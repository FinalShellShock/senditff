import { useState } from "react";
import { useOutletContext, useParams, useNavigate } from "react-router-dom";
import { makeApiClient } from "../api/client.ts";
import type { TeamProfile, WindowLabel, PickFlag, Position, Pick as DraftPick, SubClassification } from "../algo/types.ts";
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
  CRITICAL:      "#ef4444",
  NEED:          "#eab308",
  HEALTHY:       "#22c55e",
  SURPLUS:       "#06b6d4",
};

const POSITIONS: Position[] = ["QB", "RB", "WR", "TE"];

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
  const needsText = needs.map(n => n.pos).join(" · ");
  return (
    <div className={`grid-team-card${profile.isMine ? " mine" : ""}`} onClick={onClick}>
      <div className="gtc-header">
        <span className="gtc-rank">#{profile.starterRank}</span>
        <span className="gtc-name">{profile.ownerName}</span>
      </div>
      {needs.length > 0 && (
        <div className="gtc-needs">
          <span className="gtc-needs-label">NEEDS</span>
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
      )}
      <div className="gtc-age">
        <span className="gtc-age-label">age </span>
        <span className="gtc-age-val">{(profile.starterCalAge ?? 0).toFixed(1)}</span>
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
                <div key={tier} className={`grid-cell${!teams.length ? " empty" : ""}`} data-comp={comp}>
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
                  <div key={i} className={`pick-dot pick-dot-r${Math.min(pick.round, 3)}`} title={pick.label} />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Classification → small indicator glyph rendered next to the score.
// Shape + color together communicate severity; redundant on purpose so
// colorblind users can still parse it.
function ClassIndicator({ kind }: { kind?: SubClassification }) {
  const k = kind ?? "HEALTHY";
  const glyph = k === "CRITICAL" ? "×" : k === "NEED" ? "▲" : k === "SURPLUS" ? "◆" : "●";
  return (
    <span className="lt-class-glyph" style={{ color: POS_CLASS_COLOR[k] }}>
      {glyph}
    </span>
  );
}

// Combined per-position classification label shown in the collapsed view.
// "OK" if both starter + depth are HEALTHY/SURPLUS, otherwise the worse-side
// label (NEED / CRITICAL).
function combinedLabel(s?: SubClassification, d?: SubClassification): string {
  if (s === "CRITICAL" || d === "CRITICAL") return "CRITICAL";
  if (s === "NEED" || d === "NEED") return "NEED";
  return "OK";
}
function combinedColor(s?: SubClassification, d?: SubClassification): string {
  if (s === "CRITICAL" || d === "CRITICAL") return POS_CLASS_COLOR.CRITICAL ?? "#ef4444";
  if (s === "NEED" || d === "NEED") return POS_CLASS_COLOR.NEED ?? "#eab308";
  return POS_CLASS_COLOR.HEALTHY ?? "#22c55e";
}

// Compact collapsed row — Option C style. Three rows of per-position data
// (starter number+glyph, depth number+glyph, combined classification text)
// stacked vertically, with the team info column on the left. No bars in
// the collapsed view; bars live in the expanded detail panel only.
function LeagueTableRow({
  profile,
  leagueId,
  expanded,
  onToggle,
}: {
  profile: TeamProfile;
  leagueId: string;
  expanded: boolean;
  onToggle: () => void;
}) {
  const navigate = useNavigate();
  const labelColor = LABEL_COLOR[profile.windowLabel] ?? "#94a3b8";

  return (
    <div className={`lt-row${profile.isMine ? " mine" : ""}${expanded ? " expanded" : ""}`}>
      <div className="lt-row-main" onClick={onToggle}>
        <div className={`lt-col-sticky lt-row-sticky${profile.isMine ? " mine-bg" : ""}`}>
          <div className="lt-row-stack">
            <div className="lt-row-header">
              <span className="lt-rank">#{profile.starterRank}</span>
              <span className="lt-name">
                {profile.ownerName}
                {profile.isMine && <span className="mine-mark"> ★</span>}
              </span>
            </div>
            <div className="lt-row-meta">
              <span className="window-label" style={{ background: labelColor }}>
                {profile.windowLabel ?? "—"}
              </span>
              <span className="lt-row-meta-dim">{profile.record}</span>
              <span className="lt-row-meta-dim">age {(profile.starterCalAge ?? 0).toFixed(1)}</span>
            </div>
            <div className="lt-row-expand-hint">
              {expanded ? "click to collapse" : "click for more"}
            </div>
          </div>
        </div>
        {POSITIONS.map((pos) => {
          const ps = profile.positionScores?.[pos];
          const sClass = ps?.starterClassification ?? "HEALTHY";
          const dClass = ps?.depthClassification ?? "HEALTHY";
          return (
            <div key={pos} className="lt-col-pos lt-pos-cell-compact">
              <div className="lt-cell-line">
                <span className="lt-cell-score">{(ps?.starterScore ?? 0).toFixed(0)}</span>
                <ClassIndicator kind={sClass} />
              </div>
              <div className="lt-cell-line">
                <span className="lt-cell-score">{(ps?.depthScore ?? 0).toFixed(0)}</span>
                <ClassIndicator kind={dClass} />
              </div>
              <div className="lt-cell-line lt-cell-class-line">
                <span className="lt-cell-class" style={{ color: combinedColor(sClass, dClass) }}>
                  {combinedLabel(sClass, dClass)}
                </span>
              </div>
            </div>
          );
        })}
        <div className="lt-col-picks">
          <PicksDots picks={profile.picks ?? []} flag={profile.pickCapital?.flag ?? "NEUTRAL"} />
        </div>
      </div>

      {expanded && (
        <div className="lt-row-detail">
          <div className="lt-row-detail-header">
            <span>Per-position breakdown</span>
            <button
              className="btn-link"
              onClick={(e) => {
                e.stopPropagation();
                navigate(`/league/${leagueId}/team/${profile.rosterId}`);
              }}
            >
              Open full deep dive →
            </button>
          </div>
          <div className="lt-detail-grid">
            {POSITIONS.map((pos) => {
              const ps = profile.positionScores?.[pos];
              const sClass = ps?.starterClassification ?? "HEALTHY";
              const dClass = ps?.depthClassification ?? "HEALTHY";
              return (
                <div key={pos} className="lt-detail-pos">
                  <div className="lt-detail-pos-name">{pos}</div>
                  <div className="lt-detail-side">
                    <span className="lt-detail-side-label">STARTERS</span>
                    <MiniBar score={ps?.starterScore ?? 0} />
                    <span className="lt-detail-side-score">{(ps?.starterScore ?? 0).toFixed(0)}</span>
                    <span className="lt-detail-side-class" style={{ color: POS_CLASS_COLOR[sClass] }}>
                      {sClass}
                    </span>
                  </div>
                  <div className="lt-detail-side">
                    <span className="lt-detail-side-label">DEPTH</span>
                    <MiniBar score={ps?.depthScore ?? 0} />
                    <span className="lt-detail-side-score">{(ps?.depthScore ?? 0).toFixed(0)}</span>
                    <span className="lt-detail-side-class" style={{ color: POS_CLASS_COLOR[dClass] }}>
                      {dClass}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export default function LeagueOverview() {
  const { id } = useParams<{ id: string }>();
  const { getToken } = useAuth();
  const { overview, reload } = useOutletContext<LeagueOutletContext>();
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedRoster, setExpandedRoster] = useState<number | null>(null);

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

      <div className="table-scroll-wrapper">
        <section className="overview-section">
          <h2 className="section-title">League Shape</h2>
          <LeagueGrid profiles={overview.profiles} />
        </section>

        <section className="overview-section">
          <h2 className="section-title">Teams</h2>
          <div className="league-table">
            <div className="lt-header">
              <div className="lt-col-sticky lt-header-sticky">
                <span className="lt-header-label"># TEAM</span>
              </div>
              {POSITIONS.map((pos) => (
                <div key={pos} className="lt-col-pos lt-pos-header-cell">
                  <span className="lt-header-label">{pos}</span>
                </div>
              ))}
              <div className="lt-col-picks">
                <span className="lt-header-label">PICKS</span>
              </div>
            </div>
            {sorted.map((p) => (
              <LeagueTableRow
                key={p.rosterId}
                profile={p}
                leagueId={id!}
                expanded={expandedRoster === p.rosterId}
                onToggle={() => setExpandedRoster(expandedRoster === p.rosterId ? null : p.rosterId)}
              />
            ))}
          </div>
        </section>
      </div>
    </>
  );
}
