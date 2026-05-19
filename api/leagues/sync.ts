import type { VercelRequest, VercelResponse } from "@vercel/node";
import { computeAllProfiles } from "../../src/algo/profile";
import { detectFormat } from "../../src/data/format";
import { fetchLeague, fetchPlayers } from "../../src/data/sleeper";
import { adminDb } from "../_lib/admin";
import { requireApprovedUser } from "../_lib/auth";
import { buildTeamInputs } from "../_lib/buildTeams";
import { getValueMaps } from "../_lib/snapshot";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const user = await requireApprovedUser(req, res);
  if (!user) return;

  const { leagueId } = req.body as { leagueId?: string };
  if (!leagueId) return res.status(400).json({ error: "leagueId required" });

  try {
    // Pull everything from Sleeper in parallel with player DB
    const [{ league, users, rosters, tradedPicks }, sleeperPlayers] = await Promise.all([
      fetchLeague(leagueId),
      fetchPlayers(),
    ]);

    const format = detectFormat(league);
    if (format.idp) {
      return res.status(422).json({ error: "IDP leagues are not supported yet." });
    }

    // Lazy FantasyCalc snapshot (fetches fresh if > 12 hours old)
    const valueMaps = await getValueMaps(format);

    // Resolve the user's Sleeper user_id so we can correctly identify their roster.
    // This is set once when the user first looks up their leagues via /api/user/leagues.
    const userRef = adminDb.collection("users").doc(user.uid);
    const userSnap = await userRef.get();
    const mySleeperUserId: string | undefined = userSnap.data()?.["sleeperUserId"] as string | undefined;

    const thisYear = new Date().getFullYear();
    const teamInputs = buildTeamInputs({
      rosters,
      users,
      tradedPicks,
      sleeperPlayers,
      valueMaps,
      format,
      mySleeperUserId,
      thisYear,
    });

    const profiles = computeAllProfiles(teamInputs, format, thisYear);

    // Persist league doc + profiles in a batch
    const batch = adminDb.batch();

    const leagueRef = adminDb.collection("leagues").doc(leagueId);
    const leagueSnap = await leagueRef.get();
    const existingMembers: string[] = leagueSnap.exists
      ? (leagueSnap.data()?.["members"] as string[] | undefined) ?? []
      : [];
    const members = existingMembers.includes(user.uid)
      ? existingMembers
      : [...existingMembers, user.uid];

    batch.set(
      leagueRef,
      {
        sleeperLeagueId: leagueId,
        name: league.name,
        format,
        members,
        ownerId: leagueSnap.exists ? leagueSnap.data()?.["ownerId"] : user.uid,
        lastRefreshed: new Date().toISOString(),
      },
      { merge: true },
    );

    for (const profile of profiles) {
      const profileRef = leagueRef
        .collection("profiles")
        .doc(String(profile.rosterId));
      // ownerSleeperUserId lets overview.ts re-derive isMine at read time
      const roster = rosters.find((r) => r.roster_id === profile.rosterId);
      batch.set(profileRef, {
        ...profile,
        ownerSleeperUserId: roster?.owner_id ?? null,
        generatedAt: new Date().toISOString(),
      });
    }

    await batch.commit();

    // Persist Sleeper user_id and leagueId in the user's doc
    const existingLeagues: string[] =
      (userSnap.data()?.["leagueIds"] as string[] | undefined) ?? [];
    const userUpdates: Record<string, unknown> = {};
    if (!existingLeagues.includes(leagueId)) {
      userUpdates["leagueIds"] = [...existingLeagues, leagueId];
    }
    if (mySleeperUserId && !userSnap.data()?.["sleeperUserId"]) {
      userUpdates["sleeperUserId"] = mySleeperUserId;
    }
    if (Object.keys(userUpdates).length > 0) {
      await userRef.set(userUpdates, { merge: true });
    }

    return res.status(200).json({ leagueId, name: league.name, profiles });
  } catch (err) {
    console.error("sync error", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
