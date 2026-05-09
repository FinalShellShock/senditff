import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { makeApiClient, type OverviewResponse, type TradePackage } from "../api/client.ts";
import type { Player, Pick as DraftPick, TeamProfile, WindowLabel } from "../algo/types.ts";
import { useAuth } from "../hooks/useAuth.tsx";

const LABEL_COLOR: Record<WindowLabel, string> = {
  JUGGERNAUT: "#16a34a",
  CONTEND:    "#22c55e",
  CLOSING:    "#ef4444",
  RISING:     "#06b6d4",
  AVERAGE:    "#94a3b8",
  MIDDLING:   "#eab308",
  REBUILD:    "#3b82f6",
  TRANSITION: "#a855f7",
  STUCK:      "#dc2626",
};

const POS_CLASS_COLOR: Record<string, string> = {
  CRITICAL_NEED: "#ef4444",
  NEED:          "#eab308",
  HEALTHY:       "#22c55e",
  SURPLUS:       "#06b6d4",
};

const ARCHETYPE_LABELS: Record<string, string> = {
  tier_down_QB:      "Trade elite QB for two mid-tier QBs",
  tier_down_RB:      "Trade elite RB for two mid-tier RBs",
  tier_down_WR:      "Trade elite WR for two mid-tier WRs",
  tier_down_TE:      "Trade elite TE for two mid-tier TEs",
  consolidate:       "Consolidate depth into a starter",
  consolidate_flex:  "Convert flex depth into a starter",
  age_arb_buy:       "Buy young players before their breakout",
  age_arb_sell:      "Sell aging veterans at peak value",
  push_in:           "Aggressive push into contention",
  need_fill_stacked: "Fill a critical positional need",
  need_fill_balanced:"Fill positional needs across the board",
  capital_convert:   "Convert pick capital into players",
};

const POSITIONS = ["QB", "RB", "WR", "TE"] as const;

function posColor(pos: string) {
  const map: Record<string, string> = { QB: "#f97316", RB: "#22c55e", WR: "#3b82f6", TE: "#a855f7" };
  return map[pos] ?? "#94a3b8";
}

function valueBar(value: number, max = 10000) {
  const pct = Math.min(100, (value / max) * 100);
  const color = pct >= 70 ? "#22c55e" : pct >= 40 ? "#06b6d4" : pct >= 20 ? "#eab308" : "#ef4444";
  return { pct, color };
}

function PlayerRow({ player, rank }: { player: Player; rank: number }) {
  const bar = valueBar(player.valueDynasty);
  return (
    <div className="dive-player-row">
      <span className="dive-player-rank">{rank}</span>
      <span className="dive-player-name">{player.name}</span>
      {player.age != null && <span className="dive-player-age">{player.age}</span>}
      <div className="dive-bar-wrap">
        <div className="bar-track">
          <div className="bar-fill" style={{ width: `${bar.pct}%`, background: bar.color }} />
        </div>
      </div>
      <span className="dive-player-value">{player.valueDynasty.toLocaleString()}</span>
    </div>
  );
}

function PickRow({ pick }: { pick: DraftPick }) {
  return (
    <div className="dive-pick-row">
      <span className="dive-pick-label">{pick.label}</span>
      <span className="dive-pick-value">{pick.value.toLocaleString()}</span>
    </div>
  );
}

function TradeCard({ pkg }: { pkg: TradePackage }) {
  const giveNames = pkg.give.map((p) => p.name).join(" + ");
  const receiveNames = pkg.receive.map((p) => p.name).join(" + ");
  const delta = pkg.valueReceive - pkg.valueGive;
  const deltaColor = delta > 200 ? "#22c55e" : delta < -200 ? "#ef4444" : "#94a3b8";
  const archetypeLabel = pkg.archetype.replace(/_/g, " ");

  return (
    <div className="trade-card">
      <div className="trade-card-header">
        <span className="trade-arch-tag">{archetypeLabel}</span>
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
      {pkg.rationale && (
        <p className="trade-rationale">{pkg.rationale}</p>
      )}
    </div>
  );
}

export default function TeamDeepDive() {
  const { id: leagueId, rosterId: rosterIdStr } = useParams<{ id: string; rosterId: string }>();
  const rosterId = Number(rosterIdStr);
  const navigate = useNavigate();
  const { getToken } = useAuth();
  const api = makeApiClient(getToken);

  const [data, setData] = useState<OverviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [trades, setTrades] = useState<TradePackage[] | null>(null);
  const [tradesLoading, setTradesLoading] = useState(false);
  const [tradesError, setTradesError] = useState<string | null>(null);

  useEffect(() => {
    if (!leagueId) return;
    api.getOverview(leagueId)
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leagueId]);

  async function handleFindTrades() {
    if (!leagueId) return;
    setTradesLoading(true);
    setTradesError(null);
    try {
      const result = await api.findTrades(leagueId, rosterId);
      setTrades(result.packages);
    } catch (e) {
      setTradesError(e instanceof Error ? e.message : "Failed to find trades");
    } finally {
      setTradesLoading(false);
    }
  }

  const profile: TeamProfile | undefined = data?.profiles.find((p) => p.rosterId === rosterId);

  const playersByPos = (pos: string): Player[] =>
    (profile?.players ?? [])
      .filter((p) => p.position === pos)
      .sort((a, b) => b.valueDynasty - a.valueDynasty);

  const sortedPicks = [...(profile?.picks ?? [])].sort((a, b) => {
    if (a.year !== b.year) return a.year - b.year;
    if (a.round !== b.round) return a.round - b.round;
    return a.slot - b.slot;
  });

  const labelColor = profile ? LABEL_COLOR[profile.windowLabel] : "#94a3b8";

  return (
    <div className="shell">
      <div className="status-bar">
        <div className="status-left">
          <button className="btn-link" onClick={() => navigate(`/league/${leagueId}`)}>
            ← League
          </button>
          {data && <span className="status-brand">{data.name}</span>}
        </div>
        <div className="status-right">
          {profile && (
            <span className="dim-text">
              {data?.format.superflex ? "SF" : "1QB"} ·{" "}
              {data?.format.scoring.toUpperCase()}
              {data?.format.tep ? " · TEP" : ""}
            </span>
          )}
        </div>
      </div>

      <div className="app-content">
        {error && <div className="error-banner">{error}</div>}

        {loading ? (
          <p className="dim-text" style={{ marginTop: 48, textAlign: "center" }}>Loading team...</p>
        ) : !profile ? (
          <p className="dim-text" style={{ marginTop: 48, textAlign: "center" }}>Team not found.</p>
        ) : (
          <>
            {/* Team header */}
            <div className="dive-header">
              <div className="dive-title-row">
                <h1 className="dive-owner">
                  {profile.ownerName}
                  {profile.isMine && <span className="mine-mark">★ YOU</span>}
                </h1>
                <span className="window-label" style={{ background: labelColor }}>
                  {profile.windowLabel}
                </span>
              </div>
              <div className="team-meta" style={{ marginTop: 8 }}>
                <span className="meta-pill">{profile.competitiveness} / {profile.windowTier}</span>
                <span className="meta-pill">rank <strong>#{profile.starterRank}</strong></span>
                <span className="meta-pill">age <strong>{profile.starterCalAge.toFixed(1)}</strong></span>
                <span className="meta-pill">
                  picks{" "}
                  <strong style={{
                    color: profile.pickCapital.flag === "PICK_RICH" ? "#22c55e"
                         : profile.pickCapital.flag === "PICK_POOR" ? "#ef4444"
                         : "#94a3b8",
                  }}>
                    {profile.pickCapital.flag}
                  </strong>
                </span>
                <span className="meta-pill">{profile.record}</span>
              </div>
            </div>

            {/* Position sections */}
            {POSITIONS.map((pos) => {
              const players = playersByPos(pos);
              const ps = profile.positionScores[pos];
              if (players.length === 0) return null;
              return (
                <section key={pos} className="dive-pos-section">
                  <div className="dive-pos-header">
                    <span className="pos-tag" style={{ background: posColor(pos), color: "#fff", padding: "2px 8px", borderRadius: 3, fontSize: 10, fontWeight: 700, letterSpacing: 1 }}>
                      {pos}
                    </span>
                    <span className="pos-class" style={{ color: POS_CLASS_COLOR[ps.classification], fontSize: 11, fontWeight: 700 }}>
                      {ps.classification.replace("_", " ")}
                    </span>
                    <div className="dive-pos-bars">
                      <span className="bar-label">str {ps.starterScore.toFixed(0)}</span>
                      <span className="bar-label" style={{ marginLeft: 8 }}>dep {ps.depthScore.toFixed(0)}</span>
                    </div>
                  </div>
                  <div className="dive-player-list">
                    {players.map((p, i) => <PlayerRow key={p.id} player={p} rank={i + 1} />)}
                  </div>
                </section>
              );
            })}

            {/* Picks */}
            {sortedPicks.length > 0 && (
              <section className="dive-pos-section">
                <div className="dive-pos-header">
                  <span style={{ fontSize: 11, fontWeight: 700, color: "#f59e0b", letterSpacing: 2 }}>PICKS</span>
                  <span className="meta-pill" style={{ fontSize: 10 }}>
                    total{" "}
                    <strong>{sortedPicks.reduce((s, p) => s + p.value, 0).toLocaleString()}</strong>
                  </span>
                </div>
                <div className="dive-pick-list">
                  {sortedPicks.map((pick) => (
                    <PickRow key={`${pick.year}-${pick.round}-${pick.origRosterId}`} pick={pick} />
                  ))}
                </div>
              </section>
            )}

            {/* Archetypes */}
            {profile.archetypes.length > 0 && (
              <section className="dive-pos-section">
                <h2 className="section-title">SCOUTING REPORT</h2>
                <div className="dive-archetypes">
                  {profile.archetypes.map((a) => (
                    <div key={a} className="dive-arch-row">
                      <span className="arch-tag">{a.replace(/_/g, " ")}</span>
                      <span className="dive-arch-desc">
                        {ARCHETYPE_LABELS[a] ?? a.replace(/_/g, " ")}
                      </span>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Trade recommendations */}
            <section className="dive-pos-section">
              <h2 className="section-title">TRADE TARGETS</h2>
              {!trades && !tradesLoading && (
                <button className="btn-primary" onClick={handleFindTrades}>
                  Find Trades
                </button>
              )}
              {tradesLoading && (
                <p className="dim-text">Finding trades...</p>
              )}
              {tradesError && <div className="error-banner">{tradesError}</div>}
              {trades && trades.length === 0 && (
                <p className="dim-text">No trade packages found.</p>
              )}
              {trades && trades.length > 0 && (
                <div className="trade-list">
                  {trades.map((pkg, i) => (
                    <TradeCard key={i} pkg={pkg} />
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
}
