import { useEffect } from "react";
import { useNavigate, useOutletContext, useParams } from "react-router-dom";
import type { Player, Pick as DraftPick, TeamProfile, WindowLabel } from "../algo/types.ts";
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


export default function TeamDeepDive() {
  const { id: leagueId, rosterId: rosterIdStr } = useParams<{ id: string; rosterId: string }>();
  const rosterId = Number(rosterIdStr);
  const navigate = useNavigate();
  const { overview } = useOutletContext<LeagueOutletContext>();

  useEffect(() => {}, [leagueId, rosterId]); // keep dep tracking consistent

  const profile = overview.profiles.find((p) => p.rosterId === rosterId);
  const sortedTeams = [...overview.profiles].sort((a, b) => a.starterRank - b.starterRank);

  if (!profile) {
    return <p className="dim-text" style={{ marginTop: 48, textAlign: "center" }}>Team not found.</p>;
  }

  const labelColor = LABEL_COLOR[profile.windowLabel];

  const playersByPos = (pos: string): Player[] =>
    profile.players
      .filter((p) => p.position === pos)
      .sort((a, b) => b.valueDynasty - a.valueDynasty);

  const sortedPicks = [...profile.picks].sort((a, b) => {
    if (a.year !== b.year) return a.year - b.year;
    if (a.round !== b.round) return a.round - b.round;
    return a.slot - b.slot;
  });

  return (
    <>
      {/* Team header + switcher */}
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
              picks <strong style={{
                color: profile.pickCapital.flag === "PICK_RICH" ? "#22c55e"
                     : profile.pickCapital.flag === "PICK_POOR" ? "#ef4444"
                     : "#94a3b8",
              }}>
                {profile.pickCapital.flag}
              </strong>
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

      {/* Scouting report */}
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

      {/* Roster by position */}
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
                <span style={{ color: "#475569", fontWeight: 400 }}> · {ps.urgency.toFixed(0)}</span>
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
              total <strong>{sortedPicks.reduce((s, p) => s + p.value, 0).toLocaleString()}</strong>
            </span>
            <span className="meta-pill" style={{ fontSize: 10 }}>
              capital{" "}
              <strong style={{
                color: profile.pickCapital.flag === "PICK_RICH" ? "#22c55e"
                     : profile.pickCapital.flag === "PICK_POOR" ? "#ef4444"
                     : "#94a3b8",
              }}>
                {profile.pickCapital.flag.replace("_", " ")}
              </strong>
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
    </>
  );
}
