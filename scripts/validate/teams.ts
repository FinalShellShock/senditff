// Shared league-input loader for the validate scripts. Fetches Sleeper +
// FantasyCalc, then delegates team assembly to api/_lib/buildTeams — the
// exact code the sync endpoint runs — so offline calibration can never
// drift from production again. (It did once: the harness used Sleeper's
// floored integer ages while prod computed decimal ages from birth dates,
// shifting every window pressure by 2-3 points.)
//
// Optional disk cache keeps raw API responses stable across runs so algo
// changes can be diffed against identical inputs.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import type { LeagueFormat, Position, TeamInput } from "../../src/algo/index.ts";
import {
  detectFormat,
  fetchFantasyCalc,
  fetchLeague,
  fetchPlayers,
  findUpcomingDraft,
  normName,
} from "../../src/data/index.ts";

// api/ is a CommonJS tree (api/package.json sets type: commonjs for Vercel).
const require = createRequire(import.meta.url);
const { buildTeamInputs } =
  require("../../api/_lib/buildTeams.ts") as typeof import("../../api/_lib/buildTeams.ts");

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
  const { league, users, rosters, tradedPicks, drafts } = await cached(
    cacheDir,
    `league-${leagueId}`,
    () => fetchLeague(leagueId),
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

  // Value maps + global pools, mirroring api/_lib/snapshot.ts.
  const dynastyValues = new Map<string, { value: number; age?: number }>();
  const redraftValues = new Map<string, { value: number; age?: number }>();
  const dynastyByPos: Record<Position, number[]> = { QB: [], RB: [], WR: [], TE: [] };
  const redraftByPos: Record<Position, number[]> = { QB: [], RB: [], WR: [], TE: [] };
  for (const e of fcalc.dynasty) {
    const k = normName(e.player?.name);
    if (k) dynastyValues.set(k, { value: e.value, age: e.player?.age });
    const pos = e.player?.position as Position | undefined;
    if (pos && POSITIONS.includes(pos)) dynastyByPos[pos].push(e.value);
  }
  for (const e of fcalc.redraft) {
    const k = normName(e.player?.name);
    if (k) redraftValues.set(k, { value: e.value, age: e.player?.age });
    const pos = e.player?.position as Position | undefined;
    if (pos && POSITIONS.includes(pos)) redraftByPos[pos].push(e.value);
  }
  for (const pos of POSITIONS) {
    dynastyByPos[pos].sort((a, b) => b - a);
    redraftByPos[pos].sort((a, b) => b - a);
  }

  // Same "this year" the sync endpoint derives.
  const thisYear = findUpcomingDraft(drafts, rosters)?.season ?? new Date().getFullYear();

  const myUser = users.find(
    (u) =>
      u.username?.toLowerCase() === myUsername.toLowerCase() ||
      u.display_name?.toLowerCase() === myUsername.toLowerCase(),
  );

  const teams = buildTeamInputs({
    rosters,
    users,
    tradedPicks,
    drafts,
    league,
    sleeperPlayers,
    valueMaps: { dynastyValues, redraftValues, dynastyByPos, redraftByPos },
    format,
    ...(myUser ? { mySleeperUserId: myUser.user_id } : {}),
    thisYear,
  });

  return {
    leagueName: league.name,
    format,
    teams,
    thisYear,
    teamCount: rosters.length,
    dynastyValues,
    pools: { dynastyByPos, redraftByPos },
  };
}
