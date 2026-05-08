import type {
  SleeperLeague,
  SleeperPlayer,
  SleeperRoster,
  SleeperTradedPick,
  SleeperUser,
} from "./types.ts";

const SLEEPER = "https://api.sleeper.app/v1";

export async function fetchLeague(leagueId: string): Promise<{
  league: SleeperLeague;
  users: SleeperUser[];
  rosters: SleeperRoster[];
  tradedPicks: SleeperTradedPick[];
}> {
  const [lR, uR, rR, pR] = await Promise.all([
    fetch(`${SLEEPER}/league/${leagueId}`),
    fetch(`${SLEEPER}/league/${leagueId}/users`),
    fetch(`${SLEEPER}/league/${leagueId}/rosters`),
    fetch(`${SLEEPER}/league/${leagueId}/traded_picks`),
  ]);
  if (!lR.ok) throw new Error(`Sleeper league fetch failed: HTTP ${lR.status}`);
  if (!uR.ok) throw new Error(`Sleeper users fetch failed: HTTP ${uR.status}`);
  if (!rR.ok) throw new Error(`Sleeper rosters fetch failed: HTTP ${rR.status}`);
  return {
    league: (await lR.json()) as SleeperLeague,
    users: (await uR.json()) as SleeperUser[],
    rosters: (await rR.json()) as SleeperRoster[],
    tradedPicks: pR.ok ? ((await pR.json()) as SleeperTradedPick[]) : [],
  };
}

export async function fetchPlayers(): Promise<Record<string, SleeperPlayer>> {
  const r = await fetch(`${SLEEPER}/players/nfl`);
  if (!r.ok) throw new Error(`Sleeper players fetch failed: HTTP ${r.status}`);
  return (await r.json()) as Record<string, SleeperPlayer>;
}
