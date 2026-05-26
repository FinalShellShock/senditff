import type {
  SleeperDraft,
  SleeperLeague,
  SleeperNflState,
  SleeperPlayer,
  SleeperRoster,
  SleeperTradedPick,
  SleeperUser,
} from "./types";

const SLEEPER = "https://api.sleeper.app/v1";

export async function fetchLeague(leagueId: string): Promise<{
  league: SleeperLeague;
  users: SleeperUser[];
  rosters: SleeperRoster[];
  tradedPicks: SleeperTradedPick[];
  drafts: SleeperDraft[];
}> {
  const [lR, uR, rR, pR, dR] = await Promise.all([
    fetch(`${SLEEPER}/league/${leagueId}`),
    fetch(`${SLEEPER}/league/${leagueId}/users`),
    fetch(`${SLEEPER}/league/${leagueId}/rosters`),
    fetch(`${SLEEPER}/league/${leagueId}/traded_picks`),
    fetch(`${SLEEPER}/league/${leagueId}/drafts`),
  ]);
  if (!lR.ok) throw new Error(`Sleeper league fetch failed: HTTP ${lR.status}`);
  if (!uR.ok) throw new Error(`Sleeper users fetch failed: HTTP ${uR.status}`);
  if (!rR.ok) throw new Error(`Sleeper rosters fetch failed: HTTP ${rR.status}`);
  if (!pR.ok) {
    // Don't silently default to []. An empty result means EVERY team has its
    // original picks, which is almost always wrong for an established league.
    console.warn(`Sleeper traded_picks failed for ${leagueId}: HTTP ${pR.status} - all picks will appear untraded`);
  }
  return {
    league: (await lR.json()) as SleeperLeague,
    users: (await uR.json()) as SleeperUser[],
    rosters: (await rR.json()) as SleeperRoster[],
    tradedPicks: pR.ok ? ((await pR.json()) as SleeperTradedPick[]) : [],
    drafts: dR.ok ? ((await dR.json()) as SleeperDraft[]) : [],
  };
}

export async function fetchPlayers(): Promise<Record<string, SleeperPlayer>> {
  const r = await fetch(`${SLEEPER}/players/nfl`);
  if (!r.ok) throw new Error(`Sleeper players fetch failed: HTTP ${r.status}`);
  return (await r.json()) as Record<string, SleeperPlayer>;
}

export async function fetchNflState(): Promise<SleeperNflState> {
  const r = await fetch(`${SLEEPER}/state/nfl`);
  if (!r.ok) throw new Error(`Sleeper NFL state fetch failed: HTTP ${r.status}`);
  return (await r.json()) as SleeperNflState;
}

export async function fetchSleeperUser(username: string): Promise<SleeperUser> {
  const r = await fetch(`${SLEEPER}/user/${encodeURIComponent(username)}`);
  if (!r.ok) throw new Error(`Sleeper user fetch failed: HTTP ${r.status}`);
  const data = await r.json() as SleeperUser | null;
  if (!data?.user_id) throw new Error(`Sleeper user "${username}" not found`);
  return data;
}

export async function fetchUserLeagues(userId: string, year: number): Promise<SleeperLeague[]> {
  const r = await fetch(`${SLEEPER}/user/${userId}/leagues/nfl/${year}`);
  if (!r.ok) throw new Error(`Sleeper user leagues fetch failed: HTTP ${r.status}`);
  const data = await r.json() as SleeperLeague[] | null;
  return data ?? [];
}
