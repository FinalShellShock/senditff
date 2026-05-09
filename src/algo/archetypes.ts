import { FLEX_CONSOLIDATE_THRESHOLD, POSITIONS } from "./constants";
import type { LeagueAverages, LeagueFormat, TeamProfile } from "./types";

export function detectArchetypes(
  team: TeamProfile,
  averages: LeagueAverages,
  _format: LeagueFormat,
): string[] {
  const out: string[] = [];

  // Tier down: elite starter at pos + weak depth there.
  for (const pos of POSITIONS) {
    const ps = team.positionScores[pos];
    const eliteStarter = averages.starter[pos] > 0 && ps.starterValue > 1.4 * averages.starter[pos];
    const weakDepth = averages.depth[pos] > 0 && ps.depthValue < 0.6 * averages.depth[pos];
    if (eliteStarter && weakDepth) out.push(`tier_down_${pos}`);
  }

  // Per-position consolidate: mid starter + decent depth + need elsewhere.
  const needPositions = POSITIONS.filter(
    (p) => team.positionScores[p].classification === "CRITICAL_NEED" ||
           team.positionScores[p].classification === "NEED",
  );
  for (const pos of POSITIONS) {
    const ps = team.positionScores[pos];
    const midStarter = ps.starterScore >= 40 && ps.starterScore <= 65;
    const decentDepth = ps.depthScore >= 55;
    if (midStarter && decentDepth && needPositions.some((np) => np !== pos)) {
      out.push(`consolidate_${pos}`);
    }
  }

  // consolidate_flex — high FLEX score + at least one position need.
  // Signals "you have stackable trade chips and somewhere productive to put them."
  if (team.flex.score >= FLEX_CONSOLIDATE_THRESHOLD && needPositions.length > 0) {
    out.push("consolidate_flex");
  }

  // Age arbitrage (buy): LONG window + can absorb veterans (PICK_RICH).
  if (team.windowTier === "LONG" && team.pickCapital.flag === "PICK_RICH") {
    out.push("age_arb_buy");
  }

  // Age arbitrage (sell): old, still-strong roster — bail proactively for picks/youth.
  if (team.windowTier === "SHORT" && team.competitiveness !== "WEAK") {
    out.push("age_arb_sell");
  }

  // Push in: STRONG-window-closing — mortgage future for veterans, max out the
  // 1-2 year window. Parallel option to age_arb_sell. Only fires for STRONG;
  // an AVERAGE/SHORT (MIDDLING) team isn't a contender to push toward.
  if (team.windowTier === "SHORT" && team.competitiveness === "STRONG") {
    out.push("push_in");
  }

  // Need fill flavors. Trigger if team has at least one CRITICAL_NEED.
  //   stacked  = elite starter + elite depth at same pos (package multiple from this stack)
  //   balanced = SURPLUS classification but not a stack (generic 1-for-1 candidate)
  // The "thin" case (elite starter + weak depth) is already captured by tier_down_<pos>
  // using raw value ratios — we don't duplicate it here.
  // Note: stacked uses the raw starter/depth scores directly rather than gating on
  // SURPLUS classification, because elite-stacked positions can have urgency just
  // above the SURPLUS threshold due to window pressure (e.g. cwescoe at urgency 30).
  const hasCritical = POSITIONS.some(
    (p) => team.positionScores[p].classification === "CRITICAL_NEED",
  );
  if (hasCritical) {
    for (const pos of POSITIONS) {
      const ps = team.positionScores[pos];
      const eliteStarter = ps.starterScore >= 80;
      const eliteDepth = ps.depthScore >= 80;
      if (eliteStarter && eliteDepth) {
        out.push(`need_fill_stacked_${pos}`);
        continue;
      }
      if (ps.classification === "SURPLUS") {
        out.push(`need_fill_balanced_${pos}`);
      }
    }
  }

  // Capital play
  if (
    (team.competitiveness === "STRONG" || team.windowLabel === "CONTEND") &&
    team.pickCapital.flag === "PICK_POOR"
  ) {
    out.push("capital_convert_picks_to_production");
  }
  if (
    (team.competitiveness === "WEAK" || team.windowTier === "LONG") &&
    team.pickCapital.flag === "PICK_RICH"
  ) {
    out.push("capital_convert_production_to_picks");
  }

  return out;
}
