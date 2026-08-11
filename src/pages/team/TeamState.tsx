// TEAM STATE: the numbers underneath the verdicts, not the verdicts again.
//
// The first version of this plotted starter strength, window and pick capital
// as league strips. That was a mistake: the header chips already say "rank #3"
// and "CLOSING", so a dot showing you are third restated a label instead of
// explaining it. This section only earns space by answering "why".
//
// Three reports, each one a layer below a badge on this page:
//
//   SCORING    Actual points per game against the league, from the most recent
//              season anyone has played. The only thing here that is not
//              derived from FantasyCalc values, and the one number a manager
//              can check against his own memory of the season.
//
//   UNBANKED   How much of what you own has not been paid out yet.
//
//   NO WINDOW PANEL. There was one, showing a gauge and a per-asset breakdown
//   of the pressure number, and it is gone on purpose. Do not add it back
//   without a reason that is not "the number exists so it should be shown".
//
//   The window is a one-dimensional collapse of the two ranks the page already
//   prints in its header, and the state grid replaced it as the thing the
//   engine gates on. A panel decomposing it explained how we get from two
//   numbers a manager can read to one he cannot, which is motion, not
//   explanation. Its previous two incarnations both had to be retired for
//   describing formulas the app had already stopped using.
//
//   POSITIONS  Each side against the floors classifySide actually tested.
//              Previously this showed a league-rank plot beside the label, and
//              the two contradicted each other in public: a QB cover slot can
//              sit mid-pack among 16 teams and still be CRITICAL, because the
//              test is an absolute floor and a z against the global player
//              pool, and never a league rank. Drawing the real floors makes
//              the label self-evident instead of arbitrary.

import { Link } from "react-router-dom";
import { depthByPosition, fillStarters } from "../../algo/profile.ts";
import type { LedgerRow } from "../../api/client.ts";
import { BAD, GOOD } from "../../ui/theme.ts";
import type {
  ClassifyEvidence,
  LeagueFormat,
  Pick,
  Player,
  Position,
  SubClassification,
  TeamProfile,
} from "../../algo/types.ts";
import { posColor } from "../../ui/theme.ts";

const ACCENT = "#42bfdd";
const GRID = "rgba(255,255,255,0.07)";
const AXIS_TEXT = "#7e8477";

const POSITIONS: Position[] = ["QB", "RB", "WR", "TE"];

const POS_CLASS_COLOR: Record<string, string> = {
  CRITICAL_NEED: "#ee4266",
  CRITICAL: "#ee4266",
  NEED: "#f6f740",
  HEALTHY: "#999e8d",
  SURPLUS: "#18f2b2",
};


const fmt = (n: number) => Math.round(n).toLocaleString();

/** The one place a PickFlag becomes words. */
export const pickFlagText = (flag: string) =>
  flag === "NEUTRAL" ? "FINE" : flag.replace("_", " ");

// ── Scoring ──────────────────────────────────────────────────────────────────

function Scoring({ me, league }: { me: TeamProfile; league: TeamProfile[] }) {
  // Only compare within one season. A league that changed size mid-chain can
  // leave a team carrying an older season's numbers, and ranking those against
  // this year's would invent a standing that never happened.
  const season = me.scoring?.season;
  const field = league.filter(
    (t) => t.scoring && t.scoring.weeks > 0 && t.scoring.season === season,
  );

  if (!me.scoring || field.length < 2) {
    return (
      <div className="state-panel">
        <div className="state-report-head">
          <span className="state-report-title">SCORING</span>
        </div>
        <p className="state-empty">
          No completed season on record for this league yet, so there is no real
          points per game to compare. It appears here once games have been
          played.
        </p>
      </div>
    );
  }

  const rows = [...field].sort(
    (a, b) => b.scoring!.ppg - a.scoring!.ppg || a.rosterId - b.rosterId,
  );
  const max = rows[0]!.scoring!.ppg;
  const rank = rows.findIndex((t) => t.rosterId === me.rosterId) + 1;
  const mean = rows.reduce((s, t) => s + t.scoring!.ppg, 0) / rows.length;
  const diff = me.scoring.ppg - mean;

  return (
    <div className="state-panel">
      <div className="state-report-head">
        <span className="state-report-title">
          SCORING · {me.scoring.season}
          {me.scoring.live ? " (in progress)" : ""}
        </span>
        <span className="state-report-value">
          {me.scoring.ppg.toFixed(1)} PPG · #{rank}
        </span>
      </div>
      <p className="state-report-sub">
        {diff >= 0 ? "+" : ""}
        {diff.toFixed(1)} a game against the league average of {mean.toFixed(1)}
        , over {me.scoring.weeks} weeks.
      </p>
      <div className="state-bars">
        {rows.map((t) => {
          const mine = t.rosterId === me.rosterId;
          return (
            <div
              key={t.rosterId}
              className={`state-bar-row${mine ? " state-bar-mine" : ""}`}
            >
              <span className="state-bar-name">{t.ownerName}</span>
              <span className="state-bar-track">
                <span
                  className="state-bar-fill"
                  style={{
                    width: `${(t.scoring!.ppg / max) * 100}%`,
                    background: mine ? ACCENT : "rgba(148,163,184,0.30)",
                  }}
                />
              </span>
              <span className="state-bar-num">{t.scoring!.ppg.toFixed(1)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Positions ────────────────────────────────────────────────────────────────
//
// This started as two league-rank plots, then became floor gauges with
// threshold ticks and a sigma figure. Both were wrong for opposite reasons:
// the ranks contradicted the label, and the gauges were accurate but needed
// decoding before they told you anything.
//
// What a manager wants here is "is this a problem, and how bad" in one glance.
// So the visual is a four step severity meter driven BY the classification,
// which means it cannot contradict the label the way a separately-computed
// plot can. The numbers that produced the label (weakest slot, both floors,
// the sigma, and which test actually bound) move into the tooltip, where they
// are available without being in the way.

const SEVERITY_STEPS: SubClassification[] = [
  "CRITICAL",
  "NEED",
  "HEALTHY",
  "SURPLUS",
];

function SeverityCell({
  label,
  ev,
  player,
}: {
  label: SubClassification;
  ev?: ClassifyEvidence;
  /** The player this side is judged ON. The old table showed each position's
   *  BEST player, which is the one number the label never looks at: a room can
   *  be CRITICAL precisely because everything behind the best guy is empty. */
  player: Player | undefined;
}) {
  const level = Math.max(0, SEVERITY_STEPS.indexOf(label));
  const color = POS_CLASS_COLOR[label] ?? "#999e8d";
  return (
    <div className="state-sev">
      <div className="state-sev-top">
        <span className="state-sev-steps" aria-hidden="true">
          {SEVERITY_STEPS.map((_, i) => (
            <span
              key={i}
              className="state-sev-step"
              style={i <= level ? { background: color } : undefined}
            />
          ))}
        </span>
        <span className="state-sev-label" style={{ color }}>
          {label}
        </span>
      </div>
      <div className="state-sev-sub">
        <span className="state-sev-player">
          {player ? player.name : "nobody"}
        </span>
        {ev && (
          <span className="state-sev-nums">
            {fmt(ev.minSlotValue)} · floor {fmt(ev.needFloor)} ·{" "}
            <span
              className={
                Math.min(ev.minSlotZ, ev.weightedZ) < -1 ? "state-z-bad" : ""
              }
            >
              {Math.min(ev.minSlotZ, ev.weightedZ).toFixed(1)}σ
            </span>
          </span>
        )}
      </div>
    </div>
  );
}

function PositionRow({
  pos,
  me,
  weakestStarter,
  topBackup,
}: {
  pos: Position;
  me: TeamProfile;
  weakestStarter: Player | undefined;
  topBackup: Player | undefined;
}) {
  const ps = me.positionScores[pos];
  return (
    <div className="pos-dash-row">
      <span className="pos-tag" style={{ background: posColor(pos) }}>
        {pos}
      </span>
      <div className="pos-dash-metric" data-label="WEAKEST STARTER">
        <SeverityCell
          label={ps.starterClassification ?? "HEALTHY"}
          player={weakestStarter}
          {...(ps.evidence ? { ev: ps.evidence.starter } : {})}
        />
      </div>
      <div className="pos-dash-metric" data-label="TOP BACKUP">
        <SeverityCell
          label={ps.depthClassification ?? "HEALTHY"}
          player={topBackup}
          {...(ps.evidence ? { ev: ps.evidence.depth } : {})}
        />
      </div>
    </div>
  );
}

function PositionTable({
  me,
  format,
}: {
  me: TeamProfile;
  format: LeagueFormat;
}) {
  // The exact slots each label is judged on: the base starter slots for the
  // starter side, the first cover slot for depth. Same helpers profile.ts uses.
  const { starters } = fillStarters(me.players, format);
  const depth = depthByPosition(me.players, format);
  const baseSlots = (pos: Position) =>
    pos === "QB" && format.starterSlots.SUPER_FLEX > 0
      ? format.starterSlots.QB + 1
      : format.starterSlots[pos];
  return (
    <div className="pos-dashboard state-positions">
      <div className="state-report-head">
        <span className="state-report-title">POSITIONS</span>
      </div>
      <p className="state-report-sub">
        Your weakest starter and the man behind him, against the floor each has
        to clear.
      </p>
      <div className="pos-dash-header-row">
        <div />
        <div className="pos-dash-col-label">WEAKEST STARTER</div>
        <div className="pos-dash-col-label">TOP BACKUP</div>
      </div>
      {POSITIONS.map((pos) => (
        <PositionRow
          key={pos}
          pos={pos}
          me={me}
          weakestStarter={starters[pos].slice(0, baseSlots(pos)).at(-1)}
          topBackup={depth[pos][0]}
        />
      ))}
    </div>
  );
}

// UNBANKED VALUE: how much of a roster the market has not yet been paid for.
//
// FantasyCalc publishes a dynasty value and a redraft value for the same
// player. Dynasty is what the right to him is worth; redraft is what he is
// worth THIS season. The gap is the market's own statement of how much of his
// value is still in front of him, and unlike our aging curve it is priced per
// player rather than read off a curve by age.
//
//   unbanked = 1 - redraft / dynasty
//
// Written that way round on purpose. The first attempt used dynasty/redraft,
// which divides by a number that goes to nearly zero for a stashed rookie: one
// bench read 162.3 and two read 0.00. Dividing by dynasty keeps it bounded and
// makes it a percentage anyone can read. Measured across this league it lands
// between 9% and 81% at roster level.
//
// NEGATIVE is meaningful and worth reading twice: it means the lineup produces
// MORE this season than its dynasty price implies. Value already banked, not
// still owed. Contending lineups sit there.
//
// This is deliberately NOT wired into any score. It sits beside the window
// report as a second reading, because the two only agree at Spearman 0.60 and
// the disagreements look real: a roster can hold the 5th oldest lineup in the
// league and the 2nd most unrealised one at the same time, which the aging
// curve has no way to say.
// Picks fold in for free and are the cleanest case in the whole idea: a pick
// carries dynasty value and cannot score a point this season, so it is 100%
// unbanked by construction. Nothing has to be assumed about it.
//
// That also gives a continuous reading where `pickCapital.flag` only has three
// settings, and the flag turns out to be too coarse to trust: across this
// league NEUTRAL covers everything from 9% to 47% of assets held in picks, so
// it separates FustinJerguson (PICK_RICH, 49%) from Numlckr (NEUTRAL, 47%)
// while calling Numlckr the same as a team with 9%.
function unbanked(
  players: Player[],
  picks: Pick[] = [],
): { amount: number; share: number; fromPicks: number } | null {
  let dyn = 0;
  let red = 0;
  for (const p of players) {
    if (!p.valueDynasty) continue;
    dyn += p.valueDynasty;
    red += p.valueRedraft ?? 0;
  }
  // A pick has dynasty value and cannot score a point this season, so it is
  // 100% unbanked by construction: its full value is part of the amount.
  const fromPicks = picks.reduce((s, k) => s + (k.value || 0), 0);
  dyn += fromPicks;
  if (dyn <= 0) return null;
  return { amount: dyn - red, share: 1 - red / dyn, fromPicks };
}

function UnbankedReport({
  me,
  league,
  format,
}: {
  me: TeamProfile;
  league: TeamProfile[];
  format: LeagueFormat;
}) {
  const startersOf = (t: TeamProfile): Player[] => {
    const { starters } = fillStarters(t.players, format);
    return POSITIONS.flatMap((p) => starters[p]);
  };

  // Ranked and drawn on the AMOUNT, not the share.
  //
  // This used to sort on share, which answers a different question than the
  // panel's title. A share is normalised by the size of your own roster, so the
  // team with the highest percentage is not the team holding the most unbanked
  // value: in this league Gibbs16 leads on share at 92% and sits third on
  // amount, because 92% of a small roster is less than 84% of a big one. The
  // panel said "#1" next to the word UNBANKED VALUE and meant "#1 in a ratio".
  //
  // The share is still shown, because how much of YOUR OWN roster is deferred
  // is a real and different fact. It just is not a league ranking.
  const rows = league
    .map((t) => {
      const all = unbanked(t.players, t.picks);
      const st = unbanked(startersOf(t));
      return {
        rosterId: t.rosterId,
        ownerName: t.ownerName,
        roster: all,
        starters: st,
        pickShare:
          t.picks.reduce((s, k) => s + (k.value || 0), 0) /
          Math.max(
            1,
            t.players.reduce((s, x) => s + (x.valueDynasty || 0), 0) +
              t.picks.reduce((s, k) => s + (k.value || 0), 0),
          ),
      };
    })
    .filter(
      (
        r,
      ): r is typeof r & {
        roster: { amount: number; share: number };
        starters: { amount: number; share: number };
      } => r.roster != null && r.starters != null,
    )
    .sort(
      (a, b) => b.roster.amount - a.roster.amount || a.rosterId - b.rosterId,
    );

  const mine = rows.find((r) => r.rosterId === me.rosterId);
  if (!mine || rows.length < 2) return null;
  const rank = rows.findIndex((r) => r.rosterId === me.rosterId) + 1;

  // Left-aligned from zero, like SCORING, rather than diverging from a centre.
  // The first pass used a signed bar and it was wasted: once picks are counted
  // every roster in the league is positive, so half the track was dead and the
  // centre line marked an edge nothing ever crossed. The sign only flips on the
  // STARTERS figure, which is a sentence, not a bar.
  const span = Math.max(...rows.map((r) => r.roster.amount), 1);
  const pct = (n: number) => `${n < 0 ? "" : "+"}${Math.round(n * 100)}%`;

  return (
    <div className="state-panel">
      <div className="state-report-head">
        <span className="state-report-title">UNBANKED VALUE</span>
        <span className="state-report-value">
          {fmt(mine.roster.amount)} · #{rank}
        </span>
      </div>
      {/* A key, not a paragraph. The two segments are the whole idea; spelling
          it out in prose asked the reader to hold four numbers in their head to
          learn what a colour already says. */}
      <div className="state-key">
        <span className="state-key-item">
          <span className="state-key-swatch" style={{ background: ACCENT }} />
          players, beyond what they score now
        </span>
        <span className="state-key-item">
          <span
            className="state-key-swatch"
            style={{ background: "rgba(255,255,255,0.55)" }}
          />
          picks, which score nothing yet
        </span>
      </div>
      <div className="state-bars">
        {rows.map((r) => {
          const isMe = r.rosterId === me.rosterId;
          return (
            <div
              key={r.rosterId}
              className={`state-bar-row${isMe ? " state-bar-mine" : ""}`}
            >
              <span className="state-bar-name">{r.ownerName}</span>
              <span
                className="state-bar-track"
                title={`${fmt(r.roster.fromPicks)} of ${fmt(r.roster.amount)} is picks`}
              >
                <span
                  className="state-bar-fill"
                  style={{
                    width: `${Math.max(0, (r.roster.amount / span) * 100)}%`,
                    background: isMe ? ACCENT : "rgba(148,163,184,0.30)",
                  }}
                />
                {/* The pick portion, drawn over the left of the same bar. Picks
                    are unbanked by definition, so a team can lead this chart on
                    picks alone; without the split, "most unbanked value" and
                    "most deferred PLAYER value" look like the same claim. */}
                <span
                  className="state-bar-fill state-bar-fill-picks"
                  style={{
                    width: `${Math.max(0, (r.roster.fromPicks / span) * 100)}%`,
                    background: isMe
                      ? "rgba(255,255,255,0.55)"
                      : "rgba(226,232,240,0.22)",
                  }}
                />
              </span>
              <span className="state-bar-num">{fmt(r.roster.amount)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Trade record. We are a trade app; how a manager has actually traded belongs
 * beside how his roster looks.
 *
 * The ledger was already being fetched on this page and thrown away, so this
 * costs no extra request. Reads as a record because that is what a manager
 * already knows how to read, and links out rather than explaining itself.
 */
function TradeRecord({
  row,
  ledger,
  leagueId,
}: {
  row: LedgerRow;
  ledger: LedgerRow[];
  leagueId: string;
}) {
  const ranked = [...ledger].sort(
    (a, b) => b.netValue - a.netValue || a.rosterId - b.rosterId,
  );
  const rank = ranked.findIndex((r) => r.rosterId === row.rosterId) + 1;
  const up = row.netValue >= 0;
  const record = `${row.wins}-${row.losses}${row.ties ? `-${row.ties}` : ""}`;
  return (
    <div className="state-panel">
      <div className="state-report-head">
        <span className="state-report-title">TRADE RECORD</span>
        <span className="state-report-value">
          {row.trades === 0 ? "no trades" : `${record} · #${rank}`}
        </span>
      </div>
      {row.trades === 0 ? (
        <p className="state-report-sub">Nothing to grade yet.</p>
      ) : (
        <>
          <p className="state-report-sub">
            Across {row.trades} trade{row.trades === 1 ? "" : "s"}, value{" "}
            {up ? "gained" : "lost"}{" "}
            <span style={{ color: up ? GOOD : BAD, fontWeight: 700 }}>
              {up ? "+" : ""}
              {fmt(row.netValue)}
            </span>
            .
          </p>
          <div className="state-bars">
            {ranked.map((r) => {
              const mine = r.rosterId === row.rosterId;
              const span = Math.max(...ranked.map((x) => Math.abs(x.netValue)), 1);
              const w = (Math.abs(r.netValue) / span) * 50;
              return (
                <div
                  key={r.rosterId}
                  className={`state-bar-row${mine ? " state-bar-mine" : ""}`}
                >
                  <span className="state-bar-name">{r.managerName}</span>
                  {/* Diverging from the centre: a trade record is signed, and a
                      left-anchored bar cannot show which side of zero it is. */}
                  <span className="state-bar-track">
                    <span className="state-pull-axis-line" />
                    <span
                      className="state-bar-fill"
                      style={{
                        width: `${w}%`,
                        [r.netValue >= 0 ? "left" : "right"]: "50%",
                        background: r.netValue >= 0 ? GOOD : BAD,
                        opacity: mine ? 1 : 0.45,
                      }}
                    />
                  </span>
                  <span className="state-bar-num">
                    {r.netValue >= 0 ? "+" : ""}
                    {fmt(r.netValue)}
                  </span>
                </div>
              );
            })}
          </div>
        </>
      )}
      <Link className="state-more-link" to={`/league/${leagueId}/trades`}>
        Every trade, graded →
      </Link>
    </div>
  );
}

export default function TeamState({
  me,
  league,
  format,
  tradeRow,
  ledger,
  leagueId,
}: {
  me: TeamProfile;
  league: TeamProfile[];
  format: LeagueFormat;
  tradeRow: LedgerRow | null;
  ledger: LedgerRow[] | null;
  leagueId: string;
}) {
  if (league.length < 2) return null;
  return (
    <section className="dive-pos-section">
      <h2 className="section-title">TEAM STATE</h2>
      <p className="dim-text scout-intro">
        The numbers under the badges.
      </p>
      <div className="state-grid">
        <Scoring me={me} league={league} />
        <UnbankedReport me={me} league={league} format={format} />
        {tradeRow && ledger && (
          <TradeRecord row={tradeRow} ledger={ledger} leagueId={leagueId} />
        )}
      </div>
      <div className="state-panel">
        <PositionTable me={me} format={format} />
      </div>
    </section>
  );
}
