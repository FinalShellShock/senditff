// Shared league-input loader for the validate scripts. Fetches Sleeper +
// FantasyCalc and assembles TeamInput rows the same way api/leagues/sync.ts
// does, with an optional disk cache so algo changes can be diffed against
// identical inputs (values move throughout the day otherwise).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { LeagueFormat, Pick, Player, Position, TeamInput } from "../../src/algo/index.ts";
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

const POSITIONS: Position[] = ["QB", "RB", "WR", "TE"];

export type LeagueInputs = {
  leagueName: string;
  format: LeagueFormat;
  teams: TeamInput[];
  thisYear: number;
  teamCount: number;
  dynastyValues: Map<string, { value: number; age?: number }>;
  pools: {
    dynastyByPos: Record<Position, number[]>;
    redraftByPos: Record<Position, number[]>;
  };
};

async function cached<T>(cacheDir: string | null, name: string, fetcher: () => Promise<T>): Promise<T> {
  if (!cacheDir) return fetcher();
  mkdirSync(cacheDir, { recursive: true });
  const path = join(cacheDir, `${name}.json`);
  if (existsSync(path)) {
    console.log(`  (cache hit: ${name})`);
    return JSON.parse(readFileSync(path, "utf8")) as T;
  }
  const data = await fetcher();
  writeFileSync(path, JSON.stringify(data));
  return data;
}

export async function loadLeagueInputs(
  leagueId: string,
  myUsername: string,
  cacheDir: string | null = null,
): Promise<LeagueInputs> {
  console.log(`Fetching league ${leagueId}...`);
  const { league, users, rosters, tradedPicks } = await cached(cacheDir, `league-${leagueId}`, () =>
    fetchLeague(leagueId),
  );

  const format = detectFormat(league);
  if (format.idp) {
    throw new Error("This league has IDP slots. v2 does not support IDP yet.");
  }

  console.log(`Format: ${format.superflex ? "Superflex" : "1QB"} · ${format.scoring.toUpperCase()}${format.tep ? " · TEP" : ""}`);
  console.log(`Fetching player DB and FantasyCalc values (dynasty + redraft)...`);
  const [sleeperPlayers, fcalc] = await Promise.all([
    cached(cacheDir, "players", fetchPlayers),
    cached(
      cacheDir,
      `fcalc-${format.superflex ? "sf" : "1qb"}_${format.scoring}${format.tep ? "_tep" : ""}`,
      () => fetchFantasyCalc(format),
    ),
  ]);

  // Two value maps. Dynasty also seeds pick values (redraft has no picks).
  const dynastyMap = new Map<string, { value: number; age?: number }>();
  const redraftMap = new Map<string, { value: number; age?: number }>();
  // Global player pools by position (mirrors api/_lib/snapshot.ts).
  const dynastyByPos: Record<Position, number[]> = { QB: [], RB: [], WR: [], TE: [] };
  const redraftByPos: Record<Position, number[]> = { QB: [], RB: [], WR: [], TE: [] };
  for (const e of fcalc.dynasty) {
    const k = normName(e.player?.name);
    if (k) dynastyMap.set(k, { value: e.value, age: e.player?.age });
    const pos = e.player?.position as Position | undefined;
    if (pos && POSITIONS.includes(pos)) dynastyByPos[pos].push(e.value);
  }
  for (const e of fcalc.redraft) {
    const k = normName(e.player?.name);
    if (k) redraftMap.set(k, { value: e.value, age: e.player?.age });
    const pos = e.player?.position as Position | undefined;
    if (pos && POSITIONS.includes(pos)) redraftByPos[pos].push(e.value);
  }
  for (const pos of POSITIONS) {
    dynastyByPos[pos].sort((a, b) => b - a);
    redraftByPos[pos].sort((a, b) => b - a);
  }

  // Build pick ownership
  const thisYear = new Date().getFullYear();
  const draftYears = [thisYear, thisYear + 1, thisYear + 2];
  const picksMap = buildPicksMap(rosters, tradedPicks, draftYears, 4);
  const draftSlots = projectDraftSlots(rosters);

  const myUser = users.find(
    (u) =>
      u.username?.toLowerCase() === myUsername.toLowerCase() ||
      u.display_name?.toLowerCase() === myUsername.toLowerCase(),
  );

  const teams: TeamInput[] = rosters.map((r) => {
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
          // Validate scripts: no Sleeper draft endpoint pulled, so all slots
          // are projections. slotKnown=false everywhere; tier inferred.
          slotKnown: false,
          tier: round === 1
            ? (slot <= Math.ceil(rosters.length / 3) ? "early"
              : slot <= 2 * Math.ceil(rosters.length / 3) ? "mid" : "late")
            : null,
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

  return {
    leagueName: league.name,
    format,
    teams,
    thisYear,
    teamCount: rosters.length,
    dynastyValues: dynastyMap,
    pools: { dynastyByPos, redraftByPos },
  };
}
