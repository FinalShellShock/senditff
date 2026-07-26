// Product patch notes, newest first.
//
// The engine changes constantly and the people using this app feel it: a trade
// that showed up last week may not show up this week, and until now nothing
// explained why. That reads as "the app is inconsistent" when the truth is
// "the app got better." These notes are the difference.
//
// ── Naming ───────────────────────────────────────────────────────────────────
// A release is `<branch> <major>.<minor>`, e.g. "daniels 1.1".
//
// The BRANCH is a dynasty player surname and changes only on a paradigm shift:
// a new data model, a rewritten scoring approach, a different product shape.
// Point releases within a branch are ordinary deploys. Bump minor for normal
// work, bump major for a big change that still fits the branch's paradigm.
//
// `algo` is a THIRD, independent axis: the formation name of the scoring
// engine (Shotgun, West Coast, Audible, ...). One engine spans many branches,
// so a release reports its engine rather than being named after it. These were
// briefly conflated as "Shotgun 1.4", which implied the formation was the
// version number. It is not.
//
// ── Writing an entry ─────────────────────────────────────────────────────────
// One entry per deploy that users would notice. Keep `changes` in plain
// language (what a manager notices).
//
// `knownIssues` is for problems we ACTUALLY KNOW ABOUT: trends visible in user
// feedback that have not been fixed yet, and bugs that have been reported or
// reproduced. It is NOT a place to list every theoretical limitation of the
// model. An empty array is the correct and common answer, and it means
// something precisely because it is not padded. Do not invent entries.

export type PatchNote = {
  /** Branch name. Lowercase player surname. Changes only on a paradigm shift. */
  branch: string;
  /** Point release within the branch, e.g. "1.1". */
  release: string;
  /** Formation name of the scoring engine this release runs. */
  algo: string;
  /** ISO date or range end, YYYY-MM-DD. */
  date: string;
  /** One line on the theme of the release. */
  title: string;
  changes: string[];
  knownIssues: string[];
};

// The current release, e.g. "daniels 1.0". Stamped on every piece of feedback
// alongside the algo fingerprint: the fingerprint says exactly which code ran,
// this says which release a human can look up in the notes above.
export function currentRelease(): string {
  const latest = PATCH_NOTES[0];
  return latest ? `${latest.branch} ${latest.release}` : "unreleased";
}

export const PATCH_NOTES: PatchNote[] = [
  {
    branch: "daniels",
    release: "1.3",
    algo: "Shotgun",
    date: "2026-07-25",
    title: "League data is now readable only by that league's members",
    changes: [
      "Tightened who can read a league. The database previously let any approved user read any league's rosters and grades if they knew its id, even with no connection to it. The app itself already checked properly, so this closes the gap underneath it. Nobody lost access to a league they are actually in.",
    ],
    knownIssues: [],
  },
  {
    branch: "daniels",
    release: "1.2",
    algo: "Shotgun",
    date: "2026-07-25",
    title: "Depth no longer counts a flex starter twice when it simulates an injury",
    changes: [
      "Fixed a bug in the new depth math: when a player was filling your FLEX, the injury simulation could put him in the resulting lineup twice, which made rosters that flex look more injury-proof than they are. Depth scores move slightly for those teams. No position grades changed on the test league.",
    ],
    knownIssues: [],
  },
  {
    branch: "daniels",
    release: "1.1",
    algo: "Shotgun",
    date: "2026-07-25",
    title: "Access control fixed, and value history is now being kept",
    changes: [
      "Fixed a real hole in access control. Anyone who could sign in with Google could grant themselves access by editing their own account record from the browser, which made the manual approval step decorative. Approval can now only be granted by the server. Nothing suggests this was ever used, and every current account was approved deliberately.",
      "Join requests can be reviewed and approved from inside the app instead of the database console.",
      "Player values are now archived once a day and kept. Until now each refresh overwrote the last one, so there was no history of what anything used to be worth. This is the groundwork for showing how a player has moved over the last week or month, and for checking the engine's own calls against what the market actually did.",
    ],
    knownIssues: [],
  },
  {
    branch: "daniels",
    release: "1.0",
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
    knownIssues: [],
  },
  {
    branch: "barkley",
    release: "1.0",
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
    knownIssues: [],
  },
];
