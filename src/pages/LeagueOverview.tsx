import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { makeApiClient, type OverviewResponse } from "../api/client.ts";
import type { TeamProfile, WindowLabel } from "../algo/types.ts";
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

const POSITIONS = ["QB", "RB", "WR", "TE"] as const;

function ScoreBar({ score }: { score: number }) {
  const pct = Math.max(0, Math.min(100, score));
  const color = pct >= 70 ? "#22c55e" : pct >= 50 ? "#06b6d4" : pct >= 30 ? "#eab308" : "#ef4444";
  return (
    <div className="bar-track">
      <div className="bar-fill" style={{ width: `${pct}%`, background: color }} />
    </div>
  );
}

function TeamCard({ profile, leagueId }: { profile: TeamProfile; leagueId: string }) {
  const navigate = useNavigate();
  const labelColor = LABEL_COLOR[profile.windowLabel];
  return (
    <div className={`team-card${profile.isMine ? " mine" : ""}`}>
      <div className="team-header">
        <div className="team-name">
          {profile.ownerName}
          {profile.isMine && <span className="mine-mark">★ YOU</span>}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div className="team-rank">rank #{profile.starterRank} · {profile.record}</div>
          <button
            className="btn-secondary"
            style={{ padding: "4px 10px", fontSize: 11 }}
            onClick={() => navigate(`/league/${leagueId}/team/${profile.rosterId}`)}
          >
            View
          </button>
        </div>
      </div>

      <div className="team-meta">
        <span className="window-label" style={{ background: labelColor }}>
          {profile.windowLabel}
        </span>
        <span className="meta-pill">{profile.competitiveness} / {profile.windowTier}</span>
        <span className="meta-pill">age <strong>{profile.starterCalAge.toFixed(1)}</strong></span>
        <span className="meta-pill">
          picks <strong style={{ color: profile.pickCapital.flag === "PICK_RICH" ? "#22c55e" : profile.pickCapital.flag === "PICK_POOR" ? "#ef4444" : "#94a3b8" }}>
            {profile.pickCapital.flag}
          </strong>
        </span>
      </div>

      <div className="pos-grid">
        {POSITIONS.map((pos) => {
          const ps = profile.positionScores[pos];
          return (
            <div key={pos} className="pos-row">
              <span className={`pos-tag pos-${pos}`}>{pos}</span>
              <div className="bar-group">
                <span className="bar-label">str</span>
                <ScoreBar score={ps.starterScore} />
                <span className="bar-num">{ps.starterScore.toFixed(0)}</span>
              </div>
              <div className="bar-group">
                <span className="bar-label">dep</span>
                <ScoreBar score={ps.depthScore} />
                <span className="bar-num">{ps.depthScore.toFixed(0)}</span>
              </div>
              <span className="pos-class" style={{ color: POS_CLASS_COLOR[ps.classification] }}>
                {ps.classification.replace("_", " ")}
              </span>
            </div>
          );
        })}
      </div>

      {profile.archetypes.length > 0 && (
        <div className="archetypes">
          {profile.archetypes.map((a) => (
            <span key={a} className="arch-tag">{a.replace(/_/g, " ")}</span>
          ))}
        </div>
      )}
    </div>
  );
}

function LeagueGrid({ profiles }: { profiles: TeamProfile[] }) {
  type Cell = { label: WindowLabel; teams: TeamProfile[] } | null;
  const grid: Record<string, TeamProfile[]> = {};
  for (const p of profiles) {
    const key = `${p.competitiveness}-${p.windowTier}`;
    (grid[key] ??= []).push(p);
  }
  const cell = (comp: string, tier: string): Cell => {
    const teams = grid[`${comp}-${tier}`];
    if (!teams?.length) return null;
    return { label: teams[0]!.windowLabel, teams };
  };

  const rows = ["STRONG", "AVERAGE", "WEAK"] as const;
  const cols = ["LONG", "MID", "SHORT"] as const;

  return (
    <div className="league-grid">
      <div className="grid-header-row">
        <div className="grid-corner" />
        {cols.map((c) => <div key={c} className="grid-col-label">{c}</div>)}
      </div>
      {rows.map((comp) => (
        <div key={comp} className="grid-row">
          <div className="grid-row-label">{comp}</div>
          {cols.map((tier) => {
            const c = cell(comp, tier);
            return (
              <div key={tier} className={`grid-cell${!c ? " empty" : ""}`}>
                {c ? (
                  <>
                    <div className="grid-label" style={{ background: LABEL_COLOR[c.label] }}>
                      {c.label}
                    </div>
                    {c.teams.map((t) => (
                      <div key={t.rosterId} className={`grid-name${t.isMine ? " mine-name" : ""}`}>
                        {t.ownerName}
                      </div>
                    ))}
                  </>
                ) : "—"}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

export default function LeagueOverview() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { getToken } = useAuth();
  const api = makeApiClient(getToken);

  const [data, setData] = useState<OverviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    if (!id) return;
    api.getOverview(id)
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function handleRefresh() {
    if (!id) return;
    setRefreshing(true);
    setError(null);
    try {
      const result = await makeApiClient(getToken).syncLeague(id);
      setData((prev) => prev ? { ...prev, profiles: result.profiles, lastRefreshed: new Date().toISOString() } : prev);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Refresh failed");
    } finally {
      setRefreshing(false);
    }
  }

  const sorted = data
    ? [...data.profiles].sort((a, b) => a.starterRank - b.starterRank)
    : [];

  const formatStr = data
    ? `${data.format.superflex ? "SF" : "1QB"} · ${data.format.scoring.toUpperCase()}${data.format.tep ? " · TEP" : ""}`
    : "";

  return (
    <div className="shell">
      <div className="status-bar">
        <div className="status-left">
          <button className="btn-link" onClick={() => navigate("/")}>← Leagues</button>
          {data && <span className="status-brand">{data.name}</span>}
        </div>
        <div className="status-right">
          {formatStr && <span className="dim-text">{formatStr}</span>}
          <button className="btn-secondary" disabled={refreshing} onClick={handleRefresh}>
            {refreshing ? "Refreshing..." : "Refresh"}
          </button>
        </div>
      </div>

      <div className="app-content">
        {error && <div className="error-banner">{error}</div>}

        {loading ? (
          <p className="dim-text" style={{ marginTop: 48, textAlign: "center" }}>Loading league...</p>
        ) : !data ? null : (
          <>
            <section className="overview-section">
              <h2 className="section-title">League Shape</h2>
              <LeagueGrid profiles={data.profiles} />
            </section>

            <section className="overview-section">
              <h2 className="section-title">Teams</h2>
              <div className="team-list">
                {sorted.map((p) => <TeamCard key={p.rosterId} profile={p} leagueId={id!} />)}
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  );
}
