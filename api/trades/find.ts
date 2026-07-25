import { createHash } from "crypto";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { ARCHETYPE_FAMILIES, type ArchetypeFamily } from "../../src/algo/archetypes";
import { POSITIONS } from "../../src/algo/constants";
import { fairnessText } from "../../src/algo/fairness";
import type { LeagueFormat, Position, TeamProfile } from "../../src/algo/types";
import { adminDb } from "../_lib/admin";
import { requireApprovedUser } from "../_lib/auth";
import { ensureLeagueAccess } from "../_lib/membership";
import { getValueMaps } from "../_lib/snapshot";
import { generatePackages, type TradePackage } from "../_lib/tradeEngine";

export type { GenerateDiagnostics, TradePackage } from "../_lib/tradeEngine";

const MODEL_HAIKU = "claude-haiku-4-5-20251001";

// ── Rationale generation ─────────────────────────────────────────────────────

// Bump when the rationale prompt changes in a way that should invalidate
// already-cached prose. The cache key is otherwise all trade inputs, so a
// better prompt would keep serving the old text forever: that is exactly how
// rationales with invented ages would have survived the fix that added real
// ages to the prompt.
const PROMPT_VERSION = 3;

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

// Ages are included because the model was otherwise inventing them, and on an
// age-arbitrage trade the age IS the argument. Real feedback caught a rationale
// claiming a 27-year-old was 25. Ages come straight from the FantasyCalc
// snapshot the algorithm scored the trade with, so the prose can't disagree
// with the math.
function describeAsset(a: {
  kind: "player" | "pick";
  name: string;
  position?: string;
  age?: number;
}): string {
  if (a.kind !== "player") return a.name;
  return a.age != null
    ? `${a.name} (${a.position}, age ${a.age.toFixed(1)})`
    : `${a.name} (${a.position})`;
}

// Haiku ignores the plain-prose instructions often enough that we enforce
// them here, on cached entries too (they were stored unsanitized): no em
// dashes, no markdown headings or bold.
function sanitizeRationale(text: string): string {
  return text
    .replace(/^#{1,6}[^\n]*$/gm, "")
    .replace(/\*\*/g, "")
    .replace(/\s*[—–]\s*/g, ", ")
    .trim();
}

// Split out from generateRationale so the exact prompt can be returned to the
// UI for inspection, including for cache hits where no API call happens. It is
// deterministic from the same inputs, so rebuilding it always matches what the
// cached rationale was written from.
//
// Token economics drove the rewrite. Output is billed at 5x input on Haiku
// ($5 vs $1 per Mtok), and rationales run longer than the prompt, so ~78% of
// the spend is the response. The lever is therefore asking for less prose, not
// trimming the input. Note max_tokens is a CAP, not a budget: unused tokens
// cost nothing, so lowering it truncates rather than saves. The ask is what
// controls length.
//
// Prompt caching does NOT apply here: Haiku 4.5's minimum cacheable prefix is
// 4096 tokens and this prompt is roughly 300. A cache_control marker would
// silently do nothing.
//
// The instruction boilerplate was cut hard to make room for signal the engine
// already knows and was throwing away: positional need, the two-sided fit
// grades, and how well the package actually matches its archetype.
export function buildRationalePrompt(
  pkg: Omit<TradePackage, "rationale">,
  myProfile: TeamProfile,
  counterProfile?: TeamProfile,
  diagnostics?: { degraded?: string; myArchetypeScore?: number },
): string {
  const giveNames = pkg.give.map(describeAsset).join(", ");
  const receiveNames = pkg.receive.map(describeAsset).join(", ");
  const archetypeLabel = pkg.archetype.replace(/_/g, " ");

  const fairnessNote =
    pkg.fairness === "FAIR"
      ? "Value is even."
      : `Raw value is a ${fairnessText(pkg.fairness).toLowerCase()} for you; acknowledge the lean and what it buys or costs.`;

  // Positional need on what's coming back. The engine computes urgency and a
  // classification per position and previously told the writer none of it, so
  // rationales argued from vibes where hard numbers existed.
  const inbound = [...new Set(pkg.receive.filter((a) => a.kind === "player" && a.position).map((a) => a.position!))];
  const needNotes = inbound
    .map((pos) => {
      const ps = myProfile.positionScores?.[pos as keyof typeof myProfile.positionScores];
      if (!ps) return null;
      return `${pos} ${ps.classification} (urgency ${Math.round(ps.urgency)})`;
    })
    .filter(Boolean);
  const needNote = needNotes.length ? `Your need at what you're getting: ${needNotes.join(", ")}.` : "";

  const fitNote = pkg.scores
    ? `Fit grades: you ${pkg.scores.myFit >= 0.05 ? "gain" : pkg.scores.myFit <= -0.05 ? "lose" : "roughly break even"}, they ${pkg.scores.theirFit >= 0.05 ? "gain" : pkg.scores.theirFit <= -0.05 ? "lose" : "roughly break even"}.`
    : "";

  // Johnny's ask: lead with confidence when the shape genuinely fits, and say
  // plainly when it does not. A forced-intent search that found nothing clean,
  // or a roster that scores badly for this archetype, produces inspiration
  // rather than a recommendation, and the copy should admit that.
  const archMatch = pkg.scores?.archMatch ?? 0;
  const rosterFit = diagnostics?.myArchetypeScore;
  const weak =
    diagnostics?.degraded != null || archMatch < 0.3 || (rosterFit != null && rosterFit < 30);
  const stance = weak
    ? `IMPORTANT: this roster is a weak match for ${archetypeLabel}${rosterFit != null ? ` (archetype fit ${rosterFit}/100)` : ""} and this was the closest package available, not a strong one. Open by saying plainly that this is an idea to consider rather than a recommendation, and name what is imperfect about it. Do not oversell.`
    : archMatch >= 0.6
      ? `This is a textbook ${archetypeLabel} for this roster. Lead with why the shape fits, and recommend it directly.`
      : `This is a reasonable ${archetypeLabel} fit. Be measured, neither overselling nor hedging.`;

  const theirs = counterProfile
    ? `${pkg.counterTeam} is ${counterProfile.windowLabel} (${counterProfile.competitiveness}, ${counterProfile.windowTier}).`
    : "";

  return `Dynasty fantasy football trade. You are ${myProfile.windowLabel} (${myProfile.competitiveness}, ${myProfile.windowTier} window). ${theirs}

Send: ${giveNames}
Get: ${receiveNames}

Shape: ${archetypeLabel}. ${fairnessNote} ${fitNote} ${needNote}
${stance}

Write 2-3 sentences on why this fits your roster now, then one sentence on why ${pkg.counterTeam} accepts (a trade nobody takes is worthless). Be concrete about the players and both timelines.

Use only the facts above. Never invent an age, stat, injury, contract, or team situation not stated here. Plain prose: no markdown, no bullets, no em dashes.`;
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
  const cacheRef = adminDb.collection("rationaleCache").doc(hash);
  const cached = await cacheRef.get();

  if (cached.exists) {
    return { ...pkg, rationale: sanitizeRationale(cached.data()?.["rationale"] as string), prompt };
  }

  const rationale = sanitizeRationale(await generateRationale(prompt));
  await cacheRef.set({ hash, rationale, archetype: pkg.archetype, generatedAt: new Date().toISOString() });
  return { ...pkg, rationale, prompt };
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
