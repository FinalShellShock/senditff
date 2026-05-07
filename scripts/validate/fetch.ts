import type {
  FantasyCalcEntry,
  LeagueFormat,
  SleeperLeague,
  SleeperPlayer,
  SleeperRoster,
  SleeperTradedPick,
  SleeperUser,
} from "./types.ts";

const SLEEPER = "https://api.sleeper.app/v1";
const FCALC = "https://api.fantasycalc.com/values/current";

export async function fetchLeague(leagueId: string): Promise<{
  league: SleeperLeague;
  users: SleeperUser[];
  rosters: SleeperRoster[];
  tradedPicks: SleeperTradedPick[];
}> {
  const [lR, uR, rR, pR] = await Promise.all([
    fetch(`${SLEEPER}/league/${leagueId}`),
    fetch(`${SLEEPER}/league/${leagueId}/users`),
    fetch(`${SLEEPER}/league/${leagueId}/rosters`),
    fetch(`${SLEEPER}/league/${leagueId}/traded_picks`),
  ]);
  if (!lR.ok) throw new Error(`Sleeper league fetch failed: HTTP ${lR.status}`);
  if (!uR.ok) throw new Error(`Sleeper users fetch failed: HTTP ${uR.status}`);
  if (!rR.ok) throw new Error(`Sleeper rosters fetch failed: HTTP ${rR.status}`);
  return {
    league: (await lR.json()) as SleeperLeague,
    users: (await uR.json()) as SleeperUser[],
    rosters: (await rR.json()) as SleeperRoster[],
    tradedPicks: pR.ok ? ((await pR.json()) as SleeperTradedPick[]) : [],
  };
}

export async function fetchPlayers(): Promise<Record<string, SleeperPlayer>> {
  const r = await fetch(`${SLEEPER}/players/nfl`);
  if (!r.ok) throw new Error(`Sleeper players fetch failed: HTTP ${r.status}`);
  return (await r.json()) as Record<string, SleeperPlayer>;
}

async function fetchFantasyCalcOne(
  format: LeagueFormat,
  isDynasty: boolean,
): Promise<FantasyCalcEntry[]> {
  const ppr = format.scoring === "ppr" ? 1 : format.scoring === "half" ? 0.5 : 0;
  const numQbs = format.superflex ? 2 : 1;
  const url = `${FCALC}?isDynasty=${isDynasty}&numQbs=${numQbs}&ppr=${ppr}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`FantasyCalc fetch failed: HTTP ${r.status} (${url})`);
  return (await r.json()) as FantasyCalcEntry[];
}

// Fetches both dynasty and redraft value sets in parallel.
// Dynasty is the source of truth for picks (redraft has no pick values),
// so the dynasty fetch also seeds the pick value lookup.
export async function fetchFantasyCalc(
  format: LeagueFormat,
): Promise<{ dynasty: FantasyCalcEntry[]; redraft: FantasyCalcEntry[] }> {
  const [dynasty, redraft] = await Promise.all([
    fetchFantasyCalcOne(format, true),
    fetchFantasyCalcOne(format, false),
  ]);
  return { dynasty, redraft };
}

export function detectFormat(league: SleeperLeague): LeagueFormat {
  const slots = { QB: 0, RB: 0, WR: 0, TE: 0, FLEX: 0, SUPER_FLEX: 0 };
  const idpSlots = new Set(["DL", "LB", "DB", "DEF", "IDP_FLEX", "DT", "DE", "CB", "S"]);
  let idp = false;
  for (const slot of league.roster_positions) {
    if (slot === "QB") slots.QB++;
    else if (slot === "RB") slots.RB++;
    else if (slot === "WR") slots.WR++;
    else if (slot === "TE") slots.TE++;
    else if (slot === "FLEX" || slot === "WRRB_FLEX" || slot === "WRRB_TE") slots.FLEX++;
    else if (slot === "SUPER_FLEX" || slot === "SUPER FLEX") slots.SUPER_FLEX++;
    else if (idpSlots.has(slot)) idp = true;
  }
  const superflex = slots.SUPER_FLEX > 0 || slots.QB >= 2;
  const rec = league.scoring_settings?.rec ?? 0;
  const scoring: LeagueFormat["scoring"] = rec >= 0.9 ? "ppr" : rec >= 0.4 ? "half" : "std";
  const tep = (league.scoring_settings?.bonus_rec_te ?? 0) > 0;
  return {
    superflex,
    scoring,
    tep,
    idp,
    starterSlots: slots,
    teamCount: league.total_rosters,
  };
}

// Deterministic name normalization. Used for Sleeper <-> FantasyCalc matching.
export function normName(name: string | null | undefined): string {
  if (!name) return "";
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .replace(/(jr|sr|ii|iii|iv|v)$/, "");
}

// Build pick ownership map: rosterId -> Set of "year|round|origRosterId" keys.
// Uses current draft year + next 2 years, rounds 1-4.
export function buildPicksMap(
  rosters: SleeperRoster[],
  tradedPicks: SleeperTradedPick[],
  draftYears: number[],
  rounds = [1, 2, 3, 4],
): Map<number, Set<string>> {
  const map = new Map<number, Set<string>>();
  for (const r of rosters) {
    const set = new Set<string>();
    for (const y of draftYears) for (const rd of rounds) set.add(`${y}|${rd}|${r.roster_id}`);
    map.set(r.roster_id, set);
  }
  for (const pk of tradedPicks) {
    const y = parseInt(pk.season, 10);
    if (!draftYears.includes(y)) continue;
    if (!rounds.includes(pk.round)) continue;
    const origKey = `${y}|${pk.round}|${pk.roster_id}`;
    for (const set of map.values()) set.delete(origKey);
    // pk.owner_id here is the roster_id of the new owner (Sleeper quirk on this endpoint)
    const newOwner = map.get(pk.owner_id);
    if (newOwner) newOwner.add(origKey);
  }
  return map;
}

// Project draft slot per roster: 1 = earliest pick (worst record).
// Tiebreaker: lower fpts ahead. Final tiebreaker: roster_id ascending (deterministic).
export function projectDraftSlots(rosters: SleeperRoster[]): Map<number, number> {
  const ordered = [...rosters].sort((a, b) => {
    const wa = a.settings?.wins ?? 0;
    const wb = b.settings?.wins ?? 0;
    if (wa !== wb) return wa - wb;
    const fa = parseFloat(String(a.settings?.fpts ?? 0));
    const fb = parseFloat(String(b.settings?.fpts ?? 0));
    if (fa !== fb) return fa - fb;
    return a.roster_id - b.roster_id;
  });
  const map = new Map<number, number>();
  ordered.forEach((r, i) => map.set(r.roster_id, i + 1));
  return map;
}
