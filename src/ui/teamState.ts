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
 * Hue tracks the FUTURE axis, which is the grid's columns.
 *
 *   deep future   teal -> cyan -> blue     (JUGGERNAUT, RISING, REBUILD)
 *   middle        green -> slate -> purple (CONTENDER, MIDDLING, EARLY_REBUILD)
 *   thin future   orange -> yellow -> red  (WIN_NOW, FADING, STUCK)
 *
 * JUGGERNAUT was #16a34a and CONTENDER #22c55e, two greens one step apart on
 * the same ramp, which is a hard pair to tell apart on a small dot and an
 * impossible one for the ~8% of men with red-green colour deficiency. Moving
 * JUGGERNAUT to teal separates it AND puts it in the same family as the other
 * two deep-future states, so the column reads as a column.
 */
export const STATE_COLOR: Record<TeamState, string> = {
  JUGGERNAUT: "#14b8a6",
  CONTENDER: "#22c55e",
  WIN_NOW: "#f97316",
  RISING: "#06b6d4",
  MIDDLING: "#94a3b8",
  FADING: "#eab308",
  REBUILD: "#3b82f6",
  EARLY_REBUILD: "#a855f7",
  STUCK: "#dc2626",
};