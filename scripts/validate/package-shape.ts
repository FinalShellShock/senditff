// Asserts the two package-shape invariants added after the daniels 1.20
// feedback pull, across every roster and every archetype:
//
//   1. NO PASSENGERS. Every piece on a multi-asset side is worth at least
//      BUNDLE_PIECE_MIN of that side. Two downvotes were 1-for-1 swaps with a
//      zero-value body attached, which the old check waved through because it
//      returned early for any side of two assets.
//
//   2. CONSOLIDATION GOES UP. A consolidate package lands a player worth more
//      than the best piece leaving, by CONSOLIDATE_UPGRADE. Measured against
//      the pair TOTAL instead, it shipped Andrews (1,399) for Goedert (1,350).
//
//   npm run validate:shape -- [leagueId] [username] [--cache-dir dir]

import { createRequire } from "node:module";
import { ARCHETYPE_FAMILIES, computeAllProfiles } from "../../src/algo/index.ts";
import { loadLeagueInputs } from "./teams.ts";

const require = createRequire(import.meta.url);
const { generatePackages } =
  require("../../api/_lib/tradeEngine.ts") as typeof import("../../api/_lib/tradeEngine.ts");

const DEFAULT_LEAGUE_ID = "1336158419664506880";
const MY_SLEEPER_USERNAME = "FinalShellShock";

const BUNDLE_PIECE_MIN = 0.05;
const CONSOLIDATE_UPGRADE = 1.1;

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

  const passengers: string[] = [];
  const backwards: string[] = [];
  const dupes: string[] = [];
  const misordered: string[] = [];
  let sides = 0;
  let consolidations = 0;
  let packages = 0;
  let lists = 0;
  let autoPackages = 0;
  const sidegrades: string[] = [];

  const runs: Array<{ label: string; opts: Record<string, unknown> }> = [
    { label: "auto", opts: {} },
    ...ARCHETYPE_FAMILIES.map((f) => ({
      label: f,
      opts: { forceArchetype: { family: f } },
    })),
  ];

  for (const mine of profiles) {
    for (const run of runs) {
      const { packages: pkgs } = generatePackages(
        mine, profiles, inputs.format, inputs.thisYear,
        { pools: inputs.pools, ...run.opts },
      );
      // 3. NO NEAR-DUPLICATES within one result list, and 4. headline first.
      lists++;
      const pairSeen = new Map<string, number>();
      const giveSeen = new Map<string, number>();
      const recvSeen = new Map<string, number>();
      const head = (as: Array<{ name: string; valueDynasty: number }>) =>
        as.reduce((b, a) => (a.valueDynasty > b.valueDynasty ? a : b), as[0]!).name;
      for (const p of pkgs) {
        const g = head(p.give);
        const r = head(p.receive);
        pairSeen.set(`${g}>${r}`, (pairSeen.get(`${g}>${r}`) ?? 0) + 1);
        giveSeen.set(g, (giveSeen.get(g) ?? 0) + 1);
        recvSeen.set(r, (recvSeen.get(r) ?? 0) + 1);
        for (const [side, assets] of [["send", p.give], ["get", p.receive]] as const) {
          for (let i = 1; i < assets.length; i++) {
            if (assets[i]!.valueDynasty > assets[i - 1]!.valueDynasty) {
              misordered.push(
                `${mine.ownerName} [${run.label}] ${side}: ${assets[i]!.name} ` +
                  `(${assets[i]!.valueDynasty}) listed after ${assets[i - 1]!.name} (${assets[i - 1]!.valueDynasty})`,
              );
            }
          }
        }
      }
      for (const [k, n] of pairSeen) {
        if (n > 1) dupes.push(`${mine.ownerName} [${run.label}] same trade ${n}x: ${k}`);
      }
      for (const [k, n] of giveSeen) {
        if (n > 2) dupes.push(`${mine.ownerName} [${run.label}] sends ${k} in ${n} packages`);
      }
      for (const [k, n] of recvSeen) {
        if (n > 2) dupes.push(`${mine.ownerName} [${run.label}] lands ${k} in ${n} packages`);
      }

      for (const p of pkgs) {
        packages++;
        // Reported, not asserted. SIDEGRADE_PENALTY demotes these rather than
        // banning them, so a non-zero count is expected and the number itself
        // is the thing worth watching: it should be small and should not creep.
        if (run.label === "auto") {
          autoPackages++;
          const sent = p.give.filter((a) => a.kind === "player");
          const back = p.receive.filter((a) => a.kind === "player");
          if (
            sent.length === 1 && back.length >= 2 &&
            back.every((a) => a.position === sent[0]!.position)
          ) {
            sidegrades.push(
              `${mine.ownerName}: ${sent[0]!.position} ${sent[0]!.name} -> ` +
                back.map((a) => a.name).join(" + "),
            );
          }
        }
        for (const [side, assets] of [["send", p.give], ["get", p.receive]] as const) {
          if (assets.length <= 1) continue;
          sides++;
          const values = assets.map((a) => a.valueDynasty);
          const sum = values.reduce((s, v) => s + v, 0);
          if (sum <= 0) continue;
          for (const a of assets) {
            if (a.valueDynasty < BUNDLE_PIECE_MIN * sum) {
              passengers.push(
                `${mine.ownerName} [${run.label}] ${side}: ${a.name} (${a.valueDynasty}) is ` +
                  `${((a.valueDynasty / sum) * 100).toFixed(1)}% of a ${sum} side`,
              );
            }
          }
        }

        if (p.archetype.startsWith("consolidate") && p.receive.length === 1) {
          consolidations++;
          const landed = p.receive[0]!;
          const best = Math.max(...p.give.map((a) => a.valueDynasty));
          if (landed.valueDynasty < best * CONSOLIDATE_UPGRADE) {
            backwards.push(
              `${mine.ownerName} [${run.label}] sent best piece ${best} → landed ` +
                `${landed.name} (${landed.valueDynasty}), ratio ${(landed.valueDynasty / best).toFixed(2)}`,
            );
          }
        }
      }
    }
  }

  if (packages === 0 || sides === 0 || consolidations === 0) {
    console.error("Nothing to check. The harness would pass vacuously; failing instead.");
    process.exit(1);
  }
  console.log(`Checked ${packages} packages, ${sides} multi-asset sides, ${consolidations} consolidations.\n`);
  console.log(
    passengers.length === 0
      ? `✓ No passengers: every piece clears ${BUNDLE_PIECE_MIN * 100}% of its side.`
      : `✗ ${passengers.length} passenger pieces:\n  ` + passengers.slice(0, 15).join("\n  "),
  );
  console.log(
    backwards.length === 0
      ? `✓ Every consolidation landed a player beating the best outgoing piece by ${CONSOLIDATE_UPGRADE}x.`
      : `✗ ${backwards.length} consolidations went backwards:\n  ` + backwards.slice(0, 15).join("\n  "),
  );
  console.log(
    dupes.length === 0
      ? `✓ No near-duplicates across ${lists} result lists.`
      : `✗ ${dupes.length} near-duplicate clusters:\n  ` + dupes.slice(0, 15).join("\n  "),
  );
  console.log(
    `\ni ${sidegrades.length} of ${autoPackages} auto-mode packages return only the position they emptied` +
      (sidegrades.length ? ":\n  " + sidegrades.join("\n  ") : "."),
  );
  console.log(
    misordered.length === 0
      ? "✓ Every side lists its biggest asset first."
      : `✗ ${misordered.length} misordered sides:\n  ` + misordered.slice(0, 10).join("\n  "),
  );
  if (passengers.length > 0 || backwards.length > 0 || dupes.length > 0 || misordered.length > 0) {
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
