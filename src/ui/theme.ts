/**
 * Site palette. One place, so a colour cannot drift between files the way the
 * position colours did (they were copy-pasted into seven components).
 *
 * Specified by Kelly, 2026-08-07.
 */

/** Page background. */
export const BG = "#051014";
/** Brand. Replaces every use of the old orange accent. */
export const BRAND = "#42bfdd";

/**
 * Reserved pair. GOOD and BAD mean positive and negative value, and are used
 * for nothing else, so a green anywhere on the site always means "up".
 */
export const GOOD = "#18f2b2";
export const BAD = "#ee4266";

export const WARN = "#f6f740";
/** Shared with the RB and TE position tags; also carries two League Shape cells. */
export const PURPLE = "#e398ff";
export const ORANGE = "#f9a03f";
/** Primary text. */
export const INK = "#fefedf";

/**
 * Text and surface ramp, brightest to darkest.
 *
 * The six INK_ steps are TEXT and each one is pinned to a contrast ratio
 * against BG, not to a look: 18.4, 15.6, 13.0, 9.5, 7.0 and 5.0 to one. The
 * floor is 5.0, comfortably over the 4.5 AA minimum for small text.
 *
 * They started as luminance matches for the slate ramp they replaced, which
 * carried that ramp's problem across: INK_5 landed at 4.05:1 over 50 usages and
 * INK_6 at 2.54:1 over 39, so roughly ninety places on the site were at or
 * under the readable floor and Johnny was turning his screen brightness up.
 *
 * LINE and SURFACE are NOT text. Their low contrast is the point, and lifting
 * them would turn every border into a line that competes with content.
 */
export const INK_1 = "#fbfcdd"; // brightest, headings
export const INK_2 = "#e9e9ce"; // primary body
export const INK_3 = "#d5d6bd"; // secondary
export const INK_4 = "#b5b9a4"; // dim
export const INK_5 = "#999e8d"; // dimmer
export const INK_6 = "#7e8477"; // labels
export const LINE = "#3a423f"; // borders
export const SURFACE = "#212a2b"; // raised surface
export const SURFACE_DEEP = "#0f191c"; // sunken surface

/**
 * Position colours. Deliberately avoid GOOD and BAD: those two are reserved
 * for positive and negative value, and a position tag is neither.
 */
export const POS_COLOR: Record<string, string> = {
  // RB was #ca3cff: 65% more chroma than the rest of the palette and darker
  // than all of it, which is why it read as jarring. Same hue, family L and C.
  QB: BRAND,
  RB: PURPLE,
  WR: WARN,
  TE: ORANGE,
};

/** Undefined position (a pick) is dimmer than an unrecognised one. */
export function posColor(pos?: string): string {
  if (!pos) return INK_6;
  return POS_COLOR[pos] ?? INK_4;
}

/**
 * Fairness badge colour. Lives here, not in src/algo/fairness.ts, because that
 * file is hashed into the algo fingerprint and a colour change is not an
 * engine change.
 */
export function fairnessColor(label: string): string {
  if (label === "FAIR") return GOOD;
  if (label === "SLIGHT_OVERPAY" || label === "SLIGHT_UNDERPAY") return WARN;
  return BAD;
}
