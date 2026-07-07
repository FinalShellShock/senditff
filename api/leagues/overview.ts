import type { VercelRequest, VercelResponse } from "@vercel/node";
import { adminDb } from "../_lib/admin";
import { requireApprovedUser } from "../_lib/auth";

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

    // Fetch user's stored Sleeper user_id so we can fix isMine at read time.
    // This corrects stale profiles without needing a re-sync.
    const userSnap = await adminDb.collection("users").doc(user.uid).get();
    const mySleeperUserId = userSnap.data()?.["sleeperUserId"] as string | undefined;

    const profilesSnap = await leagueRef.collection("profiles").get();
    const profiles = profilesSnap.docs.map((d) => {
      const data = d.data();
      return {
        ...data,
        isMine: mySleeperUserId
          ? data["ownerSleeperUserId"] === mySleeperUserId
          : (data["isMine"] as boolean) ?? false,
      };
    });

    return res.status(200).json({
      leagueId,
      name: leagueSnap.data()?.["name"],
      format: leagueSnap.data()?.["format"],
      lastRefreshed: leagueSnap.data()?.["lastRefreshed"],
      upcomingDraftYear: leagueSnap.data()?.["upcomingDraftYear"] ?? null,
      profiles,
    });
  } catch (err) {
    console.error("overview error", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
