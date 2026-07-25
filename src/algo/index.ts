export type {
  Competitiveness,
  FlexScore,
  LeagueAverages,
  LeagueFormat,
  Pick,
  PickFlag,
  Player,
  Position,
  PositionScore,
  TeamInput,
  TeamProfile,
  WindowLabel,
  WindowTier,
} from "./types";

export {
  COMPETITIVENESS_GRID,
  FLEX_CONSOLIDATE_THRESHOLD,
  PICK_ADJUSTMENT_BY_FLAG,
  PICK_DECAY,
  POSITIONS,
  STD_THRESHOLD,
  TEP_MULTIPLIER,
  WINDOW_LONG_THRESHOLD,
  WINDOW_SHORT_THRESHOLD,
} from "./constants";

export {
  agePressure,
  applyTep,
  classifyPosition,
  computeAllProfiles,
  computePositionScores,
  depthByPosition,
  fillStarters,
  flexStrengthValue,
  pickCapital,
  score0to100,
  starterAgePressure,
  starterCalendarAge,
} from "./profile";

export type { ArchetypeFamily } from "./archetypes";
export { ARCHETYPE_FAMILIES, POSITIONAL_FAMILIES, detectArchetypes } from "./archetypes";

export type { TeamProjection } from "./projection";
export { projectPicks, projectPlayer, projectTeam, valueRetention } from "./projection";

export type { FairnessLabel } from "./fairness";
export {
  FAIRNESS_FAIR_ABS,
  FAIRNESS_FAIR_PCT,
  FAIRNESS_SLIGHT_PCT,
  fairnessColor,
  fairnessDelta,
  fairnessLabel,
  fairnessText,
} from "./fairness";
