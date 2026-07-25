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
  await retainDailySnapshot(ref, stored, now);

  return { dynastyValues, redraftValues, dynastyByPos, redraftByPos };
}

// Keep one dated copy of the values per day, forever.
//
// The document above is a CACHE: every refresh overwrites it, so the day
// before is gone the moment the TTL expires. That makes a whole class of
// question permanently unanswerable, and the loss is silent and cumulative.
// Two we actually want:
//
//   1. "How has this player moved over the last 7 / 15 / 30 days", which the
//      saved-drafts feature needs (see WISHLIST.md).
//   2. "The engine said buy this player in July. Did he go up?" That is
//      objective validation of the algorithm against the market, as opposed
//      to the thumbs, which only tell us whether a trade LOOKED right.
//
// Neither can be backfilled. Every day without this is a datapoint that
// cannot be recovered at any price, which is why it ships ahead of the
// features that consume it.
//
// First write of a given day wins, so the cost is at most one extra document
// per format per day (a few tens of KB) regardless of how often the cache
// refreshes. Failures are swallowed: history is valuable, but not more
// valuable than serving the request.
async function retainDailySnapshot(
  ref: FirebaseFirestore.DocumentReference,
  stored: StoredSnapshot,
  now: number,
): Promise<void> {
  try {
    const day = new Date(now).toISOString().slice(0, 10); // YYYY-MM-DD, UTC
    const dailyRef = ref.collection("daily").doc(day);
    if ((await dailyRef.get()).exists) return;
    await dailyRef.set(stored);
  } catch (err) {
    console.error("daily snapshot retention failed", err);
  }
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
