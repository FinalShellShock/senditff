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
//   WINDOW     Per-starter age: how much career each one has left, read off
//              the measured curves, and how much of your lineup value sits on
//              players with little of it.
//
//              NOTE: this no longer explains windowPressure. The window is now
//              the standardised gap between contender value and dynasty value,
//              with no age term in it at all. Age is still real and still worth
//              seeing, it just is not what classifies the roster any more. Do
//              not reword this back into "that IS the window calculation": that
//              claim was true and is not.
//
//   POSITIONS  Each side against the floors classifySide actually tested.
//              Previously this showed a league-rank plot beside the label, and
//              the two contradicted each other in public: a QB cover slot can
//              sit mid-pack among 16 teams and still be CRITICAL, because the
//              test is an absolute floor and a z against the global player
//              pool, and never a league rank. Drawing the real floors makes
//              the label self-evident instead of arbitrary.

import { agePressure, depthByPosition, effectiveAge, fillStarters } from "../../algo/profile.ts";
import {
  WINDOW_LONG_THRESHOLD,
  WINDOW_SHORT_THRESHOLD,
} from "../../algo/constants.ts";
import type {
  ClassifyEvidence,
  LeagueFormat,
  Pick,
  Player,
  Position,
  SubClassification,
  TeamProfile,
} from "../../algo/types.ts";

const ACCENT = "#f59e0b";
const GRID = "rgba(255,255,255,0.07)";
const AXIS_TEXT = "#475569";

const POSITIONS: Position[] = ["QB", "RB", "WR", "TE"];

const POS_CLASS_COLOR: Record<string, string> = {
  CRITICAL_NEED: "#ef4444",
  CRITICAL:      "#ef4444",
  NEED:          "#eab308",
  HEALTHY:       "#64748b",
  SURPLUS:       "#22c55e",
};

function posColor(pos: string) {
  const map: Record<string, string> = { QB: "#c2410c", RB: "#ca8a04", WR: "#3b82f6", TE: "#a855f7" };
  return map[pos] ?? "#94a3b8";
}

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
  const field = league.filter((t) => t.scoring && t.scoring.weeks > 0 && t.scoring.season === season);

  if (!me.scoring || field.length < 2) {
    return (
      <div className="state-panel">
        <div className="state-report-head">
          <span className="state-report-title">SCORING</span>
        </div>
        <p className="state-empty">
          No completed season on record for this league yet, so there is no real points per game to
          compare. It appears here once games have been played.
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
        {diff.toFixed(1)} a game against the league average of {mean.toFixed(1)}, over{" "}
        {me.scoring.weeks} weeks.
      </p>
      <div className="state-bars">
        {rows.map((t) => {
          const mine = t.rosterId === me.rosterId;
          return (
            <div key={t.rosterId} className={`state-bar-row${mine ? " state-bar-mine" : ""}`}>
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

// ── Window / age ─────────────────────────────────────────────────────────────

type StarterRow = {
  player: Player;
  /** The age the model actually judges him on. Equals calendar age unless an
   *  aging signal (rushing QBs today) knocks his remaining value down. */
  effAge: number;
  /** Age pressure, 0-100: the share of a 23 year old's remaining production at
   *  the same position that is already gone. */
  pressure: number;
  /** Share of the starting lineup's redraft value, 0-1. This is exactly the
   *  weight starterAgePressure gives him. */
  share: number;
  /** How hard this starter pulls the team average, in points: his distance
   *  from it times his share of lineup value.
   *
   *  These sum to ZERO by construction, which is what makes the two ends a
   *  real decomposition. Ranking on raw contribution (pressure x share) does
   *  not work: that number and its mirror both scale with share, so the single
   *  biggest starter tops BOTH lists and only a dedupe hides it. On this
   *  roster that put two 27.5 year old running backs in opposite groups. */
  pull: number;
};

function starterRows(me: TeamProfile, format: LeagueFormat): StarterRow[] {
  const { starters } = fillStarters(me.players, format);
  const flat: Player[] = [];
  for (const pos of POSITIONS) flat.push(...starters[pos]);
  // Filter BEFORE totalling. starterAgePressure skips players with no age on
  // both sides of its fraction, so including them in the denominator here
  // would make the shares sum to less than one and the contributions come up
  // short of the total they claim to explain.
  const aged = flat.filter((p) => p.age != null);
  const total = aged.reduce((s, p) => s + p.valueRedraft, 0) || 1;
  // The team average these are measured against. Recomputed from the same
  // inputs rather than read off the profile so the pulls provably sum to zero
  // even if one is ever rounded differently upstream.
  const avg =
    aged.reduce((s, p) => s + agePressure(effectiveAge(p), p.position) * p.valueRedraft, 0) / total;
  return aged
    .map((p) => {
      // effectiveAge, not p.age: that is what starterAgePressure averages, so
      // reading calendar age here would print rows that do not reconcile with
      // the total they are supposed to explain.
      const effAge = effectiveAge(p);
      const pressure = agePressure(effAge, p.position);
      const share = p.valueRedraft / total;
      return {
        player: p,
        effAge,
        pressure,
        share,
        pull: (pressure - avg) * share,
      };
    })
    .sort((a, b) => b.pull - a.pull || a.player.id.localeCompare(b.player.id));
}

/** Diverging bar for a signed, zero-sum quantity.
 *
 *  The bar used to be career-left as a percentage, which was the wrong picture:
 *  it is a per-player attribute on a 0-100 scale, so every bar sat somewhere in
 *  the 70-100 range and the group a player was in had no visible relationship
 *  to the length of his bar. This draws the thing the groups are actually
 *  built on, right of centre for pushing the window shorter and left for
 *  holding it open, scaled against the biggest mover in the lineup. */
function PullBar({ pull, scale }: { pull: number; scale: number }) {
  const half = Math.max(0, Math.min(50, (Math.abs(pull) / scale) * 50));
  const up = pull > 0;
  return (
    <span className="state-pull-track">
      <span className="state-pull-axis" />
      <span
        className={`state-pull-fill${up ? " state-pull-fill-up" : " state-pull-fill-down"}`}
        style={up ? { left: "50%", width: `${half}%` } : { right: "50%", width: `${half}%` }}
      />
    </span>
  );
}

/** windowPressure on the scale that actually decides the tier. */
function WindowGauge({ pressure }: { pressure: number }) {
  // The bands are narrow and low: LONG ends at 14, SHORT starts at 19, on a
  // number that is nominally 0-100. Printing "20 of 100" makes a SHORT badge
  // look like a bug, which is the same trap urgency fell into. Top of scale is
  // a little past SHORT so the live value has somewhere to sit.
  const MAX = 34;
  const pct = (v: number) => Math.max(0, Math.min(100, (v / MAX) * 100));
  return (
    <div className="state-window-gauge">
      <span className="state-bar-track">
        <span
          className="state-bar-fill"
          style={{
            width: `${pct(pressure)}%`,
            background:
              pressure > WINDOW_SHORT_THRESHOLD
                ? "#ef4444"
                : pressure > WINDOW_LONG_THRESHOLD
                  ? "#eab308"
                  : "#22c55e",
          }}
        />
        <span className="state-floor state-floor-need" style={{ left: `${pct(WINDOW_LONG_THRESHOLD)}%` }} />
        <span className="state-floor state-floor-crit" style={{ left: `${pct(WINDOW_SHORT_THRESHOLD)}%` }} />
      </span>
      <span className="state-window-bands">
        <span style={{ width: `${pct(WINDOW_LONG_THRESHOLD)}%` }}>LONG</span>
        <span style={{ width: `${pct(WINDOW_SHORT_THRESHOLD) - pct(WINDOW_LONG_THRESHOLD)}%` }}>MID</span>
        <span>SHORT</span>
      </span>
    </div>
  );
}

function StarterLine({
  row,
  scale,
  metricTitle,
}: {
  row: StarterRow;
  scale: number;
  metricTitle: string;
}) {
  const cal = row.player.age as number;
  const adjusted = Math.abs(row.effAge - cal) >= 0.05;
  return (
    <div className="state-runway-row">
      <span className="pos-tag" style={{ background: posColor(row.player.position) }}>
        {row.player.position}
      </span>
      <span className="state-runway-name">{row.player.name}</span>
      <span
        className="state-runway-age"
        {...(adjusted
          ? { title: `${cal.toFixed(1)} calendar, judged as ${row.effAge.toFixed(1)} on his aging signal` }
          : {})}
      >
        {cal.toFixed(1)}
        {adjusted ? "*" : ""}
      </span>
      {/* Column order must match the header strip above: AGE then WEAR. */}
      <span
        className="state-runway-wear"
        title={`${row.pressure.toFixed(0)}% of a 23 year old ${row.player.position}'s remaining career is already gone`}
      >
        {row.pressure.toFixed(0)}
      </span>
      <PullBar pull={row.pull} scale={scale} />
      <span
        className={`state-runway-runway${row.pull > 0 ? " state-pull-up" : " state-pull-down"}`}
        title={metricTitle}
      >
        {row.pull > 0 ? "+" : ""}
        {row.pull.toFixed(1)}
      </span>
    </div>
  );
}

function WindowReport({ me, format }: { me: TeamProfile; format: LeagueFormat }) {
  const rows = starterRows(me, format);
  // Two from each end of one ordering. No dedupe needed: pulls sum to zero, so
  // a player at the top cannot also be at the bottom.
  // Scaled against the biggest mover in the WHOLE lineup, not just the four
  // shown, so the bars keep their meaning when a team has no strong movers.
  const scale = Math.max(0.1, ...rows.map((r) => Math.abs(r.pull)));
  const shorter = rows.filter((r) => r.pull > 0).slice(0, 2);
  const open = rows
    .filter((r) => r.pull < 0)
    .slice(-2)
    .reverse();

  return (
    <div className="state-panel">
      <div className="state-report-head">
        <span className="state-report-title">WINDOW · WHERE THE PRESSURE COMES FROM</span>
        <span className="state-report-value">{me.teamState.replace("_", " ")}</span>
      </div>
      <p className="state-report-sub">
        Your lineup ranks #{me.starterRank} in the league for what it scores now, and your whole
        roster plus picks ranks #{me.dynastyRank} for what it is worth long term. The gap between
        those two, measured against the league, is your window: {me.windowPressure.toFixed(1)}.
        Under {WINDOW_LONG_THRESHOLD} the future outweighs the present, over{" "}
        {WINDOW_SHORT_THRESHOLD} the present outweighs the future.
      </p>
      <WindowGauge pressure={me.windowPressure} />
      <p className="state-report-sub">
        Age no longer sets your window, the gap above does. This is still worth seeing, because it
        is WHY the gap looks the way it does. Value-weighted across every startable slot, and WEAR
        is how much of a 23 year old's career is already gone AT THAT POSITION, so it is not
        comparable between them.
      </p>
      <div className="state-runways">
        <div className="state-runway-head">
          <span />
          <span />
          <span>AGE</span>
          <span>WEAR</span>
          <span />
          <span>PULL</span>
        </div>
        {shorter.length > 0 && (
          <div className="state-runway-group">PULLING IT SHORTER</div>
        )}
        {shorter.map((r) => (
          <StarterLine
            key={r.player.id}
            row={r}
            scale={scale}
            metricTitle={`${r.player.name} pushes your age pressure up ${r.pull.toFixed(1)} points: he is ${(r.pressure - me.starterAgePressure).toFixed(0)} above the team average and carries ${(r.share * 100).toFixed(0)}% of your lineup value`}
          />
        ))}
        {open.length > 0 && <div className="state-runway-group">HOLDING IT OPEN</div>}
        {open.map((r) => (
          <StarterLine
            key={r.player.id}
            row={r}
            scale={scale}
            metricTitle={`${r.player.name} pulls your age pressure down ${Math.abs(r.pull).toFixed(1)} points: he is ${Math.abs(r.pressure - me.starterAgePressure).toFixed(0)} below the team average and carries ${(r.share * 100).toFixed(0)}% of your lineup value`}
          />
        ))}
      </div>
      <p className="state-foot">
        Quarterbacks barely wear at all before 30, so an older one can still read lower than a
        younger receiver. Curves are measured, nflverse 1999-2024. An asterisk means an aging
        signal moved him.
      </p>
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

const SEVERITY_STEPS: SubClassification[] = ["CRITICAL", "NEED", "HEALTHY", "SURPLUS"];

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
  const color = POS_CLASS_COLOR[label] ?? "#64748b";
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
        <span className="state-sev-label" style={{ color }}>{label}</span>
      </div>
      <div className="state-sev-sub">
        <span className="state-sev-player">{player ? player.name : "nobody"}</span>
        {ev && (
          <span className="state-sev-nums">
            {fmt(ev.minSlotValue)} · floor {fmt(ev.needFloor)} ·{" "}
            <span className={Math.min(ev.minSlotZ, ev.weightedZ) < -1 ? "state-z-bad" : ""}>
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
      <span className="pos-tag" style={{ background: posColor(pos) }}>{pos}</span>
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

function PositionTable({ me, format }: { me: TeamProfile; format: LeagueFormat }) {
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
        Judged on the weakest slot you would have to start, and on the one man behind him. Each
        shows his value, the need floor he has to clear, and how far he sits from a typical player
        at that spot. Below -1 sigma is a need, below -2 is critical, and either that or the floor
        is enough to flag it.
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
function unbankedShare(players: Player[], picks: Pick[] = []): number | null {
  let dyn = 0;
  let red = 0;
  for (const p of players) {
    if (!p.valueDynasty) continue;
    dyn += p.valueDynasty;
    red += p.valueRedraft ?? 0;
  }
  for (const k of picks) dyn += k.value || 0; // redraft contribution is zero
  return dyn > 0 ? 1 - red / dyn : null;
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

  const rows = league
    .map((t) => ({
      rosterId: t.rosterId,
      ownerName: t.ownerName,
      roster: unbankedShare(t.players, t.picks),
      starters: unbankedShare(startersOf(t)),
      pickShare:
        t.picks.reduce((s, k) => s + (k.value || 0), 0) /
        Math.max(
          1,
          t.players.reduce((s, x) => s + (x.valueDynasty || 0), 0) +
            t.picks.reduce((s, k) => s + (k.value || 0), 0),
        ),
    }))
    .filter((r): r is typeof r & { roster: number; starters: number } =>
      r.roster != null && r.starters != null,
    )
    .sort((a, b) => b.roster - a.roster || a.rosterId - b.rosterId);

  const mine = rows.find((r) => r.rosterId === me.rosterId);
  if (!mine || rows.length < 2) return null;
  const rank = rows.findIndex((r) => r.rosterId === me.rosterId) + 1;

  // Left-aligned from zero, like SCORING, rather than diverging from a centre.
  // The first pass used a signed bar and it was wasted: once picks are counted
  // every roster in the league is positive (28% to 93% here), so half the track
  // was dead and the centre line marked an edge nothing ever crossed. The sign
  // only flips on the STARTERS figure, which is a sentence, not a bar.
  const span = Math.max(...rows.map((r) => r.roster), 0.05);
  const pct = (n: number) => `${n < 0 ? "" : "+"}${Math.round(n * 100)}%`;

  return (
    <div className="state-panel">
      <div className="state-report-head">
        <span className="state-report-title">UNBANKED VALUE</span>
        <span className="state-report-value">
          {pct(mine.roster)} · #{rank}
        </span>
      </div>
      <p className="state-report-sub">
        Share of everything you own that has not been paid out yet, from the gap between each
        player's dynasty and redraft price. Picks count in full, since they cannot score this
        season, and they are {Math.round(mine.pickShare * 100)}% of your assets. Your starting
        lineup alone is {pct(mine.starters)}.{" "}
        {mine.starters < 0
          ? "Negative means it out-produces its own dynasty price: that value is already banked."
          : "Higher means more of it is still in front of you."}
      </p>
      <div className="state-bars">
        {rows.map((r) => {
          const isMe = r.rosterId === me.rosterId;
          return (
            <div key={r.rosterId} className={`state-bar-row${isMe ? " state-bar-mine" : ""}`}>
              <span className="state-bar-name">{r.ownerName}</span>
              <span className="state-bar-track">
                <span
                  className="state-bar-fill"
                  style={{
                    width: `${Math.max(0, (r.roster / span) * 100)}%`,
                    background: isMe ? ACCENT : "rgba(148,163,184,0.30)",
                  }}
                />
              </span>
              <span className="state-bar-num">{pct(r.roster)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function TeamState({
  me,
  league,
  format,
}: {
  me: TeamProfile;
  league: TeamProfile[];
  format: LeagueFormat;
}) {
  if (league.length < 2) return null;
  return (
    <section className="dive-pos-section">
      <h2 className="section-title">TEAM STATE</h2>
      <p className="dim-text scout-intro">
        The numbers under the badges: what you actually scored, how much career your starters have
        left, and where each position sits against the thresholds that label it.
      </p>
      <div className="state-grid">
        <Scoring me={me} league={league} />
        <WindowReport me={me} format={format} />
        <UnbankedReport me={me} league={league} format={format} />
      </div>
      <div className="state-panel">
        <PositionTable me={me} format={format} />
      </div>
    </section>
  );
}
