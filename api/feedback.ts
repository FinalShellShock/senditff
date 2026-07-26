import type { VercelRequest, VercelResponse } from "@vercel/node";
import { ALGO_FINGERPRINT, ALGO_VERSION } from "../src/algo/version";
import { currentRelease } from "../src/data/patchNotes";
import { DEFAULT_FEEDBACK_CATEGORY, FEEDBACK_CATEGORIES } from "../src/data/feedbackCategories";
import { adminDb } from "./_lib/admin";
import { requireApprovedUser } from "./_lib/auth";
import { ensureLeagueAccess } from "./_lib/membership";

const MAX_REASONS = 12;
const MAX_REASON_LENGTH = 40;
const MAX_COMMENT_LENGTH = 2000;

// App feedback is the same collection with a different shape: no trade, no
// league, just what the person wanted to say, plus a category and the page
// they were on. Kept in ONE collection so the unread count and the export both
// stay single-source, and separated by `kind` so scripts/feedback-export.ts
// can split them. Mixing free-form app feedback into the algorithm tuning data
// would poison the exact signal that export exists to produce: reason tallies
// and verdict splits only mean something across comparable trade judgments.
//
// The stored kind is still "site" so entries written before categories existed
// keep matching. It covers the whole app, not only the UI.
//
// "play" is a thumbs on a SCOUTING REPORT play. It gets its own kind for the
// same reason site feedback does: a play is a claim about strategy backed by a
// population statistic, while a trade is a specific package of specific
// players. They fail differently and are tuned in different files, so mixing
// their reason tallies would make both unreadable.
type FeedbackKind = "trade" | "site" | "play";

const MAX_ROUTE_LENGTH = 200;

type FeedbackBody = {
  kind?: string;
  category?: unknown;
  route?: unknown;
  verdict?: string;
  reasons?: unknown;
  comment?: unknown;
  leagueId?: string;
  rosterId?: number;
  packageIndex?: number;
  search?: {
    archetype?: string | null;
    position?: string | null;
    targetRosterId?: number | null;
    noFillerPicks?: boolean;
  };
  package?: unknown;
  diagnostics?: unknown;
  play?: unknown;
};

// Aggregate counts for the footer bell, scoped to the CURRENT QUEUE.
//
// Everything here counts only feedback that has not been reviewed yet, so the
// whole widget resets when Johnny pulls. That is the point: a lifetime total
// only ever grows and answers nothing. A queue answers two real questions at a
// glance. "Is he sitting on a backlog, or is the app current?" is the queue
// size. "Have I said anything since the last time he cleared it?" is your own
// share of it.
//
// Counts only, never content, so any approved user can see the state of the
// queue without seeing anyone's words.
//
// Counted in memory rather than with count() aggregations because "unreviewed
// AND mine" is an equality plus a range on two different fields, which
// Firestore needs a composite index for. At this app's scale (tens of
// documents) one projected read of the collection is cheaper than the index is
// worth. Revisit if this ever reaches thousands: switch to writing an explicit
// `pulledAt: null` on create and add the composite index.
async function summarize(uid: string) {
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

export default async function handler(req: VercelRequest, res: VercelResponse) {
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
    diagnostics,
  } = req.body as FeedbackBody;

  const kind: FeedbackKind =
    rawKind === "site" ? "site" : rawKind === "play" ? "play" : "trade";
  const comment = typeof rawComment === "string" ? rawComment.slice(0, MAX_COMMENT_LENGTH) : "";

  // Site feedback: a comment is the whole payload, so it is the only thing
  // required, and an empty one is not feedback.
  if (kind === "site") {
    if (comment.trim().length === 0) {
      return res.status(400).json({ error: "comment required" });
    }
    const route = typeof rawRoute === "string" ? rawRoute.slice(0, MAX_ROUTE_LENGTH) : null;
    // Validated against the known list rather than stored raw, so the export
    // can group on it without first cleaning up whatever a client sent.
    const category =
      typeof rawCategory === "string" && FEEDBACK_CATEGORIES.some((c) => c.key === rawCategory)
        ? rawCategory
        : DEFAULT_FEEDBACK_CATEGORY;
    try {
      const docRef = await adminDb.collection("feedback").add({
        createdAt: new Date().toISOString(),
        userId: user.uid,
        userEmail: user.email,
        algoVersion: ALGO_VERSION,
        algoFingerprint: ALGO_FINGERPRINT,
        release: currentRelease(),
        kind,
        category,
        comment,
        route,
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

  const reasons = Array.isArray(rawReasons)
    ? rawReasons
        .filter((r): r is string => typeof r === "string")
        .slice(0, MAX_REASONS)
        .map((r) => r.slice(0, MAX_REASON_LENGTH))
    : [];

  // Scouting play feedback. Needs the league for the same access check the
  // trade path runs, because a play's detail line names that league's players.
  if (kind === "play") {
    const play = req.body.play as Record<string, unknown> | undefined;
    if (play == null || typeof play !== "object" || Array.isArray(play)) {
      return res.status(400).json({ error: "play must be an object" });
    }
    const playKey = typeof play["key"] === "string" ? play["key"] : null;
    if (!playKey) return res.status(400).json({ error: "play.key required" });
    if (typeof leagueId !== "string" || leagueId.length === 0) {
      return res.status(400).json({ error: "leagueId required" });
    }
    if (typeof rosterId !== "number" || !Number.isFinite(rosterId)) {
      return res.status(400).json({ error: "rosterId must be a number" });
    }
    try {
      const leagueRef = adminDb.collection("leagues").doc(leagueId);
      const leagueSnap = await leagueRef.get();
      const members: string[] = (leagueSnap.data()?.["members"] as string[] | undefined) ?? [];
      if (!(await ensureLeagueAccess(user.uid, leagueRef, members))) {
        return res.status(403).json({ error: "Forbidden" });
      }
      const docRef = await adminDb.collection("feedback").add({
        createdAt: new Date().toISOString(),
        userId: user.uid,
        userEmail: user.email,
        algoVersion: ALGO_VERSION,
        algoFingerprint: ALGO_FINGERPRINT,
        release: currentRelease(),
        kind,
        verdict,
        reasons,
        comment,
        leagueId,
        rosterId,
        // Hoisted out of the blob so the export can group on them without
        // digging, the same way `prompt` is hoisted on the trade path.
        playKey,
        playTitle: typeof play["title"] === "string" ? play["title"] : null,
        playHitRate: typeof play["hitRate"] === "number" ? play["hitRate"] : null,
        playKind: play["kind"] === "avoid" ? "avoid" : "do",
        play,
      });
      return res.status(200).json({ ok: true, id: docRef.id });
    } catch (err) {
      console.error("play feedback error", err);
      return res.status(500).json({ error: "Internal server error" });
    }
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

  const packageIndex =
    typeof rawPackageIndex === "number" && Number.isFinite(rawPackageIndex) ? rawPackageIndex : 0;

  const pkgRecord = pkg as Record<string, unknown>;
  // Hoisted out of the package blob: the prompt is the thing being tuned, so
  // it should be a first-class column in the export rather than something you
  // have to dig for.
  const prompt = typeof pkgRecord["prompt"] === "string" ? (pkgRecord["prompt"] as string) : null;
  const counterRosterId =
    typeof pkgRecord["counterRosterId"] === "number" ? (pkgRecord["counterRosterId"] as number) : null;

  const search = {
    archetype: rawSearch?.archetype ?? null,
    position: rawSearch?.position ?? null,
    targetRosterId: rawSearch?.targetRosterId ?? null,
    noFillerPicks: rawSearch?.noFillerPicks === true,
  };

  try {
    const leagueRef = adminDb.collection("leagues").doc(leagueId);
    const leagueSnap = await leagueRef.get();
    const members: string[] = (leagueSnap.data()?.["members"] as string[] | undefined) ?? [];
    if (!(await ensureLeagueAccess(user.uid, leagueRef, members))) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const docRef = await adminDb.collection("feedback").add({
      createdAt: new Date().toISOString(),
      userId: user.uid,
      userEmail: user.email,
      algoVersion: ALGO_VERSION,
      algoFingerprint: ALGO_FINGERPRINT,
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
      diagnostics: diagnostics ?? null,
    });

    return res.status(200).json({ ok: true, id: docRef.id });
  } catch (err) {
    console.error("feedback error", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
