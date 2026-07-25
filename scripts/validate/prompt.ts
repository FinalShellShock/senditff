// Renders the real Haiku prompt for actual packages from the last
// `npm run validate:trades` run, without calling the API and without Firebase
// credentials. That last part is why api/_lib/rationalePrompt.ts exists as its
// own module: api/trades/find.ts imports the Admin SDK at load time, so the
// prompt used to be inspectable only in production.
//
// Prints one multi-piece package (exercises the bundle-adjustment line) and one
// straight swap (which should stay clean), plus a rough token count. Run
// `npm run validate:trades` first to produce validate-trades.json.

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { computeAllProfiles } from "../../src/algo/index.ts";
import { loadLeagueInputs } from "./teams.ts";
const require = createRequire(import.meta.url);
const { buildRationalePrompt } = require("../../api/_lib/rationalePrompt.ts");

const inputs = await loadLeagueInputs("1336158419664506880", "FinalShellShock", process.argv[2] ?? null);
const profiles = computeAllProfiles(inputs.teams, inputs.format, inputs.thisYear, inputs.pools);
const byId = new Map(profiles.map((p) => [p.rosterId, p]));

const raw = JSON.parse(readFileSync("validate-trades.json", "utf8"));
const all: any[] = [];
const walk = (o: any) => {
  if (Array.isArray(o)) return o.forEach(walk);
  if (o && typeof o === "object") {
    if (o.give && o.receive && o.scores) all.push(o);
    else Object.values(o).forEach(walk);
  }
};
walk(raw);

const multi = all.find((p) => p.give.length + p.receive.length > 2);
const simple = all.find((p) => p.give.length + p.receive.length === 2);
for (const pkg of [multi, simple]) {
  if (!pkg) continue;
  const theirs = byId.get(pkg.counterRosterId);
  const mine = profiles.find((p) => p.rosterId !== pkg.counterRosterId)!;
  const p = buildRationalePrompt(pkg, mine, theirs, undefined);
  console.log(`\n===== ${pkg.give.length}-for-${pkg.receive.length}, archMatch ${pkg.scores.archMatch.toFixed(2)} =====`);
  console.log(p);
  console.log(`--- approx tokens: ${Math.round(p.length / 4)}`);
}
