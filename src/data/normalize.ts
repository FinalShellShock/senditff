// Deterministic name normalization. Used for Sleeper <-> FantasyCalc matching.
export function normName(name: string | null | undefined): string {
  if (!name) return "";
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .replace(/(jr|sr|ii|iii|iv|v)$/, "");
}
