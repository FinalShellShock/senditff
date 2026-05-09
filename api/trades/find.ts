import { createHash } from "crypto";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import type { Player, TeamProfile } from "../../src/algo/types.ts";
import { adminDb } from "../_lib/admin.ts";
import { requireApprovedUser } from "../_lib/auth.ts";

const MODEL_HAIKU = "claude-haiku-4-5-20251001";
const POSITIONS = ["QB", "RB", "WR", "TE"] as const;

export type TradePackage = {
  counterTeam: string;
  counterRosterId: number;
  give: Array<{ id: string; name: string; position: string; valueDynasty: number }>;
  receive: Array<{ id: string; name: string; position: string; valueDynasty: number }>;
  valueGive: number;
  valueReceive: number;
  archetype: string;
  rationale: string;
};

// ── Package generation ───────────────────────────────────────────────────────

function topPlayersByPos(profile: TeamProfile, pos: string, n = 3): Player[] {
  return profile.players
    .filter((p) => p.position === pos)
    .sort((a, b) => {
      if (b.valueDynasty !== a.valueDynasty) return b.valueDynasty - a.valueDynasty;
      return a.id.localeCompare(b.id);
    })
    .slice(0, n);
}

function bestGiveFor(
  mine: TeamProfile,
  targetValue: number,
  excludePositions: string[] = [],
): Player[] {
  // Prefer giving from SURPLUS positions, then anything not in excluded set.
  const surplusPos = POSITIONS.filter(
    (p) => mine.positionScores[p].classification === "SURPLUS",
  );

  const candidates = mine.players
    .filter((p) => !excludePositions.includes(p.position))
    .sort((a, b) => {
      const aScore = mine.positionScores[a.position]?.urgency ?? 50;
      const bScore = mine.positionScores[b.position]?.urgency ?? 50;
      const aSurplus = surplusPos.includes(a.position) ? 0 : 1;
      const bSurplus = surplusPos.includes(b.position) ? 0 : 1;
      if (aSurplus !== bSurplus) return aSurplus - bSurplus;
      if (aScore !== bScore) return aScore - bScore; // lower urgency = more tradeable
      return b.valueDynasty - a.valueDynasty;
    });

  // 1-for-1: find player closest in value within 20%
  for (const p of candidates) {
    const ratio = p.valueDynasty / Math.max(1, targetValue);
    if (ratio >= 0.8 && ratio <= 1.25) return [p];
  }

  // 2-for-1 give: two players whose combined value ≈ targetValue
  for (let i = 0; i < Math.min(candidates.length, 8); i++) {
    for (let j = i + 1; j < Math.min(candidates.length, 8); j++) {
      const combined = candidates[i]!.valueDynasty + candidates[j]!.valueDynasty;
      const ratio = combined / Math.max(1, targetValue);
      if (ratio >= 0.85 && ratio <= 1.20) return [candidates[i]!, candidates[j]!];
    }
  }

  // Fallback: closest single player
  const best = [...candidates].sort(
    (a, b) => Math.abs(a.valueDynasty - targetValue) - Math.abs(b.valueDynasty - targetValue),
  )[0];
  return best ? [best] : [];
}

function scorePackage(
  mine: TeamProfile,
  give: Player[],
  receive: Player[],
  archetype: string,
): number {
  const valueGive = give.reduce((s, p) => s + p.valueDynasty, 0);
  const valueReceive = receive.reduce((s, p) => s + p.valueDynasty, 0);

  // Value balance: penalise lopsided deals
  const maxVal = Math.max(valueGive, valueReceive, 1);
  const balanceScore = 1 - Math.abs(valueGive - valueReceive) / maxVal;

  // How much does received player fill a need?
  const receivePos = receive[0]?.position ?? "QB";
  const posScore = mine.positionScores[receivePos as (typeof POSITIONS)[number]];
  const fillQuality = posScore ? posScore.urgency / 100 : 0.5;

  // Archetype alignment
  const archetypeMatch = mine.archetypes.some((a) => a.includes(archetype.split("_")[0]!))
    ? 1
    : 0.5;

  return fillQuality * 0.5 + balanceScore * 0.35 + archetypeMatch * 0.15;
}

function generatePackages(
  mine: TeamProfile,
  allProfiles: TeamProfile[],
): Array<Omit<TradePackage, "rationale">> {
  const candidates: Array<Omit<TradePackage, "rationale"> & { score: number }> = [];
  const others = allProfiles.filter((p) => p.rosterId !== mine.rosterId);

  // Need-fill trades: for each of my critical/regular needs, find players on other teams
  const needPositions = POSITIONS.filter(
    (p) =>
      mine.positionScores[p].classification === "CRITICAL_NEED" ||
      mine.positionScores[p].classification === "NEED",
  ).sort((a, b) => mine.positionScores[b].urgency - mine.positionScores[a].urgency);

  for (const needPos of needPositions) {
    for (const them of others) {
      const theirTop = topPlayersByPos(them, needPos, 2);
      for (const target of theirTop) {
        if (target.valueDynasty < 500) continue; // not worth trading for
        const give = bestGiveFor(mine, target.valueDynasty, [needPos]);
        if (give.length === 0) continue;
        const valueGive = give.reduce((s, p) => s + p.valueDynasty, 0);
        const archetype = `need_fill_${needPos}`;
        const score = scorePackage(mine, give, [target], archetype);
        candidates.push({
          counterTeam: them.ownerName,
          counterRosterId: them.rosterId,
          give: give.map((p) => ({ id: p.id, name: p.name, position: p.position, valueDynasty: p.valueDynasty })),
          receive: [{ id: target.id, name: target.name, position: target.position, valueDynasty: target.valueDynasty }],
          valueGive,
          valueReceive: target.valueDynasty,
          archetype,
          score,
        });
      }
    }
  }

  // Tier-down trades: if I have an elite player with weak depth, trade down for two mid-tiers
  for (const pos of POSITIONS) {
    if (!mine.archetypes.includes(`tier_down_${pos}`)) continue;
    const myElite = topPlayersByPos(mine, pos, 1)[0];
    if (!myElite) continue;

    for (const them of others) {
      const theirTwo = topPlayersByPos(them, pos, 3).slice(1, 3); // their 2nd + 3rd at pos
      if (theirTwo.length < 2) continue;
      const combinedReceive = theirTwo.reduce((s, p) => s + p.valueDynasty, 0);
      const ratio = combinedReceive / Math.max(1, myElite.valueDynasty);
      if (ratio < 0.75 || ratio > 1.30) continue;
      const score = scorePackage(mine, [myElite], theirTwo, `tier_down`);
      candidates.push({
        counterTeam: them.ownerName,
        counterRosterId: them.rosterId,
        give: [{ id: myElite.id, name: myElite.name, position: myElite.position, valueDynasty: myElite.valueDynasty }],
        receive: theirTwo.map((p) => ({ id: p.id, name: p.name, position: p.position, valueDynasty: p.valueDynasty })),
        valueGive: myElite.valueDynasty,
        valueReceive: combinedReceive,
        archetype: `tier_down_${pos}`,
        score,
      });
    }
  }

  // Age-arb sell: if window is SHORT and I'm not WEAK, sell high-value aging players
  if (mine.windowTier === "SHORT" && mine.competitiveness !== "WEAK") {
    for (const pos of POSITIONS) {
      const myTop = topPlayersByPos(mine, pos, 1)[0];
      if (!myTop || !myTop.age || myTop.age < 28 || myTop.valueDynasty < 1500) continue;
      for (const them of others) {
        if (them.windowTier === "LONG") {
          // They want veterans, we want picks or youth
          const theirYouth = them.players
            .filter((p) => p.position === pos && p.age != null && p.age <= 25)
            .sort((a, b) => b.valueDynasty - a.valueDynasty)[0];
          if (!theirYouth) continue;
          const give = [myTop];
          const receive = [theirYouth];
          const score = scorePackage(mine, give, receive, "age_arb") * 0.9;
          candidates.push({
            counterTeam: them.ownerName,
            counterRosterId: them.rosterId,
            give: give.map((p) => ({ id: p.id, name: p.name, position: p.position, valueDynasty: p.valueDynasty })),
            receive: receive.map((p) => ({ id: p.id, name: p.name, position: p.position, valueDynasty: p.valueDynasty })),
            valueGive: myTop.valueDynasty,
            valueReceive: theirYouth.valueDynasty,
            archetype: "age_arb_sell",
            score,
          });
        }
      }
    }
  }

  // Deduplicate: max 2 packages per counter-team, then sort and return top 10 for rationale generation
  const byCounter = new Map<number, typeof candidates>();
  for (const c of candidates) {
    const existing = byCounter.get(c.counterRosterId) ?? [];
    if (existing.length < 2) {
      byCounter.set(c.counterRosterId, [...existing, c]);
    } else if (c.score > Math.min(...existing.map((e) => e.score))) {
      existing.sort((a, b) => a.score - b.score);
      existing[0] = c;
      byCounter.set(c.counterRosterId, existing);
    }
  }

  return Array.from(byCounter.values())
    .flat()
    .sort((a, b) => b.score - a.score)
    .slice(0, 10)
    .map(({ score: _score, ...pkg }) => pkg);
}

// ── Rationale generation ─────────────────────────────────────────────────────

function rationaleHash(pkg: Omit<TradePackage, "rationale">, myProfile: TeamProfile): string {
  const key = JSON.stringify({
    give: pkg.give.map((p) => p.id).sort(),
    receive: pkg.receive.map((p) => p.id).sort(),
    archetype: pkg.archetype,
    myWindow: myProfile.windowLabel,
  });
  return createHash("sha256").update(key).digest("hex");
}

async function generateRationale(
  pkg: Omit<TradePackage, "rationale">,
  myProfile: TeamProfile,
): Promise<string> {
  const giveNames = pkg.give.map((p) => `${p.name} (${p.position})`).join(", ");
  const receiveNames = pkg.receive.map((p) => `${p.name} (${p.position})`).join(", ");
  const archetypeLabel = pkg.archetype.replace(/_/g, " ");

  const prompt = `You are analyzing a dynasty fantasy football trade for a team classified as ${myProfile.windowLabel} (${myProfile.competitiveness} competitiveness, ${myProfile.windowTier} window).

Trade: Send ${giveNames} and receive ${receiveNames} from ${pkg.counterTeam}.
Trade type: ${archetypeLabel}.

Write 2-3 sentences explaining why this trade makes sense for this team right now. Be specific about the players and the team's situation. Do not use em dashes.`;

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

    const members: string[] = (leagueSnap.data()?.["members"] as string[] | undefined) ?? [];
    if (!members.includes(user.uid)) return res.status(403).json({ error: "Forbidden" });

    const profiles = profilesSnap.docs.map((d) => d.data() as TeamProfile);
    const myProfile = profiles.find((p) => p.rosterId === Number(rosterId));
    if (!myProfile) return res.status(404).json({ error: "Team not found" });

    const packages = generatePackages(myProfile, profiles);
    const top5 = packages.slice(0, 5);

    const withRationales = await Promise.all(
      top5.map((pkg) => addRationale(pkg, myProfile)),
    );

    return res.status(200).json({ packages: withRationales });
  } catch (err) {
    console.error("trades/find error", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
