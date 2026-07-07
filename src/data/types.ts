// External API shapes — Sleeper and FantasyCalc.

export type SleeperLeague = {
  league_id: string;
  name: string;
  total_rosters: number;
  roster_positions: string[];
  scoring_settings: Record<string, number>;
  status?: string;
  settings?: { type?: number; draft_rounds?: number };
  previous_league_id?: string;
  season?: string;
};

// Sleeper's drafts-for-league endpoint. We only need a few fields.
// status: "pre_draft" | "drafting" | "paused" | "complete"
// draft_order: keys are owner user_ids (strings), values are slot numbers
// slot_to_roster_id: keys are slot numbers as strings, values are roster_ids
export type SleeperDraft = {
  draft_id: string;
  season: string;
  status: string;
  draft_order: Record<string, number> | null;
  slot_to_roster_id: Record<string, number> | null;
  settings?: { rounds?: number; teams?: number };
};

export type SleeperNflState = {
  league_create_season: string;
  season: string;
  season_type: string;
  // The fantasy "current" season. Lags real-world season during the off-season
  // until Sleeper rolls leagues forward. Use this (not new Date().getFullYear())
  // to decide what counts as "this year" for pick logic.
  league_season?: string;
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
  birth_date?: string; // "YYYY-MM-DD" — used to compute decimal age
};

// League transactions endpoint (/league/{id}/transactions/{week}).
// For trades: `adds` maps playerId -> receiving rosterId, `drops` maps
// playerId -> the roster the player left. draft_picks entries: roster_id is
// the pick's ORIGINAL owner (whose future slot it is), owner_id the roster
// receiving it, previous_owner_id the roster giving it up.
export type SleeperTransaction = {
  transaction_id: string;
  type: string; // "trade" | "waiver" | "free_agent" | ...
  status: string; // keep only "complete"
  status_updated: number; // ms epoch
  leg: number; // week (offseason trades bucket into leg 1)
  roster_ids: number[] | null;
  adds: Record<string, number> | null;
  drops: Record<string, number> | null;
  draft_picks: Array<{
    season: string;
    round: number;
    roster_id: number;
    owner_id: number;
    previous_owner_id: number;
  }> | null;
  waiver_budget: Array<{ sender: number; receiver: number; amount: number }> | null;
};

// One selection from the draft picks endpoint (/draft/{draft_id}/picks).
export type SleeperDraftSelection = {
  round: number;
  draft_slot: number;
  pick_no: number;
  roster_id: number;
  player_id: string;
  metadata?: { first_name?: string; last_name?: string; position?: string };
};

export type FantasyCalcEntry = {
  value: number;
  player: { name?: string; age?: number; position?: string };
};
