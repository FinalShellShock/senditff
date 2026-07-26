// Projection (Shotgun) validation: prints a now/+1y/+2y table per team and
// asserts sanity invariants against real league data.
//
//   npm run validate:projection -- [leagueId] [username] [--cache-dir dir]

import {
  computeAllProfiles,
  fillStarters,
  projectPlayer,
  projectTeam,
  valueRetention,
} from "../../src/algo/index.ts";
import { loadLeagueInputs } from "./teams.ts";

const DEFAULT_LEAGUE_ID = "1336158419664506880";
const MY_SLEEPER_USERNAME = "FinalShellShock";

function flagValue(name: string): string | null {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] ?? null : null;
}

async function main(): Promise<void> {
  const positional = process.argv.slice(2).filter((a, i, arr) => {
    if (a.startsWith("--")) return false;
    if (i > 0 && arr[i - 1]?.startsWith("--")) return false;
    return true;
  });
  const leagueId = positional[0] ?? DEFAULT_LEAGUE_ID;
  const myUsername = positional[1] ?? MY_SLEEPER_USERNAME;
  const cacheDir = flagValue("--cache-dir");

  const inputs = await loadLeagueInputs(leagueId, myUsername, cacheDir);
  const profiles = computeAllProfiles(
    inputs.teams,
    inputs.format,
    inputs.thisYear,
    // Pools are REQUIRED for fidelity: api/leagues/sync.ts passes them, so
    // omitting them here scored every package against profiles production
    // never sees. Same class of drift as the decimal-age bug noted in
    // teams.ts, and the reason that file exists.
    inputs.pools,
  );

  let failures = 0;
  const fail = (msg: string) => {
    failures++;
    console.error(`  ✗ ${msg}`);
  };

  // Invariant 1: no player's projected value exceeds their current value.
  for (const p of profiles.flatMap((pr) => pr.players)) {
    for (const years of [1, 2, 3]) {
      const proj = projectPlayer(p, years);
      if (proj.valueDynasty > p.valueDynasty + 1e-9) {
        fail(`${p.name} (${p.position}, age ${p.age}) gains value at +${years}y`);
      }
    }
  }

  // Invariant 2: retention is monotonically non-increasing in years ahead.
  for (const pos of ["QB", "RB", "WR", "TE"] as const) {
    for (let age = 21; age <= 36; age++) {
      let prev = 1;
      for (const years of [1, 2, 3]) {
        const r = valueRetention(age, pos, years);
        if (r > prev + 1e-9) fail(`retention increases: ${pos} age ${age} +${years}y`);
        prev = r;
      }
    }
  }

  console.log(`\n${"team".padEnd(22)}${"label".padEnd(12)}${"starter now".padStart(12)}${"+1y".padStart(9)}${"+2y".padStart(9)}${"press now".padStart(11)}${"+1y".padStart(6)}${"+2y".padStart(6)}${"total now".padStart(11)}${"+2y".padStart(9)}`);
  const rows = [...profiles].sort((a, b) => a.starterRank - b.starterRank);
  for (const profile of rows) {
    const now = projectTeam(profile, 0, inputs.thisYear, inputs.format);
    const y1 = projectTeam(profile, 1, inputs.thisYear, inputs.format);
    const y2 = projectTeam(profile, 2, inputs.thisYear, inputs.format);

    // Invariant 3: aging alone never increases starter dynasty value. Uses a
    // players-only pool (the full projection legitimately rises when picks
    // mature into rookies — that's rebuilders trending up, by design).
    const starterValueAt = (years: number) => {
      const pool = profile.players.map((p) => projectPlayer(p, years));
      const { starters } = fillStarters(pool, inputs.format, (p) => p.valueDynasty);
      return Object.values(starters).flat().reduce((s, p) => s + p.valueDynasty, 0);
    };
    if (starterValueAt(1) > starterValueAt(0) + 1e-6) {
      fail(`${profile.ownerName}: players-only starter value rises at +1y`);
    }

    const k = (n: number) => `${(n / 1000).toFixed(1)}k`;
    console.log(
      `${profile.ownerName.slice(0, 20).padEnd(22)}${profile.windowLabel.padEnd(12)}${k(now.starterDynastyValue).padStart(12)}${k(y1.starterDynastyValue).padStart(9)}${k(y2.starterDynastyValue).padStart(9)}${now.agePressure.toFixed(0).padStart(11)}${y1.agePressure.toFixed(0).padStart(6)}${y2.agePressure.toFixed(0).padStart(6)}${k(now.totalDynastyValue).padStart(11)}${k(y2.totalDynastyValue).padStart(9)}`,
    );
  }

  // Invariant 4 (spot checks per plan): young rosters hold value, old
  // RB-heavy rosters decline.
  for (const profile of profiles) {
    const ages = profile.players.filter((p) => p.age != null && p.valueDynasty > 500);
    if (ages.length === 0) continue;
    const wAge =
      ages.reduce((s, p) => s + (p.age ?? 0) * p.valueDynasty, 0) /
      ages.reduce((s, p) => s + p.valueDynasty, 0);
    const now = projectTeam(profile, 0, inputs.thisYear, inputs.format);
    const y2 = projectTeam(profile, 2, inputs.thisYear, inputs.format);
    const playersOnlyNow = now.totalDynastyValue;
    const ratio = y2.totalDynastyValue / Math.max(1, playersOnlyNow);
    if (wAge < 24 && ratio < 0.85) {
      fail(`${profile.ownerName}: young roster (wAge ${wAge.toFixed(1)}) loses ${(100 - ratio * 100).toFixed(0)}% by +2y`);
    }
  }

  if (failures > 0) {
    console.error(`\n${failures} invariant failure(s).`);
    process.exit(1);
  }
  console.log("\n✓ All projection invariants hold.");
}

main().catch((err) => {
  console.error("Projection validation failed:");
  console.error(err);
  process.exit(1);
});
