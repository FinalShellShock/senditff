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

function MiniBar({ score }: { score: number }) {
  const pct = Math.max(0, Math.min(100, score));
  const color = pct >= 70 ? "#22c55e" : pct >= 50 ? "#06b6d4" : pct >= 30 ? "#eab308" : "#ef4444";
  return (
    <div className="mini-bar-track">
      <div className="mini-bar-fill" style={{ width: `${pct}%`, background: color }} />
    </div>
  );
}

function NeedsBoard({ profiles, leagueId }: { profiles: TeamProfile[]; leagueId: string }) {
  const navigate = useNavigate();
  const rows = POSITIONS.map((pos) => {
    const criticals = profiles
      .filter((p) => p.positionScores[pos].classification === "CRITICAL_NEED")
      .sort((a, b) => b.positionScores[pos].urgency - a.positionScores[pos].urgency);
    const needs = profiles
      .filter((p) => p.positionScores[pos].classification === "NEED")
      .sort((a, b) => b.positionScores[pos].urgency - a.positionScores[pos].urgency);
    const surpluses = profiles
      .filter((p) => p.positionScores[pos].classification === "SURPLUS")
      .sort((a, b) => a.positionScores[pos].urgency - b.positionScores[pos].urgency);
    return { pos, criticals, needs, surpluses };
  });

  return (
    <div className="needs-board">
      {rows.map(({ pos, criticals, needs, surpluses }) => (
        <div key={pos} className="needs-board-row">
          <span className={`pos-tag pos-${pos}`} style={{ flexShrink: 0 }}>{pos}</span>
          <div className="needs-board-cell needs-board-needs">
            {criticals.map((p) => (
              <span
                key={p.rosterId}
                className="needs-board-name needs-board-critical"
                onClick={() => navigate(`/league/${leagueId}/team/${p.rosterId}`)}
              >
                {p.ownerName}
              </span>
            ))}
            {needs.map((p) => (
              <span
                key={p.rosterId}
                className="needs-board-name needs-board-need"
                onClick={() => navigate(`/league/${leagueId}/team/${p.rosterId}`)}
              >
                {p.ownerName}
              </span>
            ))}
            {criticals.length === 0 && needs.length === 0 && (
              <span className="needs-board-empty">—</span>
            )}
          </div>
          <div className="needs-board-cell needs-board-surplus">
            {surpluses.map((p) => (
              <span
                key={p.rosterId}
                className="needs-board-name needs-board-surp"
                onClick={() => navigate(`/league/${leagueId}/team/${p.rosterId}`)}
              >
                {p.ownerName}
              </span>
            ))}
            {surpluses.length === 0 && (
              <span className="needs-board-empty">—</span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function LeagueTableRow({ profile, leagueId }: { profile: TeamProfile; leagueId: string }) {
  const navigate = useNavigate();
  const labelColor = LABEL_COLOR[profile.windowLabel];
  const pickColor = profile.pickCapital.flag === "PICK_RICH" ? "#22c55e"
    : profile.pickCapital.flag === "PICK_POOR" ? "#ef4444"
    : "#94a3b8";
  return (
    <div
      className={`lt-row${profile.isMine ? " mine" : ""}`}
      onClick={() => navigate(`/league/${leagueId}/team/${profile.rosterId}`)}
    >
      <span className="lt-rank">#{profile.starterRank}</span>
      <div className="lt-owner">
        <span className="lt-name">
          {profile.ownerName}
          {profile.isMine && <span className="mine-mark"> ★</span>}
        </span>
        <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 2 }}>
          <span className="window-label" style={{ background: labelColor, fontSize: 9, padding: "1px 6px" }}>{profile.windowLabel}</span>
          <span style={{ fontSize: 10, color: "#475569" }}>{profile.record}</span>
          <span style={{ fontSize: 10, color: "#475569" }}>age {profile.starterCalAge.toFixed(1)}</span>
        </div>
      </div>
      {POSITIONS.map((pos) => {
        const ps = profile.positionScores[pos];
        return (
          <div key={pos} className="lt-pos-cell">
            <div className="lt-pos-bar-row">
              <span className="lt-pos-label">str</span>
              <MiniBar score={ps.starterScore} />
              <span className="lt-pos-score">{ps.starterScore.toFixed(0)}</span>
            </div>
            <div className="lt-pos-bar-row">
              <span className="lt-pos-label">dep</span>
              <MiniBar score={ps.depthScore} />
              <span className="lt-pos-score">{ps.depthScore.toFixed(0)}</span>
            </div>
            <span className="lt-pos-class" style={{ color: POS_CLASS_COLOR[ps.classification] }}>
              {ps.classification.replace("_", " ")}
            </span>
          </div>
        );
      })}
      <div className="lt-picks">
        <span style={{ color: pickColor, fontWeight: 700, fontSize: 10 }}>
          {profile.pickCapital.flag === "PICK_RICH" ? "RICH" : profile.pickCapital.flag === "PICK_POOR" ? "POOR" : "NEU"}
        </span>
        <span style={{ fontSize: 10, color: "#475569", display: "block" }}>· {profile.pickCapital.score.toFixed(0)}</span>
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
        <h2 className="section-title">Positional Needs</h2>
        <div className="needs-board-header">
          <div />
          <div className="needs-board-col-label">NEEDS</div>
          <div className="needs-board-col-label">SURPLUS</div>
        </div>
        <NeedsBoard profiles={overview.profiles} leagueId={id!} />
      </section>

      <section className="overview-section">
        <h2 className="section-title">Teams</h2>
        <div className="league-table">
          <div className="lt-header">
            <div />
            <div className="lt-header-label">TEAM</div>
            <div className="lt-header-label lt-pos-header">QB</div>
            <div className="lt-header-label lt-pos-header">RB</div>
            <div className="lt-header-label lt-pos-header">WR</div>
            <div className="lt-header-label lt-pos-header">TE</div>
            <div className="lt-header-label">PICKS</div>
          </div>
          {sorted.map((p) => <LeagueTableRow key={p.rosterId} profile={p} leagueId={id!} />)}
        </div>
      </section>
    </>
  );
}
