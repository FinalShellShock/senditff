// Asset-scope validation. Proves the "find trades that send THIS player"
// filter actually constrains generation, and measures how often it comes back
// empty, which is the number that decides whether a seeded generator is worth
// building instead of a post-generation filter.
//
//   npm run validate:scope -- [leagueId] [username] [--cache-dir dir]

import { createRequire } from "node:module";
import { computeAllProfiles } from "../../src/algo/index.ts";
import { buildAssetPool } from "../../src/data/assetPool.ts";
import { loadLeagueInputs } from "./teams.ts";

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

  const inputs = await loadLeagueInputs(leagueId, myUsername, cacheDir);
  const profiles = computeAllProfiles(inputs.teams, inputs.format, inputs.thisYear, inputs.pools);
  const pool = buildAssetPool(profiles);

  console.log(`Format: ${inputs.format.superflex ? "SF" : "1QB"} · ${inputs.format.scoring}`);
  console.log(`League assets: ${pool.length}\n`);

  let hits = 0;
  let misses = 0;
  let violations = 0;
  const rows: string[] = [];

  for (const mine of profiles) {
    // Every player this roster owns, most valuable first. Sending YOUR guy is
    // the shape Gibbs asked for first ("sell x player").
    const owned = pool
      .filter((a) => a.ownerRosterId === mine.rosterId && a.kind === "player")
      .slice(0, 4);

    for (const asset of owned) {
      const { packages, diagnostics } = generatePackages(
        mine,
        profiles,
        inputs.format,
        inputs.thisYear,
        { pools: inputs.pools, mustGive: [asset.id] },
      );
      const scope = diagnostics.assetScope;
      // Correctness: every package returned MUST contain the named asset on the
      // give side. A filter that quietly lets others through is worse than no
      // filter, because the user believes the result is scoped.
      const bad = packages.filter(
        (p) => !p.give.some((g) => (g.kind === "pick" ? `pk:${g.id}` : `p:${g.id}`) === asset.id),
      );
      if (bad.length > 0) violations += bad.length;
      if (packages.length > 0) hits++;
      else misses++;

      rows.push(
        `${mine.ownerName.padEnd(16)} send ${asset.name.padEnd(22)} ` +
          `built ${String(scope?.before ?? 0).padStart(4)} → scoped ${String(scope?.after ?? 0).padStart(3)} ` +
          `→ ${packages.length} package${packages.length === 1 ? "" : "s"}`,
      );
    }
  }

  for (const r of rows) console.log(r);
  const total = hits + misses;
  console.log(
    `\n${hits}/${total} scoped searches returned at least one package ` +
      `(${Math.round((hits / total) * 100)}%). ${misses} came back empty.`,
  );
  console.log(
    violations === 0
      ? "✓ Every returned package contained the named asset."
      : `✗ ${violations} packages did NOT contain the named asset. The filter is broken.`,
  );
  if (violations > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
