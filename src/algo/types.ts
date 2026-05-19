// Algorithm-domain types. Pure compute, no external API shapes.

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
  // Current-season-only value (FantasyCalc isDynasty=false). Drives competitiveness math.
  valueRedraft: number;
  // Long-term value (FantasyCalc isDynasty=true). Drives window math.
  valueDynasty: number;
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

export type NeedKind = "starter" | "depth" | "both" | null;

export type PositionScore = {
  starterValue: number;
  starterScore: number;
  // Score of the team's weakest starter slot at this position. For single-slot
  // positions this equals starterScore. For multi-slot positions it's the
  // floor — catches "Olave + trash WR3" cases that weighted averages hide.
  minStarterSlotScore?: number;
  depthValue: number;
  depthScore: number;
  urgency: number;
  classification: "CRITICAL_NEED" | "NEED" | "HEALTHY" | "SURPLUS";
  // When classification is NEED or CRITICAL_NEED, indicates whether the issue
  // is the starter, the depth, or both. Drives UI labelling and influences
  // which trade archetypes the engine prioritises for this position.
  needKind?: NeedKind;
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
  starterCalAge: number; // redraft-value-weighted calendar age across starting lineup (display only)
  starterAgePressure: number; // 0-100, curve-based on the starting lineup; higher = window closing
  windowPressure: number; // 0-100, blended age + pick pressure
  windowRank: number; // 1 = longest window in league
  windowTier: WindowTier;
  windowLabel: WindowLabel;
  positionScores: Record<Position, PositionScore>;
  flex: FlexScore;
  pickCapital: { value: number; score: number; flag: PickFlag };
  archetypes: string[];
  archetypeScores: Record<string, number>;
};

export type LeagueAverages = {
  starter: Record<Position, number>;
  depth: Record<Position, number>;
  flex: number;
  pickCapital: number;
  pickCapitalStd: number;
  // Per-team aggregates (kept for archetype thresholding and legacy consumers).
  starterPool: Record<Position, number[]>;
  depthPool: Record<Position, number[]>;
  // Individual player pools at each position, drawn from every roster in the
  // league. Used by player-level rank scoring so the question becomes "where
  // does Dak rank among all rostered QBs" rather than "where does this team's
  // QB aggregate rank vs other teams."
  starterPlayerPool: Record<Position, number[]>; // redraft values
  depthPlayerPool: Record<Position, number[]>;   // dynasty values
  // Data-driven startable threshold: total starting slots actually filled at
  // each position across the league after fillStarters. Captures format and
  // FLEX usage in this specific league. Mirror for depth uses team_count ×
  // depthSlotsFor(pos, format).
  startersInUse: Record<Position, number>;
  depthSlotsTotal: Record<Position, number>;
};

// Input row for `computeAllProfiles`. The pipeline owns producing the full profile.
export type TeamInput = {
  rosterId: number;
  ownerName: string;
  isMine: boolean;
  record: string;
  players: Player[];
  picks: Pick[];
};
