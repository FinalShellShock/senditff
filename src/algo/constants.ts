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

// Stance cuts for the rationale writer, derived from the real archMatch
// distribution across 80 auto-mode packages rather than guessed: min 0.00,
// median 0.08, p75 0.27, p90 0.51, max 0.81.
//
// The first shipped guess (confident >= 0.60, caution < 0.30) fired confident
// on 2.5% of packages and cautionary on 76%, so nearly every trade hedged.
// These sit at roughly the top decile and the bottom third.
export const STANCE_CONFIDENT_ARCH_MATCH = 0.50;
export const STANCE_CAUTION_ARCH_MATCH = 0.05;

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
