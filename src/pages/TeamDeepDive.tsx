import { useEffect } from "react";
import { useNavigate, useOutletContext, useParams } from "react-router-dom";
import type { Pick as DraftPick, TeamProfile, WindowLabel } from "../algo/types.ts";
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

const ARCHETYPE_LABELS: Record<string, string> = {
  tier_down_QB:      "Trade elite QB for two mid-tier QBs",
  tier_down_RB:      "Trade elite RB for two mid-tier RBs",
  tier_down_WR:      "Trade elite WR for two mid-tier WRs",
  tier_down_TE:      "Trade elite TE for two mid-tier TEs",
  consolidate_QB:    "Consolidate QB depth into a true starter",
  consolidate_RB:    "Consolidate RB depth into a true starter",
  consolidate_WR:    "Consolidate WR depth into a true starter",
  consolidate_TE:    "Consolidate TE depth into a true starter",
  consolidate_flex:  "Convert flex depth into a positional starter",
  age_arb_buy:       "Buy young players before their breakout",
  age_arb_sell:      "Sell aging veterans at peak value",
  push_in:           "Aggressive push into contention",
  need_fill:         "Fill critical positional needs",
  capital_convert_picks_to_production: "Convert pick capital into proven production",
  capital_convert_production_to_picks: "Trade production for future pick capital",
};

const POSITIONS = ["QB", "RB", "WR", "TE"] as const;

function posColor(pos: string) {
  const map: Record<string, string> = { QB: "#f97316", RB: "#22c55e", WR: "#3b82f6", TE: "#a855f7" };
  return map[pos] ?? "#94a3b8";
}

function MiniBar({ score }: { score: number }) {
  const pct = Math.min(100, Math.max(0, score));
  const color = pct >= 70 ? "#22c55e" : pct >= 50 ? "#06b6d4" : pct >= 30 ? "#eab308" : "#ef4444";
  return (
    <div className="mini-bar-track">
      <div className="mini-bar-fill" style={{ width: `${pct}%`, background: color }} />
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

export default function TeamDeepDive() {
  const { id: leagueId, rosterId: rosterIdStr } = useParams<{ id: string; rosterId: string }>();
  const rosterId = Number(rosterIdStr);
  const navigate = useNavigate();
  const { overview } = useOutletContext<LeagueOutletContext>();

  useEffect(() => {}, [leagueId, rosterId]);

  const profile = overview.profiles.find((p) => p.rosterId === rosterId) as TeamProfile | undefined;
  const sortedTeams = [...overview.profiles].sort((a, b) => a.starterRank - b.starterRank);

  if (!profile) {
    return <p className="dim-text" style={{ marginTop: 48, textAlign: "center" }}>Team not found.</p>;
  }

  const labelColor = LABEL_COLOR[profile.windowLabel];

  const sortedPicks = [...profile.picks].sort((a, b) => {
    if (a.year !== b.year) return a.year - b.year;
    if (a.round !== b.round) return a.round - b.round;
    return a.slot - b.slot;
  });

  const sortedRoster = [...profile.players].sort((a, b) => b.valueDynasty - a.valueDynasty);

  const pickFlagColor = profile.pickCapital.flag === "PICK_RICH" ? "#22c55e"
    : profile.pickCapital.flag === "PICK_POOR" ? "#ef4444"
    : "#94a3b8";

  return (
    <>
      {/* Header */}
      <div className="dive-header">
        <div className="dive-title-row">
          <h1 className="dive-owner">
            {profile.ownerName}
            {profile.isMine && <span className="mine-mark">★ YOU</span>}
          </h1>
          <span className="window-label" style={{ background: labelColor }}>{profile.windowLabel}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 10 }}>
          <div className="team-meta" style={{ marginBottom: 0 }}>
            <span className="meta-pill">{profile.competitiveness} / {profile.windowTier}</span>
            <span className="meta-pill">rank <strong>#{profile.starterRank}</strong></span>
            <span className="meta-pill">age <strong>{profile.starterCalAge.toFixed(1)}</strong></span>
            <span className="meta-pill">
              picks <strong style={{ color: pickFlagColor }}>{profile.pickCapital.flag.replace("_", " ")}</strong>
              <span style={{ color: "#475569" }}> · {profile.pickCapital.score.toFixed(0)}</span>
            </span>
            <span className="meta-pill">{profile.record}</span>
          </div>
          <div className="team-switcher">
            <span className="dim-text" style={{ fontSize: 10, letterSpacing: 1 }}>TEAM</span>
            <select
              className="team-switcher-select"
              value={rosterId}
              onChange={(e) => navigate(`/league/${leagueId}/team/${e.target.value}`)}
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

      {/* Scouting Report — main focus */}
      {profile.archetypes.length > 0 && (
        <section className="dive-pos-section">
          <h2 className="section-title">SCOUTING REPORT</h2>
          <div className="dive-archetypes">
            {profile.archetypes.map((a) => (
              <div key={a} className="dive-arch-row">
                <span className="arch-tag">{a.replace(/_/g, " ")}</span>
                <span className="dive-arch-desc">{ARCHETYPE_LABELS[a] ?? a.replace(/_/g, " ")}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Position dashboard */}
      <section className="dive-pos-section">
        <h2 className="section-title">POSITIONS</h2>
        <div className="pos-dashboard">
          <div className="pos-dash-header-row">
            <div />
            <div className="pos-dash-col-label">CLASSIFICATION</div>
            <div className="pos-dash-col-label">STARTER</div>
            <div className="pos-dash-col-label">DEPTH</div>
            <div className="pos-dash-col-label">BEST PLAYER</div>
          </div>
          {POSITIONS.map((pos) => {
            const ps = profile.positionScores[pos];
            const top = profile.players
              .filter((p) => p.position === pos)
              .sort((a, b) => b.valueDynasty - a.valueDynasty)[0];
            return (
              <div key={pos} className="pos-dash-row">
                <span className="pos-tag" style={{ background: posColor(pos), color: "#fff", padding: "2px 6px", borderRadius: 3, fontSize: 9, fontWeight: 700, letterSpacing: 1, textAlign: "center" }}>
                  {pos}
                </span>
                <div className="pos-dash-class">
                  <span style={{ color: POS_CLASS_COLOR[ps.classification], fontWeight: 700, fontSize: 11 }}>
                    {ps.classification.replace("_", " ")}
                  </span>
                  <span style={{ color: "#475569", fontSize: 10 }}> · {ps.urgency.toFixed(0)}</span>
                </div>
                <div className="pos-dash-metric">
                  <MiniBar score={ps.starterScore} />
                  <span className="pos-dash-num">{ps.starterScore.toFixed(0)}</span>
                </div>
                <div className="pos-dash-metric">
                  <MiniBar score={ps.depthScore} />
                  <span className="pos-dash-num">{ps.depthScore.toFixed(0)}</span>
                </div>
                <span className="pos-dash-player">
                  {top ? `${top.name}${top.age != null ? ` (${top.age})` : ""}` : "—"}
                </span>
              </div>
            );
          })}
        </div>
      </section>

      {/* Picks */}
      {sortedPicks.length > 0 && (
        <section className="dive-pos-section">
          <div className="dive-pos-header">
            <span style={{ fontSize: 11, fontWeight: 700, color: "#f59e0b", letterSpacing: 2 }}>PICKS</span>
            <span className="meta-pill" style={{ fontSize: 10 }}>
              total <strong>{sortedPicks.reduce((s, p) => s + p.value, 0).toLocaleString()}</strong>
            </span>
            <span className="meta-pill" style={{ fontSize: 10 }}>
              capital <strong style={{ color: pickFlagColor }}>{profile.pickCapital.flag.replace("_", " ")}</strong>
              <span style={{ color: "#475569" }}> · {profile.pickCapital.score.toFixed(0)}</span>
            </span>
          </div>
          <div className="dive-pick-list">
            {sortedPicks.map((pick) => (
              <PickRow key={`${pick.year}-${pick.round}-${pick.origRosterId}`} pick={pick} />
            ))}
          </div>
        </section>
      )}

      {/* Roster — compact, deprioritized */}
      <section className="dive-pos-section">
        <h2 className="section-title">ROSTER</h2>
        <div className="roster-compact">
          {sortedRoster.map((p) => (
            <div key={p.id} className="roster-row">
              <span
                className="pos-tag"
                style={{ background: posColor(p.position), color: "#fff", padding: "1px 4px", borderRadius: 2, fontSize: 8, fontWeight: 700, letterSpacing: 0.5, flexShrink: 0 }}
              >
                {p.position}
              </span>
              <span className="roster-name">{p.name}</span>
              {p.age != null && <span className="roster-age">{p.age}</span>}
              <span className="roster-val">{p.valueDynasty.toLocaleString()}</span>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
