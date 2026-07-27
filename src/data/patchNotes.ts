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
    release: "1.16",
    algo: "Shotgun",
    date: "2026-07-26",
    title: "Team state shows the math, not the verdict again",
    changes: [
      "Rebuilt TEAM STATE. The old version plotted your starter strength, window and pick capital against the league, which just restated badges already at the top of the page. It told you where you sit without ever telling you why.",
      "SCORING: your actual points per week against every team in the league, from the most recent completed season. This is real scoring history, not a value estimate, and it is the one number here you can check against your own memory of the season.",
      "It divides by weeks played, not by wins and losses. In a league with a second weekly matchup against the median, the record counts 28 results across a 14 week season, which would have halved everyone's average.",
      "WINDOW: your starting lineup, one row each, showing how much career every starter has left and how much of your lineup value is riding on players past halfway. That is what the window tier is computed from, so now you can see the actual reason instead of a label.",
      "Career left is measured per position off nflverse production from 1999 to 2024. A 27 year old running back and a 27 year old quarterback are nowhere near the same place, and the bars show it.",
      "POSITIONS: each bar is the weakest slot you would actually have to start, with the two thresholds that set the label drawn right on it.",
      "That last one fixes a real contradiction. Position labels are set by absolute floors and by comparison to the whole player pool, never by league rank, so a position could read CRITICAL while sitting mid-pack in your league. The old chart showed the league rank as if it were the evidence. Now the thresholds themselves are on screen.",
    ],
    knownIssues: [
      "Points per game needs a league re-sync to appear. It fills in on its own within the hour, or immediately if you hit Refresh.",
    ],
  },
  {
    branch: "daniels",
    release: "1.15",
    algo: "Shotgun",
    date: "2026-07-26",
    title: "Positions folded into team state, with the real numbers",
    changes: [
      "POSITIONS is no longer its own section. It sits inside TEAM STATE, because it is the evidence for the starter-strength reading directly above it rather than unrelated detail.",
      "The starter and depth columns used to show a 0-100 score with a bar filled to that percentage. A lone filled bar cannot tell you whether you are three points off the field or in a class of your own, which is the entire question when you are deciding if a position is actually a problem.",
      "They now plot every team in the league on that position, with your dot in amber, next to your raw value. That is the data the score was computed from, so you can see the spread instead of trusting a number.",
      "Same treatment on the headline strips, so every chart on the page reads the same way: each dot is a team, the amber one is you.",
    ],
    knownIssues: [],
  },
  {
    branch: "daniels",
    release: "1.14",
    algo: "Shotgun",
    date: "2026-07-26",
    title: "See your team before the report explains it",
    changes: [
      "New TEAM STATE section above the scouting report. The plays kept asserting things about your team (you are a contender, your picks are thin) without ever showing you the numbers behind them.",
      "Left panel plots the whole league on the three axes the plays actually gate on: starter strength, how open your window is, and pick capital. Your dot is highlighted, so \"rank #3 of 16\" finally shows whether third is close to first or nowhere near it.",
      "Right panel plots your roster by age against dynasty value, with the two zones the plays name drawn right on it: the corner where a veteran is old but still worth selling, and the fringe band worth buying into. You can see at a glance that you have nobody in one of them.",
      "The shaded zones read their bounds from the same place the play copy does, so the picture and the sentence under it can never disagree.",
      "Scouting cards are more compact, since there is now a section above them.",
    ],
    knownIssues: [],
  },
  {
    branch: "daniels",
    release: "1.13",
    algo: "Shotgun",
    date: "2026-07-26",
    title: "Thumbs on the scouting report",
    changes: [
      "Every scouting report play now has the same thumbs up/down, reason chips and comment box as the trade cards in Send It.",
      "The reason chips are specific to plays rather than trades, because a play goes wrong differently: it can not apply to your team, name the wrong players, misread your window, or just tell you something you already knew.",
      "Play feedback is kept separate from trade feedback. Mixing the two would have quietly poisoned the reason tallies that tune which trades get suggested.",
    ],
    knownIssues: [],
  },
  {
    branch: "daniels",
    release: "1.12",
    algo: "Shotgun",
    date: "2026-07-26",
    title: "The scouting report now tells you what actually worked",
    changes: [
      "Rewrote the scouting report. It used to list trade angles scored 0 to 100 by the same math that picks your packages, which meant it mostly restated your window badge back to you. Every team in a 16 team league had \"fill a need\" in its top four, and one rebuilding team's number one angle was breaking up its best player.",
      "It now shows plays drawn from a study of 14,343 real dynasty trades, with the measured success rate next to each one. Landing one genuine difference-maker beat expectations 60% of the time. Splitting a star into pieces managed 47%, the only shape measured to lose.",
      "Each play names your own players, so \"package depth into a difference-maker\" points at the two specific guys worth packaging, and tells you where a single player at that combined value would rank in your league.",
      "Rebuilders get the plays the data supports for a rebuild: sell a veteran who still has value, bank picks and expect to wait, and buy the fringe rather than the deep fliers. Contenders get the contender version, including the finding that standing pat is its own decision (active contenders 56%, ones who stood pat 43%).",
      "No more padding. The report used to always show four rows, so some teams were handed an angle scoring literally zero. You now see only the plays that apply to you, between two and five.",
      "Every percentage says what it counts, and none of them are predictions for your roster. They are how often teams in that spot beat expectations.",
    ],
    knownIssues: [],
  },
  {
    branch: "daniels",
    release: "1.11",
    algo: "Shotgun",
    date: "2026-07-26",
    title: "The engine now cares most about who you end up with",
    changes: [
      "Followed 19,933 real trades into the following season to find what actually predicts a team getting better. One thing dominates: the quality of the player you end up with. Landing a top-24 dynasty player beat expectations 60% of the time, versus 48% for a trade whose best piece was outside the top 100. Ending up with the better of the two headliners beat giving him away, 54% to 46%.",
      "Trade suggestions now weigh that directly, so packages that land you a genuinely better player rank above ones that just balance on value. Trades landing a top-24 player went from 13% to 18% of what gets suggested.",
      "Almost nothing else turned out to matter. Trade shape, whether picks are involved, whether the player had been rising or falling, which position you get, and even whether you are filling a positional hole all came out flat once the quality of the player was accounted for.",
    ],
    knownIssues: [
      "61% of suggested trades still have you giving away the best player in the deal, which is the shape that underperforms. Fixing it needs changes to how packages are built, not how they are ranked, and four attempts at the ranking approach did not move it.",
    ],
  },
  {
    branch: "daniels",
    release: "1.10",
    algo: "Shotgun",
    date: "2026-07-26",
    title: "Trade advice now leans on what actually worked in 5,800 real trades",
    changes: [
      "Crawled 5,791 real dynasty trades from 400 leagues and followed 8,099 of the resulting team-seasons into the next year to see which trades actually helped.",
      "One thing came through clearly: if you are contending, packaging pieces into one better player works, and breaking a star into pieces does not. If you are rebuilding, neither shows any effect. The engine now weighs both of those by whether your team is trying to win now, which it previously ignored completely.",
      "The effect is honestly small, worth a fraction of a place in the standings, so it nudges the ordering rather than hiding anything.",
      "Also worth knowing: trading at all helps contenders (they beat expectations 56% of the time versus 43% for contenders who stood pat), and makes no measurable difference for rebuilding teams.",
    ],
    knownIssues: [
      "Give-one-get-two is still 44% of everything suggested, which is more than it should be. That is down to how packages get built rather than how they are scored, and it is the next thing to fix.",
    ],
  },
  {
    branch: "daniels",
    release: "1.9",
    algo: "Shotgun",
    date: "2026-07-26",
    title: "Confidence now measures whether a trade is good, not whether it fits a pattern",
    changes: [
      "The confidence badge was reading only one thing: how closely a trade matched a known archetype. It ignored whether the trade actually helped you, helped the other manager, or was fair. So a trade could help both sides enormously, be perfectly even, and still be labelled INSPIRATION.",
      "Measured across 80 trades, the three badges were indistinguishable on everything that matters. INSPIRATION trades had BETTER fit scores than the ones labelled WORTH A LOOK.",
      "Confidence now reads the blended score that already combines fit for you, fit for them, fairness and archetype fit. That is also what the list is sorted by, so the badge and the ordering finally agree.",
      "Removed a rule that was sabotaging the second slot. To show variety it skipped any trade whose type had already been used, which meant the second trade on your page was chosen for being different rather than good. It was the worst slot on the page.",
      "Trades are now ordered purely by quality, best first, and you still always get five options with honest badges rather than a short list.",
    ],
    knownIssues: [],
  },
  {
    branch: "daniels",
    release: "1.8",
    algo: "Shotgun",
    date: "2026-07-26",
    title: "Fixed the scoring that made almost nothing a real recommendation",
    changes: [
      "Trade angles were being scored against a scale they can never reach. The needs urgency number tops out around 60 on a real roster, but the scoring asked for 40 before an angle counted at all and 70 to count fully. Across a 16 team league only 4 of 64 spots cleared the first bar and nothing ever cleared the second.",
      "That silently zeroed entire families of trade ideas. Consolidating at QB, WR or TE, and tiering down at RB or WR, scored zero for every single team in the league. Since a trade's confidence rating is built from that same number, it also meant almost nothing could ever be labelled RECOMMENDED.",
      "Recalibrated to what the numbers actually are. Recommendations roughly tripled, every family of trade idea now scores somewhere, and no search falls back to degraded results any more.",
      "Scouting reports show stronger and more varied angles as a result. The strength label is that same score, so it was being dragged down by the same bug.",
      "Renamed the trade finder option that read 'bundle flex spares into a starter'. It never only looked at flex players: it packages two different positions into one better one, so it now says so.",
    ],
    knownIssues: [],
  },
  {
    branch: "daniels",
    release: "1.7",
    algo: "Shotgun",
    date: "2026-07-26",
    title: "Trade cards rebuilt for phones",
    changes: [
      "Trade cards were still using the desktop layout on phones, which gave each side of the trade about 150 pixels. Adding ages tipped it over: player names were breaking in half and values were being cut off.",
      "Each player now gets his own line, with name and value lined up in columns, so a three piece package reads as a list instead of a jumble. Side by side, the two halves mirror around the swap arrow: position badges sit on the outer edge of each column. On phones the sides stack, SEND above GET, and everything left aligns.",
      "Verified down to 320 pixels wide with no clipping, no wrapped names, and no sideways scrolling.",
    ],
    knownIssues: [],
  },
  {
    branch: "daniels",
    release: "1.6",
    algo: "Shotgun",
    date: "2026-07-26",
    title: "The feedback counter is a queue, not a lifetime total",
    changes: [
      "The feedback bell now counts only what is waiting to be reviewed, and resets when it gets reviewed. So it answers two useful questions instead of one vanity number: is there a backlog, or is the app caught up, and have you said anything since the last time it was cleared.",
    ],
    knownIssues: [],
  },
  {
    branch: "daniels",
    release: "1.5",
    algo: "Shotgun",
    date: "2026-07-26",
    title: "Green now means something on the leverage board",
    changes: [
      "Roughly 80% of the positional leverage board was rendering green, which made it useless for spotting anything. Green now means SURPLUS only, the positions worth shopping at. HEALTHY is neutral grey, because it means there is no leverage there and it covers about 60% of the board by nature.",
      "The grading itself did not change. Only which colour it is drawn in.",
      "Feedback moved out of the footer into a small button that stays in the bottom corner while you scroll, so you can report something without scrolling past it first.",
    ],
    knownIssues: [],
  },
  {
    branch: "daniels",
    release: "1.4",
    algo: "Shotgun",
    date: "2026-07-26",
    title: "The engine stops handing old players to teams that are rebuilding",
    changes: [
      "Every trade card now shows each player's age next to his value.",
      "The engine no longer pushes players in decline onto teams with a long timeline. It already understood that a rebuilding team does not want points scored, but it had no idea it also does not want old players, and those are different things. Every single downvote in the last batch was this, across four different kinds of trade and three different users.",
      "Fixed a bug where that check was reading the wrong side of the trade entirely, so a rebuilding team was being judged on what it gave away rather than what it took on. This is why a rebuild was graded an A for trading Lamar Jackson away for two thirty-year-olds.",
      "The check now also applies to YOU, not just the other manager. It only ever ran on the other side, so a rebuilding user searching their own trades got aging players with nothing pushing back.",
      "\"Buy an aging stud\" now requires an actual discount. It was suggesting trades where you paid full price or more to take on someone older, which is the one thing that trade type exists to avoid.",
      "Fixed the rationale getting the bundle premium backwards and telling you the other manager was charging a premium when you were.",
    ],
    knownIssues: [],
  },
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
