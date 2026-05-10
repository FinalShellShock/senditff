import { useState } from "react";
import { useOutletContext, useParams, useNavigate } from "react-router-dom";
import { makeApiClient } from "../api/client.ts";
import type { TeamProfile, WindowLabel, PickFlag, Position, Pick as DraftPick } from "../algo/types.ts";
import { useAuth } from "../hooks/useAuth.tsx";
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

const POSITIONS: Position[] = ["QB", "RB", "WR", "TE"];
const FONT = "'Space Mono', monospace";

function MiniBar({ score }: { score: number }) {
  const pct = Math.max(0, Math.min(100, score));
  const color = pct >= 70 ? "#22c55e" : pct >= 50 ? "#06b6d4" : pct >= 30 ? "#eab308" : "#ef4444";
  return (
    <div className="mini-bar-track">
      <div className="mini-bar-fill" style={{ width: `${pct}%`, background: color }} />
    </div>
  );
}

function getTeamNeeds(profile: TeamProfile): { pos: Position; classification: string }[] {
  const scored = POSITIONS.map((pos) => ({
    pos,
    classification: profile.positionScores?.[pos]?.classification ?? "HEALTHY",
    urgency: profile.positionScores?.[pos]?.urgency ?? 0,
  }));
  const needs = scored
    .filter((p) => p.classification === "CRITICAL_NEED" || p.classification === "NEED")
    .sort((a, b) => b.urgency - a.urgency)
    .slice(0, 3);
  if (needs.length > 0) return needs;
  const fallback = [...scored].sort((a, b) => b.urgency - a.urgency)[0];
  return fallback ? [fallback] : [];
}

function GridTeamCard({ profile, onClick }: { profile: TeamProfile; onClick: () => void }) {
  const needs = getTeamNeeds(profile);
  return (
    <div className={`grid-team-card${profile.isMine ? " mine" : ""}`} onClick={onClick}>
      <div className="gtc-header">
        <span className="gtc-rank">#{profile.starterRank}</span>
        <span className="gtc-name">{profile.ownerName}</span>
      </div>
      <div className="gtc-needs">
        {needs.map(({ pos, classification }) => (
          <span
            key={pos}
            className={`gtc-need-tag pos-tag pos-${pos}`}
            style={{ opacity: classification === "CRITICAL_NEED" ? 1 : 0.6 }}
          >
            {pos}
          </span>
        ))}
      </div>
      <div className="gtc-age">
        <span className="gtc-age-label">age </span>
        <span className="gtc-age-val">{profile.starterCalAge.toFixed(1)}</span>
      </div>
    </div>
  );
}

function LeagueGrid({ profiles }: { profiles: TeamProfile[] }) {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();

  const grid: Record<string, TeamProfile[]> = {};
  for (const p of profiles) {
    const key = `${p.competitiveness}-${p.windowTier}`;
    (grid[key] ??= []).push(p);
  }

  const rows = ["STRONG", "AVERAGE", "WEAK"] as const;
  const cols = ["LONG", "MID", "SHORT"] as const;
  const colLabel = { LONG: "LONG WINDOW", MID: "MID WINDOW", SHORT: "SHORT WINDOW" };

  return (
    <div className="grid-scroll-wrap">
      <div className="league-grid">
        <div className="grid-header-row">
          <div className="grid-corner" />
          {cols.map((c) => <div key={c} className="grid-col-label">{colLabel[c]}</div>)}
        </div>
        {rows.map((comp) => (
          <div key={comp} className="grid-row">
            <div className="grid-row-label">{comp}</div>
            {cols.map((tier) => {
              const teams = grid[`${comp}-${tier}`] ?? [];
              return (
                <div key={tier} className={`grid-cell${!teams.length ? " empty" : ""}`}>
                  {teams.length === 0
                    ? "—"
                    : teams.map((t) => (
                        <GridTeamCard
                          key={t.rosterId}
                          profile={t}
                          onClick={() => navigate(`/league/${id}/team/${t.rosterId}`)}
                        />
                      ))}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

function QuadrantPlot({ profiles }: { profiles: TeamProfile[] }) {
  if (profiles.length === 0) return null;

  const W = 560, H = 260;
  const PAD = { left: 52, right: 16, top: 24, bottom: 36 };
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  const values = profiles.map((p) => p.starterTotalValue);
  const minV = Math.min(...values);
  const maxV = Math.max(...values);
  const vRange = maxV - minV || 1;

  const dotX = (p: TeamProfile) => PAD.left + ((p.windowPressure ?? 50) / 100) * plotW;
  const dotY = (p: TeamProfile) => PAD.top + (1 - (p.starterTotalValue - minV) / vRange) * plotH;

  const midX = PAD.left + plotW / 2;
  const midY = PAD.top + plotH / 2;

  return (
    <div className="quadrant-wrap">
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", maxWidth: W, display: "block" }}>
        {/* Quadrant fills */}
        <rect x={PAD.left} y={PAD.top} width={plotW / 2} height={plotH / 2} fill="rgba(22,163,74,0.05)" />
        <rect x={midX} y={PAD.top} width={plotW / 2} height={plotH / 2} fill="rgba(239,68,68,0.05)" />
        <rect x={PAD.left} y={midY} width={plotW / 2} height={plotH / 2} fill="rgba(59,130,246,0.05)" />
        <rect x={midX} y={midY} width={plotW / 2} height={plotH / 2} fill="rgba(220,38,38,0.04)" />

        {/* Quadrant labels */}
        <text x={PAD.left + 6} y={PAD.top + 14} fontSize={8} fontFamily={FONT} fill="rgba(22,163,74,0.4)" letterSpacing={1}>JUGGERNAUT</text>
        <text x={midX + 6} y={PAD.top + 14} fontSize={8} fontFamily={FONT} fill="rgba(239,68,68,0.4)" letterSpacing={1}>CLOSING</text>
        <text x={PAD.left + 6} y={PAD.top + plotH - 6} fontSize={8} fontFamily={FONT} fill="rgba(59,130,246,0.4)" letterSpacing={1}>REBUILD</text>
        <text x={midX + 6} y={PAD.top + plotH - 6} fontSize={8} fontFamily={FONT} fill="rgba(220,38,38,0.4)" letterSpacing={1}>STUCK</text>

        {/* Axes */}
        <line x1={PAD.left} y1={PAD.top + plotH} x2={PAD.left + plotW} y2={PAD.top + plotH} stroke="rgba(255,255,255,0.1)" />
        <line x1={PAD.left} y1={PAD.top} x2={PAD.left} y2={PAD.top + plotH} stroke="rgba(255,255,255,0.1)" />
        <line x1={midX} y1={PAD.top} x2={midX} y2={PAD.top + plotH} stroke="rgba(255,255,255,0.05)" strokeDasharray="3 3" />
        <line x1={PAD.left} y1={midY} x2={PAD.left + plotW} y2={midY} stroke="rgba(255,255,255,0.05)" strokeDasharray="3 3" />

        {/* Axis labels */}
        <text x={PAD.left} y={H - 4} fontSize={8} fontFamily={FONT} fill="#334155" letterSpacing={1}>← LONG WINDOW</text>
        <text x={PAD.left + plotW} y={H - 4} fontSize={8} fontFamily={FONT} fill="#334155" letterSpacing={1} textAnchor="end">SHORT WINDOW →</text>
        <text x={PAD.left - 6} y={PAD.top + 4} fontSize={8} fontFamily={FONT} fill="#334155" letterSpacing={1} textAnchor="end">STRONG</text>
        <text x={PAD.left - 6} y={PAD.top + plotH} fontSize={8} fontFamily={FONT} fill="#334155" letterSpacing={1} textAnchor="end">WEAK</text>

        {/* Team dots */}
        {profiles.map((p) => {
          const x = dotX(p);
          const y = dotY(p);
          const color = LABEL_COLOR[p.windowLabel];
          const label = p.ownerName.split(" ")[0] ?? p.ownerName;
          return (
            <g key={p.rosterId}>
              {p.isMine && <circle cx={x} cy={y} r={10} fill="none" stroke={color} strokeWidth={1.5} opacity={0.5} />}
              <circle cx={x} cy={y} r={p.isMine ? 6 : 5} fill={color} opacity={0.9} />
              <text
                x={x} y={y - 10}
                textAnchor="middle"
                fontSize={8}
                fontFamily={FONT}
                fill="#94a3b8"
                style={{ pointerEvents: "none", userSelect: "none" }}
              >
                {label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function PicksDots({ picks, flag }: { picks: DraftPick[]; flag: PickFlag }) {
  const years = [...new Set(picks.map((p) => p.year))].sort().slice(0, 3);
  const flagColor = flag === "PICK_RICH" ? "#22c55e" : flag === "PICK_POOR" ? "#ef4444" : "#475569";
  return (
    <div className="picks-visual">
      <span className="picks-flag" style={{ color: flagColor }}>
        {flag === "PICK_RICH" ? "RICH" : flag === "PICK_POOR" ? "POOR" : "NEU"}
      </span>
      <div className="picks-years">
        {years.length === 0 && <span className="picks-none">none</span>}
        {years.map((year) => {
          const yp = picks.filter((p) => p.year === year).sort((a, b) => a.round - b.round);
          return (
            <div key={year} className="picks-year-row">
              <span className="picks-year-label">'{String(year).slice(2)}</span>
              <div className="picks-dots">
                {yp.map((pick, i) => (
                  <div
                    key={i}
                    className={`pick-dot pick-dot-r${Math.min(pick.round, 3)}`}
                    title={pick.label}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function LeagueTableRow({ profile, leagueId }: { profile: TeamProfile; leagueId: string }) {
  const navigate = useNavigate();
  const labelColor = LABEL_COLOR[profile.windowLabel];
  return (
    <div
      className={`lt-row${profile.isMine ? " mine" : ""}`}
      onClick={() => navigate(`/league/${leagueId}/team/${profile.rosterId}`)}
    >
      <div className={`lt-col-sticky lt-row-sticky${profile.isMine ? " mine-bg" : ""}`}>
        <span className="lt-rank">#{profile.starterRank}</span>
        <div className="lt-owner">
          <span className="lt-name">
            {profile.ownerName}
            {profile.isMine && <span className="mine-mark"> ★</span>}
          </span>
          <div style={{ display: "flex", gap: 5, alignItems: "center", marginTop: 2, flexWrap: "wrap" }}>
            <span className="window-label" style={{ background: labelColor, fontSize: 9, padding: "1px 5px" }}>
              {profile.windowLabel}
            </span>
            <span style={{ fontSize: 10, color: "#475569" }}>{profile.record}</span>
            <span style={{ fontSize: 10, color: "#475569" }}>age {profile.starterCalAge.toFixed(1)}</span>
          </div>
        </div>
      </div>
      {POSITIONS.map((pos) => {
        const ps = profile.positionScores?.[pos];
        return (
          <div key={pos} className="lt-col-pos lt-pos-cell">
            <div className="lt-pos-bar-row">
              <MiniBar score={ps?.starterScore ?? 0} />
              <span className="lt-pos-score">{(ps?.starterScore ?? 0).toFixed(0)}</span>
            </div>
            <div className="lt-pos-bar-row">
              <MiniBar score={ps?.depthScore ?? 0} />
              <span className="lt-pos-score">{(ps?.depthScore ?? 0).toFixed(0)}</span>
            </div>
            <span className="lt-pos-class" style={{ color: POS_CLASS_COLOR[ps?.classification ?? "HEALTHY"] }}>
              {(ps?.classification ?? "—").replace("_", " ")}
            </span>
          </div>
        );
      })}
      <div className="lt-col-picks">
        <PicksDots picks={profile.picks ?? []} flag={profile.pickCapital?.flag ?? "NEUTRAL"} />
      </div>
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
  const needsResync = overview.profiles.some((p) => !p.positionScores || !p.pickCapital);

  return (
    <>
      {error && <div className="error-banner">{error}</div>}

      <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 12, marginBottom: 32 }}>
        {needsResync && (
          <span className="dim-text" style={{ fontSize: 12 }}>League data is outdated — refresh to see full analysis</span>
        )}
        <button className="btn-secondary" disabled={refreshing} onClick={handleRefresh}>
          {refreshing ? "Refreshing..." : "Refresh Data"}
        </button>
      </div>

      <section className="overview-section">
        <h2 className="section-title">League Shape</h2>
        <QuadrantPlot profiles={overview.profiles} />
        <LeagueGrid profiles={overview.profiles} />
      </section>

      <section className="overview-section">
        <h2 className="section-title">Teams</h2>
        <div className="table-scroll-wrapper">
          <div className="league-table">
            <div className="lt-header">
              <div className="lt-col-sticky lt-header-sticky">
                <span className="lt-header-label"># TEAM</span>
              </div>
              {POSITIONS.map((pos) => (
                <div key={pos} className="lt-col-pos lt-pos-header-cell">
                  <span className="lt-header-label">{pos}</span>
                  <div className="lt-pos-sub-labels">
                    <span>STR</span>
                    <span>DEP</span>
                  </div>
                </div>
              ))}
              <div className="lt-col-picks">
                <span className="lt-header-label">PICKS</span>
              </div>
            </div>
            {sorted.map((p) => (
              <LeagueTableRow key={p.rosterId} profile={p} leagueId={id!} />
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
