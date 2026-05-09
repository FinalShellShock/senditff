import type { VercelRequest, VercelResponse } from "@vercel/node";
import { adminDb } from "../_lib/admin.ts";
import { requireApprovedUser } from "../_lib/auth.ts";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const user = await requireApprovedUser(req, res);
  if (!user) return;

  const { leagueId } = req.query as { leagueId?: string };
  if (!leagueId) return res.status(400).json({ error: "leagueId required" });

  try {
    const leagueRef = adminDb.collection("leagues").doc(leagueId);
    const leagueSnap = await leagueRef.get();

    if (!leagueSnap.exists) {
      return res.status(404).json({ error: "League not found. Sync it first." });
    }

    const members: string[] =
      (leagueSnap.data()?.["members"] as string[] | undefined) ?? [];
    if (!members.includes(user.uid)) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const profilesSnap = await leagueRef.collection("profiles").get();
    const profiles = profilesSnap.docs.map((d) => d.data());

    return res.status(200).json({
      leagueId,
      name: leagueSnap.data()?.["name"],
      format: leagueSnap.data()?.["format"],
      lastRefreshed: leagueSnap.data()?.["lastRefreshed"],
      profiles,
    });
  } catch (err) {
    console.error("overview error", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
