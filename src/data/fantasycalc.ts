import type { LeagueFormat } from "../algo/types";
import type { FantasyCalcEntry } from "./types";

const FCALC = "https://api.fantasycalc.com/values/current";

async function fetchFantasyCalcOne(
  format: LeagueFormat,
  isDynasty: boolean,
): Promise<FantasyCalcEntry[]> {
  const ppr = format.scoring === "ppr" ? 1 : format.scoring === "half" ? 0.5 : 0;
  const numQbs = format.superflex ? 2 : 1;
  const url = `${FCALC}?isDynasty=${isDynasty}&numQbs=${numQbs}&ppr=${ppr}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`FantasyCalc fetch failed: HTTP ${r.status} (${url})`);
  return (await r.json()) as FantasyCalcEntry[];
}

// Fetches both dynasty and redraft value sets in parallel.
// Dynasty is the source of truth for picks (redraft has no pick values),
// so the dynasty fetch also seeds the pick value lookup.
export async function fetchFantasyCalc(
  format: LeagueFormat,
): Promise<{ dynasty: FantasyCalcEntry[]; redraft: FantasyCalcEntry[] }> {
  const [dynasty, redraft] = await Promise.all([
    fetchFantasyCalcOne(format, true),
    fetchFantasyCalcOne(format, false),
  ]);
  return { dynasty, redraft };
}
