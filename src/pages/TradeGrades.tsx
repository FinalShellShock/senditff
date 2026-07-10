import { useEffect, useMemo, useState } from "react";
import { useOutletContext, useParams, useSearchParams } from "react-router-dom";
import { fairnessColor } from "../algo/fairness.ts";
import {
  makeApiClient,
  type GradedAsset,
  type GradedTrade,
  type LedgerRow,
  type TradesResponse,
} from "../api/client.ts";
import { useAuth } from "../hooks/useAuth.tsx";
import type { LeagueOutletContext } from "./LeagueShell.tsx";

function posColor(pos?: string) {
  const map: Record<string, string> = { QB: "#c2410c", RB: "#ca8a04", WR: "#3b82f6", TE: "#a855f7" };
  return pos ? map[pos] ?? "#94a3b8" : "#475569";
}

function fmtValue(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? "−" : n > 0 ? "+" : "";
  if (abs >= 10000) return `${sign}${(abs / 1000).toFixed(1)}k`;
  if (abs >= 1000) return `${sign}${(abs / 1000).toFixed(1)}k`;
  return `${sign}${abs.toLocaleString()}`;
}

function AssetRow({ asset }: { asset: GradedAsset }) {
  const drafted = asset.note?.startsWith("drafted:") ? asset.note.slice(8) : null;
  return (
    <div className="tg-asset-row">
      <span
        className="trade-asset-tag"
        style={{ background: asset.kind === "player" ? posColor(asset.position) : "#475569" }}
      >
        {asset.kind === "player" ? asset.position : asset.kind === "pick" ? "PICK" : "FAAB"}
      </span>
      <span className="tg-asset-name">
        {asset.name}
        {drafted && <span className="tg-asset-note"> → {drafted}</span>}
        {asset.note === "off_board" && <span className="tg-asset-note tg-note-bad"> off board</span>}
        {asset.note === "unresolved_pick" && <span className="tg-asset-note tg-note-bad"> unresolved</span>}
      </span>
      <span className="tg-asset-value">{asset.todayValue > 0 ? asset.todayValue.toLocaleString() : "—"}</span>
    </div>
  );
}

function TradeRow({ trade, myRosterId }: { trade: GradedTrade; myRosterId: number | null }) {
  const winner = trade.sides.find((s) => s.rosterId === trade.winnerRosterId);
  return (
    <div className="tg-trade-card">
      <div className="tg-trade-header">
        <span className="dim-text">{trade.date.slice(0, 10)}</span>
        {winner ? (
          <span className="tg-winner-tag" style={{ color: "#22c55e" }}>
            {winner.managerName} +{Math.round(trade.delta).toLocaleString()}
          </span>
        ) : (
          <span className="fairness-badge" style={{ borderColor: fairnessColor("FAIR"), color: fairnessColor("FAIR"), marginTop: 0 }}>
            FAIR
          </span>
        )}
      </div>
      <div className="tg-trade-sides">
        {trade.sides.map((side) => {
          const won = side.rosterId === trade.winnerRosterId;
          const mine = side.rosterId === myRosterId;
          return (
            <div key={side.rosterId} className={`tg-side${won ? " tg-side-won" : ""}`}>
              <div className="tg-side-header">
                <span className="tg-side-manager" style={{ color: won ? "#22c55e" : "#e2e8f0" }}>
                  {side.managerName}{mine ? " ★" : ""} receives
                </span>
                <span className="tg-side-total">{Math.round(side.received).toLocaleString()}</span>
              </div>
              {side.assets.map((a, i) => <AssetRow key={i} asset={a} />)}
              <div className="tg-side-net" style={{ color: side.net > 0 ? "#22c55e" : side.net < 0 ? "#ef4444" : "#64748b" }}>
                net {fmtValue(Math.round(side.net))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function TradeGrades() {
  const { id: leagueId } = useParams<{ id: string }>();
  const { getToken } = useAuth();
  const { overview } = useOutletContext<LeagueOutletContext>();
  const api = makeApiClient(getToken);

  const [data, setData] = useState<TradesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openSeasons, setOpenSeasons] = useState<Set<number>>(new Set());
  const [searchParams, setSearchParams] = useSearchParams();

  const myRosterId = overview.profiles.find((p) => p.isMine)?.rosterId ?? null;

  // Manager filter, deep-linkable (?manager=<rosterId> from team pages).
  const urlManager = searchParams.get("manager");
  const [managerFilter, setManagerFilter] = useState<number | "">(
    urlManager != null && urlManager !== "" ? Number(urlManager) : "",
  );

  function applyManagerFilter(value: number | "", seasons: number[]) {
    setManagerFilter(value);
    const next = new URLSearchParams(searchParams);
    if (value === "") next.delete("manager");
    else next.set("manager", String(value));
    setSearchParams(next, { replace: true });
    // Filtering to one manager: open every season so their history reads
    // as one continuous list.
    if (value !== "") setOpenSeasons(new Set(seasons));
  }

  useEffect(() => {
    if (!leagueId) return;
    setLoading(true);
    api.getTrades(leagueId)
      .then((d) => {
        setData(d);
        if (d.seasons.length > 0) {
          // A deep-linked manager filter opens everything; default opens
          // just the newest season.
          setOpenSeasons(
            managerFilter !== "" ? new Set(d.seasons) : new Set([Math.max(...d.seasons)]),
          );
        }
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load trades"))
      .finally(() => setLoading(false));
  }, [leagueId]); // eslint-disable-line react-hooks/exhaustive-deps

  function refresh() {
    if (!leagueId) return;
    setRefreshing(true);
    setError(null);
    api.refreshTrades(leagueId)
      .then((d) => {
        setData(d);
        if (openSeasons.size === 0 && d.seasons.length > 0) {
          setOpenSeasons(new Set([Math.max(...d.seasons)]));
        }
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to refresh trades"))
      .finally(() => setRefreshing(false));
  }

  const bySeason = useMemo(() => {
    const map = new Map<number, GradedTrade[]>();
    for (const t of data?.trades ?? []) {
      if (managerFilter !== "" && !t.sides.some((s) => s.rosterId === managerFilter)) continue;
      const arr = map.get(t.season) ?? [];
      arr.push(t);
      map.set(t.season, arr);
    }
    return [...map.entries()].sort((a, b) => b[0] - a[0]);
  }, [data, managerFilter]);

  if (loading) {
    return <p className="dim-text" style={{ marginTop: 48, textAlign: "center" }}>Loading trade history...</p>;
  }

  if (!data) {
    return (
      <div className="tg-backfill">
        <h2 className="tg-title">TRADE GRADES</h2>
        {error && <div className="error-banner">{error}</div>}
      </div>
    );
  }

  if (data.needsBackfill) {
    return (
      <div className="tg-backfill">
        <h2 className="tg-title">TRADE GRADES</h2>
        <p className="dim-text" style={{ maxWidth: 480, lineHeight: 1.6 }}>
          Pull every trade in this league's history from Sleeper (all seasons) and grade each
          one at today's market values. This takes about half a minute the first time.
        </p>
        {error && <div className="error-banner">{error}</div>}
        <button className="sendit-find-btn" disabled={refreshing} onClick={refresh}>
          {refreshing ? "LOADING HISTORY... (~30s)" : "LOAD TRADE HISTORY"}
        </button>
      </div>
    );
  }

  return (
    <>
      <div className="tg-header">
        <div className="tg-header-info">
          <h2 className="tg-title">TRADE GRADES</h2>
          <p className="dim-text tg-header-footnote">
            Values reflect today's market (as of {data?.valuesAsOf}). Picks graded as the players
            drafted with them where known.
          </p>
        </div>
        <div className="tg-controls">
          <select
            className="team-switcher-select"
            value={managerFilter}
            onChange={(e) =>
              applyManagerFilter(
                e.target.value === "" ? "" : Number(e.target.value),
                data?.seasons ?? [],
              )
            }
          >
            <option value="">All managers</option>
            {[...(data?.ledger ?? [])]
              .sort((a, b) => a.managerName.localeCompare(b.managerName))
              .map((row) => (
                <option key={row.rosterId} value={row.rosterId}>
                  {row.managerName}{row.rosterId === myRosterId ? " ★" : ""}
                </option>
              ))}
          </select>
          <button className="sendit-reset-btn" disabled={refreshing} onClick={refresh}>
            {refreshing ? "CHECKING..." : "CHECK FOR NEW TRADES"}
          </button>
        </div>
      </div>

      {error && <div className="error-banner">{error}</div>}

      <div className="tg-ledger">
        <h2 className="section-title">Trade Power Rankings</h2>
        <div className="tg-ledger-table">
          <div className="tg-ledger-row tg-ledger-head">
            <span>#</span><span>MANAGER</span><span>TRADES</span><span>W-L-T</span><span>NET VALUE</span>
          </div>
          {(data?.ledger ?? []).map((row: LedgerRow, i: number) => (
            <div
              key={row.rosterId}
              className={`tg-ledger-row tg-ledger-clickable${row.rosterId === myRosterId ? " tg-ledger-mine" : ""}${row.rosterId === managerFilter ? " tg-ledger-filtered" : ""}`}
              title="Filter trades to this manager"
              onClick={() =>
                applyManagerFilter(
                  managerFilter === row.rosterId ? "" : row.rosterId,
                  data?.seasons ?? [],
                )
              }
            >
              <span className="dim-text">{i + 1}</span>
              <span className="tg-ledger-manager">{row.managerName}{row.rosterId === myRosterId ? " ★" : ""}</span>
              <span>{row.trades}</span>
              <span className="dim-text">{row.wins}-{row.losses}-{row.ties}</span>
              <span style={{ color: row.netValue > 0 ? "#22c55e" : row.netValue < 0 ? "#ef4444" : "#64748b" }}>
                {fmtValue(Math.round(row.netValue))}
              </span>
            </div>
          ))}
        </div>
      </div>

      {bySeason.map(([season, trades]) => {
        const open = openSeasons.has(season);
        return (
          <div key={season} className="tg-season">
            <button
              className="tg-season-toggle"
              onClick={() => {
                const next = new Set(openSeasons);
                if (open) next.delete(season);
                else next.add(season);
                setOpenSeasons(next);
              }}
            >
              <span>{season} SEASON</span>
              <span className="dim-text">{trades.length} trades {open ? "▾" : "▸"}</span>
            </button>
            {open && (
              <div className="tg-trade-list">
                {trades.map((t) => <TradeRow key={t.transactionId} trade={t} myRosterId={myRosterId} />)}
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}
