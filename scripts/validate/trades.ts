// Trade-engine validation harness. Runs generatePackages for every roster in
// default mode (dumped as diffable JSON) plus a forced sweep of every
// archetype family, and asserts determinism by running everything twice.
//
//   npm run validate:trades -- [leagueId] [username] [--cache-dir dir] [--out file]
//
// --cache-dir caches raw Sleeper/FantasyCalc responses so two runs see
// identical inputs (required for before/after diffs).

import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { ARCHETYPE_FAMILIES, computeAllProfiles } from "../../src/algo/index.ts";
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
  const sorted = [...profiles].sort((a, b) => a.rosterId - b.rosterId);

  const runAll = () => {
    const defaults: Record<string, unknown> = {};
    const forcedSummary: Record<string, Record<string, unknown>> = {};
    for (const profile of sorted) {
      const { packages, diagnostics } = generatePackages(
        profile,
        profiles,
        inputs.format,
        inputs.thisYear,
        { limit: 5, pools: inputs.pools },
      );
      defaults[`roster_${profile.rosterId}`] = {
        owner: profile.ownerName,
        windowLabel: profile.windowLabel,
        packages,
        diagnostics,
      };
      const perFamily: Record<string, unknown> = {};
      for (const family of ARCHETYPE_FAMILIES) {
        const r = generatePackages(profile, profiles, inputs.format, inputs.thisYear, {
          limit: 5,
          pools: inputs.pools,
          forceArchetype: { family },
        });
        perFamily[family] = {
          count: r.packages.length,
          fairness: r.packages.map((p) => p.fairness),
          diagnostics: r.diagnostics,
        };
      }
      forcedSummary[`roster_${profile.rosterId}`] = perFamily;
    }
    return { defaults, forcedSummary };
  };

  console.log("\nRunning default + forced sweep (pass 1)...");
  const pass1 = runAll();
  console.log("Running again (pass 2, determinism check)...");
  const pass2 = runAll();
  const json1 = JSON.stringify(pass1);
  if (json1 !== JSON.stringify(pass2)) {
    console.error("✗ NON-DETERMINISTIC: two identical runs produced different output");
    process.exit(1);
  }
  console.log("✓ Deterministic: two full runs produced identical output\n");

  // Terminal summary
  const fairnessTally: Record<string, number> = {};
  let defaultTotal = 0;
  console.log("DEFAULT MODE                          FORCED SWEEP (packages per family)");
  const famHeader = ARCHETYPE_FAMILIES.map((f) => f.split("_").map((w) => w[0]).join("").toUpperCase().padStart(4)).join("");
  console.log(`${"roster/owner".padEnd(28)}${"pkgs".padStart(5)}  ${famHeader}`);
  for (const profile of sorted) {
    const d = pass1.defaults[`roster_${profile.rosterId}`] as { packages: Array<{ fairness: string }> };
    defaultTotal += d.packages.length;
    const fam = pass1.forcedSummary[`roster_${profile.rosterId}`]!;
    const famCounts = ARCHETYPE_FAMILIES.map((f) => {
      const entry = fam[f] as { count: number; fairness: string[] };
      for (const label of entry.fairness) fairnessTally[label] = (fairnessTally[label] ?? 0) + 1;
      return String(entry.count).padStart(4);
    }).join("");
    console.log(
      `#${String(profile.rosterId).padStart(2)} ${profile.ownerName.slice(0, 20).padEnd(20)}${String(d.packages.length).padStart(9)}  ${famCounts}`,
    );
  }
  console.log(`\nDefault mode: ${defaultTotal} packages across ${sorted.length} rosters.`);
  console.log(`Forced-sweep fairness distribution: ${JSON.stringify(fairnessTally)}`);

  writeFileSync(outPath, JSON.stringify(pass1, null, 2));
  console.log(`JSON written to: ${outPath}`);
}

main().catch((err) => {
  console.error("Trade validation failed:");
  console.error(err);
  process.exit(1);
});
