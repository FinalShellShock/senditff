import { useEffect, useMemo, useState } from "react";
import { useNavigate, useOutletContext, useParams } from "react-router-dom";
import type { Pick as DraftPick, Player, Position, SubClassification, TeamProfile, WindowLabel } from "../algo/types.ts";
import { makeApiClient, type LedgerRow } from "../api/client.ts";
import { useAuth } from "../hooks/useAuth.tsx";
import type { LeagueOutletContext } from "./LeagueShell.tsx";
import { scoutingPlays, type Play } from "../algo/plays.ts";
import { FeedbackBlock } from "../components/FeedbackBlock.tsx";
import TeamState from "./team/TeamState.tsx";

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

// CRITICAL and SURPLUS are the two states worth acting on, so they own the
// loud colors. HEALTHY is deliberately neutral: it is the absence of leverage,
// and it covers ~60% of cells by construction (classifySide puts NEED below
// z -1 and CRITICAL below z -2, so the middle is always the big bucket).
// Painting that middle green made 80% of the leverage board green and buried
// the signal.
const POS_CLASS_COLOR: Record<string, string> = {
  CRITICAL_NEED: "#ef4444",
  CRITICAL:      "#ef4444",
  NEED:          "#eab308",
  HEALTHY:       "#64748b",
  SURPLUS:       "#22c55e",
};

const POSITIONS = ["QB", "RB", "WR", "TE"] as const;

// Deep-links a play into the trade finder. Plays without an archetype are
// guidance rather than a searchable shape, and render without the button.
function playLink(leagueId: string | undefined, rosterId: number, play: Play): string {
  const params = new URLSearchParams();
  if (play.archetype) params.set("archetype", play.archetype);
  if (play.position) params.set("pos", play.position);
  return `/league/${leagueId}/sendit/${rosterId}?${params.toString()}`;
}

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
    : pct >= 70 ? "#22c55e" : pct >= 50 ? "#64748b" : pct >= 30 ? "#eab308" : "#ef4444";
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

// Play feedback reasons. Deliberately NOT the trade chips: a play is a claim
// about strategy backed by a population statistic, so it fails by not applying,
// by naming the wrong guys, or by being something you already knew. None of
// those are things a trade package can be wrong about.
const PLAY_DOWN_REASONS = [
  { key: "play_not_applicable", label: "Doesn't apply to my team" },
  { key: "play_wrong_players", label: "Wrong players named" },
  { key: "play_disagree", label: "I disagree with this" },
  { key: "play_obvious", label: "Already knew this" },
  { key: "play_unclear", label: "Confusing" },
  { key: "play_wrong_window", label: "Wrong read on my window" },
];

const PLAY_UP_REASONS = [
  { key: "play_actionable", label: "I can act on this" },
  { key: "play_right_read", label: "Right read on my team" },
  { key: "play_right_players", label: "Right players named" },
  { key: "play_learned", label: "Taught me something" },
  { key: "play_changed_plan", label: "Changed what I'd do" },
];

export default function TeamDeepDive() {
  const { id: leagueId, rosterId: rosterIdStr } = useParams<{ id: string; rosterId: string }>();
  const rosterId = Number(rosterIdStr);
  const navigate = useNavigate();
  const { getToken } = useAuth();
  const api = useMemo(() => makeApiClient(getToken), [getToken]);
  const { overview } = useOutletContext<LeagueOutletContext>();
  const [rosterSort, setRosterSort] = useState<"value" | "position">("value");

  // Trade ledger (cached Firestore read; never triggers a backfill). One
  // fetch per league visit, shared across team switches.
  const [ledger, setLedger] = useState<LedgerRow[] | null>(null);
  useEffect(() => {
    if (!leagueId) return;
    let cancelled = false;
    api
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

  // What the outcome research says THIS team should do, ranked by how far the
  // measured hit rate sits from a coin flip. No padding: a roster sees only the
  // plays that actually apply to it.
  const plays = useMemo(
    () => (profile ? scoutingPlays(profile, overview.profiles as TeamProfile[]) : []),
    [profile, overview.profiles],
  );

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

      {/* Scouting Report — what the outcome data says to do */}
      <TeamState me={profile} league={overview.profiles as TeamProfile[]} />

      <section className="dive-pos-section">
        <h2 className="section-title">SCOUTING REPORT</h2>
        <p className="dim-text scout-intro">
          What worked for teams in your situation, across 14,343 real dynasty trades. Each
          percentage says what it counts, and none of them are a prediction for this roster.
        </p>
        {plays.length === 0 && (
          <p className="scout-caveat">Nothing stands out for this roster right now.</p>
        )}
        <div className="scout-list">
          {plays.map((play) => (
            <div key={play.key} className={`scout-row${play.kind === "avoid" ? " scout-row-avoid" : ""}`}>
              <div className="scout-row-main">
                <span className="scout-title">
                  {play.kind === "avoid" && <span className="scout-avoid-tag">AVOID</span>}
                  {play.title}
                </span>
                <span className="scout-data">{play.detail}</span>
                <span className="scout-evidence">{play.evidence}</span>
              </div>
              <div className="scout-row-meter">
                <span className={`scout-rate${play.kind === "avoid" ? " scout-rate-avoid" : ""}`}>
                  {play.hitRate}%
                </span>
                <span className="scout-strength">{play.rateLabel}</span>
                {play.archetype && (
                  <button
                    className="sendit-reset-btn scout-cta"
                    onClick={() => navigate(playLink(leagueId, rosterId, play))}
                  >
                    Find these trades
                  </button>
                )}
              </div>
              {/* flex-basis 100% in CSS drops this onto its own line inside the
                  wrapping row, so the thumbs sit under the whole card rather
                  than competing with the rate for the right-hand column. */}
              <div className="scout-feedback">
                <FeedbackBlock
                  upReasons={PLAY_UP_REASONS}
                  downReasons={PLAY_DOWN_REASONS}
                  upLabel="Useful play"
                  downLabel="Not useful"
                  onSubmit={({ verdict, reasons, comment }) =>
                    api.submitPlayFeedback({
                      kind: "play",
                      verdict,
                      reasons,
                      comment,
                      leagueId: leagueId!,
                      rosterId,
                      play: {
                        key: play.key,
                        title: play.title,
                        hitRate: play.hitRate,
                        kind: play.kind,
                        detail: play.detail,
                        evidence: play.evidence,
                      },
                    })
                  }
                />
              </div>
            </div>
          ))}
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
