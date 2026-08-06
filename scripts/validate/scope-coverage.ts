// Scoped-search coverage harness.
//
// "Find trades involving this player" is the one search a user can aim at any
// asset they own, so a blank page is a much louder failure than a thin auto
// list. Before the value-matching fallback, 154 of 370 scoped searches in the
// test league returned nothing, every one of them a player under ~1,700
// dynasty value: the archetype generators all start from a position leader, so
// anyone who is nobody's best at their position was invisible to the engine.
//
// The contract this asserts: a scoped search NEVER produces a bare blank page.
// Either it returns packages, or the engine says in words why it could not
// build one. It deliberately does NOT assert "every player returns a trade":
// an asset priced at 8 when the cheapest thing anyone else holds is priced at
// 40 has no honest match, and inventing one would be worse than saying so.
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
let explained = 0;
const silentlyEmpty: string[] = [];

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
      if (r.diagnostics.assetScope?.note) {
        explained++;
      } else {
        silentlyEmpty.push(
          `${p.name} (${p.position}, ${Math.round(p.valueDynasty)}) on ${me.ownerName}`,
        );
      }
    }
  }
}

console.log(`Scoped "trade away this player" searches: ${checked}`);
console.log(`  value-matched fallback built: ${fallbackUsed}`);
console.log(`  empty: ${empty} (${((empty / checked) * 100).toFixed(0)}%), all explained: ${explained}`);

if (checked === 0) {
  console.error("\n✗ Checked nothing. The harness is not exercising the engine.");
  process.exit(1);
}
if (silentlyEmpty.length > 0) {
  console.error(`\n✗ ${silentlyEmpty.length} player(s) return nothing and no explanation:`);
  for (const w of silentlyEmpty.slice(0, 20)) console.error(`    ${w}`);
  process.exit(1);
}
console.log(`\n✓ No scoped search returns a bare blank page.`);
console.log(`  ${checked - empty} returned packages; the other ${empty} said why they could not.`);
