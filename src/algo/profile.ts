import {
  COMPETITIVENESS_GRID,
  PICK_ADJUSTMENT_BY_FLAG,
  PICK_DECAY,
  POSITIONS,
  POSITION_CURVES,
  PRESSURE_AT_DECLINE_START,
  PRESSURE_AT_DONE,
  PRESSURE_AT_PEAK_END,
  PRESSURE_AT_PEAK_START,
  PRESSURE_AT_PRODUCTIVE,
  STD_THRESHOLD,
  TEP_MULTIPLIER,
  WINDOW_LONG_THRESHOLD,
  WINDOW_SHORT_THRESHOLD,
} from "./constants";
import { detectArchetypes, scoreArchetypes } from "./archetypes";
import type {
  Competitiveness,
  LeagueAverages,
  LeagueFormat,
  NeedKind,
  Pick,
  PickFlag,
  Player,
  Position,
  PositionScore,
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

// ── Position depth (Spread: base starter slots only, no FLEX share) ──────────

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

// Per-player age pressure (0-100). Piecewise linear over the position curve.
export function agePressure(age: number, pos: Position): number {
  const c = POSITION_CURVES[pos];
  if (age <= c.productiveStart) return PRESSURE_AT_PRODUCTIVE;
  if (age <= c.peakStart) {
    return interp(age, c.productiveStart, c.peakStart, PRESSURE_AT_PRODUCTIVE, PRESSURE_AT_PEAK_START);
  }
  if (age <= c.peakEnd) {
    return interp(age, c.peakStart, c.peakEnd, PRESSURE_AT_PEAK_START, PRESSURE_AT_PEAK_END);
  }
  if (age <= c.declineStart) {
    return interp(age, c.peakEnd, c.declineStart, PRESSURE_AT_PEAK_END, PRESSURE_AT_DECLINE_START);
  }
  if (age <= c.done) {
    return interp(age, c.declineStart, c.done, PRESSURE_AT_DECLINE_START, PRESSURE_AT_DONE);
  }
  return PRESSURE_AT_DONE;
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
      const pressure = agePressure(p.age, p.position);
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

// Rules-based classifier + need-kind output. The score < 50 rule comes from
// the dual-zone definition: 50 is the boundary between "real starter" and
// "below replacement." If your starter scores below that, you don't have a
// real starter at this position, period — regardless of how the urgency
// math averages out.
export function classifyPositionRich(args: {
  starterScore: number;
  minStarterSlotScore: number;
  depthScore: number;
  depthSlots: number;
  pressure: number;
  urgency: number;
}): { classification: PositionScore["classification"]; needKind: NeedKind } {
  const { starterScore, minStarterSlotScore, depthScore, depthSlots, pressure, urgency } = args;

  const starterWeak = minStarterSlotScore < 50;
  const starterCritical = minStarterSlotScore < 25;
  const depthCatastrophic = depthScore < 10 || (depthScore < 20 && depthSlots >= 2);
  const depthWeak = depthScore < 35;

  // Catastrophic starter slot is critical regardless of depth.
  if (starterCritical) {
    return { classification: "CRITICAL_NEED", needKind: depthWeak ? "both" : "starter" };
  }
  // Starter below replacement (< 50 = bottom dual-zone) is NEED. If depth is
  // also bad, it's "both" — drives stronger trade pressure.
  if (starterWeak) {
    return { classification: "NEED", needKind: depthWeak ? "both" : "starter" };
  }
  // Starter is fine; check depth alone.
  if (depthCatastrophic) {
    return { classification: "NEED", needKind: "depth" };
  }
  // Urgency-driven fallback for borderline cases (e.g., decent starter but
  // multiple lukewarm signals piling up).
  if (urgency > 70) return { classification: "CRITICAL_NEED", needKind: "both" };
  if (urgency >= 50) {
    // Pick the side that's worse to label needKind.
    const kind: NeedKind = starterScore - 50 < depthScore - 50 ? "starter" : "depth";
    return { classification: "NEED", needKind: kind };
  }
  // SURPLUS requires both halves strong AND low pressure.
  if (urgency < 30 && starterScore > 70 && depthScore > 55 && pressure < 50) {
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
    const depthScore = weightedSlotAverage(depthPlayerScores);

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

    const { classification, needKind } = classifyPositionRich({
      starterScore,
      minStarterSlotScore,
      depthScore,
      depthSlots,
      pressure,
      urgency,
    });

    out[pos] = {
      starterValue,
      starterScore,
      minStarterSlotScore,
      depthValue,
      depthScore,
      urgency,
      classification,
      needKind,
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
  const stage2: Stage2[] = stage1.map((t) => {
    // Window pressure is age pressure shifted by the pick flag adjustment.
    // PICK_RICH eases the window (-8); PICK_POOR tightens it (+12).
    const pickFlag = pickFlagFor(t.pickCapValue);
    const windowPressure = Math.max(0, t.starterAgePressure + PICK_ADJUSTMENT_BY_FLAG[pickFlag]);
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
    startersInUse,
    depthSlotsTotal,
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
