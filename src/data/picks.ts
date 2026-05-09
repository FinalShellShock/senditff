import { normName } from "./normalize";
import type { SleeperRoster, SleeperTradedPick } from "./types";

// Build pick ownership map: rosterId -> Set of "year|round|origRosterId" keys.
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

// Resolve a pick's dynasty value from the FantasyCalc dynasty map.
// Round 1 uses tiered labels (early/mid/late 1st) when available.
// Falls back to hardcoded defaults when FantasyCalc has no entry.
export function resolvePickValue(
  dynastyValues: Map<string, { value: number; age?: number }>,
  teamCount: number,
  year: number,
  round: number,
  slot: number,
): number {
  const third = Math.ceil(teamCount / 3);
  if (round === 1) {
    const tier = slot <= third ? "early" : slot <= 2 * third ? "mid" : "late";
    const v =
      dynastyValues.get(normName(`${year} ${tier} 1st`))?.value ??
      dynastyValues.get(normName(`${year} 1st`))?.value;
    if (v) return v;
    return slot <= third ? 2500 : slot <= 2 * third ? 2000 : 1500;
  }
  const labels = ["1st", "2nd", "3rd", "4th"] as const;
  const v = dynastyValues.get(normName(`${year} ${labels[round - 1]}`))?.value;
  if (v) return v;
  return round === 2 ? 900 : round === 3 ? 450 : 200;
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
