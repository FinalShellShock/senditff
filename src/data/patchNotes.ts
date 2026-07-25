// Product patch notes, newest first.
//
// The engine changes constantly and the people using this app feel it: a trade
// that showed up last week may not show up this week, and until now nothing
// explained why. That reads as "the app is inconsistent" when the truth is
// "the app got better." These notes are the difference.
//
// Write one entry per deploy. Keep `changes` in plain language (what a manager
// notices), and be honest in `knownIssues` about what is still wrong. A patch
// note that only lists wins is marketing, not transparency.
//
// The live build's algo fingerprint is shown in the modal footer, and every
// piece of feedback carries the same hash, so a thumbs-down can always be
// traced back to the engine that produced it. Historical per-release
// fingerprints are not recorded yet; that is the remaining piece.

export type PatchNote = {
  /** Human-facing release name. Free-form, no semver contract implied. */
  version: string;
  /** ISO date, YYYY-MM-DD. */
  date: string;
  /** One line on the theme of the release. */
  title: string;
  changes: string[];
  knownIssues: string[];
};

export const PATCH_NOTES: PatchNote[] = [
  {
    version: "Shotgun 1.4",
    date: "2026-07-25",
    title: "Depth grading rebuilt, and the trade cards now show their work",
    changes: [
      "Depth grading now counts the starters in front of a backup. Two elite QBs and a fine QB3 used to read as a CRITICAL need at QB, which was simply wrong. Depth is now judged half on how good your backups are and half on how strong your lineup still is if your best starter at that position goes down, measured against what the same injury would do to everyone else in the league.",
      "A position where your starters are a surplus can no longer be graded a critical need on the strength of the bench alone.",
      "Your fourth QB no longer drags your QB room down. One injury promotes one player, so the grade looks at the backup who would actually play. Deeper stashes still count toward the depth score and your needs urgency, they just no longer decide the label.",
      "Every trade card now shows what each individual player is worth, so you can see the math instead of taking the verdict on faith.",
      "Packages with several pieces now also show their trade-effective total. A bundle is worth less than the sum of its parts, and the side holding the single best asset charges a premium, so the raw sum was never the number the engine actually judged.",
      "Trade cards carry a confidence badge: RECOMMENDED, WORTH A LOOK, or INSPIRATION, with the archetype fit percentage behind it. Nothing here is hidden anymore, and the written rationale now takes its tone from the same number, so the badge and the prose can no longer disagree.",
      "The rationale writer gets more of the math: each player's value, what the trade does for the other manager's positional needs, and the bundle adjustment. It was previously asked to explain why the other team says yes without being told anything about that team's needs.",
      "Bar colors on the overview go red, amber, green, bright green in one ramp. Cyan used to mean 'best' next to a label and 'middling' inside a bar on the same screen.",
      "These patch notes.",
    ],
    knownIssues: [
      "Depth still counts a player who is already starting via FLEX as depth at his own position, so some RB and WR rooms read a little deeper than they play.",
      "TE age curves are built on a thin sample above age 30 and never show acceleration. Treat TE age arbitrage as unsupported by data rather than as a finding.",
      "The window tier cutoffs are calibrated on one league. If your league's teams cluster differently, the LONG and SHORT labels may not split where you would split them.",
      "There is no way yet to see that new feedback has come in. On the list.",
    ],
  },
  {
    version: "Shotgun 1.3",
    date: "2026-07-24",
    title: "Aging rebuilt from real data, and the engine stopped proposing sideways trades",
    changes: [
      "Age curves are now measured from real NFL data (1999 to 2024) instead of hand-set breakpoints, and there is one aging model shared by the window math, the projection arrows, and the trade engine rather than two that could drift apart.",
      "Aging is judged by how fast a player's remaining value is draining, not by his birthday. A 27 year old RB and a 27 year old WR are in completely different places, and the old flat cutoff labeled half the league's best players as aging assets to buy at a discount.",
      "One-for-one swaps at the same position now need a real age gap to be suggested at all. Trading a WR for a WR of the same age is churn, not a trade.",
      "Rebuilding teams are no longer offered win-now production for nothing. Most leagues break draft order on points scored, so a team that is tanking loses draft position by taking your productive veteran. It now takes real surplus value to make that worth doing.",
      "Trade scoring is measured against the acceptance bar rather than from zero. A package that helped nobody used to score 0.48 out of 1.",
      "The fairness gate was four times looser than the fairness label it displayed, so packages could ship with a flat OVERPAY badge. Fixed.",
      "Feedback now captures the exact prompt the rationale was written from.",
    ],
    knownIssues: [
      "Depth grading ignores the starters in front of a backup. Fixed in 1.4.",
      "Rationales occasionally state a player's age with more confidence than the data supports.",
    ],
  },
  {
    version: "Shotgun 1.2",
    date: "2026-07-23",
    title: "Feedback, and leagues that refresh themselves",
    changes: [
      "Thumbs up and thumbs down on every trade in Send It, with reason chips and a comment box. This is what the tuning actually runs on, so it matters more than it looks.",
      "Leagues refresh themselves when you look at them instead of waiting for a manual sync.",
      "Every piece of feedback is automatically stamped with a content hash of the algorithm that produced the trade, so old feedback can never be mistaken for a description of the current engine.",
    ],
    knownIssues: [
      "Age handling is inherited from hand-set curves and is wrong at several positions. Fixed in 1.3.",
    ],
  },
];
