import {
  CONSOLIDATE_BY_COMPETITIVENESS,
  FLEX_CONSOLIDATE_THRESHOLD,
  POSITIONS,
  TIER_DOWN_BY_COMPETITIVENESS,
  URGENCY_MEANINGFUL,
  URGENCY_SEVERE,
  URGENCY_SPREAD_FULL,
  WINDOW_LONG_THRESHOLD,
  WINDOW_SHORT_THRESHOLD,
} from "./constants";
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

// Urgency on a 0-1 scale, against what urgency ACTUALLY ranges to rather than
// the 0-100 it looks like. See URGENCY_MEANINGFUL in constants.ts.
function urgencyPressure(urgency: number): number {
  return clamp(
    (urgency - URGENCY_MEANINGFUL) / (URGENCY_SEVERE - URGENCY_MEANINGFUL),
    0,
    1,
  );
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
    // Ramps from league-average depth down to 60% of it. The old form only
    // started counting BELOW 60% of average, which no team in a 16 team league
    // hit at RB or WR, so those two never scored at all.
    const thinFactor  = clamp((1 - ps.depthValue / avgD) / 0.4, 0, 1);
    // Down-weighted for contenders: measured at 47% beat-baseline for them
    // against 61% for consolidating, and tier_down is the single most common
    // thing the engine proposes.
    s[`tier_down_${pos}`] = Math.round(
      eliteFactor * thinFactor * TIER_DOWN_BY_COMPETITIVENESS[team.competitiveness] * 100,
    );
  }

  // consolidate_{pos}: spare parts HERE + a need SOMEWHERE ELSE, and it makes
  // most sense from a middling starting spot.
  //
  // Those first two are genuine preconditions and stay multiplicative. The
  // third is a preference and used to be multiplicative too, with a band so
  // narrow (starterScore 40-65) that it was zero on 52 of 64 cells and killed
  // the whole family league-wide. It is now a soft weighting instead, which is
  // the same fix already applied to need_fill for the same reason.
  for (const pos of POSITIONS) {
    const ps = team.positionScores[pos];
    const midFactor   = clamp(1 - Math.abs(ps.starterScore - 55) / 35, 0, 1);
    const depthFactor = clamp((ps.depthScore - 35) / 25, 0, 1);
    const otherUrgency = POSITIONS
      .filter((p) => p !== pos)
      .reduce((max, p) => Math.max(max, team.positionScores[p].urgency), 0);
    const needFactor = urgencyPressure(otherUrgency);
    // Contention is the strongest qualifier this archetype has and it was not
    // in the formula at all. 61 / 55 / 43 beat-baseline by tier.
    s[`consolidate_${pos}`] = Math.round(
      depthFactor * needFactor * (0.55 + 0.45 * midFactor)
        * CONSOLIDATE_BY_COMPETITIVENESS[team.competitiveness] * 100,
    );
  }

  // consolidate_flex: bundle pieces from DIFFERENT positions into one better
  // player. Named for the flex slot it frees up, not for who is eligible: it
  // built "McCaffrey (RB) + A.J. Brown (WR) -> Lamar Jackson (QB)" on a real
  // roster. The sibling consolidate_{pos} stays within one position.
  const maxUrgency = POSITIONS.reduce((max, p) => Math.max(max, team.positionScores[p].urgency), 0);
  const flexFactor = clamp((team.flex.score - 40) / (FLEX_CONSOLIDATE_THRESHOLD - 40), 0, 1);
  s["consolidate_flex"] = Math.round(
    flexFactor * urgencyPressure(maxUrgency)
      * CONSOLIDATE_BY_COMPETITIVENESS[team.competitiveness] * 100,
  );

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
  const urgencyFactor = urgencyPressure(maxUrgency);
  const surplusFactor = clamp(spread / URGENCY_SPREAD_FULL, 0, 1);
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
