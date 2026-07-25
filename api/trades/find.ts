import { createHash } from "crypto";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { ARCHETYPE_FAMILIES, type ArchetypeFamily } from "../../src/algo/archetypes";
import { POSITIONS } from "../../src/algo/constants";
import type { LeagueFormat, Position, TeamProfile } from "../../src/algo/types";
import { adminDb } from "../_lib/admin";
import { requireApprovedUser } from "../_lib/auth";
import { ensureLeagueAccess } from "../_lib/membership";
import { getValueMaps } from "../_lib/snapshot";
import { generatePackages, type TradePackage } from "../_lib/tradeEngine";
import {
  buildRationalePrompt,
  confidenceForPackage,
  PROMPT_VERSION,
  sanitizeRationale,
} from "../_lib/rationalePrompt";

export type { GenerateDiagnostics, TradePackage } from "../_lib/tradeEngine";
export { buildRationalePrompt } from "../_lib/rationalePrompt";

const MODEL_HAIKU = "claude-haiku-4-5-20251001";

// ── Rationale generation ─────────────────────────────────────────────────────

// Bump when the rationale prompt changes in a way that should invalidate
// already-cached prose. The cache key is otherwise all trade inputs, so a
// better prompt would keep serving the old text forever: that is exactly how
// rationales with invented ages would have survived the fix that added real
// ages to the prompt.

function rationaleHash(
  pkg: Omit<TradePackage, "rationale">,
  myProfile: TeamProfile,
  counterProfile?: TeamProfile,
  diagnostics?: { degraded?: string; myArchetypeScore?: number },
): string {
  const key = JSON.stringify({
    promptVersion: PROMPT_VERSION,
    // These shape the prompt's stance (recommendation vs "closest we found"),
    // so the same package under different diagnostics is a different prompt
    // and must not share a cache entry.
    degraded: diagnostics?.degraded ?? null,
    myArchetypeScore: diagnostics?.myArchetypeScore ?? null,
    give: pkg.give.map((a) => a.id).sort(),
    receive: pkg.receive.map((a) => a.id).sort(),
    archetype: pkg.archetype,
    myWindow: myProfile.windowLabel,
    theirWindow: counterProfile?.windowLabel ?? null,
    fairness: pkg.fairness,
  });
  return createHash("sha256").update(key).digest("hex");
}

async function generateRationale(prompt: string): Promise<string> {
  const apiRes = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env["ANTHROPIC_API_KEY"] ?? "",
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL_HAIKU,
      max_tokens: 200,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!apiRes.ok) return "Rationale unavailable.";
  const data = (await apiRes.json()) as { content?: Array<{ text?: string }> };
  return data.content?.[0]?.text?.trim() ?? "Rationale unavailable.";
}

async function addRationale(
  pkg: Omit<TradePackage, "rationale">,
  myProfile: TeamProfile,
  counterProfile?: TeamProfile,
  diagnostics?: { degraded?: string; myArchetypeScore?: number },
): Promise<TradePackage> {
  const hash = rationaleHash(pkg, myProfile, counterProfile, diagnostics);
  const prompt = buildRationalePrompt(pkg, myProfile, counterProfile, diagnostics);
  const confidence = confidenceForPackage(pkg, diagnostics);
  const cacheRef = adminDb.collection("rationaleCache").doc(hash);
  const cached = await cacheRef.get();

  if (cached.exists) {
    return { ...pkg, confidence, rationale: sanitizeRationale(cached.data()?.["rationale"] as string), prompt };
  }

  const rationale = sanitizeRationale(await generateRationale(prompt));
  await cacheRef.set({ hash, rationale, archetype: pkg.archetype, generatedAt: new Date().toISOString() });
  return { ...pkg, confidence, rationale, prompt };
}

// ── Handler ──────────────────────────────────────────────────────────────────

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const user = await requireApprovedUser(req, res);
  if (!user) return;

  const { leagueId, rosterId, archetype, position, targetRosterId, noFillerPicks } = req.body as {
    leagueId?: string;
    rosterId?: number;
    archetype?: string;
    position?: string;
    targetRosterId?: number;
    noFillerPicks?: boolean;
  };
  if (!leagueId || rosterId == null) {
    return res.status(400).json({ error: "leagueId and rosterId required" });
  }
  if (archetype != null && !ARCHETYPE_FAMILIES.includes(archetype as ArchetypeFamily)) {
    return res.status(400).json({ error: `Unknown archetype: ${archetype}` });
  }
  if (position != null && !POSITIONS.includes(position as Position)) {
    return res.status(400).json({ error: `Unknown position: ${position}` });
  }
  if (targetRosterId != null && Number(targetRosterId) === Number(rosterId)) {
    return res.status(400).json({ error: "Target team must differ from perspective team" });
  }

  try {
    const leagueRef = adminDb.collection("leagues").doc(leagueId);
    const [leagueSnap, profilesSnap] = await Promise.all([
      leagueRef.get(),
      leagueRef.collection("profiles").get(),
    ]);

    const leagueData = leagueSnap.data();
    const members: string[] = (leagueData?.["members"] as string[] | undefined) ?? [];
    if (!(await ensureLeagueAccess(user.uid, leagueRef, members))) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const format = leagueData?.["format"] as LeagueFormat | undefined;
    if (!format) return res.status(500).json({ error: "League format missing" });

    const profiles = profilesSnap.docs.map((d) => d.data() as TeamProfile);
    const myProfile = profiles.find((p) => p.rosterId === Number(rosterId));
    if (!myProfile) return res.status(404).json({ error: "Team not found" });
    if (
      targetRosterId != null &&
      !profiles.some((p) => p.rosterId === Number(targetRosterId))
    ) {
      return res.status(400).json({ error: "Target team not found in league" });
    }

    // Use the upcoming-draft year persisted by sync (matches the year used to
    // build the cached profiles). Fall back to wall-clock only for legacy
    // league docs written before this field existed.
    const thisYear =
      (leagueData?.["upcomingDraftYear"] as number | undefined)
      ?? new Date().getFullYear();
    const valueMaps = await getValueMaps(format);
    const { packages, diagnostics } = generatePackages(myProfile, profiles, format, thisYear, {
      limit: 5,
      pools: {
        dynastyByPos: valueMaps.dynastyByPos,
        redraftByPos: valueMaps.redraftByPos,
      },
      ...(archetype
        ? {
            forceArchetype: {
              family: archetype as ArchetypeFamily,
              ...(position ? { position: position as Position } : {}),
            },
          }
        : {}),
      ...(targetRosterId != null ? { targetRosterId: Number(targetRosterId) } : {}),
      ...(noFillerPicks === true ? { noFillerPicks: true } : {}),
    });

    const withRationales = await Promise.all(
      packages.map((pkg) =>
        addRationale(
          pkg,
          myProfile,
          profiles.find((p) => p.rosterId === pkg.counterRosterId),
          diagnostics,
        ),
      ),
    );

    return res.status(200).json({ packages: withRationales, diagnostics });
  } catch (err) {
    console.error("trades/find error", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
