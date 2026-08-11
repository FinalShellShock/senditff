import type { TeamState } from "../algo/types.ts";
import { BAD, BG, GOOD, INK, INK_4, WARN } from "./theme.ts";

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
 * Five-level scoring, specified by Kelly 2026-08-07. Several states share a
 * colour on purpose: this is a quality scale, not nine separate identities.
 *
 *   BEAUTY                              background  (drawn as an outline)
 *   RISING, CONTENDER                   good
 *   STOCKPILING, IN THE MIX, LAST RIDE  ink
 *   REBUILD, ON FUMES                   warn
 *   YARD SALE                           bad
 *
 * BEAUTY is the page background, so anything painted in it is invisible until
 * it is given an edge. Every badge and every map dot therefore carries a ring;
 * see STATE_RING below. That makes the best team read as a cut-out rather than
 * a missing element, which is the intent, but it only works while the ring is
 * drawn. Do not remove it.
 */
export const STATE_COLOR: Record<TeamState, string> = {
  JUGGERNAUT: BG,
  RISING: GOOD,
  CONTENDER: GOOD,
  REBUILD: INK,
  MIDDLING: INK,
  WIN_NOW: INK,
  EARLY_REBUILD: WARN,
  FADING: WARN,
  STUCK: BAD,
};

/**
 * Outline for a swatch painted in a state's colour. Only BEAUTY needs one to
 * exist at all; the rest get a faint edge so the set looks deliberate rather
 * than one odd outlined chip among eight solid ones.
 */
export function stateRing(state: TeamState): string {
  return STATE_COLOR[state] === BG ? INK_4 : "rgba(254,254,223,0.16)";
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
