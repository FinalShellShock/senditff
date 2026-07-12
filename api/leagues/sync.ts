import type { VercelRequest, VercelResponse } from "@vercel/node";
import { computeAllProfiles } from "../../src/algo/profile";
import { detectFormat } from "../../src/data/format";
import {
  fetchLeague,
  fetchLeagueOnly,
  fetchLeagueUsersRosters,
  fetchNflState,
  fetchPlayers,
} from "../../src/data/sleeper";
import { findUpcomingDraft } from "../../src/data/picks";
import type { SleeperNflState, SleeperRoster } from "../../src/data/types";
import { adminDb } from "../_lib/admin";
import { requireApprovedUser } from "../_lib/auth";
import { buildTeamInputs } from "../_lib/buildTeams";
import { getValueMaps } from "../_lib/snapshot";

// Regular-season standing per roster: wins desc, then points desc. Roster
// ids are stable across a Sleeper league's previous_league_id chain (same
// assumption the trade history relies on).
function standings(rosters: SleeperRoster[]): Map<number, number> {
  const ranked = [...rosters].sort((a, b) => {
    const wa = a.settings?.wins ?? 0;
    const wb = b.settings?.wins ?? 0;
    if (wa !== wb) return wb - wa;
    const fa = parseFloat(String(a.settings?.fpts ?? 0));
    const fb = parseFloat(String(b.settings?.fpts ?? 0));
    if (fa !== fb) return fb - fa;
    return a.roster_id - b.roster_id;
  });
  const map = new Map<number, number>();
  ranked.forEach((r, i) => map.set(r.roster_id, i + 1));
  return map;
}

// Past-season finishes (up to two seasons back) plus the current standing
// when a season is actually underway. Replaces the meaningless "0-0" record.
async function fetchPlacements(
  league: { previous_league_id?: string },
  rosters: SleeperRoster[],
  nflState: SleeperNflState,
): Promise<{
  history: Map<number, Array<{ season: number; place: number }>>;
  current: Map<number, number> | null;
}> {
  const history = new Map<number, Array<{ season: number; place: number }>>();
  let cursor = league.previous_league_id;
  for (let hop = 0; hop < 2 && cursor; hop++) {
    try {
      const prevLeague = await fetchLeagueOnly(cursor);
      const season = parseInt(prevLeague.season ?? "", 10);
      const { rosters: prevRosters } = await fetchLeagueUsersRosters(cursor);
      if (Number.isFinite(season)) {
        const places = standings(prevRosters);
        for (const [rosterId, place] of places) {
          const arr = history.get(rosterId) ?? [];
          arr.push({ season, place });
          history.set(rosterId, arr);
        }
      }
      cursor = prevLeague.previous_league_id;
    } catch {
      break; // placements are garnish; never fail a sync over them
    }
  }
  const inSeason = nflState.season_type === "regular" || nflState.season_type === "post";
  return { history, current: inSeason ? standings(rosters) : null };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const user = await requireApprovedUser(req, res);
  if (!user) return;

  const { leagueId } = req.body as { leagueId?: string };
  if (!leagueId) return res.status(400).json({ error: "leagueId required" });

  try {
    // Pull everything from Sleeper in parallel with player DB
    const [{ league, users, rosters, tradedPicks, drafts }, sleeperPlayers, nflState] = await Promise.all([
      fetchLeague(leagueId),
      fetchPlayers(),
      fetchNflState(),
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

    // "This year" for pick math = the season of the next scheduled draft if
    // Sleeper has one, else nflState.league_season (Sleeper's authoritative
    // fantasy season), else wall-clock year as a last resort.
    const upcoming = findUpcomingDraft(drafts, rosters);
    const thisYear =
      upcoming?.season
      ?? (nflState.league_season ? parseInt(nflState.league_season, 10) : new Date().getFullYear());

    const teamInputs = buildTeamInputs({
      rosters,
      users,
      tradedPicks,
      drafts,
      league,
      sleeperPlayers,
      valueMaps,
      format,
      mySleeperUserId,
      thisYear,
    });

    const profiles = computeAllProfiles(teamInputs, format, thisYear, {
      dynastyByPos: valueMaps.dynastyByPos,
      redraftByPos: valueMaps.redraftByPos,
    });

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
        upcomingDraftYear: thisYear,
        lastRefreshed: new Date().toISOString(),
      },
      { merge: true },
    );

    const placements = await fetchPlacements(league, rosters, nflState);
    for (const profile of profiles) {
      const profileRef = leagueRef
        .collection("profiles")
        .doc(String(profile.rosterId));
      // ownerSleeperUserId lets overview.ts re-derive isMine at read time
      const roster = rosters.find((r) => r.roster_id === profile.rosterId);
      batch.set(profileRef, {
        ...profile,
        ownerSleeperUserId: roster?.owner_id ?? null,
        placements: placements.history.get(profile.rosterId) ?? [],
        currentPlace: placements.current?.get(profile.rosterId) ?? null,
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
