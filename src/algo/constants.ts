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
