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
import { detectArchetypes } from "./archetypes";
import type {
  Competitiveness,
  LeagueAverages,
  LeagueFormat,
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
// Competitiveness math (starter / FLEX / depth) uses redraft values.
// Window math (age / young share) uses dynasty values.

const REDRAFT = (p: Player): number => p.valueRedraft;

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
    depth[pos] = sorted.slice(baseN, baseN + 3);
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

export function classifyPosition(score: PositionScore["urgency"]): PositionScore["classification"] {
  if (score > 70) return "CRITICAL_NEED";
  if (score >= 50) return "NEED";
  if (score >= 30) return "HEALTHY";
  return "SURPLUS";
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
  const depth = depthByPosition(team.players, format);
  const out: Record<Position, PositionScore> = {} as Record<Position, PositionScore>;

  const compFactor: Record<Competitiveness, number> = { STRONG: 90, AVERAGE: 60, WEAK: 30 };
  const windowFactor: Record<WindowTier, number> = { SHORT: 90, MID: 60, LONG: 30 };
  const pressure = (compFactor[team.competitiveness] + windowFactor[team.windowTier]) / 2;

  for (const pos of POSITIONS) {
    const starterValue = starters[pos].reduce((s, p) => s + p.valueRedraft, 0);
    const depthValue = depth[pos].reduce((s, p) => s + p.valueRedraft, 0);
    const starterScore = score0to100(starterValue, averages.starter[pos] || 1);
    const depthScore = score0to100(depthValue, averages.depth[pos] || 1);

    const starterGap = Math.max(0, 100 - starterScore);
    const depthGap = Math.max(0, 100 - depthScore);
    const pickFactor = 50;

    const urgency =
      starterGap * 0.4 + pressure * 0.3 + depthGap * 0.15 + pickFactor * 0.15;

    out[pos] = {
      starterValue,
      starterScore,
      depthValue,
      depthScore,
      urgency,
      classification: classifyPosition(urgency),
    };
  }
  return out;
}

// ── Main pipeline ────────────────────────────────────────────────────────────

export function computeAllProfiles(
  teams: TeamInput[],
  format: LeagueFormat,
  thisYear: number,
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
    const depth = depthByPosition(playersAdj, format);
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

  // League averages
  const avgStarter: Record<Position, number> = { QB: 0, RB: 0, WR: 0, TE: 0 };
  const avgDepth: Record<Position, number> = { QB: 0, RB: 0, WR: 0, TE: 0 };
  let avgFlex = 0;
  for (const t of stage2) {
    for (const pos of POSITIONS) {
      avgStarter[pos] += t.starters[pos].reduce((s, p) => s + p.valueRedraft, 0);
      avgDepth[pos] += t.depth[pos].reduce((s, p) => s + p.valueRedraft, 0);
    }
    avgFlex += t.flexValue;
  }
  for (const pos of POSITIONS) {
    avgStarter[pos] /= stage2.length;
    avgDepth[pos] /= stage2.length;
  }
  avgFlex /= stage2.length;
  const averages: LeagueAverages = {
    starter: avgStarter,
    depth: avgDepth,
    flex: avgFlex,
    pickCapital: meanCap,
    pickCapitalStd: stdCap,
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
    };
    profile.archetypes = detectArchetypes(profile, averages, format);
    return profile;
  });
}
