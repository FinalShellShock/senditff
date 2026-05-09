import { resolve } from "node:path";
import { computeAllProfiles } from "../../src/algo/index.ts";
import type { Pick, Player, Position } from "../../src/algo/index.ts";
import {
  buildPicksMap,
  detectFormat,
  fetchFantasyCalc,
  fetchLeague,
  fetchPlayers,
  normName,
  projectDraftSlots,
  resolvePickValue,
} from "../../src/data/index.ts";
import type { SleeperPlayer } from "../../src/data/index.ts";
import { printTerminal, writeHtmlReport } from "./report.ts";

const DEFAULT_LEAGUE_ID = "1336158419664506880";
const MY_SLEEPER_USERNAME = "FinalShellShock";

const POSITIONS: Position[] = ["QB", "RB", "WR", "TE"];

async function main(): Promise<void> {
  const leagueId = process.argv[2] ?? DEFAULT_LEAGUE_ID;
  const myUsername = process.argv[3] ?? MY_SLEEPER_USERNAME;

  console.log(`Fetching league ${leagueId}...`);
  const { league, users, rosters, tradedPicks } = await fetchLeague(leagueId);

  const format = detectFormat(league);
  if (format.idp) {
    console.error("This league has IDP slots. v2 does not support IDP yet. Aborting.");
    process.exit(1);
  }

  console.log(`Format: ${format.superflex ? "Superflex" : "1QB"} · ${format.scoring.toUpperCase()}${format.tep ? " · TEP" : ""}`);
  console.log(`Fetching player DB and FantasyCalc values (dynasty + redraft) in parallel...`);
  const [sleeperPlayers, fcalc] = await Promise.all([fetchPlayers(), fetchFantasyCalc(format)]);

  // Two value maps. Dynasty also seeds pick values (redraft has no picks).
  const dynastyMap = new Map<string, { value: number; age?: number }>();
  const redraftMap = new Map<string, { value: number; age?: number }>();
  for (const e of fcalc.dynasty) {
    const k = normName(e.player?.name);
    if (k) dynastyMap.set(k, { value: e.value, age: e.player?.age });
  }
  for (const e of fcalc.redraft) {
    const k = normName(e.player?.name);
    if (k) redraftMap.set(k, { value: e.value, age: e.player?.age });
  }

  // Build pick ownership
  const thisYear = new Date().getFullYear();
  const draftYears = [thisYear, thisYear + 1, thisYear + 2];
  const picksMap = buildPicksMap(rosters, tradedPicks, draftYears);
  const draftSlots = projectDraftSlots(rosters);

  // Pick values are dynasty (redraft has no picks). Used only by the window axis.

  const myUser = users.find(
    (u) =>
      u.username?.toLowerCase() === myUsername.toLowerCase() ||
      u.display_name?.toLowerCase() === myUsername.toLowerCase(),
  );

  const teams = rosters.map((r) => {
    const user = users.find((u) => u.user_id === r.owner_id);
    const ownerName = user?.display_name ?? `Team ${r.roster_id}`;

    // Players
    const players: Player[] = (r.players ?? [])
      .map((id): Player | null => {
        const sp: SleeperPlayer | undefined = sleeperPlayers[id];
        if (!sp) return null;
        const fullName = sp.full_name ?? `${sp.first_name ?? ""} ${sp.last_name ?? ""}`.trim();
        const pos = sp.position;
        if (!pos || !POSITIONS.includes(pos as Position)) return null;
        const k = normName(fullName);
        const dyn = dynastyMap.get(k);
        const red = redraftMap.get(k);
        return {
          id,
          name: fullName,
          position: pos as Position,
          team: sp.team ?? null,
          age: sp.age ?? dyn?.age ?? red?.age ?? null,
          valueRedraft: red?.value ?? 0,
          valueDynasty: dyn?.value ?? 0,
        };
      })
      .filter((p): p is Player => p !== null);

    // Picks
    const ownPicks = picksMap.get(r.roster_id) ?? new Set<string>();
    const picks: Pick[] = Array.from(ownPicks)
      .map((key): Pick => {
        const [yearStr, roundStr, origStr] = key.split("|");
        const year = parseInt(yearStr!, 10);
        const round = parseInt(roundStr!, 10);
        const origRosterId = parseInt(origStr!, 10);
        const slot = draftSlots.get(origRosterId) ?? rosters.length;
        const value = resolvePickValue(dynastyMap, rosters.length, year, round, slot);
        const slotStr = `${round}.${String(slot).padStart(2, "0")}`;
        const origRoster = rosters.find((rr) => rr.roster_id === origRosterId);
        const origUser = users.find((u) => u.user_id === origRoster?.owner_id);
        const viaSuffix =
          origRosterId !== r.roster_id ? ` (via ${origUser?.display_name ?? "?"})` : "";
        return {
          year,
          round,
          origRosterId,
          ownerRosterId: r.roster_id,
          slot,
          label: `${year} ${slotStr}${viaSuffix}`,
          value,
        };
      })
      .sort((a, b) => a.label.localeCompare(b.label));

    return {
      rosterId: r.roster_id,
      ownerName,
      isMine: !!myUser && r.owner_id === myUser.user_id,
      record: `${r.settings?.wins ?? 0}-${r.settings?.losses ?? 0}`,
      players,
      picks,
    };
  });

  const profiles = computeAllProfiles(teams, format, thisYear);
  printTerminal(league.name, format, profiles);

  const outPath = resolve("validate-output.html");
  writeHtmlReport(outPath, league.name, format, profiles);
  console.log(`\nHTML report written to: ${outPath}`);
  console.log(`Open it: open "${outPath}"`);
}

main().catch((err) => {
  console.error("Validation script failed:");
  console.error(err);
  process.exit(1);
});
