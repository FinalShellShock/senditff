// External API shapes — Sleeper and FantasyCalc.

export type SleeperLeague = {
  league_id: string;
  name: string;
  total_rosters: number;
  roster_positions: string[];
  scoring_settings: Record<string, number>;
  status?: string;
};

export type SleeperUser = {
  user_id: string;
  display_name: string;
  username?: string;
};

export type SleeperRoster = {
  roster_id: number;
  owner_id: string | null;
  players: string[] | null;
  settings?: { wins?: number; losses?: number; fpts?: number | string };
};

export type SleeperTradedPick = {
  season: string;
  round: number;
  roster_id: number;
  owner_id: number;
  previous_owner_id: number;
};

export type SleeperPlayer = {
  player_id?: string;
  full_name?: string;
  first_name?: string;
  last_name?: string;
  position?: string;
  team?: string | null;
  age?: number;
};

export type FantasyCalcEntry = {
  value: number;
  player: { name?: string; age?: number; position?: string };
};
