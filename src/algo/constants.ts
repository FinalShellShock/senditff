import type { Competitiveness, PickFlag, Position, WindowLabel, WindowTier } from "./types";

export const POSITIONS: Position[] = ["QB", "RB", "WR", "TE"];

// ── Aging, measured rather than assumed ──────────────────────────────────────
// Both tables come from nflverse 1999-2024 via scripts/research/aging.mjs.
// See scripts/research/AGING.md for method and caveats. Regenerate with
// `node scripts/research/aging.mjs`.
//
// These replaced a hand-set POSITION_CURVES breakpoint model taken from
// published summaries. There is deliberately only ONE aging model in the app
// now: window classification, the projection arrows, and the trade engine all
// read these. Two curves that can be refit independently is a correctness
// hazard, not just untidiness.

// Expected remaining career production, in discounted PPG-years.
//
// Built by crediting each player his PPG k years later, or ZERO if he is no
// longer startable. Dropout is not missing data here, it IS the dynasty
// signal: a player out of the league produces nothing.
//
// Smoothed isotonic non-increasing: once a player is established, expected
// remaining value should not rise with age, and the projection model requires
// retention that cannot increase with horizon. The raw series violated that
// (QB read 59.1 at 30 against 55.2 at 23, a 7% rise well inside noise). That
// smoothing deliberately gives up one real effect, young-QB bust risk, which
// the 200-attempt volume floor already filters most of.
//
// Ages 21-22 are excluded: a startable 21-year-old WR is a generational
// outlier and that bucket reads 65.4 against 46.4 at age 22.
export const REMAINING_VALUE: Record<Position, Record<number, number>> = {
  QB: { 23: 56.1, 24: 56.1, 25: 56.1, 26: 56.1, 27: 56.1, 28: 56.1, 29: 55.8, 30: 55.8, 31: 51.2, 32: 47.4, 33: 47.4, 34: 42.8, 35: 42.8, 36: 42.4, 37: 38.0, 38: 29.6 },
  RB: { 23: 40.7, 24: 38.6, 25: 37.3, 26: 34.3, 27: 31.7, 28: 29.0, 29: 25.0, 30: 24.1, 31: 21.8, 32: 17.5, 33: 15.0 },
  WR: { 23: 45.1, 24: 44.3, 25: 38.7, 26: 37.7, 27: 35.3, 28: 34.6, 29: 34.6, 30: 31.1, 31: 30.3, 32: 25.9, 33: 24.5, 34: 23.6, 35: 23.6, 36: 13.6 },
  TE: { 23: 35.5, 24: 33.9, 25: 30.4, 26: 29.9, 27: 26.6, 28: 25.1, 29: 23.7, 30: 21.4, 31: 21.4, 32: 21.4, 33: 21.4 },
};

// Age 23 is the reference for pressure: the youngest age with a healthy sample
// at every position. Pressure is the share of a player's age-23 remaining
// value already gone, so it stays WITHIN position. Normalizing across
// positions instead was measured and is worse: every roster starts the same
// position mix, so it tracks mix rather than timeline.
export const PRESSURE_REFERENCE_AGE = 23;

// Annualized percent of REMAINING dynasty value lost per year.
//
// Why a rate and not the level: the level falls for everyone with age, so it
// barely separates positions (at 27 it reads 48 for an RB and 46 for a WR,
// though one is falling apart and the other is peaking). How FAST value drains
// is what differs. At 27 an RB bleeds 9.3%/yr, a WR 4.6%, a QB 0.6%.
//
// Fitted with isotonic regression (pool adjacent violators, weighted by sample
// size) because the raw series is noisy enough to go negative at thin old-age
// buckets, and a player does not age in reverse. That monotonic constraint is
// the assumption doing the work here; it is an assumption, not a fact.
export const VALUE_LOSS_RATE: Record<Position, Record<number, number>> = {
  QB: { 23: -1.8, 24: -1.8, 25: -1.8, 26: 0.6, 27: 0.6, 28: 4.4, 29: 4.5, 30: 4.5, 31: 4.5, 32: 4.5, 33: 4.5, 34: 4.5, 35: 12.1 },
  RB: { 23: 5.6, 24: 6.4, 25: 8.0, 26: 9.3, 27: 9.3, 28: 9.3, 29: 11.2, 30: 14.6 },
  WR: { 23: 4.6, 24: 4.6, 25: 4.6, 26: 4.6, 27: 4.6, 28: 4.6, 29: 7.6, 30: 7.6, 31: 7.6, 32: 7.6, 33: 17.9 },
  // TE never accelerates in this data. That is a sample-size limitation
  // (n=25-36 above age 30), not evidence that TEs stop aging. Treat TE
  // age-arb as unsupported by data rather than as a finding.
  TE: { 23: 5.5, 24: 5.5, 25: 5.5, 26: 5.5, 27: 5.5, 28: 5.5, 29: 5.5, 30: 5.5 },
};

// A player is "aging" (worth buying at a discount) once his value drains this
// fast, and "declining" (worth selling before the cliff) at this rate.
//
// Per position, not one global number, because each position's baseline drain
// differs: an RB bleeds 5.6%/yr even at 23, so a global threshold that catches
// genuinely old RBs also catches Bijan Robinson at 24.5. What marks a player
// as aging is his position's curve accelerating away from its own baseline.
//
// Resulting gates: aging RB 25.4+, WR 29+, QB 34.6+, TE never.
//                  declining RB 28.6+, WR 33+, QB 34.9+, TE never.
// TE thresholds are kept in line with WR so the gate starts working on its own
// if the TE curve is ever refit with more data.
export const AGING_LOSS_RATE: Record<Position, number> = { QB: 6, RB: 8.5, WR: 7, TE: 7 };
export const DECLINING_LOSS_RATE: Record<Position, number> = { QB: 10, RB: 10.5, WR: 10, TE: 10 };

// A one-for-one swap at the same position needs a real timeline gap to be
// anything but churn. Measured on effective age, so a flagged rushing QB
// counts as older than his birthday. 2.5 years is the smallest gap that still
// reads as a deliberate timeline move rather than a sideways shuffle: it
// rejects DJ Moore (29.3) for Terry McLaurin (30.9), which a user flagged with
// "it'd be very rare for a trade like this 1 wr for 1 wr to make any sense."
// RESILIENCE: how much the lineup you are left with after losing your best
// starter counts toward "depth".
//
// Grading backups in isolation is blind to the cushion in front of them, which
// read a roster with two elite QBs and a weak QB3 as critically thin at QB.
//
// Two knobs because the score and the label are on different scales and must
// not be conflated:
//
// WEIGHT blends resilience into the 0-100 depthScore that feeds urgency. Both
// halves are 0-100, so a straight blend is meaningful. 0.5 splits it evenly.
//
// CREDIT is in z-units and applies to the CLASSIFICATION, one-sided. The two
// z-scores are centered differently (backups are measured against the global
// player pool and sit negative for nearly everyone, resilience is measured
// against the other rosters in the league and is zero-centered by
// construction), so blending them 50/50 is arithmetically incoherent: it
// dragged the whole league toward HEALTHY. Instead, above-average resilience
// EARNS relief and below-average resilience costs nothing, which keeps the
// existing need calibration intact for every team that is not actually
// cushioned. 1.0 caps the relief at exactly one classification step, earned in
// full at one standard deviation above the league.
// How many depth slots the CLASSIFICATION judges. One injury promotes exactly
// one player, so coverage is the top backup; slots behind him are pipeline and
// trade fodder, which depthScore still counts in full.
export const DEPTH_COVER_SLOTS = 1;

export const DEPTH_RESILIENCE_WEIGHT = 0.5;
export const DEPTH_RESILIENCE_CREDIT = 1.0;

export const LATERAL_SWAP_MIN_AGE_GAP = 2.5;

// Confidence cuts, measured on the blended `total` score.
//
// These used to read archMatch alone, which asked "does this pattern-match an
// archetype", NOT "is this a good trade". Measured across 80 packages, the
// three tiers were indistinguishable on everything that actually matters:
//
//   tier          n   archMatch   myFit  theirFit  balance
//   recommended  15      0.70      0.27    0.27      0.95
//   measured     26      0.18      0.22    0.12      0.94
//   inspiration  39      0.01      0.24    0.25      0.94
//
// INSPIRATION had BETTER fit than MEASURED. One package helped both managers
// enormously (myFit +0.97, theirFit +0.93), was perfectly balanced and read
// FAIR, and was labelled inspiration purely because archMatch was 0.00. A user
// spotted it from the outside: "if it's even does that mean we're saying it's
// a weak signal even though even is a strong confident good thing?"
//
// `total` already blends fit for me, fit for them, balance AND archetype fit,
// and is already what the ranking sorts on, so reading the badge off it also
// makes the label agree with the order. Cuts sit at the measured distribution
// of total (min 0.08, median 0.29, p75 0.39, p90 0.56, max 0.72).
export const STANCE_CONFIDENT_TOTAL = 0.40;
export const STANCE_CAUTION_TOTAL = 0.22;

// Tanking adjustment for rebuilding (LONG-window) counter-teams.
//
// Most leagues break draft order on points for, so a rebuilding team taking on
// a productive veteran loses draft position on top of not helping itself win.
// The symmetric fit score treats "receives good player" as a gain for both
// sides, which is why the engine kept offering win-now pieces to teams that
// are tanking.
//
// PRODUCTION_SCALE: redraft points of incoming production that map to the full
// penalty. Roughly one elite starter's redraft value.
// SURPLUS_SCALE: dynasty-value surplus that fully cancels the penalty, i.e.
// the point where a rebuilder takes the production anyway to flip it later.
// MAX_PENALTY is in fit-score units, where meaningful trades move ~0.3.
//
// These are a first calibration from one league's feedback, not a fitted
// result. Expect to tune them once there is more data.
// Taking on AGE is a separate cost from taking on production, and until now
// only production was modelled. Every one of five downvoted packages asked a
// LONG-window team to absorb a player at or past his positional decline, and
// two users said the same thing unprompted: "a trade for an ageing QB who will
// mostly likely be out of the NFL sooner rather than later hurts the longevity
// of my team", and "a team that is building wants foundational pieces to build
// off of. An aging RB is absolutely not one of them."
//
// Measured as incoming dynasty value weighted by how much of each player's
// career is already spent, so an old cheap flier costs little and an old
// expensive centerpiece costs a lot.
// age_arb_buy means buying an aging asset AT A DISCOUNT. Both real instances
// of it had the buyer paying full price or more: 2948 out for 2861 back on a
// 26 year old for a 32 year old, and two 2026 picks for a 30.9 year old WR.
// A user put it plainly: "Why would I ship away a higher valued asset for a
// lower valued asset 1:1 of the same position?"
//
// The existing lateral-swap gate requires an age GAP but says nothing about
// direction or price, so paying a premium to get older cleared it. This is the
// missing half. Measured on trade-effective value, the same figure the
// fairness label uses, and 10% sits inside the FAIR band so a qualifying
// discount does not automatically read as a fleece.
export const AGE_ARB_MIN_DISCOUNT = 0.10;

export const AGING_TAKEON_SCALE = 3000;
export const AGING_MAX_PENALTY = 0.30;

export const TANK_PRODUCTION_SCALE = 3000;
export const TANK_SURPLUS_SCALE = 2500;
export const TANK_MAX_PENALTY = 0.25;

export const PICK_DECAY: Record<number, number> = {
  0: 1.0,
  1: 0.85,
  2: 0.70,
  3: 0.55,
};

export const TEP_MULTIPLIER = 1.15;

// Window pressure is age pressure adjusted by pick capital:
//   windowPressure = starterAgePressure + pickAdjustment
// where pickAdjustment = -8 / 0 / +12 by PICK_RICH/NEUTRAL/PICK_POOR.
// Picks shift the window but don't dominate (a young roster with NEUTRAL picks
// still lands LONG; an old roster with PICK_RICH still lands SHORT).
export const PICK_ADJUSTMENT_BY_FLAG: Record<PickFlag, number> = {
  PICK_RICH: -8,
  NEUTRAL: 0,
  PICK_POOR: 12,
};

// What an urgency number actually means.
//
// Urgency is NOT a 0-100 scale, and archetype scoring was written as if it
// were. Measured across a 16 team league: min 1, p25 11, median 19, p75 24,
// p90 36, max 62. It is a weighted sum of score GAPS times a pressure
// multiplier under 1.2, so it cannot reach 100 on a real roster.
//
// The old thresholds asked for urgency above 40 before an archetype scored
// anything, which only 4 of 64 cells cleared, and above 70 to max out, which
// nothing ever reached. That silently zeroed every consolidate_* archetype
// across an entire league and, because archMatch is derived from these scores,
// meant almost no trade could ever be labelled RECOMMENDED.
//
// MEANINGFUL sits near the median (a need worth acting on starts registering)
// and SEVERE near p95 (fully maxed). Re-derive both if the urgency formula
// changes again: that is exactly the drift that caused this.
export const URGENCY_MEANINGFUL = 20;
export const URGENCY_SEVERE = 45;

// Typical spread between a roster's most and least urgent position. Used to
// tell "one real hole plus a surplus" apart from "evenly mediocre everywhere".
export const URGENCY_SPREAD_FULL = 30;

// NOTE: gating generation on archetype score was tried here and reverted. It
// cut packages 80 -> 67, top-24 landings 14 -> 7, and recommendations 29 -> 23
// while tripling inspiration, and it contradicted the research: archetype fit
// does not predict outcomes, so gating on it discarded good candidates
// alongside bad ones. Left as a comment so it is not retried.

// The strongest thing measured in the whole trade study: what predicts a good
// outcome is WHO YOU END UP WITH, not how the trade is shaped.
//
// 19,933 trade-sides followed into the next season, baseline-controlled:
//
//   got the better player in the trade   54%   (n=4,500)
//   gave up the better player            46%   (n=4,431)
//
//   best player acquired, top 24         60%   (n=1,584)
//   top 25-60                            51%   (n=2,672)
//   top 61-100                           48%   (n=2,284)
//   nothing better than 100              48%   (n=5,105)
//
// Monotonic, symmetric on the give/get split, and on the largest samples in
// the study. For contrast, everything else tested came back flat: trade shape
// (51 vs 52), picks (51), momentum before the trade (48/51/49), position
// acquired (49-51), and positional need once quality is held constant (57 vs
// 56). See scripts/research/REBUILD.md.
//
// Applied to BOTH sides on purpose. Only one side can end up with the best
// player, so this correctly makes taking the stud help you and hurt them,
// which is the actual negotiation. The balance gate and fairness labels still
// apply, so it cannot manufacture a fleece: it chooses among trades that are
// already close on value.
export const BEST_PLAYER_EDGE = 0.05;
export const ACQUIRED_QUALITY_BONUS: Array<{ maxRank: number; bonus: number }> = [
  { maxRank: 24, bonus: 0.08 },
  { maxRank: 60, bonus: 0.02 },
  { maxRank: 100, bonus: 0 },
  { maxRank: Infinity, bonus: -0.02 },
];

// Young assets are not interchangeable, and the difference is measurable.
//
// Tracked 19,615 real acquisitions from rank at the trade to rank 12 months
// later, using median (rank movement has huge tails; a top-60 bust falls 240
// places while improvement is capped by rank 1) and adjusted for the -18
// places a year everyone drifts as each rookie class arrives. Median places
// beaten vs that drift, with the share that beat it:
//
//   age      stud(<=24)   valuable(25-60)  fringe(61-100)   deep(100+)
//   <=23     +1  100%     -164  25%        +30  69%         -8  45%
//   24-25   +22   78%       +4  66%        +35  65%        -11  43%
//
// Among YOUNG players the fringe band rises and the deep band does not. Those
// two bets are indistinguishable if you look only at age, which is exactly why
// an earlier cut of this ("acquired anyone under 25") returned noise.
//
// Stated deliberately as a preference WITHIN young players rather than as a
// market mispricing. A 24 year old rising 35 places may be what the market
// already expects of a 24 year old; what the data supports is that fringe
// beats deep, not that fringe is underpriced.
//
// Overall dynasty RANK, not raw value, so it ports across formats: in 1QB PPR
// the band is roughly 1,970-3,150 but that number means nothing in superflex.
export const FRINGE_RANK_MIN = 61;
export const FRINGE_RANK_MAX = 100;
export const YOUNG_ASSET_MAX_AGE = 25;
export const YOUNG_ASSET_BONUS = 0.05;

// Contention weighting for consolidate and tier_down, MEASURED rather than
// assumed. See scripts/research/QUALIFY.md.
//
// Followed 8,099 trade-sides into the next season, with the baseline computed
// inside each contention-by-roster-age cell so only the move differs. Reported
// as the share of trades that beat that baseline:
//
//                    contender   middle   rebuilder
//   consolidate         61%        55%       43%
//   tier down           47%        50%       46%
//
// Consolidation is the one clean conditional signal in the data: monotonic
// across contention, which is what a real effect looks like rather than noise.
// Breaking a stud into pieces weakens a lineup trying to win now, and a
// rebuilder does not care about now.
//
// A separate control confirmed trading itself is not the driver: contenders who
// traded beat their baseline 56% of the time against 43% for contenders who
// did not, while rebuilders were 45% against 46%, i.e. indistinguishable.
//
// Deliberately gentle multipliers. The underlying effect is worth a fraction of
// a league place, so these tilt the ranking rather than gate anything out.
// The same measurement applied to the trade SHAPE, which is what was actually
// measured: the buckets were "gave 2+, got 1" and "gave 1, got 2+", not our
// archetype labels. Re-weighting the archetype score alone turned out to be
// nearly inert (identical package counts before and after) because archMatch
// is only 0.22 of the blended total and generation is not gated on it. This
// applies the finding where it can act: on the package score itself.
//
// Sized against the measured gap of 14 points of beat-baseline rate for
// contenders, and against a `total` scale where meaningful differences run
// 0.1-0.3. WEAK is zero because rebuilders showed no effect either way
// (43% vs 46%, and their traders matched their non-traders at 45 vs 46).
export const SHAPE_FIT_BY_COMPETITIVENESS: Record<Competitiveness, number> = {
  STRONG: 0.06,
  AVERAGE: 0.02,
  WEAK: 0,
};

// Breaking one player up has to BUY you something somewhere else.
//
// A tier-down that returns only players at the position it emptied leaves the
// starting lineup worse and the bench deeper, which is the trade the user
// rejected twice in two different leagues, in almost the same words:
//
//   "the replacement level is too big of a difference in this tier down again"
//   "Nothing here makes finalshellshock's team better."
//   "Stop the qb for two QBs"
//
// Measured on the seven tier-downs that carry a verdict, this separates them
// perfectly and WITHOUT reference to any particular position:
//
//   verdict  sent            replacement            gained elsewhere
//   DOWN     QB 5,210        Purdy   4,470 (-740)   NONE
//   DOWN     QB 3,982        Stafford 2,622 (-1360) NONE
//   UP       RB 3,457        Hubbard 1,836          TE Kittle 2,095
//   UP       RB 5,839        Jacobs  2,789          QB Ward   3,973
//   UP       RB 5,839        Etienne 2,759          WR Burden 3,739
//   UP       TE 3,390        Njoku   1,055          QB Stafford 2,622
//   UP       TE 3,390        Juwan   1,292          QB Jones  2,459
//
// Deliberately a PENALTY and not a gate, and deliberately not a cap on how
// many players of one position may come back. The shape stays in the pool and
// can still surface when everything else about it is strong; it just stops
// outranking trades that actually improve a room. Sized to move a package a
// tier rather than delete it: `total` differences that matter run 0.1-0.3.
//
// Caveat worth keeping in view: n=7, one user, one sitting, one superflex
// league. Strong separation, thin sample.
export const SIDEGRADE_PENALTY = 0.12;

export const CONSOLIDATE_BY_COMPETITIVENESS: Record<Competitiveness, number> = {
  STRONG: 1.0,
  AVERAGE: 0.85,
  WEAK: 0.6,
};
export const TIER_DOWN_BY_COMPETITIVENESS: Record<Competitiveness, number> = {
  STRONG: 0.65,
  AVERAGE: 0.9,
  WEAK: 1.0,
};

// Threshold for the consolidate_flex archetype: a team with FLEX score this far
// above league average has genuine "stackable trade chips" beyond positional needs.
export const FLEX_CONSOLIDATE_THRESHOLD = 55;

// Audible: standard-deviation cutoff for STRONG/AVERAGE/WEAK on the
// competitiveness axis. 0.5σ = "noticeably above/below average for this league."
export const STD_THRESHOLD = 0.5;

// Absolute thresholds on window pressure.
//   < LONG cut  = LONG  (mostly pre-peak rosters, picks-rich rebuilds)
//   > SHORT cut = SHORT (significant aging starters or PICK_POOR mid-tier teams)
//
// Recalibrated when agePressure moved from the hand-set POSITION_CURVES to
// the measured remaining-value curve, which changed the scale.
//   LONG cut 14: the one clean separation in the league, a 4.9-point gap
//     between 11.5 and 16.4 with nothing else close in that region.
//   SHORT cut 19: no clean break exists up here. The remaining gaps are 2.6
//     and 6.1, and the 6.1 one isolates a single team. 19 splits the tight
//     18.4/19.3 pair and keeps the tier sizes near what the league had
//     before (8 LONG / 2 MID / 6 SHORT). This one is a judgment call, not a
//     natural boundary: re-derive it if a second league disagrees.
export const WINDOW_LONG_THRESHOLD = 14;
export const WINDOW_SHORT_THRESHOLD = 19;

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
