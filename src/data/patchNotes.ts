// Product patch notes, newest first.
//
// The engine changes constantly and the people using this app feel it: a trade
// that showed up last week may not show up this week, and until now nothing
// explained why. That reads as "the app is inconsistent" when the truth is
// "the app got better." These notes are the difference.
//
// ── Naming ───────────────────────────────────────────────────────────────────
// A release IS a branch. Branches are dynasty player surnames (`daniels`,
// `barkley`), and one branch produces one release, so `branch` is the release
// identity. See CLAUDE.md, Branch Strategy.
//
// `algo` is a DIFFERENT axis: the formation name of the scoring engine
// (Shotgun, West Coast, Audible, ...). One engine spans many branches, so a
// release is labelled by its branch and merely reports which engine it runs.
// These were briefly conflated as "Shotgun 1.4", which implied the formation
// was the release number. It is not.
//
// ── Writing an entry ─────────────────────────────────────────────────────────
// One entry per branch, added when the branch is cut. Keep `changes` in plain
// language (what a manager notices) and be honest in `knownIssues` about what
// is still wrong. A patch note that only lists wins is marketing, not
// transparency.

export type PatchNote = {
  /** Branch name, which is the release identity. Lowercase player surname. */
  branch: string;
  /** Formation name of the scoring engine this release runs. */
  algo: string;
  /** ISO date or range end, YYYY-MM-DD. */
  date: string;
  /** One line on the theme of the release. */
  title: string;
  changes: string[];
  knownIssues: string[];
};

export const PATCH_NOTES: PatchNote[] = [
  {
    branch: "daniels",
    algo: "Shotgun",
    date: "2026-07-25",
    title: "Depth grading rebuilt, and the trade cards now show their work",
    changes: [
      "Depth grading now counts the starters in front of a backup. Two elite QBs and a fine QB3 used to read as a CRITICAL need at QB, which was simply wrong. Depth is now judged half on how good your backups are and half on how strong your lineup still is if your best starter at that position goes down, measured against what the same injury would do to everyone else in the league.",
      "A position where your starters are a surplus can no longer be graded a critical need on the strength of the bench alone.",
      "Your fourth QB no longer drags your QB room down. One injury promotes one player, so the grade looks at the backup who would actually play. Deeper stashes still count toward the depth score and your needs urgency, they just no longer decide the label.",
      "Every trade card now shows what each individual player is worth, so you can see the math instead of taking the verdict on faith.",
      "Packages with several pieces now also show their trade-effective total. A bundle is worth less than the sum of its parts, and the side holding the single best asset charges a premium, so the raw sum was never the number the engine actually judged.",
      "Trade cards carry a confidence badge: RECOMMENDED, WORTH A LOOK, or INSPIRATION. It tells you how strongly the engine stands behind a trade rather than leaving that hidden, and the written rationale takes its tone from the same reading, so the badge and the prose cannot disagree.",
      "The rationale writer gets more of the math: each player's value, what the trade does for the other manager's positional needs, and the bundle adjustment. It was previously asked to explain why the other team says yes without being told anything about that team's needs.",
      "Bar colors on the overview go red, amber, green, bright green in one ramp. Cyan used to mean 'best' next to a label and 'middling' inside a bar on the same screen.",
      "These patch notes, plus a copyright, privacy policy, and terms in the footer.",
    ],
    knownIssues: [
      "Your league's grades do not change the moment a release ships. Profiles are cached and recomputed when a league syncs, so a release lands for you within the hour, or immediately if you hit Refresh Data.",
      "Depth still counts a player who is already starting in your FLEX as depth at his own position, so some RB and WR rooms read a little deeper than they play.",
      "TE age curves are built on a thin sample above age 30 and never show acceleration. Treat TE age arbitrage as unsupported by data rather than as a finding.",
      "The window tier cutoffs are calibrated on one league. If your league's teams cluster differently, the LONG and SHORT labels may not split where you would split them.",
      "There is no way yet to see that new feedback has come in, and no way to leave feedback about the site itself rather than about a specific trade. Both are on the list.",
    ],
  },
  {
    branch: "barkley",
    algo: "Shotgun",
    date: "2026-07-25",
    title: "The trade-focused rebuild, then aging rebuilt from real data",
    changes: [
      "Send It trade finder: pick an angle, scan the league, and get ranked packages with a written rationale for both sides.",
      "Trade Grades: your league's real Sleeper trade history, graded at today's values, with a power-rankings ledger.",
      "The Window Map, showing every team's competitiveness against its timeline, with projected drift arrows a year and two years out.",
      "Thumbs up and thumbs down on every trade, with reason chips and a comment box. This is what the tuning actually runs on, so it matters more than it looks.",
      "Leagues refresh themselves when you look at them instead of waiting for a manual sync.",
      "Age curves rebuilt from real NFL data (1999 to 2024) instead of hand-set breakpoints, with one aging model shared by the window math, the projection arrows, and the trade engine rather than two that could drift apart.",
      "Aging is judged by how fast a player's remaining value is draining, not by his birthday. A 27 year old RB and a 27 year old WR are in completely different places, and the old flat cutoff labelled half the league's best players as aging assets to buy at a discount.",
      "One-for-one swaps at the same position now need a real age gap to be suggested at all. Trading a WR for a WR of the same age is churn, not a trade.",
      "Rebuilding teams are no longer offered win-now production for nothing. Most leagues break draft order on points scored, so a team that is tanking loses draft position by taking your productive veteran.",
      "Trade scoring is measured against the acceptance bar rather than from zero. A package that helped nobody used to score 0.48 out of 1.",
      "Every piece of feedback is automatically stamped with a content hash of the algorithm that produced the trade, so old feedback can never be mistaken for a description of the current engine.",
    ],
    knownIssues: [
      "Depth grading ignored the starters in front of a backup. Fixed in daniels.",
      "Rationales occasionally stated a player's age with more confidence than the data supported.",
    ],
  },
];
