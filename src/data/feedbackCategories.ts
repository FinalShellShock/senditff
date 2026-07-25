// Categories for general app feedback.
//
// "Site feedback" is NOT just UI. It is anything someone notices anywhere in
// the app that isn't a judgment on one specific trade package: the league
// overview, a scouting report, the calculator, trade grades, an idea, a bug.
// Only per-trade verdicts belong on the thumbs, because those are the rows
// that feed algorithm tuning and they only mean something when they are
// comparable to each other.
//
// The category is what makes a pile of free-form comments sortable later. A
// single unlabeled bucket would need re-reading end to end every time.

export type FeedbackCategory = {
  key: string;
  label: string;
};

export const FEEDBACK_CATEGORIES: FeedbackCategory[] = [
  { key: "overview", label: "League overview / shape" },
  { key: "scouting", label: "Scouting report / team deep dive" },
  { key: "trade_finder", label: "Trade finder (not one specific trade)" },
  { key: "calc", label: "Trade calculator" },
  { key: "grades", label: "Trade grades" },
  { key: "ui", label: "Look, layout, or wording" },
  { key: "idea", label: "Idea or feature request" },
  { key: "bug", label: "Something is broken" },
  { key: "other", label: "Something else" },
];

export const DEFAULT_FEEDBACK_CATEGORY = "other";

// Best guess at what someone is talking about, from where they were standing.
// Only a default: the dropdown is always editable, and a wrong guess costs one
// click while a right one costs none.
export function categoryForRoute(pathname: string): string {
  if (/\/league\/[^/]+\/team\//.test(pathname)) return "scouting";
  if (/\/league\/[^/]+\/sendit\//.test(pathname)) return "trade_finder";
  if (/\/league\/[^/]+\/calc$/.test(pathname)) return "calc";
  if (/\/league\/[^/]+\/trades$/.test(pathname)) return "grades";
  if (/\/league\/[^/]+$/.test(pathname)) return "overview";
  return DEFAULT_FEEDBACK_CATEGORY;
}
