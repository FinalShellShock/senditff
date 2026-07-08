// Trade engine: deterministic package generation + scoring.
//
// Each archetype has a generator that yields candidate packages in shapes that
// fit the archetype. Every candidate is then scored uniformly using:
//   1. Impact simulation (recompute position scores for both teams post-trade)
//   2. Two-sided fit (does it help me AND make sense for the counter-team)
//   3. Archetype match (does the shape line up with archetypes both teams have)
//   4. Value balance (is the dynasty-value gap acceptable)

import type { ArchetypeFamily } from "../../src/algo/archetypes";
import { PICK_DECAY, POSITIONS } from "../../src/algo/constants";
import { fairnessLabel, type FairnessLabel } from "../../src/algo/fairness";
import {
  depthByPosition,
  depthSlotsFor,
  fillStarters,
  flexStrengthValue,
  positionScoreFromPool,
  score0to100,
  topNStats,
  weightedSlotAverage,
} from "../../src/algo/profile";
import type {
  LeagueAverages,
  LeagueFormat,
  Pick,
  Player,
  Position,
  TeamProfile,
} from "../../src/algo/types";

// ── Wire types ───────────────────────────────────────────────────────────────

export type TradeAssetWire = {
  id: string;
  kind: "player" | "pick";
  name: string;
  position?: string;
  valueDynasty: number;
};

export type TradePackage = {
  counterTeam: string;
  counterRosterId: number;
  give: TradeAssetWire[];
  receive: TradeAssetWire[];
  valueGive: number;
  valueReceive: number;
  archetype: string;
  fairness: FairnessLabel;
  scores: {
    total: number;
    myFit: number;
    theirFit: number;
    balance: number;
    archMatch: number;
  };
  rationale: string;
};

export type GenerateOptions = {
  limit?: number; // default 5
  // Force one generator family (user-selected intent). Skips the archetype
  // score gates inside that generator and relaxes the hard reject gates —
  // mediocre results get labeled instead of hidden.
  forceArchetype?: { family: ArchetypeFamily; position?: Position };
  // Only consider this counter-team.
  targetRosterId?: number;
  pools?: {
    dynastyByPos: Record<Position, number[]>;
    redraftByPos: Record<Position, number[]>;
  };
};

// Deterministic explanation material for thin/empty results. The client
// composes the "here's why" copy from these counts — no Claude involved.
export type GenerateDiagnostics = {
  rawCandidates: number;
  afterDedup: number;
  rejected: { myFit: number; theirFit: number; balance: number };
  forced: boolean;
  // mine.archetypeScores for the forced family (0-100), when forced.
  myArchetypeScore?: number;
  // One deterministic sentence about the target team, when one was set.
  counterNote?: string;
};

export type GenerateResult = {
  packages: Omit<TradePackage, "rationale">[];
  diagnostics: GenerateDiagnostics;
};

// ── Internal types ───────────────────────────────────────────────────────────

type Asset =
  | { kind: "player"; player: Player; ownerRosterId: number }
  | { kind: "pick"; pick: Pick; ownerRosterId: number };

type Candidate = {
  give: Asset[];
  receive: Asset[];
  counterRosterId: number;
  archetype: string;
};

type ScoredCandidate = Candidate & {
  total: number;
  myFit: number;
  theirFit: number;
  balance: number;
  archMatch: number;
  valueGive: number;
  valueReceive: number;
};

type GenContext = {
  mine: TeamProfile;
  others: TeamProfile[];
  format: LeagueFormat;
  averages: LeagueAverages;
  thisYear: number;
  // Set when the user forced this generator's family. Generators skip their
  // archetype-score early-returns and honor the position restriction.
  forced?: { family: ArchetypeFamily; position?: Position };
};

// Positions a generator should loop over, honoring a forced position filter.
function genPositions(ctx: GenContext): Position[] {
  return ctx.forced?.position ? [ctx.forced.position] : POSITIONS;
}

// ── Asset helpers ────────────────────────────────────────────────────────────

const ARCHETYPE_THRESHOLD = 30; // softer than archetypes.ts (50) so we explore neighbours

function playerAsset(p: Player, ownerRosterId: number): Asset {
  return { kind: "player", player: p, ownerRosterId };
}
function pickAsset(pk: Pick, ownerRosterId: number): Asset {
  return { kind: "pick", pick: pk, ownerRosterId };
}
function assetValue(a: Asset): number {
  return a.kind === "player" ? a.player.valueDynasty : a.pick.value;
}
function assetId(a: Asset): string {
  return a.kind === "player"
    ? `p:${a.player.id}`
    : `pk:${a.pick.year}-${a.pick.round}-${a.pick.origRosterId}`;
}
function toWire(a: Asset): TradeAssetWire {
  if (a.kind === "player") {
    return {
      id: a.player.id,
      kind: "player",
      name: a.player.name,
      position: a.player.position,
      valueDynasty: a.player.valueDynasty,
    };
  }
  return {
    id: `${a.pick.year}-${a.pick.round}-${a.pick.origRosterId}`,
    kind: "pick",
    name: a.pick.label,
    valueDynasty: a.pick.value,
  };
}

function topPlayersByPos(profile: TeamProfile, pos: Position, n: number): Player[] {
  return profile.players
    .filter((p) => p.position === pos)
    .sort((a, b) => {
      if (b.valueDynasty !== a.valueDynasty) return b.valueDynasty - a.valueDynasty;
      return a.id.localeCompare(b.id);
    })
    .slice(0, n);
}

// ── League averages (recomputed from profiles since they're not stored) ──────

export function computeLeagueAverages(
  profiles: TeamProfile[],
  format: LeagueFormat,
  globalPlayerPools?: {
    dynastyByPos: Record<Position, number[]>;
    redraftByPos: Record<Position, number[]>;
  },
): LeagueAverages {
  const starter: Record<Position, number> = { QB: 0, RB: 0, WR: 0, TE: 0 };
  const depth: Record<Position, number> = { QB: 0, RB: 0, WR: 0, TE: 0 };
  const starterPool: Record<Position, number[]> = { QB: [], RB: [], WR: [], TE: [] };
  const depthPool: Record<Position, number[]> = { QB: [], RB: [], WR: [], TE: [] };
  // Prefer FantasyCalc-global pools when available.
  const starterPlayerPool: Record<Position, number[]> = globalPlayerPools
    ? { ...globalPlayerPools.redraftByPos }
    : { QB: [], RB: [], WR: [], TE: [] };
  const depthPlayerPool: Record<Position, number[]> = globalPlayerPools
    ? { ...globalPlayerPools.dynastyByPos }
    : { QB: [], RB: [], WR: [], TE: [] };
  const startersInUse: Record<Position, number> = { QB: 0, RB: 0, WR: 0, TE: 0 };
  const depthSlotsTotal: Record<Position, number> = { QB: 0, RB: 0, WR: 0, TE: 0 };
  let flex = 0;
  let cap = 0;
  for (const p of profiles) {
    for (const pos of POSITIONS) {
      starter[pos] += p.positionScores[pos].starterValue;
      depth[pos] += p.positionScores[pos].depthValue;
      starterPool[pos].push(p.positionScores[pos].starterValue);
      depthPool[pos].push(p.positionScores[pos].depthValue);
    }
    // Rebuild starting-slot usage from each profile's roster (the threshold
    // is league-specific even when the pool is global).
    const { starters } = fillStarters(p.players, format);
    for (const pos of POSITIONS) {
      startersInUse[pos] += starters[pos].length;
    }
    if (!globalPlayerPools) {
      for (const pl of p.players) {
        starterPlayerPool[pl.position].push(pl.valueRedraft);
        depthPlayerPool[pl.position].push(pl.valueDynasty);
      }
    }
    flex += p.flex.value;
    cap += p.pickCapital.value;
  }
  const n = Math.max(1, profiles.length);
  for (const pos of POSITIONS) {
    starter[pos] /= n;
    depth[pos] /= n;
    depthSlotsTotal[pos] = n * depthSlotsFor(pos, format);
  }
  flex /= n;
  cap /= n;
  // Reference distributions for z-score classification (matches profile.ts).
  const starterStats = {} as Record<Position, { mean: number; std: number }>;
  const depthStats = {} as Record<Position, { mean: number; std: number }>;
  for (const pos of POSITIONS) {
    starterStats[pos] = topNStats(starterPlayerPool[pos], startersInUse[pos]);
    depthStats[pos] = topNStats(depthPlayerPool[pos], depthSlotsTotal[pos]);
  }
  const variance = profiles.reduce((s, p) => s + (p.pickCapital.value - cap) ** 2, 0) / n;
  return {
    starter, depth, flex, pickCapital: cap, pickCapitalStd: Math.sqrt(variance),
    starterPool, depthPool,
    starterPlayerPool, depthPlayerPool,
    starterStats, depthStats,
    startersInUse, depthSlotsTotal,
  };
}

// ── Impact simulation ────────────────────────────────────────────────────────
// Apply a trade to a roster and recompute position / flex / pickCapital scores.
// Holds competitiveness + window tier fixed (a single trade rarely flips them,
// and assuming it would makes scoring circular with the inputs we depend on).

type ImpactDelta = {
  perPosition: Record<Position, { starterScoreDelta: number; depthScoreDelta: number; urgency: number }>;
  flexScoreDelta: number;
  pickCapitalScoreDelta: number;
};

function simulateImpact(
  team: TeamProfile,
  give: Asset[],
  receive: Asset[],
  format: LeagueFormat,
  averages: LeagueAverages,
  thisYear: number,
): ImpactDelta {
  const giveIds = new Set(give.map(assetId));
  const newPlayers = team.players.filter((p) => !giveIds.has(`p:${p.id}`));
  const newPicks = team.picks.filter(
    (pk) => !giveIds.has(`pk:${pk.year}-${pk.round}-${pk.origRosterId}`),
  );
  for (const a of receive) {
    if (a.kind === "player") newPlayers.push(a.player);
    else newPicks.push(a.pick);
  }

  const { starters } = fillStarters(newPlayers, format);
  // Match profile.ts: depth uses dynasty value with format-aware slot count.
  const depth = depthByPosition(newPlayers, format, (p) => p.valueDynasty);
  const newStarterTotal = POSITIONS.reduce(
    (s, pos) => s + starters[pos].reduce((a, p) => a + p.valueRedraft, 0),
    0,
  );
  const newFlexValue = flexStrengthValue(newPlayers, format, newStarterTotal);

  const perPosition = {} as ImpactDelta["perPosition"];
  for (const pos of POSITIONS) {
    // Player-level dual-zone scoring (matches profile.ts): each starting
    // player gets a rank-based score in the league's individual player pool,
    // then weighted-slot average across the team's slots at this position.
    const starterPlayerScores = starters[pos].map((p) =>
      positionScoreFromPool(p.valueRedraft, averages.starterPlayerPool[pos], averages.startersInUse[pos]),
    );
    const depthPlayerScores = depth[pos].map((p) =>
      positionScoreFromPool(p.valueDynasty, averages.depthPlayerPool[pos], averages.depthSlotsTotal[pos]),
    );
    const newStarterScore = weightedSlotAverage(starterPlayerScores);
    const newDepthScore = weightedSlotAverage(depthPlayerScores);
    perPosition[pos] = {
      starterScoreDelta: newStarterScore - team.positionScores[pos].starterScore,
      depthScoreDelta: newDepthScore - team.positionScores[pos].depthScore,
      urgency: team.positionScores[pos].urgency,
    };
  }

  const newFlexScore = score0to100(newFlexValue, averages.flex || 1);

  let newPickCapValue = 0;
  for (const pk of newPicks) {
    const yearsOut = pk.year - thisYear;
    newPickCapValue += pk.value * (PICK_DECAY[yearsOut] ?? 0);
  }
  const newPickCapScore = score0to100(newPickCapValue, averages.pickCapital || 1);

  return {
    perPosition,
    flexScoreDelta: newFlexScore - team.flex.score,
    pickCapitalScoreDelta: newPickCapScore - team.pickCapital.score,
  };
}

// Roll an ImpactDelta into a single fit score in [-1, 1].
// Positive = trade improves positions this team needs; negative = it damages
// them or piles onto surplus.
function fitScore(impact: ImpactDelta): number {
  let score = 0;
  for (const pos of POSITIONS) {
    const ps = impact.perPosition[pos];
    // Higher urgency = bigger reward for filling, bigger penalty for losing.
    const urgencyWeight = 0.3 + (ps.urgency / 100) * 1.2; // [0.3, 1.5]
    score += ps.starterScoreDelta * urgencyWeight;
    score += ps.depthScoreDelta * urgencyWeight * 0.4;
  }
  score += impact.flexScoreDelta * 0.4;
  score += impact.pickCapitalScoreDelta * 0.3;
  // Empirical scale: meaningful trades shift ~30 weighted score points total.
  return Math.max(-1, Math.min(1, score / 35));
}

// ── Counter archetype mapping ────────────────────────────────────────────────
// For a given trade archetype on my side, which archetypes on the counter-team
// would naturally support the same deal? Used as a scoring bonus.

const COUNTER_ARCHETYPES: Record<string, (pos?: Position) => string[]> = {
  tier_down: (pos) => (pos ? [`consolidate_${pos}`, "push_in"] : []),
  consolidate: (pos) => (pos ? [`tier_down_${pos}`] : []),
  consolidate_flex: () => ["tier_down_RB", "tier_down_WR", "tier_down_TE"],
  age_arb_buy: () => ["age_arb_sell", "capital_convert_production_to_picks"],
  age_arb_sell: () => ["age_arb_buy", "capital_convert_picks_to_production", "push_in"],
  push_in: () => ["capital_convert_production_to_picks"],
  capital_convert_picks_to_production: () => ["capital_convert_production_to_picks"],
  capital_convert_production_to_picks: () => ["capital_convert_picks_to_production", "push_in"],
  need_fill: (pos) => (pos ? [`consolidate_${pos}`, `tier_down_${pos}`] : []),
};

function counterArchetypeScore(archetype: string, theirProfile: TeamProfile): number {
  // Parse archetype: "tier_down_RB" → family "tier_down", pos "RB"
  const parts = archetype.split("_");
  const lastIsPos = POSITIONS.includes(parts[parts.length - 1] as Position);
  const pos = lastIsPos ? (parts.pop() as Position) : undefined;
  const family = parts.join("_");
  const candidates = COUNTER_ARCHETYPES[family]?.(pos) ?? [];
  if (candidates.length === 0) return 0;
  const scores = candidates.map((k) => theirProfile.archetypeScores?.[k] ?? 0);
  return Math.max(...scores) / 100;
}

// ── Scoring ──────────────────────────────────────────────────────────────────

function scoreCandidate(
  cand: Candidate,
  myProfile: TeamProfile,
  others: TeamProfile[],
  ctx: GenContext,
): ScoredCandidate {
  const them = others.find((p) => p.rosterId === cand.counterRosterId)!;
  const myImpact = simulateImpact(myProfile, cand.give, cand.receive, ctx.format, ctx.averages, ctx.thisYear);
  const theirImpact = simulateImpact(them, cand.receive, cand.give, ctx.format, ctx.averages, ctx.thisYear);

  const myFit = fitScore(myImpact);
  const theirFit = fitScore(theirImpact);

  const valueGive = cand.give.reduce((s, a) => s + assetValue(a), 0);
  const valueReceive = cand.receive.reduce((s, a) => s + assetValue(a), 0);
  const maxVal = Math.max(valueGive, valueReceive, 1);
  const balance = 1 - Math.abs(valueGive - valueReceive) / maxVal;

  // Archetype match: how strongly the trade shape fits both teams' archetypes.
  const myArchScore = (myProfile.archetypeScores?.[cand.archetype] ?? 0) / 100;
  // need_fill is stored as a single key (no per-position variant), fall back.
  const myArchScoreFallback = cand.archetype.startsWith("need_fill")
    ? (myProfile.archetypeScores?.["need_fill"] ?? 0) / 100
    : myArchScore;
  const myArch = Math.max(myArchScore, myArchScoreFallback);
  const theirArch = counterArchetypeScore(cand.archetype, them);
  const archMatch = myArch * 0.7 + theirArch * 0.3;

  // Combined score, normalised to [0, 1].
  const total =
    ((myFit + 1) / 2) * 0.40 +
    balance * 0.20 +
    archMatch * 0.20 +
    ((theirFit + 1) / 2) * 0.20;

  return {
    ...cand,
    total,
    myFit,
    theirFit,
    balance,
    archMatch,
    valueGive,
    valueReceive,
  };
}

// ── Give-side construction ───────────────────────────────────────────────────

function within(value: number, target: number, tolerance: number): boolean {
  if (target <= 0) return false;
  const ratio = value / target;
  return ratio >= 1 - tolerance && ratio <= 1 + tolerance;
}

// Combinations of size up to maxSize from an array.
function* combinations<T>(arr: T[], maxSize: number): Generator<T[]> {
  const n = Math.min(arr.length, 12); // cap to keep this cheap
  const items = arr.slice(0, n);
  for (let size = 1; size <= maxSize; size++) {
    yield* combs(items, size, 0, []);
  }
}
function* combs<T>(items: T[], size: number, start: number, prefix: T[]): Generator<T[]> {
  if (prefix.length === size) {
    yield prefix;
    return;
  }
  for (let i = start; i < items.length; i++) {
    yield* combs(items, size, i + 1, [...prefix, items[i]!]);
  }
}

function bestPickSet(picks: Pick[], target: number, maxCount: number): Pick[] | null {
  let best: Pick[] | null = null;
  let bestDelta = Infinity;
  for (const combo of combinations(picks, maxCount)) {
    const v = combo.reduce((s, p) => s + p.value, 0);
    const delta = Math.abs(v - target);
    if (delta < bestDelta) {
      bestDelta = delta;
      best = combo;
    }
  }
  return best;
}

function eligiblePlayersForGiving(
  mine: TeamProfile,
  excludePos: Position[],
  avoidIds: Set<string>,
): Player[] {
  return mine.players
    .filter((p) => !excludePos.includes(p.position))
    .filter((p) => !avoidIds.has(p.id))
    .sort((a, b) => {
      // Prefer giving from low-urgency (surplus) positions first.
      const aUrg = mine.positionScores[a.position]?.urgency ?? 50;
      const bUrg = mine.positionScores[b.position]?.urgency ?? 50;
      if (aUrg !== bUrg) return aUrg - bUrg;
      // Within same urgency, give cheaper player first (preserve elites)
      if (a.valueDynasty !== b.valueDynasty) return a.valueDynasty - b.valueDynasty;
      return a.id.localeCompare(b.id);
    });
}

// Build candidate "give" sides hitting a target value across multiple shapes.
function buildGiveSides(
  mine: TeamProfile,
  targetValue: number,
  opts: {
    excludePos?: Position[];
    avoidIds?: Set<string>;
    canIncludePicks?: boolean;
  } = {},
): Asset[][] {
  const players = eligiblePlayersForGiving(mine, opts.excludePos ?? [], opts.avoidIds ?? new Set());
  const picks = [...mine.picks].sort((a, b) => a.year - b.year || a.round - b.round);
  const shapes: Asset[][] = [];

  // 1-for-1: closest single player within 22%
  let bestSingle: Player | null = null;
  let bestSingleDelta = Infinity;
  for (const p of players) {
    const d = Math.abs(p.valueDynasty - targetValue);
    if (d < bestSingleDelta) {
      bestSingleDelta = d;
      bestSingle = p;
    }
  }
  if (bestSingle && within(bestSingle.valueDynasty, targetValue, 0.22)) {
    shapes.push([playerAsset(bestSingle, mine.rosterId)]);
  }

  // 2-for-1: search top 8 surplus-side players for best pair
  const top = players.slice(0, 8);
  let bestPair: [Player, Player] | null = null;
  let bestPairDelta = Infinity;
  for (let i = 0; i < top.length; i++) {
    for (let j = i + 1; j < top.length; j++) {
      const v = top[i]!.valueDynasty + top[j]!.valueDynasty;
      const d = Math.abs(v - targetValue);
      if (d < bestPairDelta) {
        bestPairDelta = d;
        bestPair = [top[i]!, top[j]!];
      }
    }
  }
  if (bestPair) {
    const v = bestPair[0].valueDynasty + bestPair[1].valueDynasty;
    if (within(v, targetValue, 0.18)) {
      shapes.push([playerAsset(bestPair[0], mine.rosterId), playerAsset(bestPair[1], mine.rosterId)]);
    }
  }

  if (opts.canIncludePicks && picks.length > 0) {
    // player + pick: pick fills the gap to target
    for (const pl of players.slice(0, 10)) {
      const gap = targetValue - pl.valueDynasty;
      if (gap < 200) continue;
      const pickSet = bestPickSet(picks, gap, 2);
      if (!pickSet) continue;
      const v = pl.valueDynasty + pickSet.reduce((s, p) => s + p.value, 0);
      if (within(v, targetValue, 0.15)) {
        shapes.push([
          playerAsset(pl, mine.rosterId),
          ...pickSet.map((pk) => pickAsset(pk, mine.rosterId)),
        ]);
        break; // one player+pick variant per call
      }
    }

    // pick(s) only — only when target value is reasonable for a pick package
    if (targetValue <= 4000) {
      const pickSet = bestPickSet(picks, targetValue, 3);
      if (pickSet) {
        const v = pickSet.reduce((s, p) => s + p.value, 0);
        if (within(v, targetValue, 0.20)) {
          shapes.push(pickSet.map((pk) => pickAsset(pk, mine.rosterId)));
        }
      }
    }
  }

  return shapes;
}

// ── Generators ───────────────────────────────────────────────────────────────

function genNeedFill(ctx: GenContext): Candidate[] {
  const out: Candidate[] = [];
  const { mine, others } = ctx;
  // Top 2 most-urgent positions where urgency clears 40.
  // Forced: use the requested position, or top 2 by urgency with no floor.
  const needPositions = ctx.forced?.position
    ? [ctx.forced.position]
    : [...POSITIONS]
        .sort((a, b) => mine.positionScores[b].urgency - mine.positionScores[a].urgency)
        .filter((pos) => ctx.forced ? true : mine.positionScores[pos].urgency >= 40)
        .slice(0, 2);
  if (needPositions.length === 0) return out;

  for (const needPos of needPositions) {
    for (const them of others) {
      // Skip if they themselves have a NEED at this pos — won't trade their guy
      if (them.positionScores[needPos].classification === "CRITICAL_NEED") continue;
      const targets = topPlayersByPos(them, needPos, 2);
      for (const target of targets) {
        if (target.valueDynasty < 500) continue;
        const giveSides = buildGiveSides(mine, target.valueDynasty, {
          excludePos: [needPos],
          canIncludePicks: true,
        });
        for (const give of giveSides) {
          out.push({
            give,
            receive: [playerAsset(target, them.rosterId)],
            counterRosterId: them.rosterId,
            archetype: `need_fill_${needPos}`,
          });
        }
      }
    }
  }
  return out;
}

function genTierDown(ctx: GenContext): Candidate[] {
  const out: Candidate[] = [];
  const { mine, others } = ctx;
  for (const pos of genPositions(ctx)) {
    if (!ctx.forced && (mine.archetypeScores?.[`tier_down_${pos}`] ?? 0) < ARCHETYPE_THRESHOLD) continue;
    const myElite = topPlayersByPos(mine, pos, 1)[0];
    // Forced mode still needs a real top-tier piece to tier down from, just a
    // softer bar (their best at the position, not necessarily league-elite).
    if (!myElite || myElite.valueDynasty < (ctx.forced ? 1500 : 2500)) continue;

    for (const them of others) {
      const theirAtPos = topPlayersByPos(them, pos, 4);
      const pair = theirAtPos.slice(1, 3);
      if (pair.length < 2) continue;
      const pairValue = pair.reduce((s, p) => s + p.valueDynasty, 0);
      const ratio = pairValue / myElite.valueDynasty;

      if (ratio >= 0.75 && ratio <= 1.30) {
        out.push({
          give: [playerAsset(myElite, mine.rosterId)],
          receive: pair.map((p) => playerAsset(p, them.rosterId)),
          counterRosterId: them.rosterId,
          archetype: `tier_down_${pos}`,
        });
      }

      // Their pick(s) sweeten the deal when their pair is light
      if (ratio < 0.95 && them.picks.length > 0) {
        const gap = myElite.valueDynasty - pairValue;
        const pickSet = bestPickSet(them.picks, gap, 2);
        if (pickSet) {
          const sweetenedValue = pairValue + pickSet.reduce((s, p) => s + p.value, 0);
          if (within(sweetenedValue, myElite.valueDynasty, 0.15)) {
            out.push({
              give: [playerAsset(myElite, mine.rosterId)],
              receive: [
                ...pair.map((p) => playerAsset(p, them.rosterId)),
                ...pickSet.map((pk) => pickAsset(pk, them.rosterId)),
              ],
              counterRosterId: them.rosterId,
              archetype: `tier_down_${pos}`,
            });
          }
        }
      }

      // Single-player tier-down: their #2 alone if it's close enough
      const theirSecond = theirAtPos[1];
      if (theirSecond) {
        const gap = myElite.valueDynasty - theirSecond.valueDynasty;
        if (gap > 500 && them.picks.length > 0) {
          const pickSet = bestPickSet(them.picks, gap, 2);
          if (pickSet) {
            const v = theirSecond.valueDynasty + pickSet.reduce((s, p) => s + p.value, 0);
            if (within(v, myElite.valueDynasty, 0.15)) {
              out.push({
                give: [playerAsset(myElite, mine.rosterId)],
                receive: [
                  playerAsset(theirSecond, them.rosterId),
                  ...pickSet.map((pk) => pickAsset(pk, them.rosterId)),
                ],
                counterRosterId: them.rosterId,
                archetype: `tier_down_${pos}`,
              });
            }
          }
        }
      }
    }
  }
  return out;
}

function genConsolidate(ctx: GenContext): Candidate[] {
  const out: Candidate[] = [];
  const { mine, others } = ctx;
  for (const pos of genPositions(ctx)) {
    if (!ctx.forced && (mine.archetypeScores?.[`consolidate_${pos}`] ?? 0) < ARCHETYPE_THRESHOLD) continue;
    const myAtPos = topPlayersByPos(mine, pos, 4);
    const myPair = myAtPos.slice(1, 3); // my #2 + #3
    if (myPair.length < 2) continue;
    const pairValue = myPair.reduce((s, p) => s + p.valueDynasty, 0);

    for (const them of others) {
      const theirElite = topPlayersByPos(them, pos, 1)[0];
      if (!theirElite) continue;
      // Counter must outvalue my pair by a noticeable margin (otherwise it's not a consolidation)
      if (theirElite.valueDynasty < pairValue * 0.85) continue;

      const ratio = pairValue / theirElite.valueDynasty;
      if (ratio >= 0.80 && ratio <= 1.18) {
        out.push({
          give: myPair.map((p) => playerAsset(p, mine.rosterId)),
          receive: [playerAsset(theirElite, them.rosterId)],
          counterRosterId: them.rosterId,
          archetype: `consolidate_${pos}`,
        });
      }
      // Sweeten with my pick if I'm short
      if (pairValue < theirElite.valueDynasty * 0.95 && mine.picks.length > 0) {
        const gap = theirElite.valueDynasty - pairValue;
        const pickSet = bestPickSet(mine.picks, gap, 2);
        if (pickSet) {
          const v = pairValue + pickSet.reduce((s, p) => s + p.value, 0);
          if (within(v, theirElite.valueDynasty, 0.15)) {
            out.push({
              give: [
                ...myPair.map((p) => playerAsset(p, mine.rosterId)),
                ...pickSet.map((pk) => pickAsset(pk, mine.rosterId)),
              ],
              receive: [playerAsset(theirElite, them.rosterId)],
              counterRosterId: them.rosterId,
              archetype: `consolidate_${pos}`,
            });
          }
        }
      }
    }
  }
  return out;
}

function genConsolidateFlex(ctx: GenContext): Candidate[] {
  const out: Candidate[] = [];
  const { mine, others } = ctx;
  if (!ctx.forced && (mine.archetypeScores?.["consolidate_flex"] ?? 0) < ARCHETYPE_THRESHOLD) return out;

  // Pick the position with highest urgency to upgrade INTO
  const upgradePos = [...POSITIONS].sort(
    (a, b) => mine.positionScores[b].urgency - mine.positionScores[a].urgency,
  )[0]!;

  // Two flex-y players from RB+WR (most flexable positions): take #2 RB + #2 WR
  const myRB2 = topPlayersByPos(mine, "RB", 3)[1];
  const myWR2 = topPlayersByPos(mine, "WR", 3)[1];
  if (!myRB2 && !myWR2) return out;
  const candidatesGive: Player[] = [myRB2, myWR2].filter((p): p is Player => !!p);
  if (candidatesGive.length < 2) return out;

  const giveValue = candidatesGive.reduce((s, p) => s + p.valueDynasty, 0);

  for (const them of others) {
    const target = topPlayersByPos(them, upgradePos, 2)[0];
    if (!target) continue;
    if (target.valueDynasty < giveValue * 0.85) continue;
    const ratio = giveValue / target.valueDynasty;
    if (ratio >= 0.80 && ratio <= 1.20) {
      out.push({
        give: candidatesGive.map((p) => playerAsset(p, mine.rosterId)),
        receive: [playerAsset(target, them.rosterId)],
        counterRosterId: them.rosterId,
        archetype: "consolidate_flex",
      });
    }
  }
  return out;
}

function genAgeArbBuy(ctx: GenContext): Candidate[] {
  const out: Candidate[] = [];
  const { mine, others } = ctx;
  if (!ctx.forced && (mine.archetypeScores?.["age_arb_buy"] ?? 0) < ARCHETYPE_THRESHOLD) return out;

  for (const them of others) {
    if (them.windowTier === "LONG") continue; // they're young too, not a seller
    for (const pos of genPositions(ctx)) {
      // Aging high-value player on their roster
      const aging = them.players
        .filter((p) => p.position === pos && (p.age ?? 0) >= 27 && p.valueDynasty >= 1500)
        .sort((a, b) => b.valueDynasty - a.valueDynasty)[0];
      if (!aging) continue;
      // Pay slightly above value with picks + maybe a young player they'd want
      const giveSides = buildGiveSides(mine, aging.valueDynasty * 1.05, {
        excludePos: [],
        canIncludePicks: true,
      });
      for (const give of giveSides) {
        out.push({
          give,
          receive: [playerAsset(aging, them.rosterId)],
          counterRosterId: them.rosterId,
          archetype: "age_arb_buy",
        });
      }
    }
  }
  return out;
}

function genAgeArbSell(ctx: GenContext): Candidate[] {
  const out: Candidate[] = [];
  const { mine, others } = ctx;
  if (!ctx.forced && (mine.archetypeScores?.["age_arb_sell"] ?? 0) < ARCHETYPE_THRESHOLD) return out;

  for (const pos of genPositions(ctx)) {
    const myAging = mine.players
      .filter((p) => p.position === pos && (p.age ?? 0) >= 28 && p.valueDynasty >= 1500)
      .sort((a, b) => b.valueDynasty - a.valueDynasty)[0];
    if (!myAging) continue;

    for (const them of others) {
      // Rebuilders (LONG window) punt veteran holes, they don't buy vets.
      // Win-now teams (MID/SHORT) are the ones who pay for production.
      if (them.windowTier === "LONG") continue;
      // Receive: their younger high-value player at same pos (or any pos), or picks
      const theirYouth = them.players
        .filter((p) => (p.age ?? 99) <= 25 && p.valueDynasty >= 1000)
        .sort((a, b) => b.valueDynasty - a.valueDynasty)[0];
      if (theirYouth) {
        out.push({
          give: [playerAsset(myAging, mine.rosterId)],
          receive: [playerAsset(theirYouth, them.rosterId)],
          counterRosterId: them.rosterId,
          archetype: "age_arb_sell",
        });
      }
      // Receive: a chunk of picks instead
      if (them.picks.length > 0) {
        const pickSet = bestPickSet(them.picks, myAging.valueDynasty * 0.90, 3);
        if (pickSet) {
          const v = pickSet.reduce((s, p) => s + p.value, 0);
          if (within(v, myAging.valueDynasty, 0.20)) {
            out.push({
              give: [playerAsset(myAging, mine.rosterId)],
              receive: pickSet.map((pk) => pickAsset(pk, them.rosterId)),
              counterRosterId: them.rosterId,
              archetype: "age_arb_sell",
            });
          }
        }
      }
    }
  }
  return out;
}

function genPushIn(ctx: GenContext): Candidate[] {
  const out: Candidate[] = [];
  const { mine, others } = ctx;
  if (!ctx.forced && (mine.archetypeScores?.["push_in"] ?? 0) < ARCHETYPE_THRESHOLD) return out;

  // Convert future capital + a depth piece into proven production at a need spot.
  const needPos = ctx.forced?.position
    ?? [...POSITIONS].sort(
      (a, b) => mine.positionScores[b].urgency - mine.positionScores[a].urgency,
    )[0]!;

  for (const them of others) {
    if (them.competitiveness === "STRONG" && them.windowTier === "SHORT") continue; // they need now too
    const target = topPlayersByPos(them, needPos, 2)[0];
    if (!target || target.valueDynasty < 1500) continue;
    const giveSides = buildGiveSides(mine, target.valueDynasty, {
      excludePos: [needPos],
      canIncludePicks: true,
    }).filter((g) => g.some((a) => a.kind === "pick")); // push_in must include picks
    for (const give of giveSides) {
      out.push({
        give,
        receive: [playerAsset(target, them.rosterId)],
        counterRosterId: them.rosterId,
        archetype: "push_in",
      });
    }
  }
  return out;
}

function genCapitalConvertPicksToProduction(ctx: GenContext): Candidate[] {
  const out: Candidate[] = [];
  const { mine, others } = ctx;
  if (!ctx.forced && (mine.archetypeScores?.["capital_convert_picks_to_production"] ?? 0) < ARCHETYPE_THRESHOLD) return out;
  if (mine.picks.length === 0) return out;

  for (const them of others) {
    for (const pos of genPositions(ctx)) {
      const target = topPlayersByPos(them, pos, 2)[0];
      if (!target || target.valueDynasty < 1200) continue;
      const pickSet = bestPickSet(mine.picks, target.valueDynasty, 3);
      if (!pickSet) continue;
      const v = pickSet.reduce((s, p) => s + p.value, 0);
      if (!within(v, target.valueDynasty, 0.20)) continue;
      out.push({
        give: pickSet.map((pk) => pickAsset(pk, mine.rosterId)),
        receive: [playerAsset(target, them.rosterId)],
        counterRosterId: them.rosterId,
        archetype: "capital_convert_picks_to_production",
      });
    }
  }
  return out;
}

function genCapitalConvertProductionToPicks(ctx: GenContext): Candidate[] {
  const out: Candidate[] = [];
  const { mine, others } = ctx;
  if (!ctx.forced && (mine.archetypeScores?.["capital_convert_production_to_picks"] ?? 0) < ARCHETYPE_THRESHOLD) return out;

  // Sell aging or low-urgency-position players for picks.
  const sellable = mine.players
    .filter((p) => !ctx.forced?.position || p.position === ctx.forced.position)
    .filter((p) => p.valueDynasty >= 1500)
    .filter((p) => mine.positionScores[p.position].classification !== "CRITICAL_NEED")
    .sort((a, b) => b.valueDynasty - a.valueDynasty)
    .slice(0, 6);

  for (const seller of sellable) {
    for (const them of others) {
      if (them.picks.length === 0) continue;
      const pickSet = bestPickSet(them.picks, seller.valueDynasty * 0.95, 3);
      if (!pickSet) continue;
      const v = pickSet.reduce((s, p) => s + p.value, 0);
      if (!within(v, seller.valueDynasty, 0.20)) continue;
      out.push({
        give: [playerAsset(seller, mine.rosterId)],
        receive: pickSet.map((pk) => pickAsset(pk, them.rosterId)),
        counterRosterId: them.rosterId,
        archetype: "capital_convert_production_to_picks",
      });
    }
  }
  return out;
}

// Keyed by family; insertion order matters (dedup keeps first occurrence, so
// this must match the historical generator order).
const GENERATORS: Record<ArchetypeFamily, (ctx: GenContext) => Candidate[]> = {
  need_fill: genNeedFill,
  tier_down: genTierDown,
  consolidate: genConsolidate,
  consolidate_flex: genConsolidateFlex,
  age_arb_buy: genAgeArbBuy,
  age_arb_sell: genAgeArbSell,
  push_in: genPushIn,
  capital_convert_picks_to_production: genCapitalConvertPicksToProduction,
  capital_convert_production_to_picks: genCapitalConvertProductionToPicks,
};

// Hard reject gates. Forced mode is looser: the user asked for this shape,
// so mediocre results get surfaced with honest labels instead of hidden.
const DEFAULT_GATES = { myFit: -0.10, theirFit: -0.40, balance: 0.55 };
const FORCED_GATES = { myFit: -0.30, theirFit: -0.60, balance: 0.40 };

// ── Top-level orchestration ──────────────────────────────────────────────────

function candidateKey(c: Candidate): string {
  const g = c.give.map(assetId).sort().join("|");
  const r = c.receive.map(assetId).sort().join("|");
  return `${g}::${r}`;
}

// mine.archetypeScores lookup for a forced family, mirroring how the
// generators key their scores (positional families store per-position keys).
function forcedArchetypeScore(
  mine: TeamProfile,
  forced: { family: ArchetypeFamily; position?: Position },
): number {
  const scores = mine.archetypeScores ?? {};
  if (forced.family === "tier_down" || forced.family === "consolidate") {
    const positions = forced.position ? [forced.position] : POSITIONS;
    return Math.max(...positions.map((pos) => scores[`${forced.family}_${pos}`] ?? 0));
  }
  return scores[forced.family] ?? 0;
}

function buildCounterNote(
  target: TeamProfile | undefined,
  forced?: { family: ArchetypeFamily; position?: Position },
): string | undefined {
  if (!target) return undefined;
  if (forced?.position) {
    const cl = target.positionScores[forced.position]?.classification;
    return `${target.ownerName} is ${cl} at ${forced.position}`;
  }
  return `${target.ownerName} profiles as ${target.windowLabel}`;
}

export function generatePackages(
  mine: TeamProfile,
  allProfiles: TeamProfile[],
  format: LeagueFormat,
  thisYear: number,
  opts: GenerateOptions = {},
): GenerateResult {
  const limit = opts.limit ?? 5;
  const forced = opts.forceArchetype;
  let others = allProfiles.filter((p) => p.rosterId !== mine.rosterId);
  const target =
    opts.targetRosterId != null
      ? others.find((p) => p.rosterId === opts.targetRosterId)
      : undefined;
  if (opts.targetRosterId != null) {
    others = others.filter((p) => p.rosterId === opts.targetRosterId);
  }
  const averages = computeLeagueAverages(allProfiles, format, opts.pools);
  const ctx: GenContext = { mine, others, format, averages, thisYear, forced };

  // Generate raw candidates: every archetype by default, one family when forced
  const generators = forced ? [GENERATORS[forced.family]] : Object.values(GENERATORS);
  const rawCandidates = generators.flatMap((g) => g(ctx));

  // Dedup identical packages, keep first occurrence
  const seen = new Set<string>();
  const unique: Candidate[] = [];
  for (const c of rawCandidates) {
    const key = candidateKey(c);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(c);
  }

  // Score everything
  const scored = unique.map((c) => scoreCandidate(c, mine, others, ctx));

  // Hard rejects: severely lopsided fits. Tally each failing gate so empty
  // results can be explained.
  const gates = forced ? FORCED_GATES : DEFAULT_GATES;
  const rejected = { myFit: 0, theirFit: 0, balance: 0 };
  const filtered = scored.filter((s) => {
    let ok = true;
    if (!(s.myFit > gates.myFit)) { rejected.myFit++; ok = false; }
    if (!(s.theirFit > gates.theirFit)) { rejected.theirFit++; ok = false; }
    if (!(s.balance > gates.balance)) { rejected.balance++; ok = false; }
    return ok;
  });

  // Sort by score; deterministic tiebreak by candidate key
  filtered.sort((a, b) => {
    if (b.total !== a.total) return b.total - a.total;
    return candidateKey(a).localeCompare(candidateKey(b));
  });

  // Diversity: max 2 per counter-team (uncapped when a target team was
  // requested), prefer spanning archetype families (skipped when forced —
  // everything is one family).
  const perCounterCap = opts.targetRosterId != null ? Infinity : 2;
  const perCounter = new Map<number, number>();
  const archFamiliesUsed = new Set<string>();
  const top: ScoredCandidate[] = [];
  for (const s of filtered) {
    const cnt = perCounter.get(s.counterRosterId) ?? 0;
    if (cnt >= perCounterCap) continue;
    const family = s.archetype.replace(/_(QB|RB|WR|TE)$/, "");
    // First pass: only add if archetype family is new (boosts diversity)
    if (!forced && top.length < limit / 2 && archFamiliesUsed.has(family)) continue;
    top.push(s);
    perCounter.set(s.counterRosterId, cnt + 1);
    archFamiliesUsed.add(family);
    if (top.length >= limit) break;
  }
  // Second pass: fill remaining slots from highest-scored regardless of family
  if (top.length < limit) {
    for (const s of filtered) {
      if (top.includes(s)) continue;
      const cnt = perCounter.get(s.counterRosterId) ?? 0;
      if (cnt >= perCounterCap) continue;
      top.push(s);
      perCounter.set(s.counterRosterId, cnt + 1);
      if (top.length >= limit) break;
    }
  }

  const packages = top.map((s) => {
    const counter = others.find((p) => p.rosterId === s.counterRosterId);
    return {
      counterTeam: counter?.ownerName ?? "?",
      counterRosterId: s.counterRosterId,
      give: s.give.map(toWire),
      receive: s.receive.map(toWire),
      valueGive: s.valueGive,
      valueReceive: s.valueReceive,
      archetype: s.archetype,
      fairness: fairnessLabel(s.valueGive, s.valueReceive),
      scores: {
        total: s.total,
        myFit: s.myFit,
        theirFit: s.theirFit,
        balance: s.balance,
        archMatch: s.archMatch,
      },
    };
  });

  const diagnostics: GenerateDiagnostics = {
    rawCandidates: rawCandidates.length,
    afterDedup: unique.length,
    rejected,
    forced: !!forced,
    ...(forced ? { myArchetypeScore: forcedArchetypeScore(mine, forced) } : {}),
    ...(target ? { counterNote: buildCounterNote(target, forced) } : {}),
  };

  return { packages, diagnostics };
}
