import { fetchFantasyCalc } from "../../src/data/fantasycalc";
import { normName } from "../../src/data/normalize";
import type { LeagueFormat, Position } from "../../src/algo/types";
import { adminDb } from "./admin";

const SNAPSHOT_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

const SCORING_POSITIONS: Position[] = ["QB", "RB", "WR", "TE"];

export type ValueMaps = {
  dynastyValues: Map<string, { value: number; age?: number }>;
  redraftValues: Map<string, { value: number; age?: number }>;
  // Global player pools, value-sorted descending. These are the FantasyCalc
  // universe at each position for this format, NOT filtered to rostered
  // players. Used by the algorithm for player-level rank scoring so dropping
  // a startable player doesn't artificially shift everyone else up.
  dynastyByPos: Record<Position, number[]>;
  redraftByPos: Record<Position, number[]>;
};

function formatKey(format: LeagueFormat): string {
  return `${format.superflex ? "sf" : "1qb"}_${format.scoring}${format.tep ? "_tep" : ""}`;
}

// Returns FantasyCalc value maps for the given format. Fetches fresh data
// if the stored snapshot is older than 12 hours OR the cached snapshot is
// missing the position-keyed pools (older schema). Otherwise uses cached.
export async function getValueMaps(format: LeagueFormat): Promise<ValueMaps> {
  const key = formatKey(format);
  const ref = adminDb.collection("valueSnapshots").doc(key);
  const snap = await ref.get();

  const now = Date.now();
  if (snap.exists) {
    const data = snap.data() as StoredSnapshot | undefined;
    const updatedAt = data?.["updatedAt"];
    const hasNewSchema = !!data?.["dynastyByPos"] && !!data?.["redraftByPos"];
    if (updatedAt && hasNewSchema && now - new Date(updatedAt).getTime() < SNAPSHOT_TTL_MS) {
      return deserializeSnapshot(data);
    }
  }

  // Fetch fresh and store
  const fcalc = await fetchFantasyCalc(format);
  const dynastyValues: Map<string, { value: number; age?: number }> = new Map();
  const redraftValues: Map<string, { value: number; age?: number }> = new Map();
  const dynastyByPos: Record<Position, number[]> = { QB: [], RB: [], WR: [], TE: [] };
  const redraftByPos: Record<Position, number[]> = { QB: [], RB: [], WR: [], TE: [] };

  for (const e of fcalc.dynasty) {
    const k = normName(e.player?.name);
    if (k) dynastyValues.set(k, { value: e.value, age: e.player?.age });
    const pos = e.player?.position as Position | undefined;
    if (pos && SCORING_POSITIONS.includes(pos)) dynastyByPos[pos].push(e.value);
  }
  for (const e of fcalc.redraft) {
    const k = normName(e.player?.name);
    if (k) redraftValues.set(k, { value: e.value, age: e.player?.age });
    const pos = e.player?.position as Position | undefined;
    if (pos && SCORING_POSITIONS.includes(pos)) redraftByPos[pos].push(e.value);
  }
  for (const pos of SCORING_POSITIONS) {
    dynastyByPos[pos].sort((a, b) => b - a);
    redraftByPos[pos].sort((a, b) => b - a);
  }

  const stored: StoredSnapshot = {
    dynastyValues: Object.fromEntries(dynastyValues),
    redraftValues: Object.fromEntries(redraftValues),
    dynastyByPos,
    redraftByPos,
    updatedAt: new Date(now).toISOString(),
  };
  await ref.set(stored);

  return { dynastyValues, redraftValues, dynastyByPos, redraftByPos };
}

type StoredSnapshot = {
  dynastyValues: Record<string, { value: number; age?: number }>;
  redraftValues: Record<string, { value: number; age?: number }>;
  dynastyByPos?: Record<Position, number[]>;
  redraftByPos?: Record<Position, number[]>;
  updatedAt: string;
};

function deserializeSnapshot(data: StoredSnapshot): ValueMaps {
  const empty: Record<Position, number[]> = { QB: [], RB: [], WR: [], TE: [] };
  return {
    dynastyValues: new Map(Object.entries(data.dynastyValues)),
    redraftValues: new Map(Object.entries(data.redraftValues)),
    dynastyByPos: data.dynastyByPos ?? empty,
    redraftByPos: data.redraftByPos ?? empty,
  };
}
