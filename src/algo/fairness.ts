// Shared fairness labeling for trade value gaps. Used by the trade engine
// (Send It packages), the manual calculator, and trade-history grading so
// every surface agrees on what counts as fair.
//
// Perspective: the side sending `valueGive`. Positive delta = that side
// receives more than it gives (an underpay from their seat).

export type FairnessLabel =
  | "FAIR"
  | "SLIGHT_OVERPAY"
  | "OVERPAY"
  | "SLIGHT_UNDERPAY"
  | "UNDERPAY";

// Within 5% of the bigger side, or within 150 raw value points (absolute
// floor so tiny trades don't flap between labels).
export const FAIRNESS_FAIR_PCT = 0.05;
export const FAIRNESS_FAIR_ABS = 150;
// Between 5% and 12% is a "slight" lean; beyond 12% is a real over/underpay.
export const FAIRNESS_SLIGHT_PCT = 0.12;

// Signed gap as a fraction of the larger side. Relationship to the engine's
// balance term: balance = 1 - |fairnessDelta|.
export function fairnessDelta(valueGive: number, valueReceive: number): number {
  return (valueReceive - valueGive) / Math.max(valueGive, valueReceive, 1);
}

export function fairnessLabel(valueGive: number, valueReceive: number): FairnessLabel {
  const delta = fairnessDelta(valueGive, valueReceive);
  const absGap = Math.abs(valueReceive - valueGive);
  if (Math.abs(delta) <= FAIRNESS_FAIR_PCT || absGap <= FAIRNESS_FAIR_ABS) return "FAIR";
  if (delta < 0) {
    return -delta <= FAIRNESS_SLIGHT_PCT ? "SLIGHT_OVERPAY" : "OVERPAY";
  }
  return delta <= FAIRNESS_SLIGHT_PCT ? "SLIGHT_UNDERPAY" : "UNDERPAY";
}

export function fairnessText(label: FairnessLabel): string {
  return label.replace(/_/g, " ");
}

// Badge color shared across pages: green fair, yellow slight, red lopsided.
export function fairnessColor(label: FairnessLabel): string {
  if (label === "FAIR") return "#22c55e";
  if (label === "SLIGHT_OVERPAY" || label === "SLIGHT_UNDERPAY") return "#eab308";
  return "#ef4444";
}
