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
  // Aging-signal multiplier on remaining career value, from
  // src/data/qbSignals.json. 1 or absent = no warning; 0.82 = this player
  // profiles about 18% short of what his calendar age implies. QB-only today.
  agingSignal?: number;
};

export type PickTier = "early" | "mid" | "late";

export type Pick = {
  year: number;
  round: number;
  origRosterId: number;
  ownerRosterId: number;
  // Numeric slot. Only meaningful when slotKnown=true (from Sleeper's
  // draft_order for an upcoming or in-progress draft). For projected picks
  // this is a sortable proxy derived from current standings; don't display it.
  slot: number;
  slotKnown: boolean;
  // For round-1 projected picks, which tier the original team falls into based
  // on current standings. Drives FantasyCalc value lookup. Null for known slots
  // (use slot directly) and for rounds 2+ (FantasyCalc doesn't tier those).
  tier: PickTier | null;
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

export type SubClassification = "CRITICAL" | "NEED" | "HEALTHY" | "SURPLUS";

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
  // Per-side classifications. starterClassification answers "do you have a
  // real starter here?" and depthClassification answers "do you have real
  // insurance / future production here?" — independent signals that drive
  // different trade strategies.
  starterClassification?: SubClassification;
  depthClassification?: SubClassification;
  // Overall classification = worst of the two sub-classifications. Kept for
  // backward compat with consumers that haven't switched to sub-fields yet.
  classification: "CRITICAL_NEED" | "NEED" | "HEALTHY" | "SURPLUS";
  // When overall classification is NEED or CRITICAL_NEED, indicates whether
  // the issue is the starter, the depth, or both.
  needKind?: NeedKind;
  // The inputs classifySide actually decided on. Exposed because the UI used
  // to show the label beside a league-rank plot, and the two openly disagreed:
  // a QB cover slot can sit mid-pack among 16 teams and still be CRITICAL,
  // because the test is an absolute floor and a z against the global player
  // pool, never a league rank. Showing the rank as evidence for a label that
  // never consulted it reads as a bug in the algorithm.
  evidence?: {
    starter: ClassifyEvidence;
    depth: ClassifyEvidence;
  };
};

export type ClassifyEvidence = {
  /** Weakest slot judged on this side. */
  minSlotValue: number;
  /** Below this, classifySide returns CRITICAL regardless of z. */
  criticalFloor: number;
  /** Below this, NEED. */
  needFloor: number;
  minSlotZ: number;
  weightedZ: number;
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
  // Regular-season finishes for recent past seasons (newest first) and the
  // current standing when a season is actually underway. Attached by sync;
  // optional because older profile docs predate it.
  placements?: Array<{ season: number; place: number }>;
  currentPlace?: number | null;
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
  // Real scoring from the most recent season with games played. Attached by
  // sync from the Sleeper rosters it already fetches for placements, so it
  // costs no extra request. Absent on leagues with no completed season and on
  // profile docs written before this existed.
  scoring?: {
    season: number;
    ppg: number;
    /** Scoring WEEKS, not match results. This league plays a second matchup
     *  each week against the league median, so wins+losses is double the weeks
     *  and dividing by it halves PPG. */
    weeks: number;
    /** True when the season is still being played, so PPG is partial. */
    live: boolean;
  };
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
  // Statistical reference distribution for classification. Mean + std of the
  // top-N values at each position in the FantasyCalc pool (N = startersInUse
  // for starters, N = depthSlotsTotal for depth). Used by classifyPositionRich
  // to z-score players against the actual market distribution instead of
  // against hardcoded score thresholds.
  starterStats: Record<Position, { mean: number; std: number }>;
  depthStats: Record<Position, { mean: number; std: number }>;
  // Data-driven startable threshold: total starting slots actually filled at
  // each position across the league after fillStarters. Captures format and
  // FLEX usage in this specific league. Mirror for depth uses team_count ×
  // depthSlotsFor(pos, format).
  startersInUse: Record<Position, number>;
  depthSlotsTotal: Record<Position, number>;
  // Reference distribution for RESILIENCE: every team's post-injury lineup
  // total at each position (drop the best starter, promote everyone behind
  // him). A team's depth is thin when losing a starter hurts it more than it
  // hurts the rest of the league, so the comparison has to be against other
  // post-injury lineups. Grading them against the healthy starter pool instead
  // is biased negative for every team, because everyone's lineup gets worse.
  resiliencePool: Record<Position, number[]>;
  resilienceStats: Record<Position, { mean: number; std: number }>;
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
