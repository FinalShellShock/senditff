// Trade engine: deterministic package generation + scoring.
//
// Each archetype has a generator that yields candidate packages in shapes that
// fit the archetype. Every candidate is then scored uniformly using:
//   1. Impact simulation (recompute position scores for both teams post-trade)
//   2. Two-sided fit (does it help me AND make sense for the counter-team)
//   3. Archetype match (does the shape line up with archetypes both teams have)
//   4. Value balance (is the dynasty-value gap acceptable)

import type { ArchetypeFamily } from "../../src/algo/archetypes";
import {
  AGE_ARB_MIN_DISCOUNT,
  AGING_LOSS_RATE,
  AGING_MAX_PENALTY,
  AGING_TAKEON_SCALE,
  DECLINING_LOSS_RATE,
  DEPTH_RESILIENCE_WEIGHT,
  LATERAL_SWAP_MIN_AGE_GAP,
  PICK_DECAY,
  ACQUIRED_QUALITY_BONUS,
  BEST_PLAYER_EDGE,
  FRINGE_RANK_MAX,
  FRINGE_RANK_MIN,
  POSITIONS,
  SHAPE_FIT_BY_COMPETITIVENESS,
  SIDEGRADE_PENALTY,
  YOUNG_ASSET_BONUS,
  YOUNG_ASSET_MAX_AGE,
  STANCE_CAUTION_TOTAL,
  STANCE_CONFIDENT_TOTAL,
  TANK_MAX_PENALTY,
  TANK_PRODUCTION_SCALE,
  TANK_SURPLUS_SCALE,
} from "../../src/algo/constants";
import { fairnessLabel, packageValue, tradeEffectiveValues, type FairnessLabel } from "../../src/algo/fairness";
import {
  depthByPosition,
  depthSlotsFor,
  agePressure,
  effectiveAge,
  fillStarters,
  flexStrengthValue,
  positionScoreFromPool,
  postInjuryValues,
  score0to100,
  topNStats,
  valueLossRate,
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
  // NFL team. Requested on a trade card: two players' names alone do not tell
  // you whether you just stacked a bye week or bought into a bad offence.
  team?: string;
  valueDynasty: number;
  // Players only. Carried so the rationale writer works from real ages
  // instead of inventing them, and so logged feedback records the age the
  // engine actually saw.
  age?: number;
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
  // Trade-effective totals: raw sums after per-side bundle decay and the
  // cross-side best-asset premium. These, not valueGive/valueReceive, are what
  // `balance` is judged on, so showing only the raw sums made a package the
  // engine called lopsided look even on screen. Present on every package;
  // identical to the raw totals for a straight 1-for-1.
  adjValueGive: number;
  adjValueReceive: number;
  // How strongly this is a recommendation versus an idea worth a look. Set by
  // api/trades/find.ts, which owns the diagnostics the tier depends on.
  confidence?: { tier: ConfidenceTier; archMatch: number };
  rationale: string;
  // The exact prompt sent to Haiku to write `rationale`, echoed back so the UI
  // can show what the model was actually asked. Filled in by api/trades/find.ts.
  prompt?: string;
};

// "Recommend versus inspiration" as a scale rather than a hidden threshold.
// The same call drives BOTH the badge on the card and the stance in the Haiku
// prompt, so the label and the prose can never contradict each other.
export type ConfidenceTier = "recommended" | "measured" | "inspiration";

export function confidenceTier(total: number, weak: boolean): ConfidenceTier {
  if (weak || total < STANCE_CAUTION_TOTAL) return "inspiration";
  if (total >= STANCE_CONFIDENT_TOTAL) return "recommended";
  return "measured";
}

export type GenerateOptions = {
  limit?: number; // default 5
  // Force one generator family (user-selected intent). Skips the archetype
  // score gates inside that generator and relaxes the hard reject gates —
  // mediocre results get labeled instead of hidden.
  forceArchetype?: { family: ArchetypeFamily; position?: Position };
  // Only consider this counter-team.
  targetRosterId?: number;
  // User toggle: at most one pick per side and no 3rds/4ths at all.
  noFillerPicks?: boolean;
  // Asset scoping: "find me trades that SEND this player" / "that LAND this
  // player". Engine asset ids (see assetId), ANDed together, so naming two
  // assets means both must appear on that side.
  //
  // Applied as a filter over generated candidates rather than as a generator.
  // The generators build from position leaders, so a specific mid-value player
  // simply never appears in most of them, and a dedicated seeded generator is
  // the right answer only once we know how often this comes back empty. The
  // diagnostics below report exactly that, so the decision gets made on
  // numbers instead of a guess.
  mustGive?: string[];
  mustReceive?: string[];
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
  rejected: { myFit: number; theirFit: number; balance: number; ageArbPrice?: number };
  forced: boolean;
  // Asset scoping, when the user named assets. `before` is how many candidates
  // existed at all, `after` how many contained every named asset. after=0 with
  // a healthy `before` is the honest "nobody in your league would build that
  // deal today" answer, and is also the number that decides whether a seeded
  // generator is worth building.
  assetScope?: { before: number; after: number; give: number; receive: number };
  // mine.archetypeScores for the forced family (0-100), when forced.
  myArchetypeScore?: number;
  // One deterministic sentence about the target team, when one was set.
  counterNote?: string;
  // Auto mode only: candidates existed but none cleared the strict quality
  // gates, so results came from the relaxed labeled pass. Should be rare;
  // the UI warns on it.
  degraded?: "gates";
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
  // Consolidation-adjusted side values (fairness/balance math).
  adjGive: number;
  adjReceive: number;
};

type GenContext = {
  mine: TeamProfile;
  others: TeamProfile[];
  format: LeagueFormat;
  averages: LeagueAverages;
  thisYear: number;
  // Truthy when generators should skip their archetype-score early-returns
  // and honor the position restriction. Set with a family when the user
  // forced an intent; set to {} for the auto-mode fallback pass (a team
  // with no applicable archetype still deserves ideas).
  forced?: { family?: ArchetypeFamily; position?: Position };
};

// Positions a generator should loop over, honoring a forced position filter.
function genPositions(ctx: GenContext): Position[] {
  return ctx.forced?.position ? [ctx.forced.position] : POSITIONS;
}

// ── Asset helpers ────────────────────────────────────────────────────────────

function playerAsset(p: Player, ownerRosterId: number): Asset {
  return { kind: "player", player: p, ownerRosterId };
}
function pickAsset(pk: Pick, ownerRosterId: number): Asset {
  return { kind: "pick", pick: pk, ownerRosterId };
}
function assetValue(a: Asset): number {
  return a.kind === "player" ? a.player.valueDynasty : a.pick.value;
}
// A bundle must be a real package, not stacked filler. Beyond the top two
// pieces, every additional piece must be a true sweetener: at most this
// fraction of the bundle's raw value. Three mid 4ths for a startable WR is
// a no from every league mate.
const FILLER_SWEETENER_MAX = 0.15;

// Every piece in a multi-asset side has to carry at least this share of it.
// Below that it is a body, not a piece, and including it misrepresents the
// trade: two reported downvotes were 1-for-1 swaps wearing a second name.
//
//   Mark Andrews (1,399) + Johnny Mundt (0)   for Dallas Goedert (1,350)
//   Sam Darnold  (1,510) + Aidan O'Connell (0) for Kyler Murray  (1,495)
//
//   "added a player with zero balance. that shouldn't make the trade even."
//   "Why are we adding someone of zero value to this ... This is urgent."
//
// Both passed because the check below used to `return true` for any side of
// two assets, so the sweetener rule only ever ran on three or more. The
// zero-value case is the loud one, but the rule is about proportion: a piece
// worth 2% of the side is filler whether it is worth 0 or 40.
const BUNDLE_PIECE_MIN = 0.05;

// How much better than your best outgoing piece the incoming player has to be
// for a consolidation to be worth the name. 1.0 would only stop it going
// strictly backwards; the point of packaging two players into one is a tier
// jump, so it has to clear him by a visible margin.
const CONSOLIDATE_UPGRADE = 1.1;

function bundleShapeOk(assets: Asset[]): boolean {
  if (assets.length <= 1) return true;
  const values = assets.map(assetValue).sort((a, b) => b - a);
  const sum = values.reduce((s, v) => s + v, 0);
  if (sum <= 0) return false;
  // No passengers, at any package size.
  if (values.some((v) => v < BUNDLE_PIECE_MIN * sum)) return false;
  if (assets.length <= 2) return true;
  return values.slice(2).every((v) => v <= FILLER_SWEETENER_MAX * sum);
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
      ...(a.player.team ? { team: a.player.team } : {}),
      valueDynasty: a.player.valueDynasty,
      ...(a.player.age != null ? { age: a.player.age } : {}),
    };
  }
  return {
    id: `${a.pick.year}-${a.pick.round}-${a.pick.origRosterId}`,
    kind: "pick",
    name: a.pick.label,
    valueDynasty: a.pick.value,
  };
}

// Age gates for the age-arbitrage archetypes.
//
// Version 1 was a flat calendar age (buy >= 27, sell >= 28) for every
// position, which called prime-age WRs and QBs "aging" and produced age-arb
// packages around Justin Jefferson and Josh Allen. Real feedback caught it.
//
// Version 2 read off agePressure, which fixed the position blindness. But
// pressure tracks how much career is LEFT, and that falls for everyone with
// age, so it barely separates positions: at 27 an RB and a WR land within two
// points of each other despite one falling apart and the other peaking.
//
// This reads the empirical rate at which each position drains remaining
// dynasty value (nflverse 1999-2024, see scripts/research/AGING.md). At 27 an
// RB bleeds 9.3%/yr against a WR's 4.6% and a QB's 0.6%, which is the
// distinction the archetype actually needs. Selling stays stricter than
// buying, as it always has.
function playerLossRate(p: Player): number {
  if (p.age == null) return 0; // unknown age never counts as aging
  // Effective age folds in the aging signal, so a high-rushing QB trips the
  // gates earlier than his birthday alone would justify.
  return valueLossRate(effectiveAge(p), p.position);
}
function isAging(p: Player): boolean {
  return playerLossRate(p) >= AGING_LOSS_RATE[p.position];
}
function isDeclining(p: Player): boolean {
  return playerLossRate(p) >= DECLINING_LOSS_RATE[p.position];
}

// A rebuilding team does not actually want current production. Most leagues
// break draft order on points for, so taking on a productive veteran costs
// them draft position on top of not helping them win now. The symmetric
// fitScore treats "receives good player" as a gain for everyone, which is how
// the engine kept proposing win-now pieces to teams that are tanking.
//
// Johnny's exception, and it is a real one: enough surplus value and they take
// it anyway to flip later. So the penalty is offset by whatever dynasty-value
// surplus the deal hands them.
//
// Applies to LONG-window (rebuilding) teams only. Bounded, and tunable via
// TANK_* in src/algo/constants.ts.
// What this trade does to a team's TIMELINE, as a fit adjustment.
//
// Applies to LONG-window teams (rebuilding, or young and rising) and charges
// two separate costs, because "wrong time to win" and "wrong age of asset" are
// different problems and only the first was modelled before:
//
//   PRODUCTION: most leagues break draft order on points for, so a rebuilder
//   taking on a productive veteran loses draft position on top of not helping
//   itself win.
//
//   AGING: a rebuilder taking on players in decline gets assets that will be
//   worthless by the time it is good. Five of five downvoted packages were
//   exactly this, across four different archetypes and three users, so it is a
//   missing term rather than a mistuned one.
//
// Both are offset by surplus, but the surplus is measured on the REMAINING
// share of each asset's value, not its raw value. Raw surplus let a rebuilder
// be "compensated" for two thirty-year-olds with a third thirty-year-old. On
// the package a user called out ("why would JB give away one of the most
// valuable assets in a superflex league for two aging assets"), raw surplus was
// +1024 and cancelled the whole penalty; on remaining value the surplus is zero
// and the penalty stands.
//
// Symmetric on purpose. The old version only ever adjusted the COUNTERPARTY's
// fit, so a rebuilding user searching for their own trades was handed aging
// players with nothing pushing back. Four of the five downvotes were exactly
// that case.
function timelinePenalty(team: TeamProfile, receives: Asset[], sends: Asset[]): number {
  if (team.windowTier !== "LONG") return 0;

  const spent = (p: Player) => agePressure(effectiveAge(p), p.position) / 100;
  const redraft = (assets: Asset[]) =>
    assets.reduce((sum, a) => sum + (a.kind === "player" ? a.player.valueRedraft : 0), 0);
  const aging = (assets: Asset[]) =>
    assets.reduce((sum, a) => sum + (a.kind === "player" ? assetValue(a) * spent(a.player) : 0), 0);
  // Picks count in full: an unspent pick has its whole career ahead of it.
  const remaining = (assets: Asset[]) =>
    assets.reduce(
      (sum, a) => sum + (a.kind === "player" ? assetValue(a) * (1 - spent(a.player)) : assetValue(a)),
      0,
    );

  const netProduction = redraft(receives) - redraft(sends);
  const netAging = aging(receives) - aging(sends);

  const productionCost =
    netProduction > 0 ? Math.min(TANK_MAX_PENALTY, netProduction / TANK_PRODUCTION_SCALE) : 0;
  const agingCost = netAging > 0 ? Math.min(AGING_MAX_PENALTY, netAging / AGING_TAKEON_SCALE) : 0;
  const cost = productionCost + agingCost;
  if (cost <= 0) return 0;

  const surplus = Math.max(0, remaining(receives) - remaining(sends));
  const offset = Math.min(cost, surplus / TANK_SURPLUS_SCALE);
  return -(cost - offset);
}

// Overall dynasty ranking, merged across positions and cached per context.
// The pools are the FantasyCalc universe, so this is a real overall rank
// rather than a rank among rostered players.
let overallCache: { pools: unknown; sorted: number[] } | null = null;
function overallRankOf(value: number, averages: LeagueAverages): number | null {
  if (overallCache?.pools !== averages.depthPlayerPool) {
    const all: number[] = [];
    for (const pos of POSITIONS) all.push(...averages.depthPlayerPool[pos]);
    all.sort((a, b) => b - a);
    overallCache = { pools: averages.depthPlayerPool, sorted: all };
  }
  const arr = overallCache.sorted;
  if (arr.length < FRINGE_RANK_MAX) return null;
  // Binary search for the first index whose value is below this one.
  let lo = 0, hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid]! > value) lo = mid + 1; else hi = mid;
  }
  return lo + 1;
}

// Who you end up with, which is the strongest measured predictor of a good
// outcome. See BEST_PLAYER_EDGE in constants.ts for the numbers.
//
// Two separate measured effects, so both apply:
//   1. ending up with the better player of the two headliners (54% vs 46%)
//   2. the absolute quality of the best piece acquired (60% at top-24, 48%
//      at nothing-better-than-100)
function bestPlayerEdge(
  receives: Asset[],
  gives: Asset[],
  averages: LeagueAverages,
): number {
  const bestOf = (assets: Asset[]): number | null => {
    let best: number | null = null;
    for (const a of assets) {
      if (a.kind !== "player") continue;
      if (best == null || a.player.valueDynasty > best) best = a.player.valueDynasty;
    }
    return best;
  };
  const mine = bestOf(receives);
  const theirs = bestOf(gives);
  let adj = 0;
  if (mine != null && theirs != null) {
    if (mine > theirs) adj += BEST_PLAYER_EDGE;
    else if (mine < theirs) adj -= BEST_PLAYER_EDGE;
  }
  if (mine != null) {
    const rank = overallRankOf(mine, averages);
    if (rank != null) {
      for (const tier of ACQUIRED_QUALITY_BONUS) {
        if (rank <= tier.maxRank) { adj += tier.bonus; break; }
      }
    }
  }
  return adj;
}

// Among YOUNG players, the fringe band rises and deep fliers do not.
// See FRINGE_RANK_MIN in constants.ts for the measurement.
//
// Applies only to LONG-window teams, since this is a development bet and a
// team trying to win now has no use for it. Symmetric in the sense that
// acquiring a deep flier gets the same size discount that fringe gets as a
// credit, because "young" alone was the thing that misled.
function youngAssetQuality(team: TeamProfile, receives: Asset[], averages: LeagueAverages): number {
  if (team.windowTier !== "LONG") return 0;
  let score = 0;
  for (const a of receives) {
    if (a.kind !== "player") continue;
    if ((a.player.age ?? 99) > YOUNG_ASSET_MAX_AGE) continue;
    const rank = overallRankOf(a.player.valueDynasty, averages);
    if (rank == null) continue;
    if (rank >= FRINGE_RANK_MIN && rank <= FRINGE_RANK_MAX) score += YOUNG_ASSET_BONUS;
    else if (rank > FRINGE_RANK_MAX) score -= YOUNG_ASSET_BONUS;
  }
  // One band's worth either way, so a bundle of fliers cannot dominate.
  return Math.max(-YOUNG_ASSET_BONUS, Math.min(YOUNG_ASSET_BONUS, score));
}

// Consolidating helps a contender; tiering down hurts one.
//
// Measured over 8,099 trade-sides followed into the next season, with the
// baseline computed inside each contention-by-roster-age cell so only the
// shape differs (scripts/research/QUALIFY.md):
//
//                    contender   middle   rebuilder
//   gave 2+, got 1      61%        55%       43%
//   gave 1, got 2+      47%        50%       46%
//
// Keyed on SHAPE rather than on the archetype label, because shape is what was
// measured and because a tier_down and a consolidate are the same trade seen
// from opposite sides. Zero for WEAK teams: rebuilders showed no effect in
// either direction, and their traders matched their non-traders (45% vs 46%).
//
// Effect size in the real world is a fraction of a league place, so this tilts
// the ranking and never gates anything out.
// Did breaking this player up buy anything anywhere else?
//
// Fires when one player goes out and every player coming back plays the same
// position. You have not improved a room, you have made its starter worse and
// its bench deeper. Picks are ignored: a pick is not a position.
//
// Position-agnostic on purpose. The reported cases were both QB-for-two-QBs,
// but capping same-position returns would delete the shape from the pool, and
// the shape is fine when it genuinely helps. This charges it instead.
function sidegradePenalty(give: Asset[], receive: Asset[]): number {
  const sent = give.filter((a) => a.kind === "player");
  if (sent.length !== 1 || !sent[0] || sent[0].kind !== "player") return 0;
  const sentPos = sent[0].player.position;
  const back = receive.filter((a) => a.kind === "player");
  // A straight one-for-one is a swap, not a tier down, and is judged elsewhere.
  if (back.length < 2) return 0;
  const gainsElsewhere = back.some(
    (a) => a.kind === "player" && a.player.position !== sentPos,
  );
  return gainsElsewhere ? 0 : -SIDEGRADE_PENALTY;
}

function shapeFitAdjustment(team: TeamProfile, give: Asset[], receive: Asset[]): number {
  const w = SHAPE_FIT_BY_COMPETITIVENESS[team.competitiveness];
  if (w === 0) return 0;
  if (give.length >= 2 && receive.length === 1) return w;
  if (give.length === 1 && receive.length >= 2) return -w;
  return 0;
}

// Absorbing age has to come with a discount.
//
// age_arb_buy exists to buy a player past his peak BELOW what he is worth. The
// generator never checked the price, so it proposed paying a premium to get
// older, which is the trade nobody would make. lateralSwapOk requires a
// timeline gap but is silent on direction and price, so these sailed through.
//
// Compares value-weighted age pressure to decide whether age is actually being
// absorbed, then requires the incoming side to be worth meaningfully more on
// trade-effective value. Picks count as ageless, so cashing picks for an old
// player must clear the same bar.
function ageArbDiscountOk(
  archetype: string,
  give: Asset[],
  receive: Asset[],
  adjGive: number,
  adjReceive: number,
): boolean {
  if (!archetype.startsWith("age_arb_buy")) return true;
  const spentShare = (assets: Asset[]): number => {
    let value = 0;
    let spent = 0;
    for (const a of assets) {
      const v = assetValue(a);
      value += v;
      if (a.kind === "player") spent += v * (agePressure(effectiveAge(a.player), a.player.position) / 100);
    }
    return value > 0 ? spent / value : 0;
  };
  // Not actually taking on age, so there is nothing to be compensated for.
  if (spentShare(receive) <= spentShare(give)) return true;
  return adjReceive >= adjGive * (1 + AGE_ARB_MIN_DISCOUNT);
}

// A one-for-one swap at the same position is churn unless it actually changes
// something. Four of fourteen downvoted packages were exactly this, all of
// them age_arb_buy, and a user put it plainly: "it'd be very rare for a trade
// like this 1 wr for 1 wr to make any sense for anyone."
//
// The engine liked them precisely because they are pointless: equal-value
// same-position swaps score perfectly on balance. So require a real timeline
// gap, measured on effective age so a flagged rushing QB counts as older than
// his birthday. Value gaps are not an escape hatch here: the balance gate
// already forces these swaps to be close on value.
function lateralSwapOk(give: Asset[], receive: Asset[]): boolean {
  if (give.length !== 1 || receive.length !== 1) return true;
  const g = give[0]!, r = receive[0]!;
  if (g.kind !== "player" || r.kind !== "player") return true;
  if (g.player.position !== r.player.position) return true;
  if (g.player.age == null || r.player.age == null) return true;
  return Math.abs(effectiveAge(r.player) - effectiveAge(g.player)) >= LATERAL_SWAP_MIN_AGE_GAP;
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
  const resiliencePool: Record<Position, number[]> = { QB: [], RB: [], WR: [], TE: [] };
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
    const depthByPos = depthByPosition(p.players, format, (pl) => pl.valueDynasty);
    for (const pos of POSITIONS) {
      startersInUse[pos] += starters[pos].length;
      resiliencePool[pos].push(
        postInjuryValues(starters[pos], depthByPos[pos]).reduce((a, v) => a + v, 0),
      );
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
  const resilienceStats = {} as Record<Position, { mean: number; std: number }>;
  for (const pos of POSITIONS) {
    starterStats[pos] = topNStats(starterPlayerPool[pos], startersInUse[pos]);
    depthStats[pos] = topNStats(depthPlayerPool[pos], depthSlotsTotal[pos]);
    resilienceStats[pos] = topNStats(resiliencePool[pos], resiliencePool[pos].length);
  }
  const variance = profiles.reduce((s, p) => s + (p.pickCapital.value - cap) ** 2, 0) / n;
  return {
    starter, depth, flex, pickCapital: cap, pickCapitalStd: Math.sqrt(variance),
    starterPool, depthPool,
    starterPlayerPool, depthPlayerPool,
    starterStats, depthStats,
    startersInUse, depthSlotsTotal,
    resiliencePool, resilienceStats,
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
    // Depth is the resilience blend (see computePositionScores). Scoring the
    // post-trade roster on isolated depth alone would diff it against a
    // pre-trade number computed a different way, so the delta would be junk.
    const postInjuryTotal = postInjuryValues(starters[pos], depth[pos]).reduce((a, v) => a + v, 0);
    const rMean = averages.resilienceStats[pos].mean;
    const newResilienceScore = starters[pos].length > 0 && rMean > 0
      ? Math.max(0, Math.min(100, 50 + ((postInjuryTotal - rMean) / rMean) * 50))
      : 0;
    const newDepthScore =
      weightedSlotAverage(depthPlayerScores) * (1 - DEPTH_RESILIENCE_WEIGHT) +
      newResilienceScore * DEPTH_RESILIENCE_WEIGHT;
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
  // Unscoped now returns every tier-down: one consolidate covers same- and
  // cross-position packages, so its counterpart is any team breaking a
  // player up, not only one at a matching position.
  consolidate: (pos) =>
    pos ? [`tier_down_${pos}`] : POSITIONS.map((q) => `tier_down_${q}`),
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
  const myTimeline = timelinePenalty(myProfile, cand.receive, cand.give)
    + shapeFitAdjustment(myProfile, cand.give, cand.receive)
    + youngAssetQuality(myProfile, cand.receive, ctx.averages)
    + bestPlayerEdge(cand.receive, cand.give, ctx.averages)
    + sidegradePenalty(cand.give, cand.receive);
  const theirTimeline = timelinePenalty(them, cand.give, cand.receive)
    + shapeFitAdjustment(them, cand.receive, cand.give)
    + youngAssetQuality(them, cand.give, ctx.averages)
    + bestPlayerEdge(cand.give, cand.receive, ctx.averages)
    + sidegradePenalty(cand.receive, cand.give);

  const valueGive = cand.give.reduce((s, a) => s + assetValue(a), 0);
  const valueReceive = cand.receive.reduce((s, a) => s + assetValue(a), 0);
  // Balance judges trade-effective worth, not raw sums: bundle decay per
  // side plus the cross-side best-asset premium (three quarters do not buy
  // a dollar, and the dollar holder charges extra).
  const { give: adjGive, receive: adjReceive } = tradeEffectiveValues(
    cand.give.map(assetValue),
    cand.receive.map(assetValue),
  );
  const maxVal = Math.max(adjGive, adjReceive, 1);
  const balance = 1 - Math.abs(adjGive - adjReceive) / maxVal;

  // Archetype match: how strongly the trade shape fits both teams' archetypes.
  const myArchScore = (myProfile.archetypeScores?.[cand.archetype] ?? 0) / 100;
  // need_fill is stored as a single key (no per-position variant), fall back.
  const myArchScoreFallback = cand.archetype.startsWith("need_fill")
    ? (myProfile.archetypeScores?.["need_fill"] ?? 0) / 100
    : myArchScore;
  const myArch = Math.max(myArchScore, myArchScoreFallback);
  const theirArch = counterArchetypeScore(cand.archetype, them);
  const archMatch = myArch * 0.7 + theirArch * 0.3;

  // Combined score. The partner's fit weighs nearly as much as ours: the
  // founding philosophy is surfacing trades the other manager would actually
  // accept, not fantasy heists.
  //
  // Terms are scaled from their ACCEPTANCE GATE to 1, not from -1 to 1. The
  // old mapping ((fit + 1) / 2) handed a trade that helped nobody half credit
  // on both fit terms, and an even 1-for-1 swap is by definition perfectly
  // balanced, so it collected the balance weight for free too. A package that
  // accomplished nothing scored 0.48 out of 1.
  //
  // That is not theoretical. Across 14 real thumbs-down packages the average
  // margin over a do-nothing trade of the same shape was +0.04, and six sat
  // within +/-0.02 of it. The engine could not tell "good trade" from "no
  // trade". Scaling from the gate puts a package sitting exactly at the
  // acceptance bar at zero, so score measures merit ABOVE the bar.
  const norm = (v: number, floor: number) =>
    Math.max(0, Math.min(1, (v - floor) / (1 - floor)));
  const total =
    norm(myFit + myTimeline, DEFAULT_GATES.myFit) * 0.32 +
    norm(theirFit + theirTimeline, DEFAULT_GATES.theirFit) * 0.28 +
    archMatch * 0.22 +
    norm(balance, DEFAULT_GATES.balance) * 0.18;

  return {
    ...cand,
    total,
    myFit,
    theirFit,
    balance,
    archMatch,
    valueGive,
    valueReceive,
    adjGive,
    adjReceive,
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
    // Consolidation-adjusted: multi-pick sets must overshoot the raw target.
    const v = packageValue(combo.map((p) => p.value));
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
    // Zero/near-zero players are roster filler, not trade pieces; a "0 value
    // throw-in" on a card reads as junk.
    .filter((p) => p.valueDynasty >= 100)
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

  // 2-for-1: search top 8 surplus-side players for best pair, judged on
  // consolidation-adjusted worth (pairs must overshoot the raw target).
  const top = players.slice(0, 8);
  let bestPair: [Player, Player] | null = null;
  let bestPairDelta = Infinity;
  for (let i = 0; i < top.length; i++) {
    for (let j = i + 1; j < top.length; j++) {
      const v = packageValue([top[i]!.valueDynasty, top[j]!.valueDynasty]);
      const d = Math.abs(v - targetValue);
      if (d < bestPairDelta) {
        bestPairDelta = d;
        bestPair = [top[i]!, top[j]!];
      }
    }
  }
  if (bestPair) {
    const v = packageValue([bestPair[0].valueDynasty, bestPair[1].valueDynasty]);
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
      const v = packageValue([pl.valueDynasty, ...pickSet.map((p) => p.value)]);
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
        const v = packageValue(pickSet.map((p) => p.value));
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
    const myElite = topPlayersByPos(mine, pos, 1)[0];
    // Forced mode still needs a real top-tier piece to tier down from, just a
    // softer bar (their best at the position, not necessarily league-elite).
    if (!myElite || myElite.valueDynasty < (ctx.forced ? 1500 : 2500)) continue;

    for (const them of others) {
      const theirAtPos = topPlayersByPos(them, pos, 4);
      const pair = theirAtPos.slice(1, 3);
      if (pair.length < 2) continue;
      const pairValue = packageValue(pair.map((p) => p.valueDynasty));
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
          const sweetenedValue = packageValue([
            ...pair.map((p) => p.valueDynasty),
            ...pickSet.map((p) => p.value),
          ]);
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
            const v = packageValue([theirSecond.valueDynasty, ...pickSet.map((p) => p.value)]);
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

      // Cross-position pairs: quality-for-quantity doesn't have to stay at
      // one position. Pair their #2/#3 at my elite's position with their
      // #2/#3 at one of my two most urgent OTHER positions (WR1 for an RB
      // plus a WR, etc.). Their #1s stay off the table, same as above.
      const crossPositions = [...POSITIONS]
        .filter((q) => q !== pos)
        .sort((a, b) => mine.positionScores[b].urgency - mine.positionScores[a].urgency)
        .slice(0, 2);
      for (const q of crossPositions) {
        const theirAtQ = topPlayersByPos(them, q, 3).slice(1, 3);
        for (const pieceAtPos of theirAtPos.slice(1, 3)) {
          for (const pieceAtQ of theirAtQ) {
            const v = packageValue([pieceAtPos.valueDynasty, pieceAtQ.valueDynasty]);
            const ratio = v / myElite.valueDynasty;
            if (ratio >= 0.75 && ratio <= 1.30) {
              out.push({
                give: [playerAsset(myElite, mine.rosterId)],
                receive: [
                  playerAsset(pieceAtPos, them.rosterId),
                  playerAsset(pieceAtQ, them.rosterId),
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

// Package two spare pieces into one better player.
//
// This used to be two generators. `consolidate` paired your #2 and #3 at ONE
// position and could only buy their #1 at that SAME position; `consolidate_flex`
// was hardcoded to your #2 RB plus your #2 WR and nothing else. "Flex" never
// meant flex-eligible, which release 1.8 already fixed in the label without
// touching the code underneath.
//
// Between them, five of the ten possible give-pairs could never be built at
// all: QB+RB, QB+WR, QB+TE, RB+TE and TE+WR. In a superflex league "my QB2 and
// my RB2 for your stud" is an ordinary trade the engine could not express.
//
// One generator now: any two spares, same position or not, for one better
// player at a position that is actually a need. Position scoping (forced mode)
// filters the TARGET, which is the thing the user is shopping for, rather than
// the pieces they happen to be paying with.
function genConsolidate(ctx: GenContext): Candidate[] {
  const out: Candidate[] = [];
  const { mine, others } = ctx;

  // Spares: everyone behind the starter at each position. The #1 stays home,
  // consolidating means selling depth, not your best player.
  const spares: Player[] = [];
  for (const pos of POSITIONS) spares.push(...topPlayersByPos(mine, pos, 4).slice(1, 3));
  // Deterministic order, per the tiebreak rules: value first, then Sleeper id.
  spares.sort((a, b) => b.valueDynasty - a.valueDynasty || a.id.localeCompare(b.id));

  // Buy INTO a need. Unscoped this is the two most urgent rooms, which keeps
  // the candidate count sane and matches what the old flex generator aimed at.
  const targetPositions = ctx.forced?.position
    ? [ctx.forced.position]
    : [...POSITIONS]
        .sort((a, b) => mine.positionScores[b].urgency - mine.positionScores[a].urgency)
        .slice(0, 2);

  for (let i = 0; i < spares.length; i++) {
    for (let j = i + 1; j < spares.length; j++) {
      const myPair = [spares[i]!, spares[j]!];
      const pairValue = packageValue(myPair.map((p) => p.valueDynasty));

      const pairBest = Math.max(...myPair.map((p) => p.valueDynasty));

      for (const them of others) {
        for (const pos of targetPositions) {
      const theirElite = topPlayersByPos(them, pos, 1)[0];
      if (!theirElite) continue;
      // Don't pay for a room with pieces out of that same room and call it an
      // upgrade: giving your WR2 and WR3 for their WR1 is fine, but only if
      // you are not left thinner at WR than you started. The value band below
      // handles the arithmetic; this just skips the degenerate case where the
      // target IS one of the pieces' own backups.
      if (myPair.some((p) => p.id === theirElite.id)) continue;
      // Counter must outvalue my pair by a noticeable margin (otherwise it's not a consolidation)
      if (theirElite.valueDynasty < pairValue * 0.85) continue;
      // ...and must be a real upgrade on the BEST piece leaving, not just on
      // the pair total. Measured against the total, "consolidation" happily
      // went backwards:
      //
      //   Mark Andrews (1,399) + a body  ->  Dallas Goedert (1,350)
      //   Sam Darnold  (1,510) + a body  ->  Kyler Murray   (1,495)
      //
      //   "Darnoldis worth more than Murray alone ... doing that for not the
      //    best player in the deal is way off."
      //
      // Consolidating is supposed to turn depth into a better player. Landing
      // someone worse than the guy you already had is the give-away-your-best-
      // player shape that 19,933 trades measured as the losing side, and it is
      // what daniels 1.11 recorded as needing a GENERATION fix after five
      // attempts at the ranking end moved nothing.
      if (theirElite.valueDynasty < pairBest * CONSOLIDATE_UPGRADE) continue;

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
          const v = packageValue([
            ...myPair.map((p) => p.valueDynasty),
            ...pickSet.map((p) => p.value),
          ]);
          // The upgrade rule counts the sweetener too. Checking only the player
          // pair let a package through that sent a 1,301 pick alongside two
          // smaller players for a 1,404 player: an 8% gain on the best thing
          // leaving, presented as a consolidation. A user reading the card sees
          // assets, not players-versus-picks.
          const sweetenedBest = Math.max(pairBest, ...pickSet.map((p) => p.value));
          if (
            within(v, theirElite.valueDynasty, 0.15) &&
            theirElite.valueDynasty >= sweetenedBest * CONSOLIDATE_UPGRADE
          ) {
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
    }
  }
  return out;
}

function genAgeArbBuy(ctx: GenContext): Candidate[] {
  const out: Candidate[] = [];
  const { mine, others } = ctx;

  for (const them of others) {
    if (them.windowTier === "LONG") continue; // they're young too, not a seller
    for (const pos of genPositions(ctx)) {
      // Aging high-value player on their roster
      const aging = them.players
        .filter((p) => p.position === pos && isAging(p) && p.valueDynasty >= 1500)
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

  for (const pos of genPositions(ctx)) {
    const myAging = mine.players
      .filter((p) => p.position === pos && isDeclining(p) && p.valueDynasty >= 1500)
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
          const v = packageValue(pickSet.map((p) => p.value));
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
  if (mine.picks.length === 0) return out;

  for (const them of others) {
    for (const pos of genPositions(ctx)) {
      const target = topPlayersByPos(them, pos, 2)[0];
      if (!target || target.valueDynasty < 1200) continue;
      const pickSet = bestPickSet(mine.picks, target.valueDynasty, 3);
      if (!pickSet) continue;
      const v = packageValue(pickSet.map((p) => p.value));
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
      const v = packageValue(pickSet.map((p) => p.value));
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
  age_arb_buy: genAgeArbBuy,
  age_arb_sell: genAgeArbSell,
  push_in: genPushIn,
  capital_convert_picks_to_production: genCapitalConvertPicksToProduction,
  capital_convert_production_to_picks: genCapitalConvertProductionToPicks,
};

// Hard reject gates. Forced mode is looser: the user asked for this shape,
// so mediocre results get surfaced with honest labels instead of hidden.
// The fit floors sit below zero because the consolidation premium makes a
// FAIR bundle-giving trade read slightly negative on raw roster value.
// theirFit tightened from -0.40: auto mode should only surface deals the
// partner could plausibly say yes to.
// Auto-mode balance gate aligned with the fairness label. It was 0.55, which
// permits a ~45% value delta, while fairness.ts calls anything past 12% a flat
// OVERPAY. The engine was therefore labelling a package OVERPAY on the card and
// surfacing it anyway: 24% of auto-mode packages carried a flat OVERPAY or
// UNDERPAY badge. All three "unbalanced" thumbs-down in real feedback were in
// that band, every one of them one stud out for two or three lesser pieces in.
// The user was not disagreeing with the engine, he was agreeing with a label
// the engine had already printed.
//
// 0.88 is the fairness cutoff itself, so auto mode now refuses to surface what
// it would badge as a flat overpay. Forced mode stays loose on purpose: the
// user asked for that shape and gets an honest label instead of silence.
const DEFAULT_GATES = { myFit: -0.15, theirFit: -0.25, balance: 0.88 };
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

  // Generate raw candidates: every archetype by default, one family when
  // forced. Auto mode never goes silent: a roster where no archetype fires
  // (well-balanced juggernauts score below every generation threshold)
  // reruns all generators with the score gates skipped.
  // Auto mode runs every generator. Gating generation on archetype score was
  // tried and reverted: it cut packages 80 -> 67 (below the five we promise),
  // top-24 landings 14 -> 7, and recommendations 29 -> 23 while tripling
  // inspiration. It also contradicted the research, which found archetype fit
  // does not predict outcomes at all (positional need is 57% vs 56% once
  // player quality is held constant). Gating on a signal with no predictive
  // power just threw away good candidates along with bad ones.
  const generators = forced
    ? [GENERATORS[forced.family as ArchetypeFamily]]
    : Object.values(GENERATORS);
  // Shape rules applied to every candidate regardless of mode: no stacked
  // filler bundles, and the optional no-filler-picks user toggle.
  const sideOk = (assets: Asset[]): boolean => {
    if (!bundleShapeOk(assets)) return false;
    if (opts.noFillerPicks) {
      const pickAssets = assets.filter((a) => a.kind === "pick");
      if (pickAssets.length > 1) return false;
      if (pickAssets.some((a) => a.kind === "pick" && a.pick.round >= 3)) return false;
    }
    return true;
  };
  const shapeFilter = (cands: Candidate[]) =>
    cands.filter((c) => sideOk(c.give) && sideOk(c.receive) && lateralSwapOk(c.give, c.receive));

  let degraded: GenerateDiagnostics["degraded"];
  const generated = shapeFilter(generators.flatMap((g) => g(ctx)));

  // Asset scope: keep only candidates carrying every named asset on the named
  // side. Runs before dedup and scoring so everything downstream, including the
  // rejection tallies, describes the scoped pool the user actually asked about.
  const mustGive = opts.mustGive ?? [];
  const mustReceive = opts.mustReceive ?? [];
  const scoped = mustGive.length > 0 || mustReceive.length > 0;
  const rawCandidates = scoped
    ? generated.filter((c) => {
        const give = new Set(c.give.map(assetId));
        const receive = new Set(c.receive.map(assetId));
        return (
          mustGive.every((id) => give.has(id)) && mustReceive.every((id) => receive.has(id))
        );
      })
    : generated;
  const assetScope: GenerateDiagnostics["assetScope"] = scoped
    ? {
        before: generated.length,
        after: rawCandidates.length,
        give: mustGive.length,
        receive: mustReceive.length,
      }
    : undefined;

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
  const applyGates = (gates: typeof DEFAULT_GATES) => {
    const rej = { myFit: 0, theirFit: 0, balance: 0, ageArbPrice: 0 };
    const passed = scored.filter((s) => {
      let ok = true;
      if (!(s.myFit > gates.myFit)) { rej.myFit++; ok = false; }
      if (!(s.theirFit > gates.theirFit)) { rej.theirFit++; ok = false; }
      if (!(s.balance > gates.balance)) { rej.balance++; ok = false; }
      // Not relaxed by FORCED_GATES: forcing "buy an aging stud" is a request
      // for the archetype, not a request to overpay for one.
      if (!ageArbDiscountOk(s.archetype, s.give, s.receive, s.adjGive, s.adjReceive)) {
        rej.ageArbPrice++;
        ok = false;
      }
      return ok;
    });
    return { passed, rej };
  };

  let gatePass = applyGates(forced ? FORCED_GATES : DEFAULT_GATES);
  // Auto mode second chance: strict gates rejected everything, so relax to
  // the labeled gates; if even those reject everything, surface the
  // top-scored candidates as-is. Fairness badges keep it honest either way.
  if (!forced && gatePass.passed.length === 0 && scored.length > 0) {
    degraded = "gates";
    gatePass = applyGates(FORCED_GATES);
    if (gatePass.passed.length === 0) {
      gatePass = { passed: [...scored], rej: gatePass.rej };
    }
  }
  const filtered = gatePass.passed;
  const rejected = gatePass.rej;

  // Sort: mutually-agreeable trades first (both fits at least neutral),
  // one-sided trades only behind them. Within a tier, by score with a
  // deterministic tiebreak. This is the founding philosophy as a hard
  // ordering, not just a weight: surface deals both managers would want,
  // loosen only when nothing mutual exists.
  const MUTUAL_FLOOR = -0.02;
  const mutualTier = (s: ScoredCandidate) =>
    s.myFit >= MUTUAL_FLOOR && s.theirFit >= MUTUAL_FLOOR ? 0 : 1;
  filtered.sort((a, b) => {
    const ta = mutualTier(a);
    const tb = mutualTier(b);
    if (ta !== tb) return ta - tb;
    if (b.total !== a.total) return b.total - a.total;
    return candidateKey(a).localeCompare(candidateKey(b));
  });

  // Ordering is by quality, full stop.
  //
  // There used to be a diversity rule here that, for the first half of the
  // list, SKIPPED any candidate whose archetype family was already used. It
  // was meant to show variety instead of five near-identical tier-downs, but
  // it bought that variety by demoting better trades. Measured across 16
  // rosters, slot 2 was the worst slot on the page: 0 recommended and 14 of 16
  // inspiration, while slots 3 through 5 each had 2 recommended. The one
  // position most likely to be read after the top pick was the one being
  // handed the weakest trade.
  //
  // The per-counter-team cap stays. Five trades with the same manager is not a
  // list of options, and unlike family-forcing it never costs a better trade
  // more than one slot.
  // NEAR-DUPLICATE SUPPRESSION. Reported four times in one sitting:
  //
  //   "This is a repeat of the trade directly above it minus the 2028 3rd."
  //   "a repeat of the same trade two cards up but with Michael Mayer instead
  //    of a late 2028 third. This has happened twice now."
  //   "On this run alone we surfaced 4 trades trading Xavier Worthy for picks."
  //   "We already surfaced a trade for Keon Coleman ... we don't need to tier
  //    down our trades found for more trades."
  //
  // This is NOT the diversity rule removed in daniels 1.9, and must not become
  // it. That one skipped candidates by ARCHETYPE FAMILY, a coarse category, so
  // it demoted genuinely better trades to make the page look varied and turned
  // slot 2 into the worst slot on the page. This one clusters only packages
  // that are the same trade, and always keeps the BEST member of a cluster.
  // Quality ordering is untouched; the same idea just does not get two slots.
  // Keyed on what the user SEES, not on asset identity. Two 2027 early 2nds
  // from different original rosters are distinct assets with distinct ids and
  // slightly different values, but both cards read "2027 early 2nd", so
  // shipping both is the same repetition the user complained about. Keying on
  // assetId let exactly that through, three times, until the shape harness
  // caught it.
  const displayKey = (a: Asset): string =>
    a.kind === "player" ? `p:${a.player.id}` : `pk:${a.pick.label}`;
  const headline = (assets: Asset[]): string => {
    let best = assets[0];
    for (const a of assets) {
      if (!best) { best = a; continue; }
      const av = assetValue(a);
      const bv = assetValue(best);
      if (av > bv || (av === bv && assetId(a) < assetId(best))) best = a;
    }
    return best ? displayKey(best) : "";
  };
  // Same player out AND same player in: the sweetener is the only difference.
  const SAME_TRADE_CAP = 1;
  // Same headline on one side: at most two ways to move (or land) one player,
  // which is Johnny's "the best package plus one or two alternatives".
  const SAME_HEADLINE_CAP = 2;

  const perCounterCap = opts.targetRosterId != null ? Infinity : 2;
  const perCounter = new Map<number, number>();
  const perPair = new Map<string, number>();
  const perGive = new Map<string, number>();
  const perReceive = new Map<string, number>();
  const top: ScoredCandidate[] = [];

  const admit = (s: ScoredCandidate): boolean => {
    const g = headline(s.give);
    const r = headline(s.receive);
    if ((perCounter.get(s.counterRosterId) ?? 0) >= perCounterCap) return false;
    if ((perPair.get(`${g}>${r}`) ?? 0) >= SAME_TRADE_CAP) return false;
    if ((perGive.get(g) ?? 0) >= SAME_HEADLINE_CAP) return false;
    if ((perReceive.get(r) ?? 0) >= SAME_HEADLINE_CAP) return false;
    perCounter.set(s.counterRosterId, (perCounter.get(s.counterRosterId) ?? 0) + 1);
    perPair.set(`${g}>${r}`, (perPair.get(`${g}>${r}`) ?? 0) + 1);
    perGive.set(g, (perGive.get(g) ?? 0) + 1);
    perReceive.set(r, (perReceive.get(r) ?? 0) + 1);
    top.push(s);
    return true;
  };

  for (const s of filtered) {
    admit(s);
    if (top.length >= limit) break;
  }
  // No backfill past the caps. The old code filled to `limit` unconditionally,
  // which is exactly how the fourth Xavier Worthy variant earned a slot. A
  // shorter list of distinct ideas beats five cards showing three ideas, and
  // the user said so directly: "we don't need to tier down our trades found for
  // more trades."

  // Headline asset first on each side. Reported on a package that read
  // "Jerry Jeudy (1,221), Breece Hall (4,185)": "We should list the bigger
  // asset first. Breece shouldn't be after Jeudy." Sorted here rather than in
  // the card so the rationale prompt, the feedback payload and every screen
  // see the same order. Ties break on asset id, per the determinism rules.
  const byValueDesc = (a: Asset, b: Asset) =>
    assetValue(b) - assetValue(a) || assetId(a).localeCompare(assetId(b));

  const packages = top.map((s) => {
    const counter = others.find((p) => p.rosterId === s.counterRosterId);
    return {
      counterTeam: counter?.ownerName ?? "?",
      counterRosterId: s.counterRosterId,
      give: [...s.give].sort(byValueDesc).map(toWire),
      receive: [...s.receive].sort(byValueDesc).map(toWire),
      adjValueGive: s.adjGive,
      adjValueReceive: s.adjReceive,
      valueGive: s.valueGive,
      valueReceive: s.valueReceive,
      archetype: s.archetype,
      fairness: fairnessLabel(s.adjGive, s.adjReceive),
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
    ...(assetScope ? { assetScope } : {}),
    ...(degraded ? { degraded } : {}),
    ...(forced ? { myArchetypeScore: forcedArchetypeScore(mine, forced) } : {}),
    ...(target ? { counterNote: buildCounterNote(target, forced) } : {}),
  };

  return { packages, diagnostics };
}
