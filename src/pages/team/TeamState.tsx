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
//   WINDOW     windowPressure is blended from starterAgePressure, which is
//              itself the value-weighted share of each starter's career that
//              is already spent, read off the measured aging curves. So the
//              report is per starter: how much career is left, and how much of
//              your lineup value is sitting on players with little of it. That
//              IS the window calculation, one level down.
//
//   POSITIONS  Each side against the floors classifySide actually tested.
//              Previously this showed a league-rank plot beside the label, and
//              the two contradicted each other in public: a QB cover slot can
//              sit mid-pack among 16 teams and still be CRITICAL, because the
//              test is an absolute floor and a z against the global player
//              pool, and never a league rank. Drawing the real floors makes
//              the label self-evident instead of arbitrary.

import { agePressure, effectiveAge, fillStarters } from "../../algo/profile.ts";
import {
  PICK_ADJUSTMENT_BY_FLAG,
  WINDOW_LONG_THRESHOLD,
  WINDOW_SHORT_THRESHOLD,
} from "../../algo/constants.ts";
import {
  FRINGE_MAX_AGE,
  VETERAN_SELL_AGE,
  VETERAN_SELL_VALUE,
  fringeBand,
  leagueRanking,
} from "../../algo/plays.ts";
import type {
  ClassifyEvidence,
  LeagueFormat,
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
  /** Remaining production as a share of a 23 year old's AT THE SAME POSITION. */
  left: number;
  /** This starter's share of the starting lineup's redraft value, which is
   *  exactly the weight starterAgePressure gives him. */
  share: number;
};

function starterRows(me: TeamProfile, format: LeagueFormat): StarterRow[] {
  const { starters } = fillStarters(me.players, format);
  const flat: Player[] = [];
  for (const pos of POSITIONS) flat.push(...starters[pos]);
  const total = flat.reduce((s, p) => s + p.valueRedraft, 0) || 1;
  return flat
    .filter((p) => p.age != null)
    .map((p) => {
      // effectiveAge, not p.age: that is what starterAgePressure averages, so
      // reading calendar age here would print rows that do not reconcile with
      // the total they are supposed to explain.
      const effAge = effectiveAge(p);
      return {
        player: p,
        effAge,
        left: 100 - agePressure(effAge, p.position),
        share: (p.valueRedraft / total) * 100,
      };
    })
    .sort((a, b) => b.share - a.share || a.player.id.localeCompare(b.player.id));
}

function runwayColor(left: number) {
  if (left >= 75) return "#22c55e";
  if (left >= 50) return "#eab308";
  return "#ef4444";
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

function WindowReport({ me, format }: { me: TeamProfile; format: LeagueFormat }) {
  const rows = starterRows(me, format);
  const pickAdj = PICK_ADJUSTMENT_BY_FLAG[me.pickCapital.flag];

  return (
    <div className="state-panel">
      <div className="state-report-head">
        <span className="state-report-title">WINDOW · WHERE THE PRESSURE COMES FROM</span>
        <span className="state-report-value">{me.windowTier}</span>
      </div>
      <p className="state-report-sub">
        Age pressure {me.starterAgePressure.toFixed(1)}
        {pickAdj !== 0
          ? `, ${pickAdj > 0 ? "plus" : "minus"} ${Math.abs(pickAdj)} for being ${pickFlagText(me.pickCapital.flag).toLowerCase()}`
          : ", with no pick adjustment"}
        , gives {me.windowPressure.toFixed(1)}. MID starts at {WINDOW_LONG_THRESHOLD}, SHORT at{" "}
        {WINDOW_SHORT_THRESHOLD}. The scale is tighter than it looks.
      </p>
      <WindowGauge pressure={me.windowPressure} />
      <p className="state-report-sub">
        Age pressure is the value-weighted average of the rows below, so your biggest starters move
        it most. Each bar is production left against a 23 year old at the SAME position.
      </p>
      <div className="state-runways">
        {rows.map((r) => {
          const cal = r.player.age as number;
          const adjusted = Math.abs(r.effAge - cal) >= 0.05;
          return (
            <div key={r.player.id} className="state-runway-row">
              <span className="pos-tag" style={{ background: posColor(r.player.position) }}>
                {r.player.position}
              </span>
              <span className="state-runway-name">{r.player.name}</span>
              <span
                className="state-runway-age"
                {...(adjusted
                  ? { title: `${cal.toFixed(1)} calendar, judged as ${r.effAge.toFixed(1)} on his aging signal` }
                  : {})}
              >
                {cal.toFixed(1)}
                {adjusted ? "*" : ""}
              </span>
              <span className="state-bar-track">
                <span
                  className="state-bar-fill"
                  style={{ width: `${r.left}%`, background: runwayColor(r.left) }}
                />
              </span>
              <span className="state-runway-left">{r.left.toFixed(0)}%</span>
              <span className="state-runway-runway" title="Share of your starting lineup value">
                {r.share.toFixed(0)}%
              </span>
            </div>
          );
        })}
      </div>
      <p className="state-foot">
        Measured off nflverse 1999-2024 production, per position, so the bars are not comparable
        across positions: quarterbacks decline so slowly that a 33 year old still reads high, while
        a running back the same age does not. An asterisk means an aging signal moved him.
      </p>
    </div>
  );
}

// ── Roster shape ─────────────────────────────────────────────────────────────

function RosterShape({ me, league }: { me: TeamProfile; league: TeamProfile[] }) {
  const W = 340;
  const H = 200;
  const pad = { top: 12, right: 10, bottom: 26, left: 40 };
  const fw = W - pad.left - pad.right;
  const fh = H - pad.top - pad.bottom;

  const players = me.players.filter((p) => p.age != null && p.valueDynasty > 0);
  const band = fringeBand(leagueRanking(league));

  const AGE_MIN = 21;
  const AGE_MAX = 34;
  const maxValue = Math.max(1, ...players.map((p) => p.valueDynasty));

  const px = (age: number) =>
    pad.left + ((Math.max(AGE_MIN, Math.min(AGE_MAX, age)) - AGE_MIN) / (AGE_MAX - AGE_MIN)) * fw;
  const py = (v: number) => pad.top + (1 - Math.min(1, v / maxValue)) * fh;

  return (
    <div className="state-panel">
      <div className="state-report-head">
        <span className="state-report-title">ROSTER SHAPE</span>
        <span className="state-report-value">{players.length} priced</span>
      </div>
      <p className="state-report-sub">
        Everyone you own by age and dynasty value, with the two zones the scouting report below
        actually names.
      </p>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="state-shape-svg"
        role="img"
        aria-label="Your roster plotted by age against dynasty value"
      >
        <rect
          x={px(VETERAN_SELL_AGE)}
          y={py(maxValue)}
          width={Math.max(0, px(AGE_MAX) - px(VETERAN_SELL_AGE))}
          height={Math.max(0, py(VETERAN_SELL_VALUE) - py(maxValue))}
          fill="rgba(239,68,68,0.09)"
          stroke="rgba(239,68,68,0.28)"
          strokeDasharray="3 3"
        />
        {band && (
          <rect
            x={px(AGE_MIN)}
            y={py(band.hi)}
            width={Math.max(0, px(FRINGE_MAX_AGE) - px(AGE_MIN))}
            height={Math.max(0, py(band.lo) - py(band.hi))}
            fill="rgba(34,197,94,0.09)"
            stroke="rgba(34,197,94,0.28)"
            strokeDasharray="3 3"
          />
        )}
        <line x1={pad.left} y1={pad.top + fh} x2={pad.left + fw} y2={pad.top + fh} stroke={GRID} />
        <line x1={pad.left} y1={pad.top} x2={pad.left} y2={pad.top + fh} stroke={GRID} />
        {players.map((p) => (
          <circle
            key={p.id}
            cx={px(p.age as number)}
            cy={py(p.valueDynasty)}
            r={3.2}
            fill={ACCENT}
            fillOpacity={0.75}
          >
            <title>{`${p.name} · ${(p.age as number).toFixed(1)} · ${p.valueDynasty.toLocaleString()}`}</title>
          </circle>
        ))}
        {[AGE_MIN, 25, 28, 31, AGE_MAX].map((a) => (
          <text key={a} x={px(a)} y={H - 12} fill={AXIS_TEXT} fontSize={8} textAnchor="middle">
            {a}
          </text>
        ))}
        <text x={pad.left + fw / 2} y={H - 2} fill={AXIS_TEXT} fontSize={8} textAnchor="middle">
          age
        </text>
        <text x={4} y={pad.top + 6} fill={AXIS_TEXT} fontSize={8}>{fmt(maxValue)}</text>
        <text x={4} y={pad.top + fh} fill={AXIS_TEXT} fontSize={8}>0</text>
      </svg>
      <div className="state-shape-key">
        <span><i className="state-key-swatch state-key-sell" /> sell while still valuable</span>
        <span><i className="state-key-swatch state-key-buy" /> the fringe worth buying</span>
      </div>
    </div>
  );
}

// ── Positions, against the floors that decided the label ─────────────────────

function FloorGauge({ ev, label }: { ev: ClassifyEvidence; label: SubClassification }) {
  // Scale so the NEED floor always sits at 60% of the track. Scaled to the
  // value itself the floors would land somewhere different on every row, and
  // there would be nothing to compare across positions.
  const scale = ev.needFloor > 0 ? ev.needFloor / 0.6 : Math.max(1, ev.minSlotValue);
  const pct = (v: number) => Math.max(0, Math.min(100, (v / scale) * 100));
  const color = POS_CLASS_COLOR[label] ?? "#64748b";
  return (
    <span
      className="state-gauge"
      title={`weakest slot ${fmt(ev.minSlotValue)} · need floor ${fmt(ev.needFloor)} · critical floor ${fmt(ev.criticalFloor)}`}
    >
      <span className="state-bar-track">
        <span className="state-bar-fill" style={{ width: `${pct(ev.minSlotValue)}%`, background: color }} />
        <span className="state-floor state-floor-crit" style={{ left: `${pct(ev.criticalFloor)}%` }} />
        <span className="state-floor state-floor-need" style={{ left: `${pct(ev.needFloor)}%` }} />
      </span>
      <span className="state-gauge-num">{fmt(ev.minSlotValue)}</span>
    </span>
  );
}

function PositionRow({ pos, me }: { pos: Position; me: TeamProfile }) {
  const ps = me.positionScores[pos];
  const top = me.players
    .filter((p) => p.position === pos)
    .sort((a, b) => b.valueDynasty - a.valueDynasty || a.id.localeCompare(b.id))[0];
  const ev = ps.evidence;

  return (
    <div className="pos-dash-row">
      <span className="pos-tag" style={{ background: posColor(pos) }}>{pos}</span>
      <div className="pos-dash-class">
        <span style={{ color: POS_CLASS_COLOR[ps.starterClassification ?? "HEALTHY"], fontWeight: 700, fontSize: 11 }}>
          {ps.starterClassification ?? ps.classification.replace("_", " ")}
        </span>
        <span style={{ color: "#475569", fontSize: 10 }}> / </span>
        <span style={{ color: POS_CLASS_COLOR[ps.depthClassification ?? "HEALTHY"], fontWeight: 700, fontSize: 10 }}>
          {ps.depthClassification ?? "—"}
        </span>
        <span style={{ color: "#475569", fontSize: 10 }}> · {ps.urgency.toFixed(0)}</span>
      </div>
      <div className="pos-dash-metric" data-label="START">
        {ev ? (
          <FloorGauge ev={ev.starter} label={ps.starterClassification ?? "HEALTHY"} />
        ) : (
          <span className="state-gauge-num">{fmt(ps.starterValue)}</span>
        )}
      </div>
      <div className="pos-dash-metric" data-label="DEPTH">
        {ev ? (
          <FloorGauge ev={ev.depth} label={ps.depthClassification ?? "HEALTHY"} />
        ) : (
          <span className="state-gauge-num">{fmt(ps.depthValue)}</span>
        )}
      </div>
      <span className="pos-dash-player">
        {top ? `${top.name}${top.age != null ? ` (${Number(top.age).toFixed(1)})` : ""}` : "—"}
      </span>
    </div>
  );
}

function PositionTable({ me }: { me: TeamProfile }) {
  const hasEvidence = POSITIONS.some((p) => me.positionScores[p].evidence);
  return (
    <div className="pos-dashboard state-positions">
      <div className="state-report-head">
        <span className="state-report-title">POSITIONS · WEAKEST SLOT VS THE FLOORS</span>
      </div>
      <p className="state-report-sub">
        {hasEvidence
          ? "Each bar is the weakest slot you would actually have to start there. The two ticks are the thresholds that set the label: under the left one reads CRITICAL, under the right one NEED. They are absolute, not a league ranking, so a thin position stays thin even in a weak league."
          : "Re-sync this league to see the thresholds behind each label."}
      </p>
      <div className="pos-dash-header-row">
        <div />
        <div className="pos-dash-col-label">CLASSIFICATION</div>
        <div className="pos-dash-col-label">STARTERS</div>
        <div className="pos-dash-col-label">DEPTH</div>
        <div className="pos-dash-col-label">BEST PLAYER</div>
      </div>
      {POSITIONS.map((pos) => (
        <PositionRow key={pos} pos={pos} me={me} />
      ))}
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
      </div>
      <div className="state-grid">
        <RosterShape me={me} league={league} />
        <div className="state-panel state-panel-wide">
          <PositionTable me={me} />
        </div>
      </div>
    </section>
  );
}
