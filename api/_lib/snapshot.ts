import { fetchFantasyCalc } from "../../src/data/fantasycalc";
import { normName } from "../../src/data/normalize";
import type { LeagueFormat } from "../../src/algo/types";
import { adminDb } from "./admin";

const SNAPSHOT_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

export type ValueMaps = {
  dynastyValues: Map<string, { value: number; age?: number }>;
  redraftValues: Map<string, { value: number; age?: number }>;
};

function formatKey(format: LeagueFormat): string {
  return `${format.superflex ? "sf" : "1qb"}_${format.scoring}${format.tep ? "_tep" : ""}`;
}

// Returns FantasyCalc value maps for the given format. Fetches fresh data
// if the stored snapshot is older than 12 hours; otherwise uses cached.
export async function getValueMaps(format: LeagueFormat): Promise<ValueMaps> {
  const key = formatKey(format);
  const ref = adminDb.collection("valueSnapshots").doc(key);
  const snap = await ref.get();

  const now = Date.now();
  if (snap.exists) {
    const updatedAt = snap.data()?.["updatedAt"] as string | undefined;
    if (updatedAt && now - new Date(updatedAt).getTime() < SNAPSHOT_TTL_MS) {
      return deserializeSnapshot(snap.data() as StoredSnapshot);
    }
  }

  // Fetch fresh and store
  const fcalc = await fetchFantasyCalc(format);
  const dynastyValues: Map<string, { value: number; age?: number }> = new Map();
  const redraftValues: Map<string, { value: number; age?: number }> = new Map();

  for (const e of fcalc.dynasty) {
    const k = normName(e.player?.name);
    if (k) dynastyValues.set(k, { value: e.value, age: e.player?.age });
  }
  for (const e of fcalc.redraft) {
    const k = normName(e.player?.name);
    if (k) redraftValues.set(k, { value: e.value, age: e.player?.age });
  }

  const stored: StoredSnapshot = {
    dynastyValues: Object.fromEntries(dynastyValues),
    redraftValues: Object.fromEntries(redraftValues),
    updatedAt: new Date(now).toISOString(),
  };
  await ref.set(stored);

  return { dynastyValues, redraftValues };
}

type StoredSnapshot = {
  dynastyValues: Record<string, { value: number; age?: number }>;
  redraftValues: Record<string, { value: number; age?: number }>;
  updatedAt: string;
};

function deserializeSnapshot(data: StoredSnapshot): ValueMaps {
  return {
    dynastyValues: new Map(Object.entries(data.dynastyValues)),
    redraftValues: new Map(Object.entries(data.redraftValues)),
  };
}
