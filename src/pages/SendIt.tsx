import { useEffect, useState } from "react";
import { useNavigate, useOutletContext, useParams } from "react-router-dom";
import { makeApiClient, type TradeAssetWire, type TradePackage } from "../api/client.ts";
import { useAuth } from "../hooks/useAuth.tsx";
import type { LeagueOutletContext } from "./LeagueShell.tsx";

function posColor(pos?: string) {
  const map: Record<string, string> = { QB: "#c2410c", RB: "#ca8a04", WR: "#3b82f6", TE: "#a855f7" };
  return pos ? map[pos] ?? "#94a3b8" : "#475569";
}

function AssetList({ assets }: { assets: TradeAssetWire[] }) {
  return (
    <span className="trade-names">
      {assets.map((a, i) => (
        <span key={a.id} className="trade-asset">
          <span
            className="trade-asset-tag"
            style={{ background: a.kind === "pick" ? "#475569" : posColor(a.position) }}
          >
            {a.kind === "pick" ? "PICK" : a.position}
          </span>
          <span className="trade-asset-name">{a.name}</span>
          {i < assets.length - 1 && <span className="trade-asset-sep"> + </span>}
        </span>
      ))}
    </span>
  );
}

function TradeCard({ pkg }: { pkg: TradePackage }) {
  const delta = pkg.valueReceive - pkg.valueGive;
  const deltaColor = delta > 200 ? "#22c55e" : delta < -200 ? "#ef4444" : "#94a3b8";

  return (
    <div className="trade-card">
      <div className="trade-card-header">
        <span className="trade-arch-tag">{pkg.archetype.replace(/_/g, " ")}</span>
        <span className="trade-counter-team">{pkg.counterTeam}</span>
      </div>
      <div className="trade-players">
        <div className="trade-side">
          <span className="trade-dir">SEND</span>
          <AssetList assets={pkg.give} />
          <span className="trade-val">{pkg.valueGive.toLocaleString()}</span>
        </div>
        <div className="trade-arrow">⇄</div>
        <div className="trade-side trade-side-receive">
          <span className="trade-dir">GET</span>
          <AssetList assets={pkg.receive} />
          <span className="trade-val" style={{ color: deltaColor }}>{pkg.valueReceive.toLocaleString()}</span>
        </div>
      </div>
      {pkg.rationale && <p className="trade-rationale">{pkg.rationale}</p>}
    </div>
  );
}

export default function SendIt() {
  const { id: leagueId, rosterId: rosterIdStr } = useParams<{ id: string; rosterId: string }>();
  const rosterId = Number(rosterIdStr);
  const navigate = useNavigate();
  const { getToken } = useAuth();
  const { overview } = useOutletContext<LeagueOutletContext>();
  const api = makeApiClient(getToken);

  const [trades, setTrades] = useState<TradePackage[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!leagueId || !rosterId) return;
    setTrades(null);
    setLoading(true);
    setError(null);
    api.findTrades(leagueId, rosterId)
      .then((r) => setTrades(r.packages))
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to find trades"))
      .finally(() => setLoading(false));
  }, [leagueId, rosterId]); // eslint-disable-line react-hooks/exhaustive-deps

  const profile = overview.profiles.find((p) => p.rosterId === rosterId);
  const sortedTeams = [...overview.profiles].sort((a, b) => a.starterRank - b.starterRank);

  return (
    <>
      <div className="dive-header">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <h1 className="dive-owner">{profile?.ownerName ?? "—"}</h1>
          <div className="team-switcher">
            <span className="dim-text" style={{ fontSize: 10, letterSpacing: 1 }}>TEAM</span>
            <select
              className="team-switcher-select"
              value={rosterId}
              onChange={(e) => navigate(`/league/${leagueId}/sendit/${e.target.value}`)}
            >
              {sortedTeams.map((t) => (
                <option key={t.rosterId} value={t.rosterId}>
                  #{t.starterRank} {t.ownerName}{t.isMine ? " ★" : ""}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {error && <div className="error-banner">{error}</div>}

      {loading && (
        <div className="trades-loading">
          <span className="dim-text">Generating trade packages...</span>
        </div>
      )}

      {trades && trades.length === 0 && (
        <p className="dim-text">No trade packages found for this team.</p>
      )}

      {trades && trades.length > 0 && (
        <div className="trade-list">
          {trades.map((pkg, i) => <TradeCard key={i} pkg={pkg} />)}
        </div>
      )}
    </>
  );
}
