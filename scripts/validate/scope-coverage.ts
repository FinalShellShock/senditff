// Scoped-search coverage harness.
//
// "Find trades involving this player" is the one search a user can aim at any
// asset they own, so a blank page is a much louder failure than a thin auto
// list. Before the value-matching fallback, 154 of 370 scoped searches in the
// test league returned nothing, every one of them a player under ~1,700
// dynasty value: the archetype generators all start from a position leader, so
// anyone who is nobody's best at their position was invisible to the engine.
//
// This asserts the only acceptable empty result is an asset the market prices
// at zero. Anything else means a real player has become unsearchable again.
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { generatePackages } =
  require("../../api/_lib/tradeEngine.ts") as typeof import("../../api/_lib/tradeEngine.ts");
import { computeAllProfiles } from "../../src/algo/index.ts";
import { loadLeagueInputs } from "./teams.ts";

const LEAGUE_ID = "1336158419664506880";

const inputs = await loadLeagueInputs(LEAGUE_ID, "FinalShellShock", null);
const profiles = computeAllProfiles(inputs.teams, inputs.format, inputs.thisYear, inputs.pools);

let checked = 0;
let empty = 0;
let fallbackUsed = 0;
const wrongfullyEmpty: string[] = [];

for (const me of profiles) {
  for (const p of me.players) {
    const r = generatePackages(me, profiles, inputs.format, inputs.thisYear, {
      limit: 5,
      pools: inputs.pools,
      mustGive: [`p:${p.id}`],
    });
    checked++;
    if (r.diagnostics.assetScope?.builtFallback) fallbackUsed++;
    if (r.packages.length === 0) {
      empty++;
      if (p.valueDynasty > 0) {
        wrongfullyEmpty.push(
          `${p.name} (${p.position}, ${Math.round(p.valueDynasty)}) on ${me.ownerName}`,
        );
      }
    }
  }
}

console.log(`Scoped "trade away this player" searches: ${checked}`);
console.log(`  value-matched fallback built: ${fallbackUsed}`);
console.log(`  empty: ${empty} (${((empty / checked) * 100).toFixed(0)}%)`);

if (checked === 0) {
  console.error("\n✗ Checked nothing. The harness is not exercising the engine.");
  process.exit(1);
}
if (wrongfullyEmpty.length > 0) {
  console.error(
    `\n✗ ${wrongfullyEmpty.length} player(s) with real dynasty value return no trades at all:`,
  );
  for (const w of wrongfullyEmpty.slice(0, 20)) console.error(`    ${w}`);
  process.exit(1);
}
console.log(`\n✓ Every player with dynasty value above zero returns at least one package.`);
console.log(`  The ${empty} empty results are all zero-value assets, which is the honest answer.`);
