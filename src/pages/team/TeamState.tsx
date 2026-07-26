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
import type { TeamProfile } from "../../algo/types.ts";

/** The one place a PickFlag becomes words. Lived in TeamDeepDive, and the
 *  chart briefly rendered the raw flag instead, so the same datum read "FINE"
 *  in the header chip and "NEUTRAL" in the strip six inches below it. */
export const pickFlagText = (flag: string) =>
  flag === "NEUTRAL" ? "FINE" : flag.replace("_", " ");

const ACCENT = "#f59e0b";
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
  const W = 300;
  const H = 26;
  const padX = 6;
  const values = league.map(metric.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const x = (v: number) => padX + ((v - min) / span) * (W - padX * 2);
  const mine = metric.value(me);

  return (
    <div className="state-strip">
      <div className="state-strip-head">
        <span className="state-strip-label">{metric.label}</span>
        <span className="state-strip-value">{metric.format(me)}</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="state-strip-svg" role="img"
        aria-label={`${metric.label}: ${metric.format(me)} of ${league.length} teams`}>
        <line x1={padX} y1={H / 2} x2={W - padX} y2={H / 2} stroke={GRID} strokeWidth={1} />
        {league.map((t) => (
          <circle
            key={t.rosterId}
            cx={x(metric.value(t))}
            cy={H / 2}
            r={t.rosterId === me.rosterId ? 5 : 3}
            fill={t.rosterId === me.rosterId ? ACCENT : "rgba(148,163,184,0.35)"}
          />
        ))}
        {/* Drawn last so a tied neighbour can never paint over the marker. */}
        <circle cx={x(mine)} cy={H / 2} r={5} fill={ACCENT} />
      </svg>
      <div className="state-strip-ends">
        <span>{metric.lowLabel}</span>
        <span>{metric.highLabel}</span>
      </div>
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
        Where you actually sit, and what your roster is made of. The plays below read from these
        two pictures.
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
    </section>
  );
}
