import type { TeamState } from "../algo/types.ts";
import { BAD, BG, BRAND, GOOD, INK, INK_4, ORANGE, PURPLE, WARN } from "./theme.ts";

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
 * League Shape scoring. Kelly, 2026-08-07.
 *
 * COLOUR ENCODES ACTIONABILITY, not identity. How urgently should this manager
 * do something, and of what kind:
 *
 *   green   nothing to fix
 *   blue    healthy, no forced move
 *   purple  accumulating on purpose
 *   yellow  the window is closing
 *   orange  needs a decision
 *   red     out of road
 *
 *              DEEP FUTURE          MIDDLE               THIN FUTURE
 *   CONTENDING BEAUTY  green        CONTENDER  blue      LAST RIDE yellow
 *   MIDDLE     RISING  blue         IN THE MIX blue/out  ON FUMES  orange
 *   NOT CLOSE  STOCKPILING purple   REBUILD    orange    YARD SALE red
 *
 * Cells share colours freely, which is fine because every cell is labelled and
 * the colour is answering "how urgent", not "which cell". IN THE MIX is the one
 * outline, separating it from the two solid blues without spending a hue.
 *
 * CONTENDER moved off green in this round: it sat directly beside BEAUTY and
 * the pair was distinguishable only by fill, which is the weakest signal on the
 * board and the one most likely to be misread at dot size.
 */
export const STATE_COLOR: Record<TeamState, string> = {
  JUGGERNAUT: GOOD,
  CONTENDER: BRAND,
  WIN_NOW: WARN,
  RISING: BRAND,
  MIDDLING: BRAND,
  FADING: ORANGE,
  REBUILD: PURPLE,
  EARLY_REBUILD: ORANGE,
  STUCK: BAD,
};

export type StateFill = "solid" | "outline";

export const STATE_FILL: Record<TeamState, StateFill> = {
  JUGGERNAUT: "solid",
  CONTENDER: "solid",
  WIN_NOW: "solid",
  RISING: "solid",
  MIDDLING: "outline",
  FADING: "solid",
  REBUILD: "solid",
  EARLY_REBUILD: "solid",
  STUCK: "solid",
};



/**
 * The three values a chip or dot needs, so no call site has to reimplement
 * what "outline" means and drift from the others.
 */
export function stateStyle(state: TeamState): {
  bg: string;
  border: string;
  ink: string;
} {
  const color = STATE_COLOR[state] ?? INK_4;
  if (STATE_FILL[state] === "outline") {
    return { bg: "transparent", border: color, ink: color };
  }
  return { bg: color, border: color, ink: stateInk(state) };
}
/**
 * Readable text colour for a badge painted in a state's colour.
 *
 * The badge CSS hardcoded a near-black, which was fine until STUCK red landed
 * at 4.05:1 against it, under the 4.5:1 AA floor, while white would have given
 * it 4.83:1. Deriving it from luminance means the next palette revision cannot
 * quietly make a label unreadable.
 */
export function stateInk(state: TeamState): string {
  const hex = STATE_COLOR[state] ?? INK_4;
  const ch = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const lin = ch.map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  const L = 0.2126 * lin[0]! + 0.7152 * lin[1]! + 0.0722 * lin[2]!;
  // Contrast against near-black vs against white, higher wins.
  return (L + 0.05) / 0.05 >= 1.05 / (L + 0.05) ? "#051014" : "#fefedf";
}
