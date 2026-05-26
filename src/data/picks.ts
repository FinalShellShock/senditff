import { normName } from "./normalize";
import type { PickTier } from "../algo/types";
import type { SleeperDraft, SleeperRoster, SleeperTradedPick } from "./types";

// Build pick ownership map: rosterId -> Set of "year|round|origRosterId" keys.
export function buildPicksMap(
  rosters: SleeperRoster[],
  tradedPicks: SleeperTradedPick[],
  draftYears: number[],
  draftRounds: number,
): Map<number, Set<string>> {
  const rounds = Array.from({ length: draftRounds }, (_, i) => i + 1);
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

// Resolve a pick's dynasty value from FantasyCalc.
//
// `slotOrTier` is either a concrete slot number (1..teamCount) for picks
// belonging to the upcoming draft where Sleeper publishes the real slot, or
// a tier string ("early" | "mid" | "late") for projected future-year picks.
// Rounds 2+ ignore the tier (FantasyCalc doesn't distinguish) and just use
// the generic "YYYY 2nd" / "3rd" / "4th" label.
export function resolvePickValue(
  dynastyValues: Map<string, { value: number; age?: number }>,
  teamCount: number,
  year: number,
  round: number,
  slotOrTier: number | PickTier,
): number {
  if (round === 1) {
    const tier =
      typeof slotOrTier === "number" ? slotToTier(slotOrTier, teamCount) : slotOrTier;
    const v =
      dynastyValues.get(normName(`${year} ${tier} 1st`))?.value ??
      dynastyValues.get(normName(`${year} 1st`))?.value;
    if (v) return v;
    return tier === "early" ? 2500 : tier === "mid" ? 2000 : 1500;
  }
  const labels = ["1st", "2nd", "3rd", "4th", "5th", "6th", "7th"] as const;
  const v = dynastyValues.get(normName(`${year} ${labels[round - 1]}`))?.value;
  if (v) return v;
  return round === 2 ? 900 : round === 3 ? 450 : 200;
}

// Convert a concrete slot to its tier (early/mid/late thirds of the round).
export function slotToTier(slot: number, teamCount: number): PickTier {
  const third = Math.ceil(teamCount / 3);
  return slot <= third ? "early" : slot <= 2 * third ? "mid" : "late";
}

// Project draft slot per roster from current standings (worst record = slot 1).
// Used as the fallback when Sleeper hasn't published a real slot order yet
// (i.e. for future-year picks beyond the upcoming draft).
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

// Find the upcoming draft (next pre_draft / drafting / paused) and return
// its season + actual slot-by-roster mapping. Returns null if every draft
// is complete (next year's order isn't published yet) or no drafts exist.
//
// Sleeper publishes the slot truth in two different fields depending on
// status:
//   pre_draft               -> draft_order keyed by user_id (string -> slot)
//   drafting / complete     -> slot_to_roster_id keyed by slot string -> roster_id
//
// We try slot_to_roster_id first (it's denormalized for us when present),
// then fall back to draft_order resolved through rosters.owner_id.
export function findUpcomingDraft(
  drafts: SleeperDraft[],
  rosters: SleeperRoster[],
): {
  season: number;
  slotByRoster: Map<number, number>;
  rounds: number;
} | null {
  const upcoming = drafts
    .filter((d) => d.status !== "complete")
    .sort((a, b) => parseInt(a.season, 10) - parseInt(b.season, 10))[0];
  if (!upcoming) return null;
  const season = parseInt(upcoming.season, 10);
  if (!Number.isFinite(season)) return null;

  const slotByRoster = new Map<number, number>();

  const s2r = upcoming.slot_to_roster_id;
  if (s2r && Object.keys(s2r).length > 0) {
    for (const [slotStr, rosterId] of Object.entries(s2r)) {
      const slot = parseInt(slotStr, 10);
      if (Number.isFinite(slot) && typeof rosterId === "number") {
        slotByRoster.set(rosterId, slot);
      }
    }
  } else if (upcoming.draft_order) {
    // pre_draft case: draft_order is user_id -> slot. Resolve user_id back
    // to roster_id via rosters.owner_id.
    const rosterByOwner = new Map<string, number>();
    for (const r of rosters) {
      if (r.owner_id) rosterByOwner.set(r.owner_id, r.roster_id);
    }
    for (const [userId, slot] of Object.entries(upcoming.draft_order)) {
      const rosterId = rosterByOwner.get(userId);
      if (rosterId !== undefined && Number.isFinite(slot)) {
        slotByRoster.set(rosterId, slot);
      }
    }
  }

  return {
    season,
    slotByRoster,
    rounds: upcoming.settings?.rounds ?? 4,
  };
}
