import { useEffect, useState } from "react";
import { useNavigate, useOutletContext, useParams } from "react-router-dom";
import { makeApiClient, type TradePackage } from "../api/client.ts";
import { useAuth } from "../hooks/useAuth.tsx";
import type { LeagueOutletContext } from "./LeagueShell.tsx";

function TradeCard({ pkg }: { pkg: TradePackage }) {
  const giveNames = pkg.give.map((p) => p.name).join(" + ");
  const receiveNames = pkg.receive.map((p) => p.name).join(" + ");
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
          <span className="trade-names">{giveNames}</span>
          <span className="trade-val">{pkg.valueGive.toLocaleString()}</span>
        </div>
        <div className="trade-arrow">⇄</div>
        <div className="trade-side trade-side-receive">
          <span className="trade-dir">GET</span>
          <span className="trade-names">{receiveNames}</span>
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
