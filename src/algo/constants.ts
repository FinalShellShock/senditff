import type { Competitiveness, PickFlag, Position, WindowLabel, WindowTier } from "./types";

export const POSITIONS: Position[] = ["QB", "RB", "WR", "TE"];

// West Coast: position-aware age pressure curves.
// Source: ESPN Cockcroft 2023, PFF, 4for4, FantasyLife.
// Each player gets pressure 0-100 based on calendar age and position.
// 0 = years of productivity ahead. 100 = career done.
export type CurveBreakpoints = {
  productiveStart: number; // pressure starts climbing AFTER this (before = 0)
  peakStart: number;       // entering prime
  peakEnd: number;         // leaving prime
  declineStart: number;    // sharp decline begins
  done: number;            // pressure capped at 100 from here
};

export const POSITION_CURVES: Record<Position, CurveBreakpoints> = {
  // QB: long careers, peak 27-32 for pocket / 24-27 for dual-threat. Use averaged window.
  QB: { productiveStart: 23, peakStart: 26, peakEnd: 32, declineStart: 35, done: 38 },
  // RB: short careers, sharp decline 28-29.
  RB: { productiveStart: 21, peakStart: 23, peakEnd: 27, declineStart: 28, done: 30 },
  // WR: peak 26-30, decline 31-32.
  WR: { productiveStart: 22, peakStart: 26, peakEnd: 30, declineStart: 32, done: 34 },
  // TE: late breakout, peak 26-30, decline 32.
  TE: { productiveStart: 23, peakStart: 26, peakEnd: 30, declineStart: 32, done: 34 },
};

// Pressure values at each curve breakpoint. Linear interp between.
export const PRESSURE_AT_PRODUCTIVE = 0;
export const PRESSURE_AT_PEAK_START = 0;
export const PRESSURE_AT_PEAK_END = 25;
export const PRESSURE_AT_DECLINE_START = 60;
export const PRESSURE_AT_DONE = 100;

// Annualized percent of REMAINING dynasty value a player loses per year, by
// position and age. Derived from nflverse 1999-2024 by scripts/research/aging.mjs
// (see scripts/research/AGING.md). Regenerate with `node scripts/research/aging.mjs`.
//
// Why a loss RATE and not an age: the level of remaining value falls for
// everyone as they age, so it barely separates positions (at 27 it reads 48
// for an RB and 46 for a WR, though one is falling apart and the other is in
// his prime). How FAST the value drains is what actually differs. At 27 an RB
// bleeds 9.3%/yr, a WR 4.6%, a QB 0.6%.
//
// Fitted with isotonic regression (pool adjacent violators, weighted by sample
// size) because the raw series is noisy enough to go negative at thin old-age
// buckets, and a player does not age in reverse. The monotonic constraint is
// the assumption doing the work here; it is a real assumption, not a fact.
export const VALUE_LOSS_RATE: Record<Position, Record<number, number>> = {
  QB: { 23: -1.8, 24: -1.8, 25: -1.8, 26: 0.6, 27: 0.6, 28: 4.4, 29: 4.5, 30: 4.5, 31: 4.5, 32: 4.5, 33: 4.5, 34: 4.5, 35: 12.1 },
  RB: { 23: 5.6, 24: 6.4, 25: 8.0, 26: 9.3, 27: 9.3, 28: 9.3, 29: 11.2, 30: 14.6 },
  WR: { 23: 4.6, 24: 4.6, 25: 4.6, 26: 4.6, 27: 4.6, 28: 4.6, 29: 7.6, 30: 7.6, 31: 7.6, 32: 7.6, 33: 17.9 },
  // TE never accelerates in this data. That is a sample-size limitation
  // (n=25-36 above age 30), not evidence that TEs stop aging: the raw series
  // wanders negative up there and isotonic pooling flattens it. Treat TE
  // age-arb as unsupported by data rather than as a finding.
  TE: { 23: 5.5, 24: 5.5, 25: 5.5, 26: 5.5, 27: 5.5, 28: 5.5, 29: 5.5, 30: 5.5 },
};

// A player is "aging" (worth buying at a discount) once his value drains this
// fast, and "declining" (worth selling before the cliff) at this rate.
//
// These are per position, not one global number, because each position's
// baseline drain differs: an RB bleeds 5.6%/yr even at 23, so a global
// threshold that catches genuinely old RBs also catches Bijan Robinson at
// 24.5. What marks a player as aging is his position's curve ACCELERATING
// away from its own baseline, and that happens at a different rate for each.
//
// Resulting gates on the fitted curves:
//   aging     RB 25.4+, WR 29+, QB 34.6+, TE never
//   declining RB 28.6+, WR 33+, QB 34.9+, TE never
//
// TE never triggers because its fitted curve is flat at 5.5%/yr. That is a
// data limitation (n=25-36 above age 30, raw series wanders negative), not a
// finding that TEs stop aging. Thresholds are kept in line with WR so the
// gate starts working on its own if the TE curve is ever refit with more data.
export const AGING_LOSS_RATE: Record<Position, number> = { QB: 6, RB: 8.5, WR: 7, TE: 7 };
export const DECLINING_LOSS_RATE: Record<Position, number> = { QB: 10, RB: 10.5, WR: 10, TE: 10 };

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

// Absolute thresholds on window pressure, calibrated against the position
// curves ON DECIMAL AGES (production computes exact ages from birth dates;
// the original 5/14 cuts were tuned on a harness that used Sleeper's floored
// integer ages, which read 2-8 points younger).
//   < 9   = LONG  (mostly pre-peak rosters, picks-rich rebuilds)
//   > 14  = SHORT (significant aging starters or PICK_POOR mid-tier teams)
// Shotgun: LONG cut recalibrated after harness/prod age parity. At the old
// cut, one just-past-peak starter (Mahomes on a young SF juggernaut) pushed
// obviously long-window teams into MID. Both test leagues separate cleanly
// around 9 (nearest teams 8.1/8.6 below, 9.9/11.4 above).
export const WINDOW_LONG_THRESHOLD = 9;
export const WINDOW_SHORT_THRESHOLD = 14;

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
