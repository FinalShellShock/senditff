// Trade-history validation: walks the league chain, fetches every trade,
// grades at today's values, and prints the full ledger + every graded trade
// for eyeballing against known league history. No Firestore involved.
//
//   npm run validate:history -- [leagueId] [username] [--cache-dir dir] [--out file]

import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { fetchPlayers } from "../../src/data/index.ts";
import { loadLeagueInputs } from "./teams.ts";

const require = createRequire(import.meta.url);
const { walkLeagueChain, fetchSeasonTrades, gradeTrades, buildLedger } =
  require("../../api/_lib/tradeHistory.ts") as typeof import("../../api/_lib/tradeHistory.ts");

const DEFAULT_LEAGUE_ID = "1336158419664506880";
const MY_SLEEPER_USERNAME = "FinalShellShock";

function flagValue(name: string): string | null {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] ?? null : null;
}

function fmt(n: number): string {
  return n.toLocaleString("en-US");
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
  const outPath = resolve(flagValue("--out") ?? "validate-history.json");

  const inputs = await loadLeagueInputs(leagueId, myUsername, cacheDir);
  const players = await fetchPlayers();

  console.log("\nWalking league chain...");
  const chain = await walkLeagueChain(leagueId);
  console.log(chain.map((c) => `  ${c.season}: ${c.leagueId}`).join("\n"));

  const docs = [];
  for (const link of chain) {
    console.log(`Fetching ${link.season} trades (18 weeks)...`);
    const doc = await fetchSeasonTrades(link.leagueId, link.season, players);
    console.log(
      `  ${doc.trades.length} trades, ${Object.keys(doc.draftSelections).length} draft selections resolved`,
    );
    docs.push(doc);
  }

  const graded = gradeTrades(docs, inputs.dynastyValues, inputs.teamCount, inputs.thisYear);
  const ledger = buildLedger(graded);

  console.log(`\n═══ TRADE POWER RANKINGS (values as of today) ═══`);
  console.log(`${"manager".padEnd(22)}${"trades".padStart(7)}${"W-L-T".padStart(10)}${"net".padStart(10)}`);
  for (const row of ledger) {
    console.log(
      `${row.managerName.slice(0, 20).padEnd(22)}${String(row.trades).padStart(7)}${`${row.wins}-${row.losses}-${row.ties}`.padStart(10)}${fmt(Math.round(row.netValue)).padStart(10)}`,
    );
  }

  console.log(`\n═══ ALL TRADES (newest first) ═══`);
  for (const t of graded) {
    const flag = t.winnerRosterId != null
      ? `winner: ${t.sides.find((s) => s.rosterId === t.winnerRosterId)?.managerName} +${fmt(Math.round(t.delta))}`
      : "fair";
    console.log(`\n${t.date.slice(0, 10)}  (${t.season} wk${t.week})  ${flag}`);
    for (const side of t.sides) {
      console.log(`  ${side.managerName} receives (${fmt(Math.round(side.received))}):`);
      for (const a of side.assets) {
        const note = a.note ? `  [${a.note}]` : "";
        console.log(`    ${(a.position ?? "PK").padEnd(3)} ${a.name.padEnd(28)} ${fmt(a.todayValue).padStart(7)}${note}`);
      }
    }
  }

  const unresolved = graded.flatMap((t) => t.sides.flatMap((s) => s.assets)).filter((a) => a.note === "unresolved_pick").length;
  const offBoard = graded.flatMap((t) => t.sides.flatMap((s) => s.assets)).filter((a) => a.note === "off_board").length;
  console.log(`\n${graded.length} trades graded. ${offBoard} off-board players, ${unresolved} unresolved picks.`);

  writeFileSync(outPath, JSON.stringify({ ledger, graded }, null, 2));
  console.log(`JSON written to: ${outPath}`);
}

main().catch((err) => {
  console.error("History validation failed:");
  console.error(err);
  process.exit(1);
});
