// RANKINGS: every rostered asset in the league, ordered by dynasty value.
//
// Wishlist entry 6. Deliberately presentation over data the app already holds:
// the asset pool, the filters and the value numbers all exist, so this is a
// view rather than a feature.
//
// Two things it shows that nothing else does:
//
//   UNBANKED   The gap between a player's dynasty and redraft price, as a
//              percentage. The market's own read on how much of him is still
//              ahead of him. Picks read 100% because they cannot score this
//              season. This is the per-player version of the roster number on
//              TEAM STATE.
//
//   OWNER      Who holds him. Rankings without ownership are a price list;
//              with it they are a shopping list.

import { useMemo, useState } from "react";
import { useOutletContext } from "react-router-dom";
import AssetFilterBar from "./shared/AssetFilterBar.tsx";
import {
  EMPTY_ASSET_FILTERS,
  buildAssetPool,
  filterAssets,
  type AssetFilters,
} from "../data/assetPool.ts";
import type { LeagueOutletContext } from "./LeagueShell.tsx";

function posColor(pos?: string) {
  const map: Record<string, string> = { QB: "#c2410c", RB: "#ca8a04", WR: "#3b82f6", TE: "#a855f7" };
  return (pos && map[pos]) || "#475569";
}

export default function Rankings() {
  const { overview } = useOutletContext<LeagueOutletContext>();
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<AssetFilters>(EMPTY_ASSET_FILTERS);

  const pool = useMemo(
    () => buildAssetPool(overview.profiles, overview.format?.teamCount),
    [overview.profiles, overview.format?.teamCount],
  );

  // Rank is assigned on the FULL pool before filtering, so a player keeps his
  // league rank when you filter to WRs. A list that renumbers 1..n under a
  // filter answers a question nobody asked.
  const ranked = useMemo(() => {
    const r = new Map<string, number>();
    pool.forEach((a, i) => r.set(a.id, i + 1));
    return r;
  }, [pool]);

  // Rank within his own position: WR5, QB3. Same rule as the overall rank, off
  // the full pool, so filtering to WRs does not renumber anyone. The pool is
  // already value-sorted, so a running counter per position is the ranking.
  const posRanked = useMemo(() => {
    const seen = new Map<string, number>();
    const r = new Map<string, string>();
    for (const a of pool) {
      // Picks get the overall pick number instead: a 2.03 in a 12 team league
      // is pick 15, which is the number you actually think in when you value
      // one. Projected slots stay blank rather than guessing.
      if (a.kind === "pick") {
        if (a.pickOverall) r.set(a.id, `Pick ${a.pickOverall}`);
        continue;
      }
      if (!a.position) continue;
      const n = (seen.get(a.position) ?? 0) + 1;
      seen.set(a.position, n);
      r.set(a.id, `${a.position}${n}`);
    }
    return r;
  }, [pool]);

  // Redraft value per player id, for the unbanked column. Not on TradeAsset
  // because nothing else needs it.
  const redraft = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of overview.profiles) {
      for (const p of t.players) m.set(`p:${p.id}`, p.valueRedraft ?? 0);
    }
    return m;
  }, [overview.profiles]);

  const rows = useMemo(
    () => filterAssets(pool, { ...filters, query }, { limit: 300 }),
    [pool, filters, query],
  );

  const unbankedOf = (id: string, kind: string, value: number): number | null => {
    if (kind === "pick") return 1; // cannot score this season, by definition
    const red = redraft.get(id);
    if (red == null || value <= 0) return null;
    return 1 - red / value;
  };

  return (
    <>
      <div className="sendit-header">
        <h2 className="section-title">Rankings</h2>
        <h3 className="sendit-tagline">
          Every rostered player and pick in this league by dynasty value, with who holds it and how
          much of it is still to come.
        </h3>
      </div>

      <div className="rankings-panel">
        <input
          className="calc-search-input"
          placeholder="Search players and picks…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <AssetFilterBar filters={filters} onChange={setFilters} />

        <div className="rankings-head">
          <span className="rk-rank">#</span>
          <span className="rk-pos" />
          <span className="rk-name">PLAYER</span>
          <span className="rk-posrank">POS RK</span>
          <span className="rk-owner">OWNER</span>
          {/* rk-dim so the header hides with its cells on a phone. Without it
              the head kept eight columns while the rows dropped to five. */}
          <span className="rk-num rk-dim">AGE</span>
          <span className="rk-num">UNBANKED</span>
          <span className="rk-num">VALUE</span>
        </div>

        {rows.length === 0 ? (
          <p className="dim-text" style={{ textAlign: "center", fontSize: 11, padding: "20px 0" }}>
            Nothing matches those filters.
          </p>
        ) : (
          <div className="rankings-rows">
            {rows.map((a) => {
              const un = unbankedOf(a.id, a.kind, a.value);
              return (
                <div key={a.id} className="rankings-row">
                  <span className="rk-rank">{ranked.get(a.id)}</span>
                  <span className="rk-pos" style={{ background: posColor(a.position) }}>
                    {a.kind === "pick" ? "PK" : a.position}
                  </span>
                  <span className="rk-name">{a.name}</span>
                  <span className="rk-posrank" style={{ color: posColor(a.position) }}>
                    {posRanked.get(a.id) ?? "—"}
                  </span>
                  <span className="rk-owner">{a.ownerName}</span>
                  <span className="rk-num rk-dim">
                    {a.age != null ? a.age.toFixed(1) : "—"}
                  </span>
                  <span className={`rk-num${un != null && un < 0 ? " rk-banked" : ""}`}>
                    {un != null ? `${Math.round(un * 100)}%` : "—"}
                  </span>
                  <span className="rk-num rk-value">{a.value.toLocaleString()}</span>
                </div>
              );
            })}
          </div>
        )}
        {rows.length >= 300 && (
          <p className="dim-text" style={{ textAlign: "center", fontSize: 10, padding: "8px 0" }}>
            Showing the top 300. Narrow with search or the filters above.
          </p>
        )}
      </div>
    </>
  );
}
