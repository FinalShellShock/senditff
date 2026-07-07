// Trade-engine validation harness. Runs generatePackages for every roster in
// the league and dumps deterministic JSON so algo changes can be diffed.
//
//   npm run validate:trades -- [leagueId] [username] [--cache-dir dir] [--out file]
//
// --cache-dir caches raw Sleeper/FantasyCalc responses so two runs see
// identical inputs (required for before/after diffs).

import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { computeAllProfiles } from "../../src/algo/index.ts";
import { loadLeagueInputs } from "./teams.ts";

// api/ is a CommonJS tree (api/package.json sets type: commonjs for Vercel),
// so pull the engine in via require to keep named exports + typing.
const require = createRequire(import.meta.url);
const { generatePackages } =
  require("../../api/_lib/tradeEngine.ts") as typeof import("../../api/_lib/tradeEngine.ts");

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
  const outPath = resolve(flagValue("--out") ?? "validate-trades.json");

  const inputs = await loadLeagueInputs(leagueId, myUsername, cacheDir);
  const profiles = computeAllProfiles(inputs.teams, inputs.format, inputs.thisYear);
  const sorted = [...profiles].sort((a, b) => a.rosterId - b.rosterId);

  const output: Record<string, unknown> = {};
  let totalPackages = 0;
  for (const profile of sorted) {
    const packages = generatePackages(
      profile,
      profiles,
      inputs.format,
      inputs.thisYear,
      5,
      inputs.pools,
    );
    totalPackages += packages.length;
    output[`roster_${profile.rosterId}`] = {
      owner: profile.ownerName,
      windowLabel: profile.windowLabel,
      packages,
    };
    console.log(
      `#${String(profile.rosterId).padStart(2)} ${profile.ownerName.padEnd(20)} ${profile.windowLabel.padEnd(11)} → ${packages.length} packages`,
    );
  }

  writeFileSync(outPath, JSON.stringify(output, null, 2));
  console.log(`\n${totalPackages} packages across ${sorted.length} rosters.`);
  console.log(`JSON written to: ${outPath}`);
}

main().catch((err) => {
  console.error("Trade validation failed:");
  console.error(err);
  process.exit(1);
});
