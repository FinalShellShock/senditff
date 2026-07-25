import type { VercelRequest, VercelResponse } from "@vercel/node";
import { ALGO_FINGERPRINT, ALGO_VERSION } from "../src/algo/version";
import { adminDb } from "./_lib/admin";
import { requireApprovedUser } from "./_lib/auth";
import { ensureLeagueAccess } from "./_lib/membership";

const MAX_REASONS = 12;
const MAX_REASON_LENGTH = 40;
const MAX_COMMENT_LENGTH = 2000;

type FeedbackBody = {
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
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const user = await requireApprovedUser(req, res);
  if (!user) return;

  const {
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

  const reasons = Array.isArray(rawReasons)
    ? rawReasons
        .filter((r): r is string => typeof r === "string")
        .slice(0, MAX_REASONS)
        .map((r) => r.slice(0, MAX_REASON_LENGTH))
    : [];

  const comment = typeof rawComment === "string" ? rawComment.slice(0, MAX_COMMENT_LENGTH) : "";

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
