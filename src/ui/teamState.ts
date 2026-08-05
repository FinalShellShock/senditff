import type { TeamState } from "../algo/types.ts";

/**
 * One source for how the nine team states are drawn and named.
 *
 * These maps were previously copy-pasted across LeagueOverview, TeamDeepDive
 * and WindowMap against the OLD windowLabel enum. Keeping three copies is how
 * the app ended up showing two different 3x3 grids at once: the map moved to
 * the state grid and the league grid stayed on competitiveness x windowTier.
 */

/** Row = contender band, column = dynasty band. 0 = top third. */
export const STATE_GRID: TeamState[][] = [
  ["JUGGERNAUT", "CONTENDER", "WIN_NOW"],
  ["RISING", "MIDDLING", "FADING"],
  ["REBUILD", "EARLY_REBUILD", "STUCK"],
];

/**
 * Axis captions. The row labels sit in a 52px gutter (32px on phones), so they
 * have to stay short; the corner cell below carries what the axes mean.
 */
export const CONTENDER_BAND_LABEL = ["STRONG", "MIDDLE", "WEAK"];
export const DYNASTY_BAND_LABEL = ["DEEP FUTURE", "MIDDLE", "THIN FUTURE"];
/** Reads down-then-across: rows are this season, columns are the future. */
export const GRID_CORNER_LABEL = { row: "NOW", col: "LATER" };

export const STATE_TEXT: Record<TeamState, string> = {
  JUGGERNAUT: "JUGGERNAUT",
  CONTENDER: "CONTENDER",
  WIN_NOW: "WIN NOW",
  RISING: "RISING",
  MIDDLING: "MIDDLING",
  FADING: "FADING",
  REBUILD: "REBUILD",
  EARLY_REBUILD: "EARLY REBUILD",
  STUCK: "STUCK",
};

/**
 * Green = healthy on both axes, red = healthy on neither, and the two
 * lopsided corners get their own hues so WIN_NOW (all now, no later) never
 * reads as the same situation as REBUILD (all later, no now).
 */
export const STATE_COLOR: Record<TeamState, string> = {
  JUGGERNAUT: "#16a34a",
  CONTENDER: "#22c55e",
  WIN_NOW: "#f97316",
  RISING: "#06b6d4",
  MIDDLING: "#94a3b8",
  FADING: "#eab308",
  REBUILD: "#3b82f6",
  EARLY_REBUILD: "#a855f7",
  STUCK: "#dc2626",
};
