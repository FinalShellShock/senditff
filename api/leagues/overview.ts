import type { VercelRequest, VercelResponse } from "@vercel/node";
import { adminDb } from "../_lib/admin";
import { requireApprovedUser } from "../_lib/auth";
import { ensureLeagueAccess } from "../_lib/membership";

// How old cached league data may get before the client is told to re-sync.
// Same lazy-TTL pattern as the FantasyCalc snapshot in _lib/snapshot.ts:
// nothing is scheduled, staleness is resolved the moment someone looks.
const LEAGUE_TTL_MS = 60 * 60 * 1000; // 1 hour

// Missing or unparseable timestamps count as stale so a league that predates
// this field self-heals on the next view.
function isStale(lastRefreshed: unknown): boolean {
  if (typeof lastRefreshed !== "string") return true;
  const t = new Date(lastRefreshed).getTime();
  if (!Number.isFinite(t)) return true;
  return Date.now() - t > LEAGUE_TTL_MS;
}

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
    if (!(await ensureLeagueAccess(user.uid, leagueRef, members))) {
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

    const lastRefreshed = leagueSnap.data()?.["lastRefreshed"];

    return res.status(200).json({
      leagueId,
      name: leagueSnap.data()?.["name"],
      format: leagueSnap.data()?.["format"],
      lastRefreshed,
      // The client re-syncs on its own when this is true, so league data
      // freshens by being looked at instead of on a schedule.
      stale: isStale(lastRefreshed),
      upcomingDraftYear: leagueSnap.data()?.["upcomingDraftYear"] ?? null,
      profiles,
    });
  } catch (err) {
    console.error("overview error", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
