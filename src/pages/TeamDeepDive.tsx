import { useEffect, useMemo, useState } from "react";
import { useNavigate, useOutletContext, useParams } from "react-router-dom";
import type { Pick as DraftPick, Player, Position, SubClassification, TeamProfile, WindowLabel } from "../algo/types.ts";
import { makeApiClient, type LedgerRow } from "../api/client.ts";
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
  SURPLUS:       "#4ade80",
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

const pickFlagText = (flag: string) => (flag === "NEUTRAL" ? "FINE" : flag.replace("_", " "));

type RosterItem = { divider: (typeof POSITIONS)[number]; player?: undefined } | { divider?: undefined; player: Player };

function posColor(pos: string) {
  const map: Record<string, string> = { QB: "#f97316", RB: "#22c55e", WR: "#3b82f6", TE: "#a855f7" };
  return map[pos] ?? "#94a3b8";
}

function MiniBar({ score, kind }: { score: number; kind?: SubClassification }) {
  const pct = Math.min(100, Math.max(0, score));
  const color = kind
    ? POS_CLASS_COLOR[kind] ?? "#22c55e"
    : pct >= 70 ? "#4ade80" : pct >= 50 ? "#22c55e" : pct >= 30 ? "#eab308" : "#ef4444";
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

// Position with the highest urgency score. Deterministic: iterates QB/RB/WR/TE
// in fixed order, first strictly-greater win keeps ties on the earlier position.
function mostUrgentPosition(profile: TeamProfile): (typeof POSITIONS)[number] {
  return POSITIONS.reduce((best, pos) =>
    profile.positionScores[pos].urgency > profile.positionScores[best].urgency ? pos : best
  , POSITIONS[0]);
}

function topPlayerAt(profile: TeamProfile, pos: string): Player | undefined {
  return [...profile.players]
    .filter((p) => p.position === pos)
    .sort((a, b) => b.valueDynasty - a.valueDynasty || a.id.localeCompare(b.id))[0];
}

// Family + optional position for the Send It deep link. Mirrors ArchetypeFamily
// in src/algo/archetypes.ts (tier_down_WR -> archetype=tier_down&pos=WR, etc).
function scoutLink(leagueId: string | undefined, rosterId: number, key: string, profile: TeamProfile): string {
  const params = new URLSearchParams();
  const tierDownMatch = key.match(/^tier_down_(QB|RB|WR|TE)$/);
  const consolidateMatch = key.match(/^consolidate_(QB|RB|WR|TE)$/);
  if (tierDownMatch) {
    params.set("archetype", "tier_down");
    params.set("pos", tierDownMatch[1] as string);
  } else if (consolidateMatch) {
    params.set("archetype", "consolidate");
    params.set("pos", consolidateMatch[1] as string);
  } else if (key === "need_fill") {
    params.set("archetype", "need_fill");
    params.set("pos", mostUrgentPosition(profile));
  } else {
    params.set("archetype", key);
  }
  return `/league/${leagueId}/sendit/${rosterId}?${params.toString()}`;
}

// One supporting data line per archetype family, built from real profile numbers.
function buildScoutData(key: string, profile: TeamProfile): string {
  const tierDownMatch = key.match(/^tier_down_(QB|RB|WR|TE)$/);
  if (tierDownMatch) {
    const pos = tierDownMatch[1] as string;
    const top = topPlayerAt(profile, pos);
    const ps = profile.positionScores[pos as Position];
    if (!top) return `no clear ${pos} centerpiece to build around`;
    return ps.depthScore < 35
      ? `${top.name} (${top.valueDynasty.toLocaleString()}) carries the room with little behind him; split him into two starters`
      : `${top.name} (${top.valueDynasty.toLocaleString()}) headlines a room with support; trading him down adds depth elsewhere`;
  }

  const consolidateMatch = key.match(/^consolidate_(QB|RB|WR|TE)$/);
  if (consolidateMatch) {
    const pos = consolidateMatch[1] as string;
    return `no true ${pos}1 here but plenty of bodies; two spares could become one stud`;
  }

  if (key === "consolidate_flex") {
    return "extra flex bodies riding the bench; bundle spares into a real starter";
  }

  if (key === "age_arb_sell") {
    const candidates = [...profile.players]
      .filter((p) => p.valueDynasty >= 1500 && p.age != null)
      .sort((a, b) => (b.age as number) - (a.age as number) || b.valueDynasty - a.valueDynasty || a.id.localeCompare(b.id));
    const oldest = candidates[0];
    if (!oldest) return "no aging studs to move";
    return `${oldest.name} is ${Number(oldest.age).toFixed(1)} and still worth ${oldest.valueDynasty.toLocaleString()}; cash out before the cliff`;
  }

  if (key === "age_arb_buy") {
    return "young roster with time to spare; buy a proven vet at an age discount";
  }

  if (key === "push_in") {
    return "your best players are peaking now; convert future picks into this year's lineup";
  }

  if (key === "need_fill") {
    const pos = mostUrgentPosition(profile);
    return `${pos} is the thinnest spot on this roster; trade from strength to fix it`;
  }

  if (key === "capital_convert_picks_to_production") {
    return "sitting on a pile of picks; turn some into players who help now";
  }

  if (key === "capital_convert_production_to_picks") {
    return "light on future draft capital; selling a vet restocks the shelf";
  }

  return "";
}

export default function TeamDeepDive() {
  const { id: leagueId, rosterId: rosterIdStr } = useParams<{ id: string; rosterId: string }>();
  const rosterId = Number(rosterIdStr);
  const navigate = useNavigate();
  const { getToken } = useAuth();
  const { overview } = useOutletContext<LeagueOutletContext>();
  const [rosterSort, setRosterSort] = useState<"value" | "position">("value");

  // Trade ledger (cached Firestore read; never triggers a backfill). One
  // fetch per league visit, shared across team switches.
  const [ledger, setLedger] = useState<LedgerRow[] | null>(null);
  useEffect(() => {
    if (!leagueId) return;
    let cancelled = false;
    makeApiClient(getToken)
      .getTrades(leagueId)
      .then((d) => {
        if (!cancelled && !d.needsBackfill) setLedger(d.ledger);
      })
      .catch(() => {}); // stats chip is optional garnish
    return () => { cancelled = true; };
  }, [leagueId]); // eslint-disable-line react-hooks/exhaustive-deps

  const tradeRow = ledger?.find((r) => r.rosterId === rosterId) ?? null;

  const profile = overview.profiles.find((p) => p.rosterId === rosterId) as TeamProfile | undefined;
  const sortedTeams = [...overview.profiles].sort((a, b) => a.starterRank - b.starterRank);

  const rosterItems = useMemo(() => {
    if (!profile) return [] as RosterItem[];
    if (rosterSort === "value") {
      return [...profile.players]
        .sort((a, b) => b.valueDynasty - a.valueDynasty)
        .map((player): RosterItem => ({ player }));
    }
    const items: RosterItem[] = [];
    for (const pos of POSITIONS) {
      const group = profile.players
        .filter((p) => p.position === pos)
        .sort((a, b) => b.valueDynasty - a.valueDynasty);
      if (group.length === 0) continue;
      items.push({ divider: pos });
      for (const player of group) items.push({ player });
    }
    return items;
  }, [profile, rosterSort]);

  // Top 4 archetype angles by score, always shown regardless of threshold.
  // Deterministic tiebreak: score descending, then key ascending.
  const scoutEntries = useMemo(() => {
    if (!profile) return [] as Array<[string, number]>;
    return Object.entries(profile.archetypeScores)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 4);
  }, [profile]);

  if (!profile) {
    return <p className="dim-text" style={{ marginTop: 48, textAlign: "center" }}>Team not found.</p>;
  }

  const labelColor = LABEL_COLOR[profile.windowLabel];

  const sortedPicks = [...profile.picks].sort((a, b) => {
    if (a.year !== b.year) return a.year - b.year;
    if (a.round !== b.round) return a.round - b.round;
    return a.slot - b.slot;
  });

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
        <div className="dive-header-row">
          <div className="team-meta" style={{ marginBottom: 0 }}>
            <span className="meta-pill">{profile.competitiveness} / {profile.windowTier}</span>
            <span className="meta-pill">rank <strong>#{profile.starterRank}</strong></span>
            <span className="meta-pill">age <strong>{profile.starterCalAge.toFixed(1)}</strong></span>
            <span className="meta-pill">
              picks <strong style={{ color: pickFlagColor }}>{pickFlagText(profile.pickCapital.flag)}</strong>
              <span style={{ color: "#475569" }}> · {profile.pickCapital.score.toFixed(0)}</span>
            </span>
            <span className="meta-pill">{profile.record}</span>
            {tradeRow && (
              <span
                className="meta-pill"
                style={{ cursor: "pointer" }}
                title="Open trade grades"
                onClick={() => navigate(`/league/${leagueId}/trades?manager=${rosterId}`)}
              >
                trades <strong>{tradeRow.trades}</strong>
                <span style={{ color: "#475569" }}> · {tradeRow.wins}-{tradeRow.losses}-{tradeRow.ties} · </span>
                <strong style={{ color: tradeRow.netValue > 0 ? "#22c55e" : tradeRow.netValue < 0 ? "#ef4444" : "#94a3b8" }}>
                  {tradeRow.netValue >= 0 ? "+" : "−"}{(Math.abs(tradeRow.netValue) / 1000).toFixed(1)}k
                </strong>
              </span>
            )}
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
      <section className="dive-pos-section">
        <h2 className="section-title">SCOUTING REPORT</h2>
        <p className="dim-text scout-intro">Your best trade angles by the numbers. Send one to the trade finder.</p>
        {(scoutEntries[0]?.[1] ?? 0) < 35 && (
          <p className="scout-caveat">No screaming angles on this roster. These are the closest fits:</p>
        )}
        <div className="scout-list">
          {scoutEntries.map(([key, score]) => {
            const strength = score >= 60 ? "strong angle" : score >= 35 ? "worth a look" : score >= 15 ? "situational" : "a stretch";
            return (
              <div key={key} className="scout-row">
                <div className="scout-row-main">
                  <span className="scout-title">{ARCHETYPE_LABELS[key] ?? key.replace(/_/g, " ")}</span>
                  <span className="scout-data">{buildScoutData(key, profile)}</span>
                </div>
                <div className="scout-row-meter">
                  <div className="scout-meter-bar">
                    <MiniBar score={score} />
                  </div>
                  <span className="scout-score">{score}</span>
                  <span className="scout-strength">{strength}</span>
                  <button
                    className="sendit-reset-btn scout-cta"
                    onClick={() => navigate(scoutLink(leagueId, rosterId, key, profile))}
                  >
                    Find these trades
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </section>

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
                  {/* Dual-zone: starter and depth judged separately (a SURPLUS
                      starter room shouldn't hide behind merely-healthy depth) */}
                  <span style={{ color: POS_CLASS_COLOR[ps.starterClassification ?? "HEALTHY"], fontWeight: 700, fontSize: 11 }}>
                    {ps.starterClassification ?? ps.classification.replace("_", " ")}
                  </span>
                  <span style={{ color: "#475569", fontSize: 10 }}> / </span>
                  <span style={{ color: POS_CLASS_COLOR[ps.depthClassification ?? "HEALTHY"], fontWeight: 700, fontSize: 10 }}>
                    {ps.depthClassification ?? "—"}
                  </span>
                  <span style={{ color: "#475569", fontSize: 10 }}> · {ps.urgency.toFixed(0)}</span>
                </div>
                <div className="pos-dash-metric">
                  <MiniBar score={ps.starterScore} kind={ps.starterClassification} />
                  <span className="pos-dash-num">{ps.starterScore.toFixed(0)}</span>
                </div>
                <div className="pos-dash-metric">
                  <MiniBar score={ps.depthScore} kind={ps.depthClassification} />
                  <span className="pos-dash-num">{ps.depthScore.toFixed(0)}</span>
                </div>
                <span className="pos-dash-player">
                  {top ? `${top.name}${top.age != null ? ` (${Number(top.age).toFixed(1)})` : ""}` : "—"}
                </span>
              </div>
            );
          })}
        </div>
      </section>

      {/* Roster — compact, deprioritized */}
      <section className="dive-pos-section">
        <div className="shape-header">
          <h2 className="section-title">ROSTER</h2>
          <div style={{ display: "flex", gap: 6 }}>
            <button
              className={`sendit-reset-btn${rosterSort === "value" ? " roster-sort-active" : ""}`}
              onClick={() => setRosterSort("value")}
            >
              BY VALUE
            </button>
            <button
              className={`sendit-reset-btn${rosterSort === "position" ? " roster-sort-active" : ""}`}
              onClick={() => setRosterSort("position")}
            >
              BY POSITION
            </button>
          </div>
        </div>
        <div className="roster-compact">
          {rosterItems.map((item) =>
            item.divider !== undefined ? (
              <div key={`div-${item.divider}`} className="roster-pos-divider" style={{ color: posColor(item.divider) }}>
                {item.divider}
              </div>
            ) : (
              <div key={item.player.id} className="roster-row">
                <span
                  className="pos-tag"
                  style={{ background: posColor(item.player.position), color: "#fff", padding: "1px 4px", borderRadius: 2, fontSize: 8, fontWeight: 700, letterSpacing: 0.5, flexShrink: 0 }}
                >
                  {item.player.position}
                </span>
                <span className="roster-name">{item.player.name}</span>
                {item.player.age != null && <span className="roster-age">{Number(item.player.age).toFixed(1)}</span>}
                <span className="roster-val">{item.player.valueDynasty.toLocaleString()}</span>
              </div>
            )
          )}
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
              capital <strong style={{ color: pickFlagColor }}>{pickFlagText(profile.pickCapital.flag)}</strong>
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
