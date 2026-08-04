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
  /**
   * The algo fingerprint this release actually stamped on feedback. Lets a
   * logged thumbs-down be traced to a release rather than to a bare hash, and
   * more importantly lets you see at a glance that two releases ran the SAME
   * engine.
   *
   * Backfilled from the git tags by hashing each tag's files. Absent where a
   * release was never tagged (barkley 1.0).
   *
   * NOTE: daniels 1.21 changed what this hashes. Up to and including 1.20 it
   * covered src/algo/plays.ts, so scouting-report edits moved it; from 1.21 the
   * scouting report has its own hash and this covers the trade path only. That
   * is why 1.12 through 1.20 show so much churn on a trade engine that did not
   * change once between 1.14 and 1.20.
   */
  algoFingerprint?: string;
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
    release: "1.32",
    algo: "Shotgun",
    algoFingerprint: "19ddbc5e248b",
    date: "2026-08-04",
    title: "\"Is anyone in this deal any good\" is now a question about your own league",
    changes: [
      "The check for a trade full of nobodies used to ask whether anyone ranked inside the top 100 players in the league. That treated a tight end and a receiver at the same rank as equally useful, which is wrong when your league starts one tight end and two receivers plus flex.",
      "It now asks whether a player would actually start somewhere in your league at his own position. In your 16 team league that means 16 quarterbacks, 57 running backs, 50 receivers and 21 tight ends, counted off real lineups so flex is already included. Nobody picked those numbers; they are a fact about your league.",
      "The practical difference: Tony Pollard used to trip the warning because he ranked 124th overall. He is a startable running back, so he no longer does.",
      "On the rankings page, picks now show their actual pick number instead of a blank. A 2.03 in a 12 team league reads as Pick 15. Picks whose slot is still projected stay blank rather than passing off a guess as a fact.",
    ],
    knownIssues: [],
  },
  {
    branch: "daniels",
    release: "1.31",
    algo: "Shotgun",
    algoFingerprint: "1650f710baf0",
    date: "2026-08-04",
    title: "Trades tell you when nobody in them is any good, instead of disappearing",
    changes: [
      "Last release started hiding trades where none of the players were worth much. That was the wrong call and it is reversed. You get the trade, and it tells you why it is only an idea.",
      "The badge already said INSPIRATION on those, which is true and useless: \"this roster doesn't suit that shape\" and \"none of these players is worth much\" are completely different problems, and you had no way to tell which one you were looking at. Each of those now says so in a line under the card.",
      "The check itself is unchanged: does anything in the deal rank inside the league's top 100. It just labels now instead of deleting. Six of eighty suggestions carry it, and you can see all six.",
      "Searching for trades involving a specific player never hides anything either. If the only deals available for your WR5 are unexciting, you should see them, labelled, rather than an empty page.",
    ],
    knownIssues: [],
  },
  {
    branch: "daniels",
    release: "1.30",
    algo: "Shotgun",
    algoFingerprint: "fdec63255448",
    date: "2026-08-04",
    title: "Rankings show where a player sits at his own position",
    changes: [
      "The rankings page has a POS RK column: QB1, WR14, RB4. Overall rank tells you what a player is worth, positional rank tells you what he is worth to a lineup, and those are different questions.",
      "Ranked against the full league pool, so filtering to receivers does not renumber anyone. Your WR14 stays WR14.",
      "On phones the coloured position badge steps aside for it, since \"WR14\" already says the position and the rank in the space the badge used for the position alone.",
    ],
    knownIssues: [],
  },
  {
    branch: "daniels",
    release: "1.29",
    algo: "Shotgun",
    algoFingerprint: "fdec63255448",
    date: "2026-08-04",
    title: "Trades have to involve someone actually good, and the calculator moves to your thumbs",
    changes: [
      "The engine now refuses trades where nobody involved is any good. Every check it ran was relative: the two sides balanced against each other, each piece was a fair share of its own side, the player coming back beat the one going out. None of them ever asked whether the players were worth having, so a deal made entirely of bench pieces passed all of them at once.",
      "The best asset in a deal now has to rank inside the league's top 100. That is not a made-up line: it is the band the trade research already measured, where landing a top-24 player beat expectations 60% of the time against 48% once the best piece fell outside the top 100. Forced searches and searches pinned to a specific player are exempt, because if you asked for something specific you should see what exists rather than a blank page.",
      "The calculator has been rebuilt around the bottom of the screen. Search, the results and your running totals now sit in a dock pinned above the keyboard, because that is where your thumb already is. Results stack above the input so you can read the trade, see the matches and type without any of them moving.",
      "The dock stays a single line until you tap into it, so the page is not carrying a list you did not ask for.",
    ],
    knownIssues: [],
  },
  {
    branch: "daniels",
    release: "1.28",
    algo: "Shotgun",
    algoFingerprint: "c73e12cc9692",
    date: "2026-08-04",
    title: "Six things that had been waiting: pick prices, bench value, a rankings tab and a rebuilt calculator",
    changes: [
      "Draft picks are priced on YOUR league's scale now. FantasyCalc publishes slotted pick values for a 12 team league and only a 12 team league, and we were reading our own slots straight off that list. In a 16 team league your 2.09 is the 25th pick overall but was being priced as if it were the 21st, about 14% too high, and every pick in the league was inflated the same way. Picks 1.13 through 1.16 were worse: they matched nothing at all and quietly fell back to an estimate, so one round had exact prices for its first twelve picks and guesses for the rest.",
      "The engine stops paying you extra for a trade the other manager loves. Whether they would accept is a yes or no question, and past the point where the answer is clearly yes, more enthusiasm on their side means you are paying more than you needed to. The two most one-sided deals in the feedback so far were both ones you rejected.",
      "It also stops treating value you cannot start as full value. In a one quarterback league a second quarterback cannot get on the field, and the engine was pricing him as if he could. Rebuilding teams are exempt, because stashing players who cannot start yet is the entire point of a rebuild.",
      "New RANKINGS tab: every rostered player and pick in the league by dynasty value, with who owns it, and how much of its value is still ahead of it. Filter by position, age, value, players or picks.",
      "The trade calculator has been rebuilt around how it is actually used. Search is at the top now, because on a phone the keyboard covers the bottom of the screen and the results were landing underneath it. A one-line summary of the trade sticks to the top of the page, so the numbers never disappear while you are typing.",
      "And the calculator can now balance a trade for you. Pick whether you want the deal to read as fair, an overpay or an underpay, and it works out how much the lighter side needs to add and lists that team's own assets that land in the range, closest first.",
      "Positional leverage now also sits at the bottom of the calculator page.",
    ],
    knownIssues: [
      "A package can pass every rule and still not be worth making, because nothing yet measures whether the players involved are any good in absolute terms.",
    ],
  },
  {
    branch: "daniels",
    release: "1.27",
    algo: "Shotgun",
    algoFingerprint: "b768314c1638",
    date: "2026-08-04",
    title: "Fixes the gap the last release put through the middle of the window map",
    changes: [
      "The pick adjustment shipped in 1.26 compared every team against the league average share of value held in picks. That was the wrong comparison: a couple of teams hoard picks and drag the average above what any normal roster holds, so ten of sixteen teams came out below average and every one of them got pushed toward a shorter window.",
      "The effect was a hole in the middle of the window map. The middle tier went from three teams to one, and both leagues showed a visible divide with nobody in it.",
      "It now compares each team against the MEDIAN, which is what a typical roster actually holds, so a typical roster gets no adjustment at all. That is what the old three-way label did for everyone in the middle, and it was the part worth keeping.",
      "Teams genuinely rich or poor in picks still move, and by the same amounts as before.",
    ],
    knownIssues: [
      "The trade calculator still needs a proper layout pass.",
      "A package can pass every rule and still not be worth making, because nothing yet measures whether the players involved are any good in absolute terms.",
    ],
  },
  {
    branch: "daniels",
    release: "1.26",
    algo: "Shotgun",
    algoFingerprint: "231cb8145742",
    date: "2026-08-04",
    title: "Your picks now count toward your window by how many you have, not which bucket you land in",
    changes: [
      "Draft picks have always nudged your window, but only through a three-way label: pick rich eased it, pick poor tightened it, and everyone else got nothing at all. The problem is that \"everyone else\" was most of the league. In the test league that middle bucket covered teams holding 9% of their value in picks and teams holding 47%, treating them identically while drawing a hard line between the 47% team and a 49% one.",
      "Picks now count continuously. The label was already a standard-deviation calculation under the hood; it was just rounding the answer to three values and discarding the rest. Same maths, nothing thrown away.",
      "Calibrated to change nothing where the old version was actually tuned: a team at the league average still gets no adjustment, and the teams at the old pick rich and pick poor cutoffs get exactly what they got before. Only the teams in between move, which is the point.",
      "Two of sixteen teams in the test league shift window tier as a result, both by one step. Trade suggestions are otherwise unchanged: still five packages for every roster, still identical across repeated runs.",
      "This is the first piece of the unbanked value idea from the last release feeding into an actual number rather than just being displayed.",
    ],
    knownIssues: [
      "The trade calculator still needs a proper layout pass. It was built before the impact panel, the fairness badge and the player filters existed, and has never been reorganised around them.",
      "A package can pass every rule and still not be worth making, because nothing yet measures whether the players involved are any good in absolute terms.",
    ],
  },
  {
    branch: "daniels",
    release: "1.25",
    algo: "Shotgun",
    algoFingerprint: "66d9bdc652c8",
    date: "2026-08-04",
    title: "A new way to read your window that owes nothing to age",
    changes: [
      "New UNBANKED VALUE panel in TEAM STATE. FantasyCalc prices every player twice: what the rights to him are worth long term, and what he is worth this season. The gap between those is the market telling you how much of him you have not been paid for yet, and it is priced player by player rather than read off an age curve.",
      "Your number is the share of everything you own that is still owed to you. Draft picks count in full, because a pick cannot score a point this season, so a team sitting on picks reads as holding a lot of unrealised value. Rightly.",
      "Your starting lineup gets its own reading, and it can go negative. Negative means your lineup out-produces its own long-term price, which is what a contending roster looks like: that value is banked, not pending.",
      "This is a second opinion, not a replacement. It is not wired into any score, badge or trade suggestion. Across the test league it agrees with the existing window reading only about 60% of the time, and the disagreements are the interesting part: one roster has the fifth oldest starting lineup in the league and the second most unrealised one at the same time, which the age curve has no way to express.",
    ],
    knownIssues: [
      "The trade calculator still needs a proper layout pass. It was built before the impact panel, the fairness badge and the player filters existed, and has never been reorganised around them.",
      "A package can pass every rule and still not be worth making, because nothing yet measures whether the players involved are any good in absolute terms.",
    ],
  },
  {
    branch: "daniels",
    release: "1.24",
    algo: "Shotgun",
    algoFingerprint: "66d9bdc652c8",
    date: "2026-08-02",
    title: "Trade cards show how both teams change, and say a lot less",
    changes: [
      "Every trade card now shows what the trade does to both rosters: your starters and your depth at each position in the deal, and the same for the other team. Only the positions actually involved, because a quarterback for a running back tells you nothing about your tight ends.",
      "Drawn as bars rather than numbers, so you can read it at a glance. The bar is where the position ends up, and the coloured tip is the change: green if the room got better, red if it got worse. Hover for the exact figures. The two halves mirror around the middle the same way the send and get sides of the card do.",
      "These are real recalculations of both rosters after the trade, not the current number with the traded value added on. The engine was already working all of this out to score the trade and then throwing it away.",
      "The written rationale is two sentences now: one on why it fits you, one on why they say yes. Everything it used to spend paragraphs restating is on the card already.",
      "It is also no longer allowed to talk about age. It had called a 38 year old \"younger\" than a 33 year old and described a 27 year old receiver as an aging asset. Ages are printed on every player, so you can see for yourself.",
      "It can no longer print internal numbers at you either. \"Your 21-urgency QB need\" was a real sentence a real person read. That number was never on a 0 to 100 scale and was never meant to leave the engine, so it is not handed to the writer at all now.",
      "On phones, the player search filters collapse to a single line instead of three rows. They were pushing the search results down under the keyboard, which made picking a player nearly impossible.",
    ],
    knownIssues: [
      "The trade calculator needs a proper layout pass. It was built before the impact panel, the fairness badge and the player filters existed, and it has never been reorganised around them. Collapsing the filters fixes the worst of it on mobile but not the underlying design.",
      "A package can pass every rule and still not be worth making, because nothing yet measures whether the players involved are any good in absolute terms.",
    ],
  },
  {
    branch: "daniels",
    release: "1.23",
    algo: "Shotgun",
    algoFingerprint: "ee3de4362a27",
    date: "2026-08-02",
    title: "Consolidate is one option now, and it can finally build the obvious trades",
    changes: [
      "There were two consolidate options in the trade finder and there should only ever have been one. \"2 same-position into 1 stud\" packaged two players at the same position, and \"2 positions into 1 stud\" was quietly hardcoded to your second-best running back plus your second-best receiver, and nothing else.",
      "Between them, half the possible packages could not be built at all. Your QB with your RB, your QB with your WR, your QB with your TE, your RB with your TE, your TE with your WR: none of those five combinations existed as far as the engine was concerned. In a superflex league, \"my second quarterback and my second running back for your stud\" is an ordinary trade it simply could not think of.",
      "Now it is one option that takes any two of your spare pieces, wherever they play, and buys one better player at a position you actually need. On the test league the combinations that were impossible are now the most common ones, because your backup quarterback turns out to be the most useful trade currency you own.",
      "You get more consolidation options as a result, and a search pinned to a specific player now finds something every time rather than occasionally coming up empty.",
      "The scouting report's \"package depth into one difference-maker\" now names your best two spare pieces wherever they play, instead of the best two at a single position. It was restricted last week only because the button behind it could not search across positions, and now it can.",
    ],
    knownIssues: [
      "The written rationale on each trade card is still too long and still gets things wrong. It is being rebuilt to show how both teams actually change at the positions in the trade, with far less prose. This is the next thing being worked on.",
      "A package can pass every rule and still not be worth making, because nothing yet measures whether the players involved are any good in absolute terms.",
    ],
  },
  {
    branch: "daniels",
    release: "1.22",
    algo: "Shotgun",
    algoFingerprint: "e377c25eca47",
    date: "2026-08-02",
    title: "Five different trades, not the same trade five times",
    changes: [
      "The five cards were often three ideas wearing five faces: the same trade again with a different pick attached, or four versions of shipping the same player. You now get at most one of any given trade, and at most two built around the same player. If that leaves four options instead of five, you get four. A shorter list of real choices beats a padded one.",
      "Breaking up a good player now has to buy you something somewhere else. Trading a quarterback for two quarterbacks left your starter worse and your bench deeper, and it was doing it in two different leagues. Deals that only reload the position you just emptied now rank below deals that improve a different one. They are not banned, because sometimes that trade is right, they just stop crowding out better ideas.",
      "Consolidating had two more holes. One kind of consolidation was never checked for whether it landed an upgrade at all, and another counted only the players you send while ignoring the pick you throw in, so it could call a small step up a consolidation.",
      "Trade cards list the biggest piece first. A package reading \"Jerry Jeudy, Breece Hall\" buried the part that mattered.",
      "Every player on a trade card shows his NFL team.",
      "Fixed the calculator zooming and cutting off the text box on iPhone. Any text box under a certain size makes iOS zoom the whole page, and every box in the app was under it. Typing a player name or writing feedback should behave now.",
    ],
    knownIssues: [
      "The written rationale on each trade card is too long and still gets things wrong: it has called a 38 year old quarterback \"younger\" than a 33 year old, described a 27 year old receiver as an aging asset, and printed an internal number at you with no explanation. It is being rebuilt to show how both teams actually change at the positions in the trade, with far less prose.",
      "A package can pass every rule and still not be worth making, because nothing yet measures whether the players involved are any good in absolute terms.",
    ],
  },
  {
    branch: "daniels",
    release: "1.21",
    algo: "Shotgun",
    algoFingerprint: "8cb30600a5c9",
    date: "2026-08-01",
    title: "Name a player and search around him, and no more filler bodies",
    changes: [
      "You can now point the trade finder at a specific player or pick. Open INVOLVE SPECIFIC PLAYERS OR PICKS on the Send It tab, mark what you want to send or land, and every package that comes back has to include it. Thanks to Gibbs for asking for this one directly.",
      "It searches, it does not invent: the finder still only builds the trade shapes it knows how to build, so naming a deep bench player can come back empty. When it does it now says so, and tells you how many packages it built before your pieces ruled them out.",
      "The trade calculator's search got real filters: position, age band, value band, and players or picks. Send It's new picker uses the same ones, so the two cannot drift apart.",
      "Packages no longer carry passengers. A player worth nothing could ride along on a side, which turned a straight one-for-one into something the card presented as a two-piece package. Two of you reported the same thing: adding someone of zero value does not make a trade even. Every piece now has to be worth at least a twentieth of its side.",
      "\"Consolidate\" now has to actually move you up. It was checking the pair's combined value and never the best player leaving, so it would happily take your best guy and hand back someone worse. Turning depth into a better player is the whole point of the shape, so the player coming back now has to clearly beat the best one going out.",
      "Feedback buttons name the team you are looking at. \"Doesn't fit for me\" meant whichever roster was on screen, not you, which made your own notes unreadable later whenever you were scouting someone else's team. Same fix on the scouting report.",
      "POSITIONAL LEVERAGE moved up the league page, above the team table. It is for building trades, and it was sitting under sixteen rows where nobody found it.",
    ],
    knownIssues: [
      "Packages can still be technically sound and not worth making: a few low-value pieces for another low-value piece passes every rule we have, because none of them measures whether the players involved are actually any good. Reported and not fixed.",
    ],
  },
  {
    branch: "daniels",
    release: "1.20",
    algo: "Shotgun",
    algoFingerprint: "2adcd0e0279a",
    date: "2026-07-27",
    title: "The difference-maker play has to actually buy a difference-maker",
    changes: [
      "\"Package depth into one difference-maker\" now only appears when your two pieces could genuinely land a top-24 player. It was firing on a rebuilding roster whose two spare quarterbacks were worth 2,235 together, which buys the 74th most valuable player in that league. That is not a difference-maker, and those quarterbacks are worth more sold to a contender in-season anyway.",
      "Top 24 is not a taste call: it is the exact tier the 60% figure quoted on that play is measured on. If your package cannot reach it, the finding does not apply to you and the play stays off.",
      "\"Buy the fringe, not the lottery tickets\" has a button again, pointing at Picks to players. That is the real mechanism for a pick-rich team buying young players, though the finder still cannot filter to the exact value band, so the play now tells you to check ages and values on what comes back.",
    ],
    knownIssues: [
      "Two teams in a 16 team test league now see an empty scouting report. Both are stuck in the middle with no measured angle that fits. The report will not pad with filler, so an empty one means we genuinely have nothing backed by data for that spot yet.",
    ],
  },
  {
    branch: "daniels",
    release: "1.19",
    algo: "Shotgun",
    algoFingerprint: "a98f8075739e",
    date: "2026-07-27",
    title: "Scouting links now say where they go, and go somewhere sensible",
    changes: [
      "Thanks to Gibbs for catching this one. Clicking \"Buy the fringe, not the lottery tickets\" opened the trade finder on \"Buy an aging stud\", which is the opposite bet. That play is about young players on the edge of startable, and the engine has no search shape for it, so it no longer carries a button at all. The advice stands; the button was lying.",
      "Every scouting button now names the intent it opens, so you can see you are heading to \"Players to picks\" before you click rather than after.",
      "\"Package depth into one difference-maker\" now names two players at the SAME position. It opens the consolidate intent, which is a same-position search, but it was naming a receiver and a running back and then sending you somewhere that would never offer that trade.",
      "The intent names now live in one place, so the finder and the scouting report cannot drift apart again.",
    ],
    knownIssues: [],
  },
  {
    branch: "daniels",
    release: "1.18",
    algo: "Shotgun",
    algoFingerprint: "d679479f315e",
    date: "2026-07-27",
    title: "Scouting links that actually go somewhere",
    changes: [
      "\"Find these trades\" no longer appears on a play the trade finder cannot satisfy. Measured across a real 16 team league, 16 of 39 scouting links landed on \"none survived scoring\". A play that sends you to an empty result is worse than a play with no button.",
      "Most of those were self-inflicted. \"Package depth into one difference-maker\" was forcing the search to one position, picked arbitrarily from whichever spare piece was worth more, which also contradicted its own text: it names two players at different positions and then searched only one of them. Unscoped, that play now returns packages for all 16 teams instead of failing on five.",
      "The rest are genuine: sometimes nobody in your league will do that kind of deal today. Those buttons now stay hidden rather than promising a result.",
      "Each team page checks this once, in a single request, before drawing any buttons.",
    ],
    knownIssues: [],
  },
  {
    branch: "daniels",
    release: "1.17",
    algo: "Shotgun",
    algoFingerprint: "37576a046b39",
    date: "2026-07-27",
    title: "Dropped a scouting play that was not advice",
    changes: [
      "Removed \"End up with the better player\" from the scouting report. It measured fine (the side taking the better headliner beat expectations 54% of the time against 46% for the side giving him away) but nobody needs telling to try and win a trade. It fired on every roster in the league while saying nothing anyone could act on.",
    ],
    knownIssues: [
      "Teams stuck in the middle, neither contending nor rebuilding, can now see only one play. The report never pads with filler, so a thin section means we genuinely do not have a second measured angle for that spot yet.",
    ],
  },
  {
    branch: "daniels",
    release: "1.16",
    algo: "Shotgun",
    algoFingerprint: "8c0936e302ca",
    date: "2026-07-26",
    title: "Team state shows the math, not the verdict again",
    changes: [
      "Rebuilt TEAM STATE. The old version plotted your starter strength, window and pick capital against the league, which just restated badges already at the top of the page. It told you where you sit without ever telling you why.",
      "SCORING: your actual points per week against every team in the league, from the most recent completed season. This is real scoring history, not a value estimate, and it is the one number here you can check against your own memory of the season.",
      "It divides by weeks played, not by wins and losses. In a league with a second weekly matchup against the median, the record counts 28 results across a 14 week season, which would have halved everyone's average.",
      "WINDOW: the two startable players pulling your window shorter and the two holding it open, across every starting slot including flex. Each carries the points of age pressure it is responsible for, and those points sum to your total.",
      "Ranked by contribution, not by age. A 27 year old carrying a quarter of your lineup value moves the number far more than a 33 year old backup does, and only the weighted view shows that.",
      "Career left is measured per position off nflverse production from 1999 to 2024. A 27 year old running back and a 27 year old quarterback are nowhere near the same place, and the bars show it.",
      "POSITIONS: a four step meter per side, critical through surplus, with the numbers behind it on the page rather than buried in a tooltip. Each side names the player it is actually judging, his value, the floor he has to clear and how far he sits from a typical player at that spot.",
      "It shows your WEAKEST starter and your top backup instead of your best player. The best player is the one thing the label never looks at: a room can be critical precisely because there is nothing behind him.",
      "The window bars show each starter's push on your average: right of centre in red for shortening your window, left in green for holding it open. Every row now carries its WEAR figure, how much of a 23 year old's career is already gone at that position, which is the number that decides the grouping.",
      "Wear is measured per position and does not compare between them. Quarterbacks barely wear before 30, so a 31 year old quarterback can genuinely sit lower than a 27 year old receiver.",
    ],
    knownIssues: [
      "Points per game needs a league re-sync to appear. It fills in on its own within the hour, or immediately if you hit Refresh.",
    ],
  },
  {
    branch: "daniels",
    release: "1.15",
    algo: "Shotgun",
    algoFingerprint: "f06a4adff7c1",
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
    algoFingerprint: "f06a4adff7c1",
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
    algoFingerprint: "2391971471d0",
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
    algoFingerprint: "2391971471d0",
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
    algoFingerprint: "7a883247a604",
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
    algoFingerprint: "98115421c99a",
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
    algoFingerprint: "8ede6fa25f22",
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
    algoFingerprint: "53317c0c54a3",
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
    algoFingerprint: "2fe0c0951fcb",
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
    algoFingerprint: "2fe0c0951fcb",
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
    algoFingerprint: "2fe0c0951fcb",
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
    algoFingerprint: "2fe0c0951fcb",
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
    algoFingerprint: "d329a3795f53",
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
    algoFingerprint: "d329a3795f53",
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
    algoFingerprint: "87c6b1ff3fe3",
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
    algoFingerprint: "87c6b1ff3fe3",
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
