// TEAM STATE: the picture the scouting plays are reading from.
//
// The plays below this section assert things like "you are a contender" and
// "buy the fringe, not the lottery tickets", and until now a manager had to
// take both on faith. The header chips give the verdicts (CLOSING, rank #3,
// picks FINE) but never show the distribution those verdicts came out of, so
// "rank #3 of 16" and "age 26.9" are unreadable without knowing what the rest
// of the league looks like.
//
// Two panels, each earning its place by explaining specific plays:
//
//   WHERE YOU SIT   strip plots of the whole league on the three axes that
//                   gate the plays: starter strength (contender vs rebuild),
//                   window pressure (sell-the-veteran, bank-picks), and pick
//                   capital (whether banking more is worth anything).
//
//   ROSTER SHAPE    age against dynasty value for this roster, with the two
//                   zones the plays actually name drawn on it. A manager can
//                   see he has nobody in the fringe band, or three guys in the
//                   sell-while-valuable corner, without reading a word.
//
// The zone bounds come from src/algo/plays.ts rather than being redeclared
// here. Drawn from local constants they drifted by a rounding step, which put
// a shaded band on screen that disagreed with the sentence right under it.

import {
  FRINGE_MAX_AGE,
  VETERAN_SELL_AGE,
  VETERAN_SELL_VALUE,
  fringeBand,
  leagueRanking,
} from "../../algo/plays.ts";
import type { Player, Position, TeamProfile } from "../../algo/types.ts";

/** The one place a PickFlag becomes words. Lived in TeamDeepDive, and the
 *  chart briefly rendered the raw flag instead, so the same datum read "FINE"
 *  in the header chip and "NEUTRAL" in the strip six inches below it. */
export const pickFlagText = (flag: string) =>
  flag === "NEUTRAL" ? "FINE" : flag.replace("_", " ");

const ACCENT = "#f59e0b";
const MUTED = "rgba(148,163,184,0.35)";

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

/** Every team on one axis, this team highlighted. The shared primitive behind
 *  both the headline strips and the per-position rows: a 0-100 score says
 *  nothing about whether the field is bunched or spread, and that is exactly
 *  the question "am I actually short at this position" turns on. */
function LeagueDots({
  values,
  mine,
  height = 14,
}: {
  values: number[];
  mine: number;
  height?: number;
}) {
  const W = 200;
  const padX = 5;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const x = (v: number) => padX + ((v - min) / span) * (W - padX * 2);
  return (
    <svg viewBox={`0 0 ${W} ${height}`} className="state-dots-svg" aria-hidden="true">
      <line x1={padX} y1={height / 2} x2={W - padX} y2={height / 2} stroke={GRID} strokeWidth={1} />
      {values.map((v, i) => (
        <circle key={i} cx={x(v)} cy={height / 2} r={2.6} fill={MUTED} />
      ))}
      <circle cx={x(mine)} cy={height / 2} r={4} fill={ACCENT} />
    </svg>
  );
}
const GRID = "rgba(255,255,255,0.07)";
const AXIS_TEXT = "#475569";

type Metric = {
  key: string;
  label: string;
  /** Higher is better for reading the strip left-to-right. */
  value: (t: TeamProfile) => number;
  format: (t: TeamProfile) => string;
  /** What the low and high ends of this axis mean, in plain language. */
  lowLabel: string;
  highLabel: string;
};

const METRICS: Metric[] = [
  {
    key: "strength",
    label: "STARTER STRENGTH",
    value: (t) => t.starterTotalValue,
    format: (t) => `#${t.starterRank}`,
    lowLabel: "weakest",
    highLabel: "strongest",
  },
  {
    // Inverted so "further right" means "more time", matching the other two
    // rows where right is the comfortable end. Raw windowPressure runs the
    // other way (high = closing), and mixing directions across three stacked
    // strips makes the whole panel misread at a glance.
    key: "window",
    label: "WINDOW",
    value: (t) => 100 - t.windowPressure,
    format: (t) => t.windowTier,
    lowLabel: "closing",
    highLabel: "wide open",
  },
  {
    key: "picks",
    label: "PICK CAPITAL",
    value: (t) => t.pickCapital.value,
    format: (t) => pickFlagText(t.pickCapital.flag),
    lowLabel: "thin",
    highLabel: "loaded",
  },
];

function StripPlot({ metric, me, league }: { metric: Metric; me: TeamProfile; league: TeamProfile[] }) {
  return (
    <div className="state-strip">
      <div className="state-strip-head">
        <span className="state-strip-label">{metric.label}</span>
        <span className="state-strip-value">{metric.format(me)}</span>
      </div>
      <LeagueDots values={league.map(metric.value)} mine={metric.value(me)} height={20} />
      <div className="state-strip-ends">
        <span>{metric.lowLabel}</span>
        <span>{metric.highLabel}</span>
      </div>
    </div>
  );
}

// ── Positions ────────────────────────────────────────────────────────────────
//
// Folded into TEAM STATE rather than sitting in its own section, because it IS
// the evidence for the starter-strength headline directly above it. As a
// standalone block it read as unrelated detail.
//
// The starter and depth columns used to be a 0-100 score with a bar filled to
// that percentage. The score is computed against the league average, so the
// bar was already a comparison, but a lone filled bar cannot show whether you
// are 3 points off the field or in a class of your own. These now plot the
// league's actual position values with this team's dot on them, which is the
// data the score was derived from in the first place.

function PositionRow({ pos, me, league }: { pos: Position; me: TeamProfile; league: TeamProfile[] }) {
  const ps = me.positionScores[pos];
  const top = me.players
    .filter((p) => p.position === pos)
    .sort((a, b) => b.valueDynasty - a.valueDynasty || a.id.localeCompare(b.id))[0] as Player | undefined;
  const starterValues = league.map((t) => t.positionScores[pos].starterValue);
  const depthValues = league.map((t) => t.positionScores[pos].depthValue);

  return (
    <div className="pos-dash-row">
      <span className="pos-tag" style={{ background: posColor(pos) }}>{pos}</span>
      <div className="pos-dash-class">
        {/* Dual-zone: starter and depth judged separately (a SURPLUS starter
            room shouldn't hide behind merely-healthy depth) */}
        <span style={{ color: POS_CLASS_COLOR[ps.starterClassification ?? "HEALTHY"], fontWeight: 700, fontSize: 11 }}>
          {ps.starterClassification ?? ps.classification.replace("_", " ")}
        </span>
        <span style={{ color: "#475569", fontSize: 10 }}> / </span>
        <span style={{ color: POS_CLASS_COLOR[ps.depthClassification ?? "HEALTHY"], fontWeight: 700, fontSize: 10 }}>
          {ps.depthClassification ?? "\u2014"}
        </span>
        <span style={{ color: "#475569", fontSize: 10 }}> · {ps.urgency.toFixed(0)}</span>
      </div>
      <div className="pos-dash-metric" data-label="START">
        <LeagueDots values={starterValues} mine={ps.starterValue} />
        <span className="pos-dash-num">{fmt(ps.starterValue)}</span>
      </div>
      <div className="pos-dash-metric" data-label="DEPTH">
        <LeagueDots values={depthValues} mine={ps.depthValue} />
        <span className="pos-dash-num">{fmt(ps.depthValue)}</span>
      </div>
      <span className="pos-dash-player">
        {top ? `${top.name}${top.age != null ? ` (${Number(top.age).toFixed(1)})` : ""}` : "\u2014"}
      </span>
    </div>
  );
}

function PositionTable({ me, league }: { me: TeamProfile; league: TeamProfile[] }) {
  return (
    <div className="pos-dashboard state-positions">
      <div className="pos-dash-header-row">
        <div />
        <div className="pos-dash-col-label">CLASSIFICATION</div>
        <div className="pos-dash-col-label">STARTERS VS LEAGUE</div>
        <div className="pos-dash-col-label">DEPTH VS LEAGUE</div>
        <div className="pos-dash-col-label">BEST PLAYER</div>
      </div>
      {POSITIONS.map((pos) => (
        <PositionRow key={pos} pos={pos} me={me} league={league} />
      ))}
    </div>
  );
}

function RosterShape({ me, league }: { me: TeamProfile; league: TeamProfile[] }) {
  const W = 340;
  const H = 210;
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

  const best = [...players].sort((a, b) => b.valueDynasty - a.valueDynasty)[0];

  return (
    <div className="state-shape">
      <svg viewBox={`0 0 ${W} ${H}`} className="state-shape-svg" role="img"
        aria-label="Your roster plotted by age against dynasty value">
        {/* Sell-while-valuable corner: old AND still worth something. */}
        <rect
          x={px(VETERAN_SELL_AGE)}
          y={py(maxValue)}
          width={Math.max(0, px(AGE_MAX) - px(VETERAN_SELL_AGE))}
          height={Math.max(0, py(VETERAN_SELL_VALUE) - py(maxValue))}
          fill="rgba(239,68,68,0.09)"
          stroke="rgba(239,68,68,0.28)"
          strokeDasharray="3 3"
        />
        {/* Fringe band: young AND inside the league's 61st-100th value window. */}
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

        {/* Axes */}
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

        {/* Label flips to the left of the dot once it is far enough right that
            the text would run off the plot. */}
        {best && (() => {
          const bx = px(best.age as number);
          const flip = bx > pad.left + fw * 0.6;
          return (
            <text
              x={flip ? bx - 6 : bx + 6}
              y={py(best.valueDynasty) + 3}
              fill="#94a3b8"
              fontSize={8}
              textAnchor={flip ? "end" : "start"}
            >
              {best.name}
            </text>
          );
        })()}

        {[AGE_MIN, 25, 28, 31, AGE_MAX].map((a) => (
          <text key={a} x={px(a)} y={H - 12} fill={AXIS_TEXT} fontSize={8} textAnchor="middle">
            {a}
          </text>
        ))}
        <text x={pad.left + fw / 2} y={H - 2} fill={AXIS_TEXT} fontSize={8} textAnchor="middle">
          age
        </text>
        <text x={4} y={pad.top + 6} fill={AXIS_TEXT} fontSize={8}>
          {Math.round(maxValue).toLocaleString()}
        </text>
        <text x={4} y={pad.top + fh} fill={AXIS_TEXT} fontSize={8}>
          0
        </text>
      </svg>
      <div className="state-shape-key">
        <span>
          <i className="state-key-swatch state-key-sell" /> sell while still valuable
        </span>
        <span>
          <i className="state-key-swatch state-key-buy" /> the fringe worth buying
        </span>
      </div>
    </div>
  );
}

export default function TeamState({ me, league }: { me: TeamProfile; league: TeamProfile[] }) {
  if (league.length < 2) return null;
  return (
    <section className="dive-pos-section">
      <h2 className="section-title">TEAM STATE</h2>
      <p className="dim-text scout-intro">
        The evidence the scouting report is reading. Every dot is a team in this league, and the
        amber one is you.
      </p>
      <div className="state-grid">
        <div className="state-panel">
          {METRICS.map((m) => (
            <StripPlot key={m.key} metric={m} me={me} league={league} />
          ))}
        </div>
        <div className="state-panel">
          <RosterShape me={me} league={league} />
        </div>
      </div>
      <PositionTable me={me} league={league} />
    </section>
  );
}
