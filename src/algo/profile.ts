import {
  COMPETITIVENESS_GRID,
  PICK_ADJUSTMENT_BY_FLAG,
  PICK_DECAY,
  POSITIONS,
  DEPTH_COVER_SLOTS,
  DEPTH_RESILIENCE_CREDIT,
  DEPTH_RESILIENCE_WEIGHT,
  PRESSURE_REFERENCE_AGE,
  REMAINING_VALUE,
  STD_THRESHOLD,
  TEP_MULTIPLIER,
  VALUE_LOSS_RATE,
  WINDOW_LONG_THRESHOLD,
  WINDOW_SHORT_THRESHOLD,
} from "./constants";
import { detectArchetypes, scoreArchetypes } from "./archetypes";
import type {
  ClassifyEvidence,
  Competitiveness,
  LeagueAverages,
  LeagueFormat,
  NeedKind,
  Pick,
  PickFlag,
  Player,
  Position,
  PositionScore,
  SubClassification,
  TeamInput,
  TeamProfile,
  WindowTier,
} from "./types";

// ── Value getters ────────────────────────────────────────────────────────────
// Starter / FLEX math uses redraft values (current-season production).
// Depth math uses dynasty values (insurance + future starter pipeline + trade
// fodder). Window math (age / young share) uses dynasty values.

const REDRAFT = (p: Player): number => p.valueRedraft;
const DYNASTY = (p: Player): number => p.valueDynasty;

// Position-aware depth slot count. The old hard-coded "3 deep" assumption
// punished QB and TE in formats where most teams only roster 1-2 of them.
//   - QB: 1 backup in 1QB, 2 in SF
//   - TE: 1 in non-TEP, 2 in TEP
//   - RB/WR: 3 (insurance + FLEX rotation)
export function depthSlotsFor(pos: Position, format: LeagueFormat): number {
  if (pos === "QB") return format.superflex ? 2 : 1;
  if (pos === "TE") return format.tep ? 2 : 1;
  return 3;
}

function byValueDesc(getValue: (p: Player) => number) {
  return (a: Player, b: Player) => {
    const va = getValue(a);
    const vb = getValue(b);
    if (vb !== va) return vb - va;
    return a.id.localeCompare(b.id);
  };
}

// ── Greedy starter fill (redraft) ────────────────────────────────────────────

export function fillStarters(
  players: Player[],
  format: LeagueFormat,
  getValue: (p: Player) => number = REDRAFT,
): { starters: Record<Position, Player[]> } {
  const used = new Set<string>();
  const byPos: Record<Position, Player[]> = { QB: [], RB: [], WR: [], TE: [] };
  for (const p of [...players].sort(byValueDesc(getValue))) byPos[p.position].push(p);

  const starters: Record<Position, Player[]> = { QB: [], RB: [], WR: [], TE: [] };
  const fillFrom = (pos: Position, n: number) => {
    for (const p of byPos[pos]) {
      if (starters[pos].length >= n) break;
      if (!used.has(p.id)) {
        starters[pos].push(p);
        used.add(p.id);
      }
    }
  };
  fillFrom("QB", format.starterSlots.QB);
  fillFrom("RB", format.starterSlots.RB);
  fillFrom("WR", format.starterSlots.WR);
  fillFrom("TE", format.starterSlots.TE);

  // FLEX: best leftover RB/WR/TE
  for (let i = 0; i < format.starterSlots.FLEX; i++) {
    let best: Player | undefined;
    for (const pos of ["RB", "WR", "TE"] as Position[]) {
      for (const p of byPos[pos]) {
        if (used.has(p.id)) continue;
        if (!best || getValue(p) > getValue(best)) best = p;
        break;
      }
    }
    if (!best) break;
    starters[best.position].push(best);
    used.add(best.id);
  }

  // SUPER_FLEX: best leftover QB/RB/WR/TE
  for (let i = 0; i < format.starterSlots.SUPER_FLEX; i++) {
    let best: Player | undefined;
    for (const pos of POSITIONS) {
      for (const p of byPos[pos]) {
        if (used.has(p.id)) continue;
        if (!best || getValue(p) > getValue(best)) best = p;
        break;
      }
    }
    if (!best) break;
    starters[best.position].push(best);
    used.add(best.id);
  }

  return { starters };
}

// ── Position depth ───────────────────────────────────────────────────────────
// Depth counts from the BASE starter slots, so a player filling your FLEX is
// counted as depth at his own position as well as a starter.
//
// That looks like a double-count and it was nearly "fixed" into one. Measured
// on a real league, excluding flex starters from the depth pool is clearly
// WORSE:
//
//   Roster 10 starts five RBs (Achane, Henderson, Warren, White, Dobbins).
//   Its only true bench RB is Jaleel McLaughlin at 21, so the strict reading
//   grades the deepest RB room in the league as CRITICAL_NEED at RB.
//
//   Roster 2 is the room a user described as "pretty darn strong". Strict
//   reading drops it from SURPLUS to merely HEALTHY, away from his read.
//
// The reason is that in dynasty a fifth startable RB IS depth: he covers byes,
// he slides up on an injury, and he is a tradeable asset. "Who is my best
// benchwarmer" is the wrong question when the lineup itself is stacked at that
// position.
//
// The genuinely broken part of this was never the pool, it was that the same
// player could enter the post-injury lineup twice. That is fixed in
// postInjuryValues below, where it belongs.
export function depthByPosition(
  players: Player[],
  format: LeagueFormat,
  getValue: (p: Player) => number = REDRAFT,
): Record<Position, Player[]> {
  const baseStarters: Record<Position, number> = {
    QB: format.starterSlots.QB + (format.starterSlots.SUPER_FLEX > 0 ? 1 : 0),
    RB: format.starterSlots.RB,
    WR: format.starterSlots.WR,
    TE: format.starterSlots.TE,
  };
  const depth: Record<Position, Player[]> = { QB: [], RB: [], WR: [], TE: [] };
  for (const pos of POSITIONS) {
    const sorted = players.filter((p) => p.position === pos).sort(byValueDesc(getValue));
    const baseN = baseStarters[pos];
    const depthN = depthSlotsFor(pos, format);
    depth[pos] = sorted.slice(baseN, baseN + depthN);
  }
  return depth;
}

// ── Post-injury lineup (resilience) ──────────────────────────────────────────
// Drop the best starter at a position, promote everyone behind him, and report
// the redraft values of the lineup you are left with.
//
// Padded back to full starter length with zeros: a team with NO backup is
// charged for the empty slot instead of being flattered by a shorter average.
export function postInjuryValues(
  starters: Player[],
  depth: Player[],
): number[] {
  // Dedupe by id. A player filling the FLEX appears in BOTH lists by design
  // (see depthByPosition), so without this he is promoted twice and inflates
  // resilience for exactly the rosters that flex. Measured: one roster's
  // post-injury RB lineup read Javonte, Croskey-Merritt, Pacheco,
  // Croskey-Merritt, with the same player in two slots.
  const seen = new Set<string>();
  const promoted = [...starters.slice(1), ...depth].filter((p) => {
    if (seen.has(p.id)) return false;
    seen.add(p.id);
    return true;
  });
  return Array.from({ length: starters.length }, (_, i) => promoted[i]?.valueRedraft ?? 0);
}

// ── FLEX strength: total starter value minus position-specific value ─────────
// Naturally captures whatever fills FLEX/SF (QB in SF, TE flexing in bye weeks,
// etc.) without double-counting. Uses redraft values.

export function flexStrengthValue(
  players: Player[],
  format: LeagueFormat,
  totalStarterValue: number,
  getValue: (p: Player) => number = REDRAFT,
): number {
  let positionSpecificValue = 0;
  for (const pos of POSITIONS) {
    const baseN = format.starterSlots[pos];
    if (baseN <= 0) continue;
    const sortedAtPos = players.filter((p) => p.position === pos).sort(byValueDesc(getValue));
    positionSpecificValue += sortedAtPos.slice(0, baseN).reduce((s, p) => s + getValue(p), 0);
  }
  return Math.max(0, totalStarterValue - positionSpecificValue);
}

// ── Window math (uses dynasty values) ────────────────────────────────────────

function interp(x: number, x0: number, x1: number, y0: number, y1: number): number {
  if (x1 === x0) return y0;
  return y0 + ((x - x0) / (x1 - x0)) * (y1 - y0);
}

// Reads a value off an integer-aged table, clamping at both ends and
// interpolating between (production ages are decimals).
function fromAgeTable(age: number, table: Record<number, number>): number {
  const ages = Object.keys(table).map(Number).sort((a, b) => a - b);
  const lo = ages[0]!, hi = ages[ages.length - 1]!;
  if (age <= lo) return table[lo]!;
  if (age >= hi) return table[hi]!;
  const upper = ages.find((a) => a >= age)!;
  const lower = ages[ages.indexOf(upper) - 1]!;
  return interp(age, lower, upper, table[lower]!, table[upper]!);
}

// Expected remaining career production, in discounted PPG-years.
export function remainingValue(age: number, pos: Position): number {
  return fromAgeTable(age, REMAINING_VALUE[pos]);
}

// Per-player age pressure (0-100): the share of this player's age-23 remaining
// career value that is already gone. 0 means everything still ahead of him,
// 100 means nothing left.
//
// This used to be piecewise-linear over hand-set POSITION_CURVES breakpoints
// taken from published summaries. It now derives from measured remaining
// career value (nflverse 1999-2024, see scripts/research/AGING.md), so the
// whole app runs on ONE aging model instead of a hand curve here and a data
// curve in the trade engine. Two models that can be refit independently is a
// correctness hazard, not just a tidiness problem.
//
// The swap was validated before shipping: on Johnny's league it ranked teams
// at Spearman 0.95 against the old hand-tuned curve, so it reproduces
// established behavior while being derived rather than guessed.
export function agePressure(age: number, pos: Position): number {
  const reference = REMAINING_VALUE[pos][PRESSURE_REFERENCE_AGE];
  if (!reference) return 0;
  const pressure = 100 * (1 - remainingValue(age, pos) / reference);
  return Math.max(0, Math.min(100, pressure));
}

// Effective age: what this player's remaining career value says his age is,
// after applying his aging signal.
//
// A high-rushing QB carries roughly 18% less remaining value than his calendar
// age implies (scripts/research/SIGNALS.md). Rather than bolt a penalty onto
// every consumer, we knock his remaining value down and read back the age that
// normally corresponds to it. Everything downstream (window pressure, the
// projection, the age-arb gates) then works unchanged on one number.
//
// Two guards:
//   - The signal ramps in from 26 to 30, matching the 27-32 range the research
//     actually measured. Applying it at full strength to a 23-year-old would
//     extrapolate past the evidence onto exactly the players it hurts most
//     (Jayden Daniels and Anthony Richardson are both flagged rushers). The
//     ramp is deliberately wide: a narrow one made Jalen Hurts jump five
//     effective years between his 26th and 28th birthdays, which is an
//     artifact of the QB curve being flat, not a real cliff.
//   - Effective age never goes BELOW calendar age. Signals are warnings only;
//     nothing here makes a player younger than he is.
export function effectiveAge(p: Player): number {
  const age = p.age;
  if (age == null) return 0;
  const signal = p.agingSignal;
  if (signal == null || signal >= 1) return age;

  const ramp = Math.max(0, Math.min(1, (age - 26) / 4));
  if (ramp <= 0) return age;
  const applied = 1 - (1 - signal) * ramp;

  const target = remainingValue(age, p.position) * applied;
  const table = REMAINING_VALUE[p.position];
  const ages = Object.keys(table).map(Number).sort((a, b) => a - b);
  for (let i = 0; i < ages.length; i++) {
    const a = ages[i]!;
    if (table[a]! <= target) {
      if (i === 0) return Math.max(age, a);
      const prev = ages[i - 1]!;
      const span = table[prev]! - table[a]!;
      const t = span > 0 ? (table[prev]! - target) / span : 0;
      return Math.max(age, prev + t * (a - prev));
    }
  }
  return Math.max(age, ages[ages.length - 1]!);
}

// Annualized percent of remaining dynasty value this player loses per year.
// Reads the empirical VALUE_LOSS_RATE table, clamping to the nearest tabulated
// age at either end and interpolating between (the table is integer-aged;
// production ages are decimals).
export function valueLossRate(age: number, pos: Position): number {
  const table = VALUE_LOSS_RATE[pos];
  const ages = Object.keys(table).map(Number).sort((a, b) => a - b);
  const lo = ages[0]!, hi = ages[ages.length - 1]!;
  if (age <= lo) return table[lo]!;
  if (age >= hi) return table[hi]!;
  const upper = ages.find((a) => a >= age)!;
  const lower = ages[ages.indexOf(upper) - 1]!;
  return interp(age, lower, upper, table[lower]!, table[upper]!);
}

// Starter age pressure: REDRAFT-value-weighted avg of player pressures across
// the actual starting lineup. Answers "are the players actually filling your
// lineup right now aging out?"
//   - Lineup chosen by greedy fill on redraft values (current production)
//   - Each starter contributes pressure × their redraft value
//   - Bench players don't count (they're not contributing this season)
//   - Picks influence the window via PICK_RICH/POOR adjustment, not here
export function starterAgePressure(players: Player[], format: LeagueFormat): number {
  const { starters } = fillStarters(players, format, REDRAFT);
  let totalNum = 0;
  let totalDen = 0;
  for (const pos of POSITIONS) {
    for (const p of starters[pos]) {
      if (p.age == null) continue;
      const pressure = agePressure(effectiveAge(p), p.position);
      totalNum += pressure * p.valueRedraft;
      totalDen += p.valueRedraft;
    }
  }
  return totalDen > 0 ? totalNum / totalDen : 50;
}

// Calendar weighted age across the starting lineup — display only.
export function starterCalendarAge(players: Player[], format: LeagueFormat): number {
  const { starters } = fillStarters(players, format, REDRAFT);
  let totalNum = 0;
  let totalDen = 0;
  for (const pos of POSITIONS) {
    for (const p of starters[pos]) {
      if (p.age == null) continue;
      totalNum += p.age * p.valueRedraft;
      totalDen += p.valueRedraft;
    }
  }
  return totalDen > 0 ? totalNum / totalDen : 25;
}

export function pickCapital(picks: Pick[], thisYear: number): number {
  let total = 0;
  for (const p of picks) {
    const yearsOut = p.year - thisYear;
    const decay = PICK_DECAY[yearsOut] ?? 0;
    total += p.value * decay;
  }
  return total;
}

// ── Score helpers ────────────────────────────────────────────────────────────

export function score0to100(value: number, leagueAvg: number): number {
  if (leagueAvg <= 0) return 50;
  const score = 50 + ((value - leagueAvg) / leagueAvg) * 50;
  return Math.max(0, Math.min(100, score));
}

// Helper: mean + std of the top-N values in a value-sorted pool. Used to
// build the reference distribution that z-score classification compares
// against. N comes from league context (startersInUse for starters,
// depthSlotsTotal for depth).
export function topNStats(pool: number[], n: number): { mean: number; std: number } {
  const safeN = Math.max(1, Math.min(pool.length, n));
  const sorted = [...pool].sort((a, b) => b - a).slice(0, safeN);
  if (sorted.length === 0) return { mean: 0, std: 1 };
  const mean = sorted.reduce((s, v) => s + v, 0) / sorted.length;
  const variance = sorted.reduce((s, v) => s + (v - mean) ** 2, 0) / sorted.length;
  return { mean, std: Math.max(1, Math.sqrt(variance)) }; // floor std to avoid /0
}

// Helper: avg rank (with tie handling) for a value within a pool.
function avgRankInPool(value: number, pool: number[]): { avgRank: number; n: number } {
  const n = pool.length;
  if (n <= 1) return { avgRank: 1, n };
  const sorted = [...pool].sort((a, b) => b - a);
  let strictlyGreater = 0;
  let equal = 0;
  for (const v of sorted) {
    if (v > value) strictlyGreater++;
    else if (v === value) equal++;
  }
  const firstRank = strictlyGreater + 1;
  const lastRank = equal === 0 ? firstRank : strictlyGreater + equal;
  return { avgRank: (firstRank + lastRank) / 2, n };
}

// Dual-zone position score within a pool, with a data-driven startable
// threshold. Inside startable (rank ≤ threshold) the player is a real
// starter and lives in a 50-100 band; below it the player drops linearly
// into 0-50 (real need territory). Ties share avg rank so fungible plateaus
// all score the same.
//
//   pool=35 rostered QBs, startable=16 (16-team 1QB)
//   rank 1   → 100
//   rank 12  → ~67  (Dak-tier, well inside startable, HEALTHY)
//   rank 16  → 50   (edge of startable)
//   rank 17  → ~47  (just past replacement)
//   rank 35  → 0
export function positionScoreFromPool(
  value: number,
  pool: number[],
  startable: number,
): number {
  const { avgRank, n } = avgRankInPool(value, pool);
  if (n <= 1) return 50;
  const safeStartable = Math.max(1, Math.min(n, startable));
  if (avgRank <= safeStartable) {
    if (safeStartable <= 1) return 100;
    return Math.max(50, Math.min(100, 100 - 50 * (avgRank - 1) / (safeStartable - 1)));
  }
  const remaining = n - safeStartable;
  if (remaining <= 0) return 50;
  return Math.max(0, Math.min(50, 50 * (n - avgRank) / remaining));
}

// Kept for external consumers; not used in primary scoring.
export function rankPercentile(value: number, pool: number[]): number {
  const { avgRank, n } = avgRankInPool(value, pool);
  if (n <= 1) return 50;
  return Math.max(0, Math.min(100, 100 * (1 - (avgRank - 1) / (n - 1))));
}

// Weighted slot average — favors weaker slots. For multi-slot positions a
// team with Olave + trash WR3 ends up lower than a plain mean would suggest.
// Single-slot positions degenerate to that slot's own score.
//   [25, 79, 95] → (25×3 + 79×2 + 95×1) / 6 = 56.7
//   [60, 60, 60] → 60
export function weightedSlotAverage(scores: number[]): number {
  if (scores.length === 0) return 0;
  if (scores.length === 1) return scores[0] ?? 0;
  const sorted = [...scores].sort((a, b) => a - b);
  let weightedSum = 0;
  let totalWeight = 0;
  for (let i = 0; i < sorted.length; i++) {
    const weight = sorted.length - i; // [n, n-1, ..., 1]
    weightedSum += (sorted[i] ?? 0) * weight;
    totalWeight += weight;
  }
  return totalWeight > 0 ? weightedSum / totalWeight : 0;
}

// Legacy single-threshold classifier; preserved for any external consumers.
export function classifyPosition(score: PositionScore["urgency"]): PositionScore["classification"] {
  if (score > 70) return "CRITICAL_NEED";
  if (score >= 50) return "NEED";
  if (score >= 30) return "HEALTHY";
  return "SURPLUS";
}

// Per-side z-score classifier with absolute floor. Replaces the previous
// blended classifyPositionRich.
//
// Thresholds (tightened from the previous z < -0.5 / -1.5 pair to reduce
// noise — half the league shouldn't be NEED at depth just because half is
// below mean by definition):
//   z >= -1.0          → HEALTHY
//   z >= -2.0          → NEED
//   z <  -2.0          → CRITICAL
//
// Absolute floor (handles bimodal positions where wide std hides
// catastrophic absolute values):
//   value < worst_top_N × 0.15  → CRITICAL (severely below replacement)
//   value < worst_top_N × 0.35  → NEED minimum
// where worst_top_N is the lowest value in the reference top-N pool.
//
// For SURPLUS, both halves need to be solid (positive z) AND pressure low.
/** The floors classifySide tests against. Exported so the UI can draw the same
 *  lines the decision used instead of inventing its own comparison. */
export function classifyFloors(worstTopN: number): { critical: number; need: number } {
  return { critical: worstTopN * 0.15, need: worstTopN * 0.35 };
}

/** Snapshot of what a side was judged on, for display. */
export function classifyEvidence(args: {
  weightedZ: number;
  minSlotZ: number;
  minSlotValue: number;
  worstTopN: number;
}): ClassifyEvidence {
  const { critical, need } = classifyFloors(args.worstTopN);
  return {
    minSlotValue: args.minSlotValue,
    criticalFloor: critical,
    needFloor: need,
    minSlotZ: args.minSlotZ,
    weightedZ: args.weightedZ,
  };
}

export function classifySide(args: {
  weightedZ: number;
  minSlotZ: number;
  weightedValue: number;
  minSlotValue: number;
  worstTopN: number;
}): SubClassification {
  const { weightedZ, minSlotZ, weightedValue, minSlotValue, worstTopN } = args;
  const { critical: criticalFloor, need: needFloor } = classifyFloors(worstTopN);

  // CRITICAL: very far below typical OR absolute floor breach
  if (minSlotZ < -2.0 || weightedZ < -2.0 || minSlotValue < criticalFloor) {
    return "CRITICAL";
  }
  // NEED: below typical OR below VOLS-floor proxy
  if (minSlotZ < -1.0 || weightedZ < -1.0 || minSlotValue < needFloor) {
    return "NEED";
  }
  // SURPLUS: comfortably above typical
  if (weightedZ > 0.75 && minSlotZ > 0.0) {
    return "SURPLUS";
  }
  return "HEALTHY";
}

// Combine the two sub-classifications into the overall label + needKind.
// "Worst of the two halves" — if either side is CRITICAL, the position is
// CRITICAL_NEED. If one is NEED and the other is HEALTHY, it's NEED.
// SURPLUS only fires if both halves are SURPLUS-eligible AND pressure is low.
export function combineClassifications(args: {
  starterSub: SubClassification;
  depthSub: SubClassification;
  pressure: number;
}): { classification: PositionScore["classification"]; needKind: NeedKind } {
  const { starterSub, depthSub, pressure } = args;
  const sIsBad = starterSub === "CRITICAL" || starterSub === "NEED";
  const dIsBad = depthSub === "CRITICAL" || depthSub === "NEED";

  // Elite starters lift the depth floor by one step. You cannot be in critical
  // need of a position your starters dominate, and a merely thin bench behind a
  // surplus starting group is not a need at all. Before this, SURPLUS starters
  // plus a weak bench combined to CRITICAL_NEED, so the team with the best QB
  // room in the league was told it urgently needed a QB.
  //
  // Only SURPLUS earns this. "Worst of the two halves" still governs everywhere
  // else, so the case the rule was built for (a strong WR1 hiding a
  // replacement-level WR3) is untouched.
  if (starterSub === "SURPLUS" && dIsBad) {
    return depthSub === "CRITICAL"
      ? { classification: "NEED", needKind: "depth" }
      : { classification: "HEALTHY", needKind: null };
  }
  if (starterSub === "CRITICAL" || depthSub === "CRITICAL") {
    return {
      classification: "CRITICAL_NEED",
      needKind: sIsBad && dIsBad ? "both" : (starterSub === "CRITICAL" ? "starter" : "depth"),
    };
  }
  if (sIsBad && dIsBad) {
    return { classification: "NEED", needKind: "both" };
  }
  if (sIsBad) {
    return { classification: "NEED", needKind: "starter" };
  }
  if (dIsBad) {
    return { classification: "NEED", needKind: "depth" };
  }
  // Both at least HEALTHY. SURPLUS requires both SURPLUS-tier AND low pressure.
  if (starterSub === "SURPLUS" && depthSub === "SURPLUS" && pressure < 50) {
    return { classification: "SURPLUS", needKind: null };
  }
  return { classification: "HEALTHY", needKind: null };
}

// Position importance multipliers per format. These reflect marginal value
// of upgrading the position — how much going from "below replacement" to
// "above average" actually impacts wins, given league scoring + start counts.
// Calibrated from VBD scoring curves and dynasty community consensus:
//   - 1QB QB: flat curve, low marginal value → 0.7
//   - SF QB: steep curve (start 2), high marginal value → 1.0
//   - RB: steepest current-year curve in most formats → 0.95
//   - WR: deep but high-leverage in PPR → 1.0
//   - TE non-TEP: bimodal, only top ~3 truly matter → 0.7
//   - TE TEP: top ~6 matter, importance climbs → 1.0
export function positionImportance(pos: Position, format: LeagueFormat): number {
  if (pos === "QB") return format.superflex ? 1.0 : 0.7;
  if (pos === "TE") return format.tep ? 1.0 : 0.7;
  if (pos === "RB") return 0.95;
  return 1.0; // WR
}

// ── TEP applies to BOTH redraft and dynasty values ────────────────────────────

export function applyTep(players: Player[], format: LeagueFormat): Player[] {
  if (!format.tep) return players;
  return players.map((p) =>
    p.position === "TE"
      ? {
          ...p,
          valueRedraft: p.valueRedraft * TEP_MULTIPLIER,
          valueDynasty: p.valueDynasty * TEP_MULTIPLIER,
        }
      : p,
  );
}

// ── Per-position scores ──────────────────────────────────────────────────────

export function computePositionScores(
  team: { players: Player[]; competitiveness: Competitiveness; windowTier: WindowTier },
  format: LeagueFormat,
  averages: LeagueAverages,
): Record<Position, PositionScore> {
  const { starters } = fillStarters(team.players, format);
  // Depth pool ranked by dynasty value: rewards developmental QBs, young TEs,
  // and other "won't start this week but real long-term insurance" assets.
  const depth = depthByPosition(team.players, format, DYNASTY);
  const out: Record<Position, PositionScore> = {} as Record<Position, PositionScore>;

  const compFactor: Record<Competitiveness, number> = { STRONG: 90, AVERAGE: 60, WEAK: 30 };
  const windowFactor: Record<WindowTier, number> = { SHORT: 90, MID: 60, LONG: 30 };
  const pressure = (compFactor[team.competitiveness] + windowFactor[team.windowTier]) / 2;

  for (const pos of POSITIONS) {
    const starterValue = starters[pos].reduce((s, p) => s + p.valueRedraft, 0);
    const depthValue = depth[pos].reduce((s, p) => s + p.valueDynasty, 0);

    // Player-level dual-zone scoring. Each starting player's value is ranked
    // among ALL rostered players at the position; threshold = total starting
    // slots actually filled across the league. Team's position score is a
    // worst-slot-weighted average (so weak slots count more).
    const starterPlayerScores = starters[pos].map((p) =>
      positionScoreFromPool(p.valueRedraft, averages.starterPlayerPool[pos], averages.startersInUse[pos]),
    );
    const depthPlayerScores = depth[pos].map((p) =>
      positionScoreFromPool(p.valueDynasty, averages.depthPlayerPool[pos], averages.depthSlotsTotal[pos]),
    );
    const starterScore = weightedSlotAverage(starterPlayerScores);
    const minStarterSlotScore = starterPlayerScores.length > 0
      ? Math.min(...starterPlayerScores)
      : 0;

    // Depth used to be scored purely on the backups in isolation, blind to who
    // was ahead of them. That reads a roster with two elite QBs and a weak QB3
    // as critically thin at QB, which is wrong: if one starter goes down you
    // still start the other elite one, and the backup only fills the vacated
    // slot. Real feedback flagged exactly this (Daniels + Mahomes + Rodgers
    // grading CRITICAL_NEED).
    //
    // So depth now also measures RESILIENCE: drop the best starter, promote
    // everyone behind him, and score the lineup you are left with against the
    // STARTER pool. Deep rooms with elite starters survive a loss; thin ones
    // do not. This is what makes starters "play into" depth, and it self-scales
    // to thin positions because every team's QB3 is bad, so the comparison
    // stays league-relative.
    //
    // The promoted lineup is padded back to full starter length with zeros, so
    // a team with NO backup at all is charged for the empty slot rather than
    // being flattered by a short average.
    const postInjuryRedraft = postInjuryValues(starters[pos], depth[pos]);
    const hasLineup = starters[pos].length > 0;
    const postInjuryTotal = postInjuryRedraft.reduce((s, v) => s + v, 0);
    const rStats = averages.resilienceStats[pos];
    // Scored against the LEAGUE's post-injury lineups, the same 50-centered
    // shape as starter strength. Comparing against healthy starters instead
    // would sit every team below the mean by construction.
    const resilienceScore = hasLineup && rStats.mean > 0
      ? Math.max(0, Math.min(100, 50 + ((postInjuryTotal - rStats.mean) / rStats.mean) * 50))
      : 0;
    const isolatedDepthScore = weightedSlotAverage(depthPlayerScores);
    // Depth still has to mean asset quality too (the future-starter pipeline
    // and trade fodder), not only injury insurance, so this blends rather than
    // replaces.
    const depthScore =
      isolatedDepthScore * (1 - DEPTH_RESILIENCE_WEIGHT) +
      resilienceScore * DEPTH_RESILIENCE_WEIGHT;

    // Format-aware gap weights. Depth carries less weight in formats where
    // the position has only 1 depth slot. The dead pickFactor was removed —
    // it was a constant 50 with weight 0.15 that uniformly inflated every
    // urgency by 7.5 without saying anything useful.
    const depthSlots = depthSlotsFor(pos, format);
    const baseDepthWeight = 0.15;
    const baseStarterWeight = 0.50;
    const depthWeight = baseDepthWeight * (depthSlots / 3);
    const starterWeight = baseStarterWeight + (baseDepthWeight - depthWeight);

    const starterGap = Math.max(0, 100 - starterScore);
    const depthGap = Math.max(0, 100 - depthScore);

    // Urgency = weighted gap × pressure × position importance.
    //   pressure: contender bias, doesn't manufacture urgency on its own
    //   importance: 1QB QB has flat scoring curve so QB gaps matter less;
    //     TEP TE flips the other way. Calibrated from VBD curves.
    const gapUrgency =
      starterGap * starterWeight +
      depthGap * depthWeight;
    const pressureMult = 0.6 + (pressure / 100) * 0.6; // [0.6, 1.2]
    const importance = positionImportance(pos, format);
    const urgency = gapUrgency * pressureMult * importance;

    // Z-scores against the top-N starter/depth distributions, plus absolute
    // value tracking for the absolute-floor check that catches catastrophic
    // values in wide distributions (bimodal TE, etc.).
    const sStats = averages.starterStats[pos];
    const dStats = averages.depthStats[pos];
    const sortedStarterPool = [...averages.starterPlayerPool[pos]].sort((a, b) => b - a);
    const sortedDepthPool = [...averages.depthPlayerPool[pos]].sort((a, b) => b - a);
    const sWorstTopN = sortedStarterPool[Math.max(0, averages.startersInUse[pos] - 1)] ?? 1;
    const dWorstTopN = sortedDepthPool[Math.max(0, averages.depthSlotsTotal[pos] - 1)] ?? 1;

    const starterPlayerZs = starters[pos].map((p) => (p.valueRedraft - sStats.mean) / sStats.std);
    const depthPlayerZs = depth[pos].map((p) => (p.valueDynasty - dStats.mean) / dStats.std);
    const starterWeightedZ = starterPlayerZs.length > 0 ? weightedSlotAverage(starterPlayerZs) : -3;
    const minStarterZ = starterPlayerZs.length > 0 ? Math.min(...starterPlayerZs) : -3;
    const depthWeightedZ = depthPlayerZs.length > 0 ? weightedSlotAverage(depthPlayerZs) : -3;
    const minDepthZ = depthPlayerZs.length > 0 ? Math.min(...depthPlayerZs) : -3;

    const starterValues = starters[pos].map((p) => p.valueRedraft);
    const depthValues = depth[pos].map((p) => p.valueDynasty);
    const depthMinValue = depthValues.length > 0 ? Math.min(...depthValues) : 0;

    // Shotgun: starter CLASSIFICATION judges base slots only (the slots the
    // league forces you to fill at this position). fillStarters appends flex
    // spillover after the base slots, and a fifth startable WR is a luxury,
    // not a hole — the old all-slots minSlotZ made deep rooms grade WORSE
    // (a team flexing 3 extra WRs could never read SURPLUS because its worst
    // flex sat below the starter-pool mean). starterScore/urgency still use
    // the whole lineup.
    const baseSlotCount =
      pos === "QB" && format.starterSlots.SUPER_FLEX > 0
        ? format.starterSlots.QB + 1
        : format.starterSlots[pos];
    const baseZs = starterPlayerZs.slice(0, baseSlotCount);
    const baseValues = starterValues.slice(0, baseSlotCount);
    const starterArgs = {
      weightedZ: baseZs.length > 0 ? weightedSlotAverage(baseZs) : -3,
      minSlotZ: baseZs.length > 0 ? Math.min(...baseZs) : -3,
      weightedValue: baseValues.reduce((s, v) => s + v, 0),
      minSlotValue: baseValues.length > 0 ? Math.min(...baseValues) : 0,
      worstTopN: sWorstTopN,
    };
    const starterSub = classifySide(starterArgs);
    // Same resilience blend applied to the depth LABEL, not just its score.
    // Fixing only the score would leave the roster still reading "NEED at QB"
    // on screen, which is the thing that got reported.
    //
    // Both halves are compared to their own pool (backups to the depth pool,
    // the post-injury lineup to the starter pool), so the blend happens on
    // normalized quantities: z-scores, and the absolute floor as a RATIO of
    // its pool's worst startable value.
    // Resilience relief for the depth LABEL. One-sided on purpose: a team whose
    // post-injury lineup beats the league's earns up to one classification step
    // of relief, and a team below average is left exactly where it was. See
    // DEPTH_RESILIENCE_CREDIT for why this is not a blend.
    //
    // The absolute-value floor is deliberately left alone. It exists to catch a
    // genuinely worthless bench player, and that stays true no matter how good
    // the starters are.
    const resilienceZ = hasLineup && rStats.std > 0
      ? (postInjuryTotal - rStats.mean) / rStats.std
      : -3;
    const resilienceCredit =
      Math.max(0, Math.min(1, resilienceZ)) * DEPTH_RESILIENCE_CREDIT;
    // Judge the depth LABEL on the slots that can actually enter the lineup.
    // One injury promotes exactly one player, so the top backup is the coverage
    // and everything behind him is asset accumulation. This is the same rule
    // the starter side already applies ("a fifth startable WR is a luxury, not
    // a hole"), and it matters most at thin positions: a superflex roster gets
    // two depth slots at QB, so a QB4 nobody would ever start was dragging the
    // whole room to CRITICAL. Bagent at 200 was outvoting Rodgers at 1356
    // behind Daniels and Mahomes.
    //
    // depthScore, and therefore urgency, still counts every depth slot, so
    // stockpiled assets keep their value in the numbers.
    const coverZs = depthPlayerZs.slice(0, DEPTH_COVER_SLOTS);
    const coverValues = depthValues.slice(0, DEPTH_COVER_SLOTS);
    const depthArgs = {
      weightedZ: (coverZs.length > 0 ? weightedSlotAverage(coverZs) : -3) + resilienceCredit,
      minSlotZ: (coverZs.length > 0 ? Math.min(...coverZs) : -3) + resilienceCredit,
      weightedValue: depthValue,
      minSlotValue: coverValues.length > 0 ? Math.min(...coverValues) : 0,
      worstTopN: dWorstTopN,
    };
    const depthSub = classifySide(depthArgs);
    const { classification, needKind } = combineClassifications({
      starterSub,
      depthSub,
      pressure,
    });

    out[pos] = {
      starterValue,
      starterScore,
      minStarterSlotScore,
      depthValue,
      depthScore,
      urgency,
      starterClassification: starterSub,
      depthClassification: depthSub,
      classification,
      needKind,
      evidence: { starter: classifyEvidence(starterArgs), depth: classifyEvidence(depthArgs) },
    };
  }
  return out;
}

// ── Main pipeline ────────────────────────────────────────────────────────────

// Optional global player pools sourced from FantasyCalc. When provided, used
// for player-level rank scoring instead of league-rostered values. This lets
// us avoid the "dropped startable player shifts ranks" distortion and
// matches the user's intuition that every league shares the same player
// universe — only format and team count are league-specific.
export type GlobalPlayerPools = {
  dynastyByPos: Record<Position, number[]>;
  redraftByPos: Record<Position, number[]>;
};

export function computeAllProfiles(
  teams: TeamInput[],
  format: LeagueFormat,
  thisYear: number,
  globalPlayerPools?: GlobalPlayerPools,
): TeamProfile[] {
  type Stage1 = TeamInput & {
    starterTotalValue: number;
    starterAgePressure: number;
    starterCalAge: number;
    pickCapValue: number;
    flexValue: number;
    starters: Record<Position, Player[]>;
    depth: Record<Position, Player[]>;
  };

  const stage1: Stage1[] = teams.map((t) => {
    const playersAdj = applyTep(t.players, format);
    const { starters } = fillStarters(playersAdj, format);
    const depth = depthByPosition(playersAdj, format, DYNASTY);
    const starterTotalValue = POSITIONS.reduce(
      (s, pos) => s + starters[pos].reduce((a, p) => a + p.valueRedraft, 0),
      0,
    );
    const flexValue = flexStrengthValue(playersAdj, format, starterTotalValue);
    return {
      ...t,
      players: playersAdj,
      starterTotalValue,
      starterAgePressure: starterAgePressure(playersAdj, format),
      starterCalAge: starterCalendarAge(playersAdj, format),
      pickCapValue: pickCapital(t.picks, thisYear),
      flexValue,
      starters,
      depth,
    };
  });

  // Competitiveness axis (Audible: std-dev cuts instead of terciles)
  const sortedByStarter = [...stage1].sort((a, b) => {
    if (b.starterTotalValue !== a.starterTotalValue) return b.starterTotalValue - a.starterTotalValue;
    return a.rosterId - b.rosterId;
  });
  const starterRank = new Map<number, number>();
  sortedByStarter.forEach((t, i) => starterRank.set(t.rosterId, i + 1));

  const starterTotals = stage1.map((t) => t.starterTotalValue);
  const meanStarter = starterTotals.reduce((s, v) => s + v, 0) / starterTotals.length;
  const stdStarter = Math.sqrt(
    starterTotals.reduce((s, v) => s + (v - meanStarter) ** 2, 0) / starterTotals.length,
  );
  const compFor = (totalValue: number): Competitiveness => {
    if (totalValue > meanStarter + STD_THRESHOLD * stdStarter) return "STRONG";
    if (totalValue < meanStarter - STD_THRESHOLD * stdStarter) return "WEAK";
    return "AVERAGE";
  };

  // Window axis (West Coast: curve-based age pressure + pick capital)
  const caps = stage1.map((t) => t.pickCapValue);
  const meanCap = caps.reduce((s, v) => s + v, 0) / caps.length;
  const stdCap = Math.sqrt(
    caps.reduce((s, v) => s + (v - meanCap) ** 2, 0) / caps.length,
  );
  const pickFlagFor = (cap: number): PickFlag => {
    if (cap > meanCap + 1.5 * stdCap) return "PICK_RICH";
    if (cap < meanCap - 1.5 * stdCap) return "PICK_POOR";
    return "NEUTRAL";
  };

  type Stage2 = Stage1 & {
    competitiveness: Competitiveness;
    windowPressure: number;
    pickFlag: PickFlag;
  };
  // How much of each roster's dynasty value is sitting in picks. Picks cannot
  // score this season, so this is the share of a team's assets that is purely
  // unrealised: the same "unbanked" reading TEAM STATE shows, restricted to the
  // part of it picks are responsible for.
  const shareOf = (t: Stage1): number => {
    const pickDyn = t.picks.reduce((s, k) => s + (k.value || 0), 0);
    const playerDyn = t.players.reduce((s, p) => s + (p.valueDynasty || 0), 0);
    return pickDyn / Math.max(1, pickDyn + playerDyn);
  };
  const shares = stage1.map(shareOf);
  const meanShare = shares.reduce((s, v) => s + v, 0) / shares.length;
  const stdShare =
    Math.sqrt(shares.reduce((s, v) => s + (v - meanShare) ** 2, 0) / shares.length) || 1;

  // The pick contribution to the window, CONTINUOUS rather than bucketed.
  //
  // It used to read PICK_ADJUSTMENT_BY_FLAG, which is -8 / 0 / +12 off a flag
  // set at +/-1.5 standard deviations. So the input was already a z-score; the
  // flag just rounded it to three values and threw the rest away. Measured on
  // the 16 team league, NEUTRAL covered everything from 9% to 47% of assets
  // held in picks, which called FustinJerguson (49%, PICK_RICH) different from
  // Numlckr (47%, NEUTRAL) while calling Numlckr the same as a team at 9%.
  //
  // Piecewise so it reproduces the old behaviour exactly at the points that
  // were actually tuned: 0 at the mean, -8 at +1.5sd, +12 at -1.5sd. Clamped
  // to that same range rather than extrapolating past values nobody chose.
  //
  // Measured effect on the test league: 2 of 16 teams change window tier
  // (cwescoe1511 MID -> SHORT, kwescoe3 LONG -> MID). Using raw pickCapital
  // instead of the share moves the identical two teams, so the de-bucketing is
  // the whole effect and the choice of statistic is not load bearing.
  const pickAdjustment = (share: number): number => {
    const z = (share - meanShare) / stdShare;
    const raw = z >= 0 ? -(8 / 1.5) * z : -(12 / 1.5) * z;
    return Math.max(PICK_ADJUSTMENT_BY_FLAG.PICK_RICH, Math.min(PICK_ADJUSTMENT_BY_FLAG.PICK_POOR, raw));
  };

  const stage2: Stage2[] = stage1.map((t) => {
    // The flag is still computed, but only as a LABEL. Nothing scores on it.
    const pickFlag = pickFlagFor(t.pickCapValue);
    const windowPressure = Math.max(0, t.starterAgePressure + pickAdjustment(shareOf(t)));
    return {
      ...t,
      competitiveness: compFor(t.starterTotalValue),
      windowPressure,
      pickFlag,
    };
  });

  const sortedByPressure = [...stage2].sort((a, b) => {
    if (a.windowPressure !== b.windowPressure) return a.windowPressure - b.windowPressure;
    return a.rosterId - b.rosterId;
  });
  const windowRank = new Map<number, number>();
  sortedByPressure.forEach((t, i) => windowRank.set(t.rosterId, i + 1));

  const windowTierFor = (pressure: number): WindowTier => {
    if (pressure < WINDOW_LONG_THRESHOLD) return "LONG";
    if (pressure > WINDOW_SHORT_THRESHOLD) return "SHORT";
    return "MID";
  };

  // League pools + thresholds + averages.
  // - Player pools: every rostered player at each position, used by the
  //   player-level rank scoring.
  // - Aggregate pools (kept for archetype thresholding).
  // - Startable thresholds: total starting slots actually filled across the
  //   league (data-driven, captures format + actual FLEX usage).
  const starterPool: Record<Position, number[]> = { QB: [], RB: [], WR: [], TE: [] };
  const depthPool: Record<Position, number[]> = { QB: [], RB: [], WR: [], TE: [] };
  const resiliencePool: Record<Position, number[]> = { QB: [], RB: [], WR: [], TE: [] };
  const startersInUse: Record<Position, number> = { QB: 0, RB: 0, WR: 0, TE: 0 };
  const depthSlotsTotal: Record<Position, number> = { QB: 0, RB: 0, WR: 0, TE: 0 };
  // Prefer the FantasyCalc-global pool when available; only fall back to
  // assembling pools from rostered players if globalPlayerPools wasn't passed.
  const starterPlayerPool: Record<Position, number[]> = globalPlayerPools
    ? { ...globalPlayerPools.redraftByPos }
    : { QB: [], RB: [], WR: [], TE: [] };
  const depthPlayerPool: Record<Position, number[]> = globalPlayerPools
    ? { ...globalPlayerPools.dynastyByPos }
    : { QB: [], RB: [], WR: [], TE: [] };
  let avgFlex = 0;
  for (const t of stage2) {
    for (const pos of POSITIONS) {
      starterPool[pos].push(t.starters[pos].reduce((s, p) => s + p.valueRedraft, 0));
      depthPool[pos].push(t.depth[pos].reduce((s, p) => s + p.valueDynasty, 0));
      startersInUse[pos] += t.starters[pos].length;
      resiliencePool[pos].push(
        postInjuryValues(t.starters[pos], t.depth[pos]).reduce((s, v) => s + v, 0),
      );
    }
    if (!globalPlayerPools) {
      for (const p of t.players) {
        starterPlayerPool[p.position].push(p.valueRedraft);
        depthPlayerPool[p.position].push(p.valueDynasty);
      }
    }
    avgFlex += t.flexValue;
  }
  for (const pos of POSITIONS) {
    depthSlotsTotal[pos] = stage2.length * depthSlotsFor(pos, format);
  }
  // Reference distributions for z-score classification. The "top N" is the
  // league-aware startable count for starters and depth-slot count for depth.
  const starterStats = {} as Record<Position, { mean: number; std: number }>;
  const depthStats = {} as Record<Position, { mean: number; std: number }>;
  const resilienceStats = {} as Record<Position, { mean: number; std: number }>;
  for (const pos of POSITIONS) {
    starterStats[pos] = topNStats(starterPlayerPool[pos], startersInUse[pos]);
    depthStats[pos] = topNStats(depthPlayerPool[pos], depthSlotsTotal[pos]);
    // Every team counts here, not a top-N slice: the question is how this
    // team's post-injury lineup compares to the other rosters it plays.
    resilienceStats[pos] = topNStats(resiliencePool[pos], resiliencePool[pos].length);
  }
  const avgStarter: Record<Position, number> = { QB: 0, RB: 0, WR: 0, TE: 0 };
  const avgDepth: Record<Position, number> = { QB: 0, RB: 0, WR: 0, TE: 0 };
  for (const pos of POSITIONS) {
    const sSum = starterPool[pos].reduce((s, v) => s + v, 0);
    const dSum = depthPool[pos].reduce((s, v) => s + v, 0);
    avgStarter[pos] = sSum / starterPool[pos].length;
    avgDepth[pos] = dSum / depthPool[pos].length;
  }
  avgFlex /= stage2.length;
  const averages: LeagueAverages = {
    starter: avgStarter,
    depth: avgDepth,
    flex: avgFlex,
    pickCapital: meanCap,
    pickCapitalStd: stdCap,
    starterPool,
    depthPool,
    starterPlayerPool,
    depthPlayerPool,
    starterStats,
    depthStats,
    startersInUse,
    depthSlotsTotal,
    resiliencePool,
    resilienceStats,
  };

  return stage2.map((t) => {
    const tier = windowTierFor(t.windowPressure);
    const positionScores = computePositionScores(
      { players: t.players, competitiveness: t.competitiveness, windowTier: tier },
      format,
      averages,
    );
    const profile: TeamProfile = {
      rosterId: t.rosterId,
      ownerName: t.ownerName,
      isMine: t.isMine,
      record: t.record,
      players: t.players,
      picks: t.picks,
      starterTotalValue: t.starterTotalValue,
      starterRank: starterRank.get(t.rosterId)!,
      competitiveness: t.competitiveness,
      starterCalAge: t.starterCalAge,
      starterAgePressure: t.starterAgePressure,
      windowPressure: t.windowPressure,
      windowRank: windowRank.get(t.rosterId)!,
      windowTier: tier,
      windowLabel: COMPETITIVENESS_GRID[t.competitiveness][tier],
      positionScores,
      flex: {
        value: t.flexValue,
        score: score0to100(t.flexValue, averages.flex || 1),
      },
      pickCapital: {
        value: t.pickCapValue,
        score: score0to100(t.pickCapValue, averages.pickCapital || 1),
        flag: t.pickFlag,
      },
      archetypes: [],
      archetypeScores: {},
    };
    profile.archetypes = detectArchetypes(profile, averages, format);
    profile.archetypeScores = scoreArchetypes(profile, averages);
    return profile;
  });
}
