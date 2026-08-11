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
/** Primary text. */
export const INK = "#fefedf";

/**
 * Text and surface ramp, brightest to darkest.
 *
 * These are INK blended toward BG at the fraction that reproduces the relative
 * luminance of the slate ramp they replace, so the text hierarchy that already
 * worked survives the recolour instead of being re-guessed by eye.
 */
export const INK_1 = "#fbfcdd"; // brightest, headings
export const INK_2 = "#e9e9ce"; // primary body
export const INK_3 = "#d4d6bd"; // secondary
export const INK_4 = "#9fa492"; // dim
export const INK_5 = "#6e756a"; // dimmer
export const INK_6 = "#4e5650"; // labels
export const LINE = "#3a423f"; // borders
export const SURFACE = "#212a2b"; // raised surface
export const SURFACE_DEEP = "#0f191c"; // sunken surface

/**
 * Position colours. Deliberately avoid GOOD and BAD: those two are reserved
 * for positive and negative value, and a position tag is neither.
 */
export const POS_COLOR: Record<string, string> = {
  QB: "#42bfdd",
  RB: "#ca3cff",
  WR: "#f6f740",
  TE: "#f9a03f",
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
