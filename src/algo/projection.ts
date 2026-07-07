// Shotgun: deterministic multi-year team projection built on the West Coast
// age curves. Powers the Window Map trajectory arrows.
//
// Known approximation (by design): future strength uses dynasty values as the
// proxy (redraft production can't be projected), and picks that mature into
// rookies become flat neutral assets. Good enough for trajectory arrows, not
// a standings predictor.

import { PICK_DECAY, POSITIONS } from "./constants";
import { agePressure, fillStarters } from "./profile";
import type { LeagueFormat, Pick, Player, Position, TeamProfile } from "./types";

const DYN = (p: Player) => p.valueDynasty;

// How much of a player's dynasty value survives N more years of aging:
// the ratio of remaining runway (100 - pressure) after vs now.
export function valueRetention(age: number, pos: Position, yearsAhead: number): number {
  const now = 100 - agePressure(age, pos);
  const then = 100 - agePressure(age + yearsAhead, pos);
  if (now <= 0) return then > 0 ? 1 : 0;
  return Math.max(0, Math.min(1, then / now));
}

export function projectPlayer(p: Player, yearsAhead: number): Player {
  if (yearsAhead <= 0) return p;
  // Unknown age: assume the value holds (usually deep bench bodies anyway).
  const retention = p.age == null ? 1 : valueRetention(p.age, p.position, yearsAhead);
  return {
    ...p,
    age: p.age == null ? null : p.age + yearsAhead,
    valueDynasty: p.valueDynasty * retention,
  };
}

// Picks re-decay toward their draft year (a 2027 pick is worth MORE in 2027
// than today); picks whose draft has passed "mature" into synthetic rookie
// players so their capital converts instead of vanishing. WR at age 22 +
// years-since-draft is the neutral proxy.
export function projectPicks(
  picks: Pick[],
  yearsAhead: number,
  thisYear: number,
): { capital: number; matured: Player[] } {
  const projectionYear = thisYear + yearsAhead;
  let capital = 0;
  const matured: Player[] = [];
  for (const pk of picks) {
    const yearsOut = pk.year - projectionYear;
    if (yearsOut >= 0) {
      capital += pk.value * (PICK_DECAY[yearsOut] ?? 0);
    } else {
      const yearsSinceDraft = -yearsOut;
      const rookieAge = 22;
      matured.push({
        id: `matured-${pk.year}-${pk.round}-${pk.origRosterId}`,
        name: pk.label,
        position: "WR",
        team: null,
        age: rookieAge + yearsSinceDraft,
        valueRedraft: 0,
        valueDynasty: pk.value * valueRetention(rookieAge, "WR", yearsSinceDraft),
      });
    }
  }
  return { capital, matured };
}

export type TeamProjection = {
  totalDynastyValue: number; // players + matured picks + remaining pick capital
  starterDynastyValue: number; // best projected lineup by dynasty value
  agePressure: number; // dynasty-value-weighted pressure of that lineup
};

export function projectTeam(
  profile: TeamProfile,
  yearsAhead: number,
  thisYear: number,
  format: LeagueFormat,
): TeamProjection {
  const projected = profile.players.map((p) => projectPlayer(p, yearsAhead));
  const { capital, matured } = projectPicks(profile.picks, yearsAhead, thisYear);
  const pool = [...projected, ...matured];

  const { starters } = fillStarters(pool, format, DYN);
  let starterValue = 0;
  let pressureNum = 0;
  let pressureDen = 0;
  for (const pos of POSITIONS) {
    for (const p of starters[pos]) {
      starterValue += p.valueDynasty;
      if (p.age == null) continue;
      pressureNum += agePressure(p.age, p.position) * p.valueDynasty;
      pressureDen += p.valueDynasty;
    }
  }

  return {
    totalDynastyValue: pool.reduce((s, p) => s + p.valueDynasty, 0) + capital,
    starterDynastyValue: starterValue,
    agePressure: pressureDen > 0 ? pressureNum / pressureDen : 50,
  };
}
