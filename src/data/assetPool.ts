// The league's tradeable assets as one flat, searchable, filterable pool.
//
// Extracted from Calc, which grew the only real asset picker in the app: every
// player and pick across every roster, value-sorted, with a search box. Send It
// needed the same thing to answer "find me trades that send THIS player", and a
// second implementation would have drifted from the first within a release.
//
// Ids are the ENGINE's asset ids (`p:<playerId>`, `pk:<year>-<round>-<orig>`),
// the same strings api/_lib/tradeEngine.ts `assetId()` produces. Sharing one
// identity means the client can name an asset in a search request without a
// translation layer that could silently mismatch on picks.

import type { Position, TeamProfile } from "../algo/types";

export type TradeAsset = {
  /** Engine asset id. Stable across renders and safe to send to the API. */
  id: string;
  kind: "player" | "pick";
  name: string;
  position?: Position;
  value: number;
  ownerName: string;
  ownerRosterId: number;
  age?: number | null;
};

export type AssetFilters = {
  query: string;
  position: Position | "";
  kind: "all" | "player" | "pick";
  /** Inclusive age bounds. Picks have no age and are excluded when either is set. */
  ageMin: number | null;
  ageMax: number | null;
  /** Inclusive dynasty-value bounds. */
  valueMin: number | null;
  valueMax: number | null;
};

export const EMPTY_ASSET_FILTERS: AssetFilters = {
  query: "",
  position: "",
  kind: "all",
  ageMin: null,
  ageMax: null,
  valueMin: null,
  valueMax: null,
};

export function assetFiltersActive(f: AssetFilters): boolean {
  return (
    f.position !== "" ||
    f.kind !== "all" ||
    f.ageMin != null ||
    f.ageMax != null ||
    f.valueMin != null ||
    f.valueMax != null
  );
}

/** Every player and pick in the league, value-sorted descending. */
export function buildAssetPool(profiles: TeamProfile[]): TradeAsset[] {
  const players: TradeAsset[] = profiles.flatMap((p) =>
    p.players.map((pl): TradeAsset => ({
      id: `p:${pl.id}`,
      kind: "player",
      name: pl.name,
      position: pl.position,
      value: pl.valueDynasty,
      ownerName: p.ownerName,
      ownerRosterId: p.rosterId,
      age: pl.age,
    })),
  );
  const picks: TradeAsset[] = profiles.flatMap((p) =>
    p.picks.map((pk): TradeAsset => ({
      id: `pk:${pk.year}-${pk.round}-${pk.origRosterId}`,
      kind: "pick",
      name: pk.label,
      value: pk.value,
      ownerName: p.ownerName,
      ownerRosterId: p.rosterId,
    })),
  );
  // Ties broken by id so the list order is stable, matching the determinism
  // rule the engine follows.
  return [...players, ...picks].sort((a, b) => b.value - a.value || a.id.localeCompare(b.id));
}

/**
 * Search + filter. `query` needs 2 characters before it narrows anything, so
 * an empty box shows the most valuable assets rather than nothing.
 */
export function filterAssets(
  pool: TradeAsset[],
  filters: AssetFilters,
  opts: { exclude?: Set<string>; limit?: number } = {},
): TradeAsset[] {
  const { exclude, limit } = opts;
  const q = filters.query.trim().toLowerCase();
  const wantsAge = filters.ageMin != null || filters.ageMax != null;

  const out = pool.filter((a) => {
    if (exclude?.has(a.id)) return false;
    if (filters.kind !== "all" && a.kind !== filters.kind) return false;
    if (filters.position !== "" && a.position !== filters.position) return false;
    if (filters.valueMin != null && a.value < filters.valueMin) return false;
    if (filters.valueMax != null && a.value > filters.valueMax) return false;
    // An age filter is a question about players. A pick has no age, so it is
    // not an answer to that question either way.
    if (wantsAge) {
      if (a.age == null) return false;
      if (filters.ageMin != null && a.age < filters.ageMin) return false;
      if (filters.ageMax != null && a.age > filters.ageMax) return false;
    }
    if (q.length >= 2 && !a.name.toLowerCase().includes(q)) return false;
    return true;
  });

  // With no query and no filters this is a browse, so cap it short. Once the
  // user has actually narrowed something, show more of what they asked for.
  const cap = limit ?? (q.length >= 2 || assetFiltersActive(filters) ? 40 : 25);
  return out.slice(0, cap);
}
