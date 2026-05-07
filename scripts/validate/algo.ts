import type {
  Competitiveness,
  LeagueAverages,
  LeagueFormat,
  Pick,
  Player,
  Position,
  PositionScore,
  TeamProfile,
  WindowLabel,
  WindowTier,
} from "./types.ts";

const POSITIONS: Position[] = ["QB", "RB", "WR", "TE"];

const AGE_MULT: Record<Position, number> = {
  QB: 0.85,
  RB: 1.20,
  WR: 1.00,
  TE: 1.05,
};

const PICK_DECAY: Record<number, number> = {
  0: 1.0,
  1: 0.85,
  2: 0.70,
  3: 0.55,
};

const PICK_ADJUSTED_AGE = 22;
const TEP_MULTIPLIER = 1.15;
const YOUNG_ADJ_AGE_CUTOFF = 25;

// Window-pressure weights. Tunable.
const W_AGE = 0.40;
const W_YOUNG_SHARE = 0.35;
const W_PICK_CAPITAL = 0.25;

// Threshold for the consolidate_flex archetype: a team with FLEX score this far
// above league average has genuine "stackable trade chips" beyond positional needs.
const FLEX_CONSOLIDATE_THRESHOLD = 55;

// In-season COMPETITIVENESS weights (parked here so we don't lose the formula).
//   w_season = 0.25 + 0.04 * week
//   w_recent = max(0, 0.20 - 0.01 * week)
//   w_roster = 1 - w_season - w_recent
// Source: lining103 power ranker, modified to use PPG instead of W/L.

export const COMPETITIVENESS_GRID: Record<Competitiveness, Record<WindowTier, WindowLabel>> = {
  STRONG: { LONG: "JUGGERNAUT", MID: "CONTEND", SHORT: "CLOSING" },
  AVERAGE: { LONG: "RISING", MID: "AVERAGE", SHORT: "MIDDLING" },
  WEAK: { LONG: "REBUILD", MID: "TRANSITION", SHORT: "STUCK" },
};

// ── Value getters ────────────────────────────────────────────────────────────
// Competitiveness math (starter / FLEX / depth) uses redraft values.
// Window math (age / young share) uses dynasty values.

const REDRAFT = (p: Player): number => p.valueRedraft;
const DYNASTY = (p: Player): number => p.valueDynasty;

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

export function weightedAge(players: Player[], picks: Pick[]): number {
  const top10 = [...players].sort(byValueDesc(DYNASTY)).slice(0, 10);

  let totalNum = 0;
  let totalDen = 0;

  for (const p of top10) {
    if (p.age == null) continue;
    const adj = p.age * AGE_MULT[p.position];
    totalNum += adj * p.valueDynasty;
    totalDen += p.valueDynasty;
  }
  for (const pk of picks) {
    totalNum += PICK_ADJUSTED_AGE * pk.value;
    totalDen += pk.value;
  }
  return totalDen > 0 ? totalNum / totalDen : 26;
}

export function youngValueShare(players: Player[]): number {
  const top10 = [...players].sort(byValueDesc(DYNASTY)).slice(0, 10);
  let young = 0;
  let total = 0;
  for (const p of top10) {
    total += p.valueDynasty;
    if (p.age != null && p.age * AGE_MULT[p.position] <= YOUNG_ADJ_AGE_CUTOFF) {
      young += p.valueDynasty;
    }
  }
  return total > 0 ? young / total : 0;
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

export function tercile(rank: number, total: number): 0 | 1 | 2 {
  const third = total / 3;
  if (rank <= Math.ceil(third)) return 0;
  if (rank <= Math.ceil(2 * third)) return 1;
  return 2;
}

function percentileRank(value: number, all: number[], higherIsMore: boolean): number {
  const sorted = [...all].sort((a, b) => a - b);
  let rank = 0;
  for (const v of sorted) if (v < value) rank++;
  const pct = (rank / Math.max(1, sorted.length - 1)) * 100;
  return higherIsMore ? pct : 100 - pct;
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
  teams: Array<{
    rosterId: number;
    ownerName: string;
    isMine: boolean;
    record: string;
    players: Player[];
    picks: Pick[];
  }>,
  format: LeagueFormat,
  thisYear: number,
): TeamProfile[] {
  type Stage1 = (typeof teams)[number] & {
    players: Player[];
    starterTotalValue: number;
    weightedAge: number;
    youngValueShare: number;
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
      weightedAge: weightedAge(playersAdj, t.picks),
      youngValueShare: youngValueShare(playersAdj),
      pickCapValue: pickCapital(t.picks, thisYear),
      flexValue,
      starters,
      depth,
    };
  });

  // Competitiveness axis
  const sortedByStarter = [...stage1].sort((a, b) => {
    if (b.starterTotalValue !== a.starterTotalValue) return b.starterTotalValue - a.starterTotalValue;
    return a.rosterId - b.rosterId;
  });
  const starterRank = new Map<number, number>();
  sortedByStarter.forEach((t, i) => starterRank.set(t.rosterId, i + 1));
  const compFor = (rid: number): Competitiveness => {
    const t = tercile(starterRank.get(rid)!, stage1.length);
    return t === 0 ? "STRONG" : t === 1 ? "AVERAGE" : "WEAK";
  };

  // Window axis
  const ages = stage1.map((t) => t.weightedAge);
  const youngs = stage1.map((t) => t.youngValueShare);
  const caps = stage1.map((t) => t.pickCapValue);

  const meanCap = caps.reduce((s, v) => s + v, 0) / caps.length;
  const stdCap = Math.sqrt(
    caps.reduce((s, v) => s + (v - meanCap) ** 2, 0) / caps.length,
  );
  const pickFlagFor = (cap: number): TeamProfile["pickCapital"]["flag"] => {
    if (cap > meanCap + 1.5 * stdCap) return "PICK_RICH";
    if (cap < meanCap - 1.5 * stdCap) return "PICK_POOR";
    return "NEUTRAL";
  };

  type Stage2 = Stage1 & {
    competitiveness: Competitiveness;
    windowPressure: number;
    pickFlag: TeamProfile["pickCapital"]["flag"];
  };
  const stage2: Stage2[] = stage1.map((t) => {
    const agePressure = percentileRank(t.weightedAge, ages, true);
    const youngPressure = percentileRank(t.youngValueShare, youngs, false);
    const pickPressure = percentileRank(t.pickCapValue, caps, false);
    const windowPressure =
      agePressure * W_AGE + youngPressure * W_YOUNG_SHARE + pickPressure * W_PICK_CAPITAL;
    return {
      ...t,
      competitiveness: compFor(t.rosterId),
      windowPressure,
      pickFlag: pickFlagFor(t.pickCapValue),
    };
  });

  const sortedByPressure = [...stage2].sort((a, b) => {
    if (a.windowPressure !== b.windowPressure) return a.windowPressure - b.windowPressure;
    return a.rosterId - b.rosterId;
  });
  const windowRank = new Map<number, number>();
  sortedByPressure.forEach((t, i) => windowRank.set(t.rosterId, i + 1));
  const windowTierFor = (rid: number): WindowTier => {
    const t = tercile(windowRank.get(rid)!, stage2.length);
    return t === 0 ? "LONG" : t === 1 ? "MID" : "SHORT";
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

  // Final assembly
  return stage2.map((t) => {
    const tier = windowTierFor(t.rosterId);
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
      weightedAge: t.weightedAge,
      youngValueShare: t.youngValueShare,
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

// ── Archetypes ───────────────────────────────────────────────────────────────

export function detectArchetypes(
  team: TeamProfile,
  averages: LeagueAverages,
  _format: LeagueFormat,
): string[] {
  const out: string[] = [];

  // Tier down: elite starter at pos + weak depth there.
  for (const pos of POSITIONS) {
    const ps = team.positionScores[pos];
    const eliteStarter = averages.starter[pos] > 0 && ps.starterValue > 1.4 * averages.starter[pos];
    const weakDepth = averages.depth[pos] > 0 && ps.depthValue < 0.6 * averages.depth[pos];
    if (eliteStarter && weakDepth) out.push(`tier_down_${pos}`);
  }

  // Per-position consolidate: mid starter + decent depth + need elsewhere.
  const needPositions = POSITIONS.filter(
    (p) => team.positionScores[p].classification === "CRITICAL_NEED" ||
           team.positionScores[p].classification === "NEED",
  );
  for (const pos of POSITIONS) {
    const ps = team.positionScores[pos];
    const midStarter = ps.starterScore >= 40 && ps.starterScore <= 65;
    const decentDepth = ps.depthScore >= 55;
    if (midStarter && decentDepth && needPositions.some((np) => np !== pos)) {
      out.push(`consolidate_${pos}`);
    }
  }

  // NEW: consolidate_flex — high FLEX score + at least one position need.
  // Signals "you have stackable trade chips and somewhere productive to put them."
  if (team.flex.score >= FLEX_CONSOLIDATE_THRESHOLD && needPositions.length > 0) {
    out.push("consolidate_flex");
  }

  // Age arbitrage (buy): LONG window + can absorb veterans (PICK_RICH).
  if (team.windowTier === "LONG" && team.pickCapital.flag === "PICK_RICH") {
    out.push("age_arb_buy");
  }

  // Age arbitrage (sell): old, still-strong roster.
  if (team.windowTier === "SHORT" && team.competitiveness !== "WEAK") {
    out.push("age_arb_sell");
  }

  // Need fill flavors. Trigger if team has at least one CRITICAL_NEED.
  //   stacked  = elite starter + elite depth at same pos (package multiple from this stack)
  //   balanced = SURPLUS classification but not a stack (generic 1-for-1 candidate)
  // The "thin" case (elite starter + weak depth) is already captured by tier_down_<pos>
  // using raw value ratios — we don't duplicate it here.
  // Note: stacked uses the raw starter/depth scores directly rather than gating on
  // SURPLUS classification, because elite-stacked positions can have urgency just
  // above the SURPLUS threshold due to window pressure (e.g. cwescoe at urgency 30).
  const hasCritical = POSITIONS.some(
    (p) => team.positionScores[p].classification === "CRITICAL_NEED",
  );
  if (hasCritical) {
    for (const pos of POSITIONS) {
      const ps = team.positionScores[pos];
      const eliteStarter = ps.starterScore >= 80;
      const eliteDepth = ps.depthScore >= 80;
      if (eliteStarter && eliteDepth) {
        out.push(`need_fill_stacked_${pos}`);
        continue;
      }
      if (ps.classification === "SURPLUS") {
        out.push(`need_fill_balanced_${pos}`);
      }
    }
  }

  // Capital play
  if (
    (team.competitiveness === "STRONG" || team.windowLabel === "CONTEND") &&
    team.pickCapital.flag === "PICK_POOR"
  ) {
    out.push("capital_convert_picks_to_production");
  }
  if (
    (team.competitiveness === "WEAK" || team.windowTier === "LONG") &&
    team.pickCapital.flag === "PICK_RICH"
  ) {
    out.push("capital_convert_production_to_picks");
  }

  return out;
}
