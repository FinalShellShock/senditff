import type { VercelRequest, VercelResponse } from "@vercel/node";
import { adminDb } from "../_lib/admin";
import { requireApprovedUser } from "../_lib/auth";
import { detectFormat } from "../../src/data/format";
import {
  fetchNflState,
  fetchSleeperUser,
  fetchUserLeagues,
} from "../../src/data/sleeper";
import type { SleeperLeague } from "../../src/data/types";

export type SleeperLeagueSummary = {
  leagueId: string;
  name: string;
  season: string;
  status: string;
  totalRosters: number;
  superflex: boolean;
  scoring: "ppr" | "half" | "std";
  tep: boolean;
};

function isDynastyNonIdp(league: SleeperLeague): boolean {
  // settings.type: 2 = dynasty, 1 = keeper, 0 = redraft
  if (league.settings?.type !== 2) return false;
  const format = detectFormat(league);
  return !format.idp;
}

function deduplicateLeagues(current: SleeperLeague[], prior: SleeperLeague[]): SleeperLeague[] {
  // Renewed leagues appear in both years. A renewed league has previous_league_id pointing to
  // the prior year's league_id. Keep the newer (current-year) version, drop the prior-year dupe.
  const renewedPriorIds = new Set(
    current
      .map((l) => l.previous_league_id)
      .filter((id): id is string => Boolean(id) && id !== "0"),
  );
  const priorOnly = prior.filter((l) => !renewedPriorIds.has(l.league_id));
  return [...current, ...priorOnly];
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const user = await requireApprovedUser(req, res);
  if (!user) return;

  const { username } = req.query as { username?: string };

  try {
    const userRef = adminDb.collection("users").doc(user.uid);
    const userSnap = await userRef.get();
    let sleeperUserId = userSnap.data()?.["sleeperUserId"] as string | undefined;

    // If we don't have a stored Sleeper user_id, resolve it from the provided username
    if (!sleeperUserId) {
      if (!username?.trim()) {
        return res.status(400).json({ error: "Sleeper username required for first-time setup" });
      }
      const sleeperUser = await fetchSleeperUser(username.trim());
      sleeperUserId = sleeperUser.user_id;
      await userRef.set({ sleeperUserId }, { merge: true });
    }

    // Get the current league-creation year from Sleeper's NFL state endpoint.
    // This handles the offseason correctly — league_create_season is "2026" even if
    // the NFL season hasn't started yet.
    const nflState = await fetchNflState();
    const createYear = parseInt(nflState.league_create_season, 10);

    // Fetch both the current and prior year to catch leagues not yet renewed for the new season.
    const [current, prior] = await Promise.all([
      fetchUserLeagues(sleeperUserId, createYear),
      fetchUserLeagues(sleeperUserId, createYear - 1),
    ]);

    const allLeagues = deduplicateLeagues(current, prior);
    const dynastyLeagues = allLeagues.filter(isDynastyNonIdp);

    const summaries: SleeperLeagueSummary[] = dynastyLeagues.map((l) => {
      const fmt = detectFormat(l);
      return {
        leagueId: l.league_id,
        name: l.name,
        season: l.season ?? String(createYear),
        status: l.status ?? "unknown",
        totalRosters: l.total_rosters,
        superflex: fmt.superflex,
        scoring: fmt.scoring,
        tep: fmt.tep,
      };
    });

    return res.status(200).json({ leagues: summaries });
  } catch (err) {
    console.error("user/leagues error", err);
    const msg = err instanceof Error ? err.message : "Internal server error";
    return res.status(500).json({ error: msg });
  }
}
