import { resolve } from "node:path";
import { computeAllProfiles } from "../../src/algo/index.ts";
import { loadLeagueInputs } from "./teams.ts";
import { printTerminal, writeHtmlReport } from "./report.ts";

const DEFAULT_LEAGUE_ID = "1336158419664506880";
const MY_SLEEPER_USERNAME = "FinalShellShock";

async function main(): Promise<void> {
  const leagueId = process.argv[2] ?? DEFAULT_LEAGUE_ID;
  const myUsername = process.argv[3] ?? MY_SLEEPER_USERNAME;

  const inputs = await loadLeagueInputs(leagueId, myUsername);
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
  printTerminal(inputs.leagueName, inputs.format, profiles);

  const outPath = resolve("validate-output.html");
  writeHtmlReport(outPath, inputs.leagueName, inputs.format, profiles);
  console.log(`\nHTML report written to: ${outPath}`);
  console.log(`Open it: open "${outPath}"`);
}

main().catch((err) => {
  console.error("Validation script failed:");
  console.error(err);
  process.exit(1);
});
