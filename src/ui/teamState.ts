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
 * A bivariate palette: both axes of the grid carry a visual channel.
 *
 * Four corners are fixed, and the five cells between them are Oklab blends of
 * their neighbours, so a ROW reads as a progression and so does a COLUMN:
 *
 *              DEEP FUTURE      MIDDLE          THIN FUTURE
 *   CONTENDING teal #2dd4bf     green           amber #f59e0b
 *   MIDDLE     cyan             stone           burnt orange
 *   WEAK       blue #3b82f6     mauve           red #b91c1c
 *
 * Cool means the value is still ahead of you, warm means it has been spent.
 * Going down a column, the same hue family loses its brightness as the lineup
 * gets weaker. The muddy centre is not an accident: MIDDLING is the cell with
 * nothing to say about a roster, and it should not look like a verdict.
 *
 * CONTENDER is hand-set rather than blended. A straight teal-to-amber midpoint
 * lands on a washed-out olive, which is a poor look for one of the strongest
 * states on the board.
 *
 * Checked, not eyeballed: the closest pair in this set is 0.122 apart in Oklab,
 * against 0.071 for the palette it replaces. That previous worst pair was
 * JUGGERNAUT and RISING, not the JUGGERNAUT/CONTENDER pair that prompted the
 * change, so fixing it by eye had moved the collision rather than removed it.
 */
export const STATE_COLOR: Record<TeamState, string> = {
  JUGGERNAUT: "#2dd4bf",
  CONTENDER: "#6cbf59",
  WIN_NOW: "#f59e0b",
  RISING: "#2faede",
  MIDDLING: "#a1928c",
  FADING: "#d9651a",
  REBUILD: "#3b82f6",
  EARLY_REBUILD: "#8e6491",
  STUCK: "#b91c1c",
};