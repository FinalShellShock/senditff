var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// api/feedback.ts
var feedback_exports = {};
__export(feedback_exports, {
  default: () => handler
});
module.exports = __toCommonJS(feedback_exports);

// src/algoFingerprint.generated.ts
var ALGO_FINGERPRINT_BUILD = "ffaae21803a4";

// src/algo/version.ts
var ALGO_VERSION = "shotgun";

// src/data/patchNotes.ts
function currentRelease() {
  const latest = PATCH_NOTES[0];
  return latest ? `${latest.branch} ${latest.release}` : "unreleased";
}
var PATCH_NOTES = [
  {
    branch: "daniels",
    release: "1.12",
    algo: "Shotgun",
    date: "2026-07-26",
    title: "The scouting report now tells you what actually worked",
    changes: [
      `Rewrote the scouting report. It used to list trade angles scored 0 to 100 by the same math that picks your packages, which meant it mostly restated your window badge back to you. Every team in a 16 team league had "fill a need" in its top four, and one rebuilding team's number one angle was breaking up its best player.`,
      "It now shows plays drawn from a study of 14,343 real dynasty trades, with the measured success rate next to each one. Landing one genuine difference-maker beat expectations 60% of the time. Splitting a star into pieces managed 47%, the only shape measured to lose.",
      'Each play names your own players, so "turn spare parts into a difference-maker" points at the two specific guys worth packaging.',
      "Rebuilders get the plays the data supports for a rebuild: sell a veteran who still has value, bank picks and expect to wait, and buy the fringe rather than the deep fliers. Contenders get the contender version, including the finding that standing pat is its own decision (active contenders 56%, ones who stood pat 43%).",
      "No more padding. The report used to always show four rows, so some teams were handed an angle scoring literally zero. You now see only the plays that apply to you, between two and five.",
      "Every percentage says what it counts, and none of them are predictions for your roster. They are how often teams in that spot beat expectations."
    ],
    knownIssues: []
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
      "Almost nothing else turned out to matter. Trade shape, whether picks are involved, whether the player had been rising or falling, which position you get, and even whether you are filling a positional hole all came out flat once the quality of the player was accounted for."
    ],
    knownIssues: [
      "61% of suggested trades still have you giving away the best player in the deal, which is the shape that underperforms. Fixing it needs changes to how packages are built, not how they are ranked, and four attempts at the ranking approach did not move it."
    ]
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
      "Also worth knowing: trading at all helps contenders (they beat expectations 56% of the time versus 43% for contenders who stood pat), and makes no measurable difference for rebuilding teams."
    ],
    knownIssues: [
      "Give-one-get-two is still 44% of everything suggested, which is more than it should be. That is down to how packages get built rather than how they are scored, and it is the next thing to fix."
    ]
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
      "Trades are now ordered purely by quality, best first, and you still always get five options with honest badges rather than a short list."
    ],
    knownIssues: []
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
      "Renamed the trade finder option that read 'bundle flex spares into a starter'. It never only looked at flex players: it packages two different positions into one better one, so it now says so."
    ],
    knownIssues: []
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
      "Verified down to 320 pixels wide with no clipping, no wrapped names, and no sideways scrolling."
    ],
    knownIssues: []
  },
  {
    branch: "daniels",
    release: "1.6",
    algo: "Shotgun",
    date: "2026-07-26",
    title: "The feedback counter is a queue, not a lifetime total",
    changes: [
      "The feedback bell now counts only what is waiting to be reviewed, and resets when it gets reviewed. So it answers two useful questions instead of one vanity number: is there a backlog, or is the app caught up, and have you said anything since the last time it was cleared."
    ],
    knownIssues: []
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
      "Feedback moved out of the footer into a small button that stays in the bottom corner while you scroll, so you can report something without scrolling past it first."
    ],
    knownIssues: []
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
      '"Buy an aging stud" now requires an actual discount. It was suggesting trades where you paid full price or more to take on someone older, which is the one thing that trade type exists to avoid.',
      "Fixed the rationale getting the bundle premium backwards and telling you the other manager was charging a premium when you were."
    ],
    knownIssues: []
  },
  {
    branch: "daniels",
    release: "1.3",
    algo: "Shotgun",
    date: "2026-07-25",
    title: "League data is now readable only by that league's members",
    changes: [
      "Tightened who can read a league. The database previously let any approved user read any league's rosters and grades if they knew its id, even with no connection to it. The app itself already checked properly, so this closes the gap underneath it. Nobody lost access to a league they are actually in."
    ],
    knownIssues: []
  },
  {
    branch: "daniels",
    release: "1.2",
    algo: "Shotgun",
    date: "2026-07-25",
    title: "Depth no longer counts a flex starter twice when it simulates an injury",
    changes: [
      "Fixed a bug in the new depth math: when a player was filling your FLEX, the injury simulation could put him in the resulting lineup twice, which made rosters that flex look more injury-proof than they are. Depth scores move slightly for those teams. No position grades changed on the test league."
    ],
    knownIssues: []
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
      "Player values are now archived once a day and kept. Until now each refresh overwrote the last one, so there was no history of what anything used to be worth. This is the groundwork for showing how a player has moved over the last week or month, and for checking the engine's own calls against what the market actually did."
    ],
    knownIssues: []
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
      "These patch notes, plus a copyright, privacy policy, and terms in the footer."
    ],
    knownIssues: []
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
      "Every piece of feedback is automatically stamped with a content hash of the algorithm that produced the trade, so old feedback can never be mistaken for a description of the current engine."
    ],
    knownIssues: []
  }
];

// src/data/feedbackCategories.ts
var FEEDBACK_CATEGORIES = [
  { key: "overview", label: "League overview / shape" },
  { key: "scouting", label: "Scouting report / team deep dive" },
  { key: "trade_finder", label: "Trade finder (not one specific trade)" },
  { key: "calc", label: "Trade calculator" },
  { key: "grades", label: "Trade grades" },
  { key: "ui", label: "Look, layout, or wording" },
  { key: "idea", label: "Idea or feature request" },
  { key: "bug", label: "Something is broken" },
  { key: "other", label: "Something else" }
];
var DEFAULT_FEEDBACK_CATEGORY = "other";

// api/_lib/admin.ts
var admin = __toESM(require("firebase-admin"));
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(
      JSON.parse(process.env["FIREBASE_SERVICE_ACCOUNT_JSON"] ?? "{}")
    )
  });
  admin.firestore().settings({ ignoreUndefinedProperties: true });
}
var adminAuth = admin.auth();
var adminDb = admin.firestore();

// api/_lib/auth.ts
async function requireApprovedUser(req, res) {
  const authHeader = req.headers["authorization"] ?? "";
  if (!authHeader.startsWith("Bearer ")) {
    res.status(401).json({ error: "Unauthorized" });
    return null;
  }
  let uid;
  let email;
  try {
    const decoded = await adminAuth.verifyIdToken(authHeader.slice(7));
    uid = decoded.uid;
    email = decoded.email ?? "";
  } catch {
    res.status(401).json({ error: "Unauthorized" });
    return null;
  }
  const userSnap = await adminDb.collection("users").doc(uid).get();
  const d = userSnap.data();
  const isApproved = d?.["approved"] === true || d?.["subscribed"] === true;
  if (!userSnap.exists || !isApproved) {
    res.status(403).json({ error: "Forbidden" });
    return null;
  }
  return { uid, email };
}

// api/_lib/membership.ts
async function ensureLeagueAccess(uid, leagueRef, members) {
  if (members.includes(uid)) return true;
  const userSnap = await adminDb.collection("users").doc(uid).get();
  const sleeperUserId = userSnap.data()?.["sleeperUserId"];
  if (!sleeperUserId) return false;
  const match = await leagueRef.collection("profiles").where("ownerSleeperUserId", "==", sleeperUserId).limit(1).get();
  if (match.empty) return false;
  await leagueRef.set({ members: [...members, uid] }, { merge: true });
  return true;
}

// api/feedback.ts
var MAX_REASONS = 12;
var MAX_REASON_LENGTH = 40;
var MAX_COMMENT_LENGTH = 2e3;
var MAX_ROUTE_LENGTH = 200;
async function summarize(uid) {
  const snap = await adminDb.collection("feedback").select("userId", "pulledAt").get();
  let queued = 0;
  let mine = 0;
  for (const d of snap.docs) {
    if (d.get("pulledAt")) continue;
    queued++;
    if (d.get("userId") === uid) mine++;
  }
  return { queued, mine, others: queued - mine };
}
async function handler(req, res) {
  if (req.method !== "POST" && req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }
  const user = await requireApprovedUser(req, res);
  if (!user) return;
  if (req.method === "GET") {
    try {
      return res.status(200).json(await summarize(user.uid));
    } catch (err) {
      console.error("feedback summary error", err);
      return res.status(500).json({ error: "Internal server error" });
    }
  }
  const {
    kind: rawKind,
    category: rawCategory,
    route: rawRoute,
    verdict,
    reasons: rawReasons,
    comment: rawComment,
    leagueId,
    rosterId,
    packageIndex: rawPackageIndex,
    search: rawSearch,
    package: pkg,
    diagnostics
  } = req.body;
  const kind = rawKind === "site" ? "site" : "trade";
  const comment = typeof rawComment === "string" ? rawComment.slice(0, MAX_COMMENT_LENGTH) : "";
  if (kind === "site") {
    if (comment.trim().length === 0) {
      return res.status(400).json({ error: "comment required" });
    }
    const route = typeof rawRoute === "string" ? rawRoute.slice(0, MAX_ROUTE_LENGTH) : null;
    const category = typeof rawCategory === "string" && FEEDBACK_CATEGORIES.some((c) => c.key === rawCategory) ? rawCategory : DEFAULT_FEEDBACK_CATEGORY;
    try {
      const docRef = await adminDb.collection("feedback").add({
        createdAt: (/* @__PURE__ */ new Date()).toISOString(),
        userId: user.uid,
        userEmail: user.email,
        algoVersion: ALGO_VERSION,
        algoFingerprint: ALGO_FINGERPRINT_BUILD,
        release: currentRelease(),
        kind,
        category,
        comment,
        route
      });
      return res.status(200).json({ ok: true, id: docRef.id });
    } catch (err) {
      console.error("site feedback error", err);
      return res.status(500).json({ error: "Internal server error" });
    }
  }
  if (verdict !== "up" && verdict !== "down") {
    return res.status(400).json({ error: 'verdict must be "up" or "down"' });
  }
  if (typeof leagueId !== "string" || leagueId.length === 0) {
    return res.status(400).json({ error: "leagueId required" });
  }
  if (typeof rosterId !== "number" || !Number.isFinite(rosterId)) {
    return res.status(400).json({ error: "rosterId must be a number" });
  }
  if (pkg == null || typeof pkg !== "object" || Array.isArray(pkg)) {
    return res.status(400).json({ error: "package must be an object" });
  }
  const reasons = Array.isArray(rawReasons) ? rawReasons.filter((r) => typeof r === "string").slice(0, MAX_REASONS).map((r) => r.slice(0, MAX_REASON_LENGTH)) : [];
  const packageIndex = typeof rawPackageIndex === "number" && Number.isFinite(rawPackageIndex) ? rawPackageIndex : 0;
  const pkgRecord = pkg;
  const prompt = typeof pkgRecord["prompt"] === "string" ? pkgRecord["prompt"] : null;
  const counterRosterId = typeof pkgRecord["counterRosterId"] === "number" ? pkgRecord["counterRosterId"] : null;
  const search = {
    archetype: rawSearch?.archetype ?? null,
    position: rawSearch?.position ?? null,
    targetRosterId: rawSearch?.targetRosterId ?? null,
    noFillerPicks: rawSearch?.noFillerPicks === true
  };
  try {
    const leagueRef = adminDb.collection("leagues").doc(leagueId);
    const leagueSnap = await leagueRef.get();
    const members = leagueSnap.data()?.["members"] ?? [];
    if (!await ensureLeagueAccess(user.uid, leagueRef, members)) {
      return res.status(403).json({ error: "Forbidden" });
    }
    const docRef = await adminDb.collection("feedback").add({
      createdAt: (/* @__PURE__ */ new Date()).toISOString(),
      userId: user.uid,
      userEmail: user.email,
      algoVersion: ALGO_VERSION,
      algoFingerprint: ALGO_FINGERPRINT_BUILD,
      release: currentRelease(),
      kind,
      verdict,
      reasons,
      comment,
      leagueId,
      rosterId,
      counterRosterId,
      packageIndex,
      search,
      package: pkg,
      prompt,
      diagnostics: diagnostics ?? null
    });
    return res.status(200).json({ ok: true, id: docRef.id });
  } catch (err) {
    console.error("feedback error", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
