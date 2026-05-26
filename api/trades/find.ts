import { createHash } from "crypto";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import type { LeagueFormat, TeamProfile } from "../../src/algo/types";
import { adminDb } from "../_lib/admin";
import { requireApprovedUser } from "../_lib/auth";
import { getValueMaps } from "../_lib/snapshot";
import { generatePackages, type TradePackage } from "../_lib/tradeEngine";

export type { TradePackage } from "../_lib/tradeEngine";

const MODEL_HAIKU = "claude-haiku-4-5-20251001";

// ── Rationale generation ─────────────────────────────────────────────────────

function rationaleHash(pkg: Omit<TradePackage, "rationale">, myProfile: TeamProfile): string {
  const key = JSON.stringify({
    give: pkg.give.map((a) => a.id).sort(),
    receive: pkg.receive.map((a) => a.id).sort(),
    archetype: pkg.archetype,
    myWindow: myProfile.windowLabel,
  });
  return createHash("sha256").update(key).digest("hex");
}

function describeAsset(a: { kind: "player" | "pick"; name: string; position?: string }): string {
  return a.kind === "player" ? `${a.name} (${a.position})` : a.name;
}

async function generateRationale(
  pkg: Omit<TradePackage, "rationale">,
  myProfile: TeamProfile,
): Promise<string> {
  const giveNames = pkg.give.map(describeAsset).join(", ");
  const receiveNames = pkg.receive.map(describeAsset).join(", ");
  const archetypeLabel = pkg.archetype.replace(/_/g, " ");

  const prompt = `You are analyzing a dynasty fantasy football trade for a team classified as ${myProfile.windowLabel} (${myProfile.competitiveness} competitiveness, ${myProfile.windowTier} window).

Trade: Send ${giveNames} and receive ${receiveNames} from ${pkg.counterTeam}.
Trade type: ${archetypeLabel}.

Write 2-3 sentences explaining why this trade makes sense for this team right now. Be specific about the players, picks, and the team's situation. Do not use em dashes.`;

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
): Promise<TradePackage> {
  const hash = rationaleHash(pkg, myProfile);
  const cacheRef = adminDb.collection("rationaleCache").doc(hash);
  const cached = await cacheRef.get();

  if (cached.exists) {
    return { ...pkg, rationale: cached.data()?.["rationale"] as string };
  }

  const rationale = await generateRationale(pkg, myProfile);
  await cacheRef.set({ hash, rationale, archetype: pkg.archetype, generatedAt: new Date().toISOString() });
  return { ...pkg, rationale };
}

// ── Handler ──────────────────────────────────────────────────────────────────

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const user = await requireApprovedUser(req, res);
  if (!user) return;

  const { leagueId, rosterId } = req.body as { leagueId?: string; rosterId?: number };
  if (!leagueId || rosterId == null) {
    return res.status(400).json({ error: "leagueId and rosterId required" });
  }

  try {
    const leagueRef = adminDb.collection("leagues").doc(leagueId);
    const [leagueSnap, profilesSnap] = await Promise.all([
      leagueRef.get(),
      leagueRef.collection("profiles").get(),
    ]);

    const leagueData = leagueSnap.data();
    const members: string[] = (leagueData?.["members"] as string[] | undefined) ?? [];
    if (!members.includes(user.uid)) return res.status(403).json({ error: "Forbidden" });

    const format = leagueData?.["format"] as LeagueFormat | undefined;
    if (!format) return res.status(500).json({ error: "League format missing" });

    const profiles = profilesSnap.docs.map((d) => d.data() as TeamProfile);
    const myProfile = profiles.find((p) => p.rosterId === Number(rosterId));
    if (!myProfile) return res.status(404).json({ error: "Team not found" });

    // Use the upcoming-draft year persisted by sync (matches the year used to
    // build the cached profiles). Fall back to wall-clock only for legacy
    // league docs written before this field existed.
    const thisYear =
      (leagueData?.["upcomingDraftYear"] as number | undefined)
      ?? new Date().getFullYear();
    const valueMaps = await getValueMaps(format);
    const packages = generatePackages(myProfile, profiles, format, thisYear, 5, {
      dynastyByPos: valueMaps.dynastyByPos,
      redraftByPos: valueMaps.redraftByPos,
    });

    const withRationales = await Promise.all(
      packages.map((pkg) => addRationale(pkg, myProfile)),
    );

    return res.status(200).json({ packages: withRationales });
  } catch (err) {
    console.error("trades/find error", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
