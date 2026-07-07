import { FLEX_CONSOLIDATE_THRESHOLD, POSITIONS, WINDOW_LONG_THRESHOLD, WINDOW_SHORT_THRESHOLD } from "./constants";
import type { LeagueAverages, LeagueFormat, TeamProfile } from "./types";

export const ARCHETYPE_THRESHOLD = 50;

// Generator families in the trade engine. Users can force one as an "intent"
// on the Send It tab; positional families accept an optional position filter.
export const ARCHETYPE_FAMILIES = [
  "need_fill",
  "tier_down",
  "consolidate",
  "consolidate_flex",
  "age_arb_buy",
  "age_arb_sell",
  "push_in",
  "capital_convert_picks_to_production",
  "capital_convert_production_to_picks",
] as const;

export type ArchetypeFamily = (typeof ARCHETYPE_FAMILIES)[number];

// Families where the UI offers a position filter (engine honors position on
// any generator with a position loop, but these are the intuitive ones).
export const POSITIONAL_FAMILIES: ArchetypeFamily[] = [
  "need_fill",
  "tier_down",
  "consolidate",
];

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

// Continuous 0-100 scores for every archetype. Used in two ways:
//   1. `detectArchetypes` filters these at ARCHETYPE_THRESHOLD for display in the team deep dive.
//   2. `find.ts` reads them off the stored profile so package generation always has
//      something to work with — best available when nothing clears the threshold.
export function scoreArchetypes(
  team: TeamProfile,
  averages: LeagueAverages,
): Record<string, number> {
  const s: Record<string, number> = {};

  // tier_down_{pos}: elite starter (approaching 1.4× avg) + thin depth (approaching 0.6× avg)
  for (const pos of POSITIONS) {
    const ps = team.positionScores[pos];
    const avgS = averages.starter[pos] || 1;
    const avgD = averages.depth[pos] || 1;
    const eliteFactor = clamp((ps.starterValue / avgS - 1.0) / 0.4, 0, 1);
    const thinFactor  = clamp(1 - (ps.depthValue / avgD) / 0.6, 0, 1);
    s[`tier_down_${pos}`] = Math.round(eliteFactor * thinFactor * 100);
  }

  // consolidate_{pos}: mid starter [40-65] + decent depth + need elsewhere
  for (const pos of POSITIONS) {
    const ps = team.positionScores[pos];
    const midFactor   = clamp(1 - Math.abs(ps.starterScore - 52.5) / 12.5, 0, 1);
    const depthFactor = clamp((ps.depthScore - 40) / 15, 0, 1);
    const otherUrgency = POSITIONS
      .filter((p) => p !== pos)
      .reduce((max, p) => Math.max(max, team.positionScores[p].urgency), 0);
    const needFactor = clamp((otherUrgency - 40) / 60, 0, 1);
    s[`consolidate_${pos}`] = Math.round(midFactor * depthFactor * needFactor * 100);
  }

  // consolidate_flex: flex above threshold + somewhere to put the upgrade
  const maxUrgency = POSITIONS.reduce((max, p) => Math.max(max, team.positionScores[p].urgency), 0);
  const flexFactor = clamp((team.flex.score - 40) / (FLEX_CONSOLIDATE_THRESHOLD - 40), 0, 1);
  s["consolidate_flex"] = Math.round(flexFactor * clamp(maxUrgency / 70, 0, 1) * 100);

  // age_arb_buy: low window pressure + pick rich
  const longFactor = clamp(1 - team.windowPressure / WINDOW_SHORT_THRESHOLD, 0, 1);
  const richFactor = clamp((team.pickCapital.score - 50) / 50, 0, 1);
  s["age_arb_buy"] = Math.round(longFactor * richFactor * 100);

  // age_arb_sell: high window pressure + not a weak team
  const shortFactor   = clamp(
    (team.windowPressure - WINDOW_LONG_THRESHOLD) / (WINDOW_SHORT_THRESHOLD - WINDOW_LONG_THRESHOLD),
    0, 1,
  );
  const notWeakFactor = team.competitiveness === "STRONG" ? 1 : team.competitiveness === "AVERAGE" ? 0.6 : 0.1;
  s["age_arb_sell"] = Math.round(shortFactor * notWeakFactor * 100);

  // push_in: genuinely SHORT-window STRONG team only (pressure must exceed SHORT threshold)
  // MID-window teams building toward contention don't need to go all-in yet
  const strongFactor = team.competitiveness === "STRONG" ? 1 : team.competitiveness === "AVERAGE" ? 0.3 : 0;
  const pushInFactor = clamp((team.windowPressure - WINDOW_SHORT_THRESHOLD) / (WINDOW_SHORT_THRESHOLD * 0.5), 0, 1);
  s["push_in"] = Math.round(pushInFactor * strongFactor * 100);

  // need_fill: critical positional gap exists + meaningful spread across positions
  // Additive formula so that a large need (high urgency) or a large spread both count;
  // the old multiplicative formula required both to be simultaneously near-maximum,
  // which caused it to almost never fire on real rosters.
  const minUrgency    = POSITIONS.reduce((min, p) => Math.min(min, team.positionScores[p].urgency), 100);
  const spread        = maxUrgency - minUrgency;
  const urgencyFactor = clamp((maxUrgency - 40) / 60, 0, 1);
  const surplusFactor = clamp(spread / 50, 0, 1);
  s["need_fill"] = Math.round((urgencyFactor * 0.6 + surplusFactor * 0.4) * 100);

  // capital_convert_picks_to_production: contender + pick poor
  const contenderFactor = team.competitiveness === "STRONG" ? 1 : team.competitiveness === "AVERAGE" ? 0.4 : 0.1;
  const poorFactor      = clamp((50 - team.pickCapital.score) / 50, 0, 1);
  s["capital_convert_picks_to_production"] = Math.round(contenderFactor * poorFactor * 100);

  // capital_convert_production_to_picks: rebuilder + pick rich
  const rebuilderFactor = team.competitiveness === "WEAK" ? 1 : team.competitiveness === "AVERAGE" ? 0.4 : 0.1;
  s["capital_convert_production_to_picks"] = Math.round(rebuilderFactor * richFactor * 100);

  return s;
}

export function detectArchetypes(
  team: TeamProfile,
  averages: LeagueAverages,
  _format: LeagueFormat,
): string[] {
  const scores = scoreArchetypes(team, averages);
  return Object.entries(scores)
    .filter(([, score]) => score >= ARCHETYPE_THRESHOLD)
    .map(([key]) => key);
}
