import { useMemo, useState } from "react";
import { useOutletContext, useParams, useNavigate } from "react-router-dom";
import { makeApiClient } from "../api/client.ts";
import { fillStarters } from "../algo/profile.ts";
import type { LeagueFormat, TeamProfile, WindowLabel, PickFlag, Position, Pick as DraftPick, SubClassification } from "../algo/types.ts";
import { useAuth } from "../hooks/useAuth.tsx";
import type { LeagueOutletContext } from "./LeagueShell.tsx";
import LeverageBoard from "./overview/LeverageBoard.tsx";
import WindowMap from "./overview/WindowMap.tsx";

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
  SURPLUS:       "#4ade80",
};

const POSITIONS: Position[] = ["QB", "RB", "WR", "TE"];

// Rich grid team card. Three responsive density modes (controlled entirely
// via CSS media queries — same markup):
//   Desktop:    bars for Starter + Depth × 4 positions + picks
//   Medium:     POS / Starter / Depth stacked vertically per column (2-char
//               numbers, no bars)
//   Mobile:     rank + name only, no positional info, no picks
function GridTeamCard({ profile, onClick }: { profile: TeamProfile; onClick: () => void }) {
  const labelColor = LABEL_COLOR[profile.windowLabel] ?? "#94a3b8";
  return (
    <div className={`grid-team-card${profile.isMine ? " mine" : ""}`} onClick={onClick}>
      <div className="gtc-name-line">
        <span className="gtc-rank">#{profile.starterRank}</span>
        <span className="gtc-name">{profile.ownerName}{profile.isMine && " ★"}</span>
        <span className="gtc-meta">
          <span
            className="window-label"
            style={{ background: labelColor }}
            title={profile.windowLabel ?? "—"}
          >
            {profile.windowLabel ?? "—"}
          </span>
          <span
            className="window-dot"
            style={{ background: labelColor }}
            title={profile.windowLabel ?? "—"}
            aria-label={profile.windowLabel ?? ""}
          />
          <span className="gtc-age">{(profile.starterCalAge ?? 0).toFixed(1)}y</span>
        </span>
      </div>

      {/* Desktop: vertical position blocks (one per position, starter + depth
          rows inside each with bar + number + classification text) */}
      <div className="gtc-bars">
        {POSITIONS.map((pos) => {
          const ps = profile.positionScores?.[pos];
          const sClass = ps?.starterClassification ?? "HEALTHY";
          const dClass = ps?.depthClassification ?? "HEALTHY";
          return (
            <div key={pos} className="gtc-pos-block">
              <div className="gtc-pos-label">{pos}</div>
              <div className="gtc-pos-lines">
                <div className="gtc-pos-line">
                  <ThickBar score={ps?.starterScore ?? 0} kind={sClass} />
                  <span className="gtc-pos-num">{(ps?.starterScore ?? 0).toFixed(0)}</span>
                  <span className="gtc-pos-class" style={{ color: POS_CLASS_COLOR[sClass] }}>
                    {sClass}
                  </span>
                </div>
                <div className="gtc-pos-line">
                  <ThickBar score={ps?.depthScore ?? 0} kind={dClass} />
                  <span className="gtc-pos-num">{(ps?.depthScore ?? 0).toFixed(0)}</span>
                  <span className="gtc-pos-class" style={{ color: POS_CLASS_COLOR[dClass] }}>
                    {dClass}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Medium: 2-char number columns (POS / starter / depth stacked) */}
      <div className="gtc-numbers">
        {POSITIONS.map((pos) => {
          const ps = profile.positionScores?.[pos];
          const sClass = ps?.starterClassification ?? "HEALTHY";
          const dClass = ps?.depthClassification ?? "HEALTHY";
          return (
            <div key={pos} className="gtc-numbers-col">
              <span className="gtc-numbers-pos">{pos}</span>
              <span className="gtc-numbers-val gtc-numbers-starter" style={{ color: POS_CLASS_COLOR[sClass] }}>
                {(ps?.starterScore ?? 0).toFixed(0)}
              </span>
              <span className="gtc-numbers-val gtc-numbers-depth" style={{ color: POS_CLASS_COLOR[dClass] }}>
                {(ps?.depthScore ?? 0).toFixed(0)}
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
        {flag === "PICK_RICH" ? "RICH" : flag === "PICK_POOR" ? "POOR" : "FINE"}
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

// Thick stubby bar — collapsed-view replacement for score number + glyph.
// Bar color = classification (green/yellow/red), bar length = score 0-100.
// Color does the work that text/numbers used to. Exact numbers live in
// the expanded detail view.
function ThickBar({ score, kind }: { score: number; kind?: SubClassification }) {
  const color = POS_CLASS_COLOR[kind ?? "HEALTHY"] ?? "#22c55e";
  const width = Math.max(4, Math.min(100, score));
  return (
    <div className="lt-thick-bar-track">
      <div className="lt-thick-bar-fill" style={{ width: `${width}%`, background: color }} />
    </div>
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

// 1st / 2nd / 3rd / Nth
function ordinal(n: number): string {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1: return `${n}st`;
    case 2: return `${n}nd`;
    case 3: return `${n}rd`;
    default: return `${n}th`;
  }
}

// Radar chart showing team dynasty value across 5 asset classes, normalized
// against the league max for each axis. Always a pentagon; values are 0-1
// of "best team at this axis in the league".
type RadarAxis = "QB" | "RB" | "WR" | "TE" | "PICKS";
const RADAR_AXES: RadarAxis[] = ["QB", "RB", "WR", "TE", "PICKS"];

function teamAxisValue(profile: TeamProfile, axis: RadarAxis): number {
  if (axis === "PICKS") {
    return (profile.picks ?? []).reduce((s, p) => s + p.value, 0);
  }
  return (profile.players ?? [])
    .filter((p) => p.position === axis)
    .reduce((s, p) => s + p.valueDynasty, 0);
}

function RadarChart({ profile, allProfiles }: { profile: TeamProfile; allProfiles: TeamProfile[] }) {
  const size = 200;
  const cx = size / 2;
  const cy = size / 2;
  const maxR = 78;

  // Normalize each axis against league max for that axis
  const axisData = RADAR_AXES.map((axis) => {
    const teamVal = teamAxisValue(profile, axis);
    const leagueMax = Math.max(1, ...allProfiles.map((p) => teamAxisValue(p, axis)));
    return { axis, value: teamVal, normalized: Math.max(0, Math.min(1, teamVal / leagueMax)) };
  });

  // Vertex positions (start at top, clockwise)
  const angle = (i: number) => -Math.PI / 2 + i * ((2 * Math.PI) / RADAR_AXES.length);
  const point = (i: number, r: number) => ({
    x: cx + r * Math.cos(angle(i)),
    y: cy + r * Math.sin(angle(i)),
  });

  // Grid rings at 25/50/75/100%
  const rings = [0.25, 0.5, 0.75, 1.0];

  // Data polygon points
  const dataPoints = axisData.map((d, i) => point(i, maxR * d.normalized));
  const dataPath = dataPoints.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");

  // Axis-end labels
  const labelOffset = 14;
  const axisLabels = axisData.map((d, i) => {
    const p = point(i, maxR + labelOffset);
    return { ...p, label: d.axis };
  });

  return (
    <svg viewBox={`-18 0 ${size + 36} ${size}`} className="radar-svg">
      {/* Grid rings */}
      {rings.map((ratio) => (
        <polygon
          key={ratio}
          points={RADAR_AXES.map((_, i) => {
            const p = point(i, maxR * ratio);
            return `${p.x},${p.y}`;
          }).join(" ")}
          fill="none"
          stroke="rgba(255,255,255,0.06)"
          strokeWidth={1}
        />
      ))}
      {/* Axis lines */}
      {RADAR_AXES.map((_, i) => {
        const p = point(i, maxR);
        return <line key={i} x1={cx} y1={cy} x2={p.x} y2={p.y} stroke="rgba(255,255,255,0.06)" />;
      })}
      {/* Data polygon */}
      <polygon
        points={dataPath}
        fill="rgba(245,158,11,0.22)"
        stroke="#f59e0b"
        strokeWidth={1.5}
      />
      {/* Vertex dots */}
      {dataPoints.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r={2.5} fill="#f59e0b" />
      ))}
      {/* Axis labels */}
      {axisLabels.map((l, i) => (
        <text
          key={i}
          x={l.x}
          y={l.y}
          textAnchor="middle"
          dominantBaseline="middle"
          className="radar-axis-label"
        >
          {l.label}
        </text>
      ))}
    </svg>
  );
}

// Per-position roster column shown in the expanded view. Players sorted by
// dynasty value desc; star next to the players the real lineup fill puts in
// starting slots (base + flex/superflex), same math the algorithm scores.
function PositionColumn({
  pos,
  profile,
  starterIds,
  allProfiles,
}: {
  pos: Position;
  profile: TeamProfile;
  starterIds: Set<string>;
  allProfiles: TeamProfile[];
}) {
  const players = (profile.players ?? [])
    .filter((p) => p.position === pos)
    .sort((a, b) => b.valueDynasty - a.valueDynasty);

  const totalDynasty = players.reduce((s, p) => s + p.valueDynasty, 0);
  const weightedAge =
    totalDynasty > 0
      ? players.reduce((s, p) => s + (p.age ?? 0) * p.valueDynasty, 0) / totalDynasty
      : 0;

  // Position rank: where this team's starter value at pos ranks across league
  const myStarter = profile.positionScores?.[pos]?.starterValue ?? 0;
  const ranks = allProfiles
    .map((p) => p.positionScores?.[pos]?.starterValue ?? 0)
    .sort((a, b) => b - a);
  const posRank = ranks.indexOf(myStarter) + 1;

  return (
    <div className="pos-column">
      <div className="pos-column-header">
        <div className="pos-column-header-row">
          <span className="pos-column-pos">{pos}</span>
          <span className="pos-column-meta-bold">#{posRank}</span>
        </div>
        <div className="pos-column-header-row pos-column-meta-dim">
          <span>{totalDynasty.toLocaleString()}</span>
          <span>{weightedAge > 0 ? `${weightedAge.toFixed(1)}y` : "—"}</span>
        </div>
      </div>
      <div className="pos-column-players">
        {players.map((p) => (
          <div key={p.id} className={`pos-column-player${starterIds.has(p.id) ? " is-starter" : ""}`}>
            <span className="pos-column-player-name">{p.name}</span>
            <span className="pos-column-player-val">{p.valueDynasty.toLocaleString()}</span>
          </div>
        ))}
        {players.length === 0 && (
          <div className="pos-column-empty">no players</div>
        )}
      </div>
    </div>
  );
}

// Compact collapsed row — self-contained mini-table per team. Each row has
// its own QB/RB/WR/TE column headers (so you don't lose context as you
// scroll), plus row labels "Starter" / "Depth" on each data line. Depth
// numbers are dimmed to visually distinguish from bold starter numbers.
// Chevron in the top-right indicates collapse state.
function LeagueTableRow({
  profile,
  leagueId,
  format,
  allProfiles,
  expanded,
  onToggle,
}: {
  profile: TeamProfile;
  leagueId: string;
  format: LeagueFormat;
  allProfiles: TeamProfile[];
  expanded: boolean;
  onToggle: () => void;
}) {
  const navigate = useNavigate();
  const labelColor = LABEL_COLOR[profile.windowLabel] ?? "#94a3b8";

  // Real lineup fill (same math the algorithm scores): base slots + flex.
  const starterIds = useMemo(() => {
    if (!expanded) return new Set<string>();
    const { starters } = fillStarters(profile.players ?? [], format);
    return new Set<string>(Object.values(starters).flat().map((p) => p.id));
  }, [expanded, profile, format]);

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
              {profile.currentPlace != null && (
                <span className="lt-row-meta-dim">now {ordinal(profile.currentPlace)}</span>
              )}
              {(profile.placements ?? []).slice(0, 2).map((pl) => (
                <span key={pl.season} className="lt-row-meta-dim">
                  '{String(pl.season).slice(2)} {ordinal(pl.place)}
                </span>
              ))}
              <span className="lt-row-meta-dim">age {(profile.starterCalAge ?? 0).toFixed(1)}</span>
            </div>
          </div>
        </div>

        <div className="lt-pos-grid">
          {/* Header row */}
          <div className="lt-pos-grid-corner" />
          {POSITIONS.map((pos) => (
            <div key={`h-${pos}`} className="lt-pos-grid-pos-header">{pos}</div>
          ))}

          {/* Starter row */}
          <div className="lt-pos-grid-row-label">Starter</div>
          {POSITIONS.map((pos) => {
            const ps = profile.positionScores?.[pos];
            const sClass = ps?.starterClassification ?? "HEALTHY";
            return (
              <div key={`s-${pos}`} className="lt-pos-grid-bar-cell">
                <ThickBar score={ps?.starterScore ?? 0} kind={sClass} />
              </div>
            );
          })}

          {/* Depth row */}
          <div className="lt-pos-grid-row-label">Depth</div>
          {POSITIONS.map((pos) => {
            const ps = profile.positionScores?.[pos];
            const dClass = ps?.depthClassification ?? "HEALTHY";
            return (
              <div key={`d-${pos}`} className="lt-pos-grid-bar-cell">
                <ThickBar score={ps?.depthScore ?? 0} kind={dClass} />
              </div>
            );
          })}
        </div>

        {/* Mobile-only dense numbers block (under 640px) — replaces
            .lt-pos-grid so the row never needs horizontal scroll. Same
            starter/depth data as the ThickBars above, shown as colored
            numbers instead. */}
        <div className="lt-mobile-numbers">
          <div className="lt-mn-col lt-mn-label">
            <span className="lt-mn-spacer" aria-hidden="true" />
            <span className="lt-mn-label-text">STR</span>
            <span className="lt-mn-label-text">DEP</span>
          </div>
          {POSITIONS.map((pos) => {
            const ps = profile.positionScores?.[pos];
            const sClass = ps?.starterClassification ?? "HEALTHY";
            const dClass = ps?.depthClassification ?? "HEALTHY";
            return (
              <div key={pos} className="lt-mn-col">
                <span className="lt-mn-pos">{pos}</span>
                <span className="lt-mn-val" style={{ color: POS_CLASS_COLOR[sClass] }}>
                  {Math.round(ps?.starterScore ?? 0)}
                </span>
                <span className="lt-mn-val lt-mn-depth" style={{ color: POS_CLASS_COLOR[dClass] }}>
                  {Math.round(ps?.depthScore ?? 0)}
                </span>
              </div>
            );
          })}
        </div>

        <div className="lt-col-picks">
          <PicksDots picks={profile.picks ?? []} flag={profile.pickCapital?.flag ?? "NEUTRAL"} />
        </div>

        <button
          className="lt-row-chevron"
          onClick={(e) => {
            e.stopPropagation();
            onToggle();
          }}
          aria-label={expanded ? "collapse" : "expand"}
        >
          {expanded ? "▴" : "▾"}
        </button>
      </div>

      {expanded && (
        <div className="lt-row-detail">
          <div className="lt-detail-radar">
            <RadarChart profile={profile} allProfiles={allProfiles} />
          </div>
          <div className="lt-detail-positions">
            {POSITIONS.map((pos) => (
              <PositionColumn
                key={pos}
                pos={pos}
                profile={profile}
                starterIds={starterIds}
                allProfiles={allProfiles}
              />
            ))}
          </div>
          <div className="lt-detail-footer-row">
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
  // "map" is the new default; the classic 3x3 grid stays behind a toggle for
  // one release.
  const [shapeView, setShapeView] = useState<"map" | "grid">("map");

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
          <div className="shape-header">
            <h2 className="section-title">League Shape</h2>
            <button
              className="btn-link shape-toggle"
              onClick={() => setShapeView(shapeView === "map" ? "grid" : "map")}
            >
              {shapeView === "map" ? "grid view" : "map view"}
            </button>
          </div>
          {shapeView === "map" ? (
            <WindowMap
              profiles={overview.profiles}
              format={overview.format}
              thisYear={
                overview.upcomingDraftYear
                ?? Math.min(
                  ...overview.profiles.flatMap((p) => p.picks.map((pk) => pk.year)),
                  new Date().getFullYear() + 1,
                )
              }
            />
          ) : (
            <LeagueGrid profiles={overview.profiles} />
          )}
        </section>

        <section className="overview-section">
          <h2 className="section-title">Teams</h2>
          <div className="league-table">
            {sorted.map((p) => (
              <LeagueTableRow
                key={p.rosterId}
                profile={p}
                leagueId={id!}
                format={overview.format}
                allProfiles={overview.profiles}
                expanded={expandedRoster === p.rosterId}
                onToggle={() => setExpandedRoster(expandedRoster === p.rosterId ? null : p.rosterId)}
              />
            ))}
          </div>
        </section>

        <section className="overview-section">
          <h2 className="section-title">Positional Leverage</h2>
          <LeverageBoard profiles={overview.profiles} />
        </section>
      </div>
    </>
  );
}
