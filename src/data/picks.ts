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

const ROUND_LABELS = ["1st", "2nd", "3rd", "4th", "5th", "6th", "7th"] as const;

// Per-round slot curves parsed from the value map ("YYYY Pick R.SS" entries,
// which FantasyCalc publishes for the upcoming draft, rounds 1-4, slots up
// to 12 regardless of league size). Cached per value map — parsing scans
// every key once.
type SlotCurves = Map<number, { slots: Map<number, number>; mean: number }>;
const curveCache = new WeakMap<Map<string, { value: number; age?: number }>, SlotCurves>();

function slotCurves(
  dynastyValues: Map<string, { value: number; age?: number }>,
): SlotCurves {
  const cached = curveCache.get(dynastyValues);
  if (cached) return cached;
  // normName("2026 Pick 1.01") -> "2026pick101"
  const byYearRound = new Map<string, Map<number, number>>();
  for (const [key, entry] of dynastyValues) {
    const m = /^(\d{4})pick(\d)(\d{2})$/.exec(key);
    if (!m) continue;
    const yearRound = `${m[1]}|${m[2]}`;
    const slots = byYearRound.get(yearRound) ?? new Map<number, number>();
    slots.set(parseInt(m[3]!, 10), entry.value);
    byYearRound.set(yearRound, slots);
  }
  // Keep one curve per round: the year with the most slots (the upcoming draft).
  const curves: SlotCurves = new Map();
  const chosenSize = new Map<number, number>();
  for (const [yearRound, slots] of byYearRound) {
    const round = parseInt(yearRound.split("|")[1]!, 10);
    if (slots.size < 3) continue; // not a usable curve
    if (slots.size <= (chosenSize.get(round) ?? 0)) continue;
    chosenSize.set(round, slots.size);
    const mean = [...slots.values()].reduce((s, v) => s + v, 0) / slots.size;
    curves.set(round, { slots, mean });
  }
  curveCache.set(dynastyValues, curves);
  return curves;
}

// How a tier's slots compare to the round's average, from the published
// curve shape. 1.0 when no curve exists for the round.
function tierMultiplier(
  dynastyValues: Map<string, { value: number; age?: number }>,
  round: number,
  tier: PickTier,
): number {
  const curve = slotCurves(dynastyValues).get(round);
  if (!curve || curve.mean <= 0) return 1;
  const slotNums = [...curve.slots.keys()].sort((a, b) => a - b);
  const third = Math.ceil(slotNums.length / 3);
  const bucket =
    tier === "early" ? slotNums.slice(0, third)
    : tier === "mid" ? slotNums.slice(third, 2 * third)
    : slotNums.slice(2 * third);
  if (bucket.length === 0) return 1;
  const bucketMean = bucket.reduce((s, n) => s + (curve.slots.get(n) ?? 0), 0) / bucket.length;
  return bucketMean / curve.mean;
}

// How much of the projected tier spread survives per year of distance. A
// "late 1st" two drafts out is a guess: the strong team it came from can
// crater. Tier multipliers blend toward mid by this factor per year, so
// distant projections price closer to the median outcome.
export const TIER_CONVICTION_DECAY = 0.65;

// Resolve a pick's dynasty value from FantasyCalc.
//
// `slotOrTier` is either a concrete slot number (1..teamCount) for picks
// belonging to the upcoming draft where Sleeper publishes the real slot, or
// a tier string ("early" | "mid" | "late") for projected future-year picks.
// `yearsOut` (0 = upcoming draft) fades projected tiers toward mid.
//
// Resolution order:
//   1. Exact slot entry ("2026 Pick 1.01") — published for the upcoming
//      draft. A 1.01 is worth ~3x a 1.12; treating them alike was flattening
//      every pick valuation in the app.
//   2. Generic round value for the year ("2027 1st") scaled by a tier
//      multiplier derived from the published slot-curve shape (uncertainty-
//      faded by yearsOut), so a projected-early future 1st beats a
//      projected-late one, but not with false confidence.
//   3. Hardcoded fallbacks.
export function resolvePickValue(
  dynastyValues: Map<string, { value: number; age?: number }>,
  teamCount: number,
  year: number,
  round: number,
  slotOrTier: number | PickTier,
  yearsOut = 0,
): number {
  if (typeof slotOrTier === "number") {
    const exact = dynastyValues.get(
      normName(`${year} Pick ${round}.${String(slotOrTier).padStart(2, "0")}`),
    );
    if (exact) return exact.value;
  }
  const tier =
    typeof slotOrTier === "number" ? slotToTier(slotOrTier, teamCount) : slotOrTier;

  const label = ROUND_LABELS[round - 1];
  const generic = label ? dynastyValues.get(normName(`${year} ${label}`))?.value : undefined;
  if (generic) {
    const tierMult = tierMultiplier(dynastyValues, round, tier);
    const midMult = tierMultiplier(dynastyValues, round, "mid");
    const conviction = yearsOut <= 0 ? 1 : Math.pow(TIER_CONVICTION_DECAY, yearsOut);
    const effMult = midMult + (tierMult - midMult) * conviction;
    return Math.round(generic * effMult);
  }

  if (round === 1) return tier === "early" ? 2500 : tier === "mid" ? 2000 : 1500;
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
