// Does a specific downvoted trade still get suggested?
//
// The feedback loop needs this: after changing the engine, the question is not
// "did the numbers move" but "is the trade the user hated actually gone".
//
//   npm run validate:repro -- <leagueId> <rosterId> [cacheDir] [playerName]
//
// Prints that roster's default-mode packages with scores, flagging any that
// mention the named player. Uses the same profile basis as production.
import { createRequire } from "node:module";
import { computeAllProfiles } from "../../src/algo/index.ts";
import { loadLeagueInputs } from "./teams.ts";
const require = createRequire(import.meta.url);
const { generatePackages } = require("../../api/_lib/tradeEngine.ts") as typeof import("../../api/_lib/tradeEngine.ts");

const [lid, rosterId, cache, needle] = process.argv.slice(2);
const inputs = await loadLeagueInputs(lid!, "FinalShellShock", cache || null);
const profiles = computeAllProfiles(inputs.teams, inputs.format, inputs.thisYear, inputs.pools);
const me = profiles.find((p) => p.rosterId === Number(rosterId))!;
const { packages } = generatePackages(me, profiles, inputs.format, inputs.thisYear, {
  limit: 5,
  pools: inputs.pools,
});
console.log(`roster ${rosterId}: ${packages.length} packages`);
packages.forEach((p, i) => {
  const g = p.give.map((a) => a.name).join(" + ");
  const r = p.receive.map((a) => a.name).join(" + ");
  const hit = needle && (g.includes(needle) || r.includes(needle)) ? "  <<< FLAGGED PLAYER" : "";
  console.log(`  #${i} ${p.archetype.padEnd(22)} tot=${p.scores.total.toFixed(3)} my=${p.scores.myFit.toFixed(2)} their=${p.scores.theirFit.toFixed(2)} | ${g} -> ${r}${hit}`);
});
