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

/**
 * Display names. The internal keys never change: they are stored on every
 * feedback record and are part of the rationale cache key, so renaming them
 * would orphan history. Names are free to iterate here.
 *
 * WATCH THE TWO IN THE BOTTOM ROW. Internal REBUILD shows as STOCKPILING and
 * internal EARLY_REBUILD shows as REBUILD. That is deliberate: the cell with
 * the DEEPEST future is the one sitting on a pile, and the ordinary case is
 * the one in the middle. Do not "fix" the apparent mismatch by swapping them.
 */
export const STATE_TEXT: Record<TeamState, string> = {
  JUGGERNAUT: "BEAUTY",
  CONTENDER: "CONTENDER",
  WIN_NOW: "LAST RIDE",
  RISING: "RISING",
  MIDDLING: "IN THE MIX",
  FADING: "ON FUMES",
  REBUILD: "STOCKPILING",
  EARLY_REBUILD: "REBUILD",
  STUCK: "YARD SALE",
};
/**
 * The ROW carries the verdict; the COLUMN carries the character.
 *
 *              DEEP FUTURE   MIDDLE       THIN FUTURE
 *   CONTENDING platinum      emerald      lime
 *   MIDDLE     cyan          slate        amber
 *   WEAK       blue          purple       red
 *
 * The previous palette had this backwards. It ran cool-to-warm ACROSS, so
 * "your future is spent" was drawn as a warning and WIN_NOW came out orange.
 * But a win-now team is winning: it is in the top row, it makes the playoffs,
 * and spending the future is the strategy succeeding, not a fault. Johnny:
 * "Win-now still has you in the playoffs expectations. It should be like green
 * for go and go fast."
 *
 * So the whole top row is now green-family, because every team in it is
 * winning. The bottom row runs blue to red: a deliberate rebuild, a drift, and
 * a roster with neither present nor future. The middle row is the muted
 * version of the same idea.
 *
 * JUGGERNAUT is platinum rather than a fourth green. Three greens in one row
 * is the collision this palette exists to avoid, and being the best roster on
 * both axes is worth its own mark rather than a slightly different shade.
 *
 * Measured, not eyeballed. Closest pair is 0.141 apart in Oklab against 0.122
 * for the palette it replaces and 0.071 for the one before that. Every by-eye
 * revision of these colours so far has moved a collision instead of removing
 * one, which is why each version now ships with that number.
 */
export const STATE_COLOR: Record<TeamState, string> = {
  JUGGERNAUT: "#e8edf5",
  CONTENDER: "#10b981",
  WIN_NOW: "#a3e635",
  RISING: "#22d3ee",
  MIDDLING: "#94a3b8",
  FADING: "#eab308",
  REBUILD: "#5b63f0",
  EARLY_REBUILD: "#c026d3",
  STUCK: "#dc2626",
};
/**
 * Readable text colour for a badge painted in a state's colour.
 *
 * The badge CSS hardcoded a near-black, which was fine until STUCK red landed
 * at 4.05:1 against it, under the 4.5:1 AA floor, while white would have given
 * it 4.83:1. Deriving it from luminance means the next palette revision cannot
 * quietly make a label unreadable.
 */
export function stateInk(state: TeamState): string {
  const hex = STATE_COLOR[state] ?? "#94a3b8";
  const ch = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const lin = ch.map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  const L = 0.2126 * lin[0]! + 0.7152 * lin[1]! + 0.0722 * lin[2]!;
  // Contrast against near-black vs against white, higher wins.
  return (L + 0.05) / 0.05 >= 1.05 / (L + 0.05) ? "#0a0c0f" : "#ffffff";
}
