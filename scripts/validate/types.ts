// Throwaway types for the algorithm validation script.
// Will be re-derived once the real app exists; do not import these from app code.

export type Position = "QB" | "RB" | "WR" | "TE";

export type LeagueFormat = {
  superflex: boolean;
  scoring: "ppr" | "half" | "std";
  tep: boolean;
  idp: boolean;
  starterSlots: {
    QB: number;
    RB: number;
    WR: number;
    TE: number;
    FLEX: number;
    SUPER_FLEX: number;
  };
  teamCount: number;
};

export type Player = {
  id: string;
  name: string;
  position: Position;
  team: string | null;
  age: number | null;
  value: number;
};

export type Pick = {
  year: number;
  round: number;
  origRosterId: number;
  ownerRosterId: number;
  slot: number;
  label: string;
  value: number;
};

// Two independent classification axes that combine into a 3x3 grid.
// Final cell labels (the WindowLabel type) are placeholders — Johnny will name them later.
export type Competitiveness = "STRONG" | "AVERAGE" | "WEAK";
export type WindowTier = "LONG" | "MID" | "SHORT";

// 9 cells: Competitiveness × WindowTier
//                LONG          MID         SHORT
//   STRONG       JUGGERNAUT    CONTEND     CLOSING
//   AVERAGE      RISING        AVERAGE     MIDDLING
//   WEAK         REBUILD       TRANSITION  STUCK
export type WindowLabel =
  | "JUGGERNAUT"
  | "CONTEND"
  | "CLOSING"
  | "RISING"
  | "AVERAGE"
  | "MIDDLING"
  | "REBUILD"
  | "TRANSITION"
  | "STUCK";

export type PickFlag = "PICK_RICH" | "PICK_POOR" | "NEUTRAL";

export type PositionScore = {
  starterValue: number;
  starterScore: number;
  depthValue: number;
  depthScore: number;
  urgency: number;
  classification: "CRITICAL_NEED" | "NEED" | "HEALTHY" | "SURPLUS";
};

export type FlexScore = {
  value: number; // sum of best-3 RB/WR not in their position-specific starter slot
  score: number; // 0-100 vs league avg
};

export type TeamProfile = {
  rosterId: number;
  ownerName: string;
  isMine: boolean;
  record: string;
  players: Player[];
  picks: Pick[];
  starterTotalValue: number;
  starterRank: number; // 1 = best in league
  competitiveness: Competitiveness;
  weightedAge: number;
  youngValueShare: number; // share of top-10 value held by players with adj_age <= 25
  windowPressure: number; // 0-100, higher = window closing faster
  windowRank: number; // 1 = longest window in league
  windowTier: WindowTier;
  windowLabel: WindowLabel;
  positionScores: Record<Position, PositionScore>;
  flex: FlexScore; // Spread-only: FLEX as its own dimension (zero TE share by default)
  pickCapital: { value: number; score: number; flag: PickFlag };
  archetypes: string[];
};

export type LeagueAverages = {
  starter: Record<Position, number>;
  depth: Record<Position, number>;
  flex: number; // Spread: average value of best-3 RB/WR not starting at their pos
  pickCapital: number;
  pickCapitalStd: number;
};

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
