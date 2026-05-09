import { useState } from "react";
import { useOutletContext, useParams } from "react-router-dom";
import { makeApiClient } from "../api/client.ts";
import type { TeamProfile, WindowLabel } from "../algo/types.ts";
import { useAuth } from "../hooks/useAuth.tsx";
import { useNavigate } from "react-router-dom";
import type { LeagueOutletContext } from "./LeagueShell.tsx";

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
    <div
      className={`team-card${profile.isMine ? " mine" : ""}`}
      onClick={() => navigate(`/league/${leagueId}/team/${profile.rosterId}`)}
      style={{ cursor: "pointer" }}
    >
      <div className="team-header">
        <div className="team-name">
          {profile.ownerName}
          {profile.isMine && <span className="mine-mark">★ YOU</span>}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div className="team-rank">rank #{profile.starterRank} · {profile.record}</div>
          <span className="window-label" style={{ background: labelColor }}>{profile.windowLabel}</span>
        </div>
      </div>

      <div className="team-meta" style={{ marginBottom: 8 }}>
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
    </div>
  );
}

function LeagueGrid({ profiles }: { profiles: TeamProfile[] }) {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
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
                    <div className="grid-label" style={{ background: LABEL_COLOR[c.label] }}>{c.label}</div>
                    {c.teams.map((t) => (
                      <div
                        key={t.rosterId}
                        className={`grid-name${t.isMine ? " mine-name" : ""}`}
                        style={{ cursor: "pointer" }}
                        onClick={() => navigate(`/league/${id}/team/${t.rosterId}`)}
                      >
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
  const { getToken } = useAuth();
  const { overview, reload } = useOutletContext<LeagueOutletContext>();

  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleRefresh() {
    if (!id) return;
    setRefreshing(true);
    setError(null);
    try {
      await makeApiClient(getToken).syncLeague(id);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Refresh failed");
    } finally {
      setRefreshing(false);
    }
  }

  const sorted = [...overview.profiles].sort((a, b) => a.starterRank - b.starterRank);

  return (
    <>
      {error && <div className="error-banner">{error}</div>}

      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 32 }}>
        <button className="btn-secondary" disabled={refreshing} onClick={handleRefresh}>
          {refreshing ? "Refreshing..." : "Refresh Data"}
        </button>
      </div>

      <section className="overview-section">
        <h2 className="section-title">League Shape</h2>
        <LeagueGrid profiles={overview.profiles} />
      </section>

      <section className="overview-section">
        <h2 className="section-title">Teams</h2>
        <div className="team-list">
          {sorted.map((p) => <TeamCard key={p.rosterId} profile={p} leagueId={id!} />)}
        </div>
      </section>
    </>
  );
}
