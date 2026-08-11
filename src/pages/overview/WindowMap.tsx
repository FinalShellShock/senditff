// Window Map: the league plotted on a continuous 2D field. x = dynasty rank
// (deep future left → thin future right), y = contender rank (strongest
// starters top) at EVERY viewport: same mental model on phone and desktop.
// Phones just get a taller, narrower field (labels stack via decollision) so
// nothing scrolls horizontally. The 3x3 band boundaries ARE the state grid;
// a dot lands in the region matching its teamState because the regions are
// generated from the same STATE_GRID the engine assigns from. Dashed trails
// project each team 1-2 years out (Shotgun).
//
// Readability rules (dataviz): identity comes from an ink-colored name label
// beside each dot, never text inside the mark; the dot's color carries the
// teamState (the region names double as the legend); dots wear a 2px
// surface ring; band boundaries are solid hairlines; hover targets are
// bigger than the marks.

import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  STD_THRESHOLD,
  WINDOW_LONG_THRESHOLD,
  WINDOW_SHORT_THRESHOLD,
} from "../../algo/constants.ts";
import { projectTeam } from "../../algo/projection.ts";
import type { LeagueFormat, TeamProfile } from "../../algo/types.ts";
import { STATE_GRID, STATE_COLOR, STATE_TEXT, stateRing } from "../../ui/teamState.ts";
import { BRAND, INK_4 } from "../../ui/theme.ts";

const SURFACE = "#051014";

// Pressure beyond this pins to the field edge.
const PRESSURE_MAX = 45;
// z beyond ±this pins to the field edge.
const Z_MAX = 2.0;

const DOT_R = 7;
const HIT_R = 15;

type Geometry = {
  W: number;
  H: number;
  pad: { top: number; right: number; bottom: number; left: number };
  fw: number;
  fh: number;
  portrait: boolean;
  nameMax: number;
  collideX: number;
  labelFlipMargin: number;
};

function makeGeometry(portrait: boolean): Geometry {
  if (portrait) {
    const W = 460;
    const H = 680;
    const pad = { top: 22, right: 12, bottom: 30, left: 40 };
    return {
      W,
      H,
      pad,
      fw: W - pad.left - pad.right,
      fh: H - pad.top - pad.bottom,
      portrait,
      nameMax: 10,
      collideX: 110,
      labelFlipMargin: 85,
    };
  }
  const W = 760;
  const H = 480;
  const pad = { top: 30, right: 18, bottom: 34, left: 70 };
  return {
    W,
    H,
    pad,
    fw: W - pad.left - pad.right,
    fh: H - pad.top - pad.bottom,
    portrait,
    nameMax: 13,
    collideX: 160,
    labelFlipMargin: 110,
  };
}

// Piecewise window fraction: each band (LONG / MID / SHORT) gets a third,
// so band boundaries line up with the visual grid. 0 = longest window.
// Position is RANK, not value.
//
// Gibbs: "Plotting rank in league and not on actual value would help to
// separate all the teams better in that chart as well. Which makes sense
// because you are competing against others in the league, not against anyone
// else."
//
// He is right about separation: ranks spread the field evenly so nobody hides
// in a cluster. The cost, stated plainly, is that magnitude is gone. Two
// adjacent dots are one rank apart whether that is 40 points or 4,000.
//
// X is DYNASTY rank, best on the left, which is the flip Gibbs asked for and
// Johnny agreed to. It replaces windowPressure, so the horizontal axis is no
// longer derived from age curves at all: it is what the market says the roster
// is worth. Y is CONTENDER rank, best at the top, which is starterRank and was
// already computed.
function rankFrac(rank: number, n: number): number {
  if (n <= 1) return 0.5;
  return (rank - 0.5) / n;
}

// Map (window, strength) fractions to viewBox coordinates. Window is always
// the x axis, strength always the y axis, regardless of orientation.
function toPoint(
  g: Geometry,
  fWindow: number,
  fStrength: number,
): { x: number; y: number } {
  return {
    x: g.pad.left + fWindow * g.fw,
    y: g.pad.top + fStrength * g.fh,
  };
}

function meanStd(values: number[]): { mean: number; std: number } {
  const n = Math.max(1, values.length);
  const mean = values.reduce((s, v) => s + v, 0) / n;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / n;
  return { mean, std: Math.sqrt(variance) };
}

function displayName(name: string, max: number): string {
  return name.length > max ? `${name.slice(0, max - 1)}…` : name;
}

type Placed = {
  profile: TeamProfile;
  x: number;
  y: number;
  labelSide: "right" | "left";
  trail: Array<{ x: number; y: number }>;
  /** 1 = best in league. These two ARE the axes, so the tooltip states them. */
  dynRankNum: number;
  contRankNum: number;
};

// Derived from the same grid the engine assigns states with, so a dot can
// never land in one region while carrying another region's colour. Previously
// these labels were hand-listed here and the dots were coloured by the old
// windowLabel enum, which let a team sit in STUCK wearing TRANSITION purple.
const REGIONS = STATE_GRID.flatMap((row, strengthBand) =>
  row.map((state, windowBand) => ({
    label: STATE_TEXT[state],
    state,
    windowBand,
    strengthBand,
  })),
);

export default function WindowMap({
  profiles,
  format,
  thisYear,
}: {
  profiles: TeamProfile[];
  format: LeagueFormat;
  thisYear: number;
}) {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();

  const [portrait, setPortrait] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 640px)");
    const update = () => setPortrait(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  const g = makeGeometry(portrait);

  const placed: Placed[] = useMemo(() => {
    const sorted = [...profiles].sort((a, b) => a.rosterId - b.rosterId);
    const n = sorted.length;

    // Total dynasty value: every player plus every pick. This is the X axis,
    // and it is deliberately the raw market number rather than anything the
    // engine derives. Gibbs: "that's why I am advocating for dynasty value ...
    // don't create dyno value from contender."
    const dynastyOf = (p: TeamProfile) =>
      p.players.reduce((s, x) => s + (x.valueDynasty || 0), 0) +
      p.picks.reduce((s, k) => s + (k.value || 0), 0);

    // Rank helper: 1 = best. Ties break on rosterId so the plot is stable.
    const rankMap = (score: (p: TeamProfile) => number) => {
      const order = [...sorted].sort(
        (a, b) => score(b) - score(a) || a.rosterId - b.rosterId,
      );
      const m = new Map<number, number>();
      order.forEach((p, i) => m.set(p.rosterId, i + 1));
      return m;
    };
    const dynRank = rankMap(dynastyOf);

    // Projected horizons, ranked the same way so a trail is movement THROUGH
    // the league rather than movement in raw value. Applied as a rank DELTA off
    // today's position, because the projection reports starter DYNASTY value
    // while the live Y axis is starter REDRAFT value: the delta is comparable
    // even though the absolute numbers are not.
    const horizons = [0, 1, 2].map((years) => {
      const proj = sorted.map((p) => projectTeam(p, years, thisYear, format));
      const byTotal = [...proj.keys()].sort(
        (a, b) =>
          proj[b]!.totalDynastyValue - proj[a]!.totalDynastyValue || a - b,
      );
      const byStarter = [...proj.keys()].sort(
        (a, b) =>
          proj[b]!.starterDynastyValue - proj[a]!.starterDynastyValue || a - b,
      );
      const dyn = new Map<number, number>();
      const str = new Map<number, number>();
      byTotal.forEach((idx, i) => dyn.set(idx, i + 1));
      byStarter.forEach((idx, i) => str.set(idx, i + 1));
      return { dyn, str };
    });

    const clampRank = (r: number) => Math.max(1, Math.min(n, r));

    const result: Placed[] = sorted.map((p, idx) => {
      const dNow = dynRank.get(p.rosterId) ?? 1;
      const cNow = p.starterRank;
      const trail = [1, 2].map((h) => {
        const dDyn =
          (horizons[h]!.dyn.get(idx) ?? 1) - (horizons[0]!.dyn.get(idx) ?? 1);
        const dStr =
          (horizons[h]!.str.get(idx) ?? 1) - (horizons[0]!.str.get(idx) ?? 1);
        return toPoint(
          g,
          rankFrac(clampRank(dNow + dDyn), n),
          rankFrac(clampRank(cNow + dStr), n),
        );
      });
      const pt = toPoint(g, rankFrac(dNow, n), rankFrac(cNow, n));
      return {
        profile: p,
        dynRankNum: dNow,
        contRankNum: cNow,
        x: pt.x,
        y: pt.y,
        labelSide:
          pt.x > g.pad.left + g.fw - g.labelFlipMargin
            ? ("left" as const)
            : ("right" as const),
        trail,
      };
    });

    // Deterministic label decollision: dot + name occupy a horizontal strip,
    // so any two teams whose strips overlap need vertical separation.
    // rosterId order, later one pushed down; a few passes settle it.
    for (let pass = 0; pass < 4; pass++) {
      for (let i = 0; i < result.length; i++) {
        for (let j = i + 1; j < result.length; j++) {
          const a = result[i]!;
          const b = result[j]!;
          if (Math.abs(b.x - a.x) >= g.collideX) continue;
          const dy = b.y - a.y;
          if (Math.abs(dy) < 17) {
            b.y = Math.min(g.pad.top + g.fh - DOT_R, a.y + 17);
          }
        }
      }
    }
    return result;
  }, [profiles, format, thisYear, portrait]); // eslint-disable-line react-hooks/exhaustive-deps

  // Cell centers for region labels, honoring orientation.
  const regionCenter = (windowBand: number, strengthBand: number) =>
    toPoint(g, (windowBand + 0.5) / 3, (strengthBand + 0.5) / 3);

  const labelGap = DOT_R + 5;

  return (
    <div className="wm-wrap">
      <svg
        viewBox={`0 0 ${g.W} ${g.H}`}
        className={portrait ? "window-map window-map-portrait" : "window-map"}
        role="img"
        aria-label="League window map"
      >
        {/* Band boundaries: solid hairlines, one step off the surface */}
        {[1, 2].map((i) => (
          <line
            key={`v${i}`}
            x1={g.pad.left + (i * g.fw) / 3}
            y1={g.pad.top}
            x2={g.pad.left + (i * g.fw) / 3}
            y2={g.pad.top + g.fh}
            stroke="rgba(255,255,255,0.07)"
            strokeWidth={1}
          />
        ))}
        {[1, 2].map((i) => (
          <line
            key={`h${i}`}
            x1={g.pad.left}
            y1={g.pad.top + (i * g.fh) / 3}
            x2={g.pad.left + g.fw}
            y2={g.pad.top + (i * g.fh) / 3}
            stroke="rgba(255,255,255,0.07)"
            strokeWidth={1}
          />
        ))}
        <rect
          x={g.pad.left}
          y={g.pad.top}
          width={g.fw}
          height={g.fh}
          fill="none"
          stroke="rgba(255,255,255,0.06)"
        />

        {/* Region labels (double as the color legend) */}
        {REGIONS.map((r) => {
          const c = regionCenter(r.windowBand, r.strengthBand);
          return (
            <text
              key={r.label}
              x={c.x}
              y={c.y}
              textAnchor="middle"
              dominantBaseline="central"
              className={
                portrait
                  ? "wm-region-label wm-region-label-sm"
                  : "wm-region-label"
              }
            >
              {r.label}
            </text>
          );
        })}

        {/* Axis labels: same arrangement in both orientations */}
        <text
          x={g.pad.left}
          y={g.H - 10}
          className="wm-axis-label"
          textAnchor="start"
        >
          ◀ HIGH DYNASTY
        </text>
        <text
          x={g.pad.left + g.fw}
          y={g.H - 10}
          className="wm-axis-label"
          textAnchor="end"
        >
          LOW DYNASTY ▶
        </text>
        <text
          x={portrait ? 4 : 16}
          y={g.pad.top + 10}
          className="wm-axis-label"
          textAnchor="start"
        >
          CONTENDS ▲
        </text>
        <text
          x={portrait ? 4 : 16}
          y={g.pad.top + g.fh}
          className="wm-axis-label"
          textAnchor="start"
        >
          CANNOT ▼
        </text>
        <text
          x={g.pad.left + g.fw}
          y={portrait ? 14 : 16}
          className="wm-axis-label wm-axis-hint"
          textAnchor="end"
        >
          {portrait
            ? "dashed = drift (+1y, +2y)"
            : "dashed trail = projected drift (+1y, +2y)"}
        </text>

        {/* Trajectory trails under the dots (dashed = projection) */}
        {placed.map(({ profile, x, y, trail }) => {
          const color = STATE_COLOR[profile.teamState] ?? INK_4;
          const pts = [{ x, y }, ...trail];
          const last = pts[pts.length - 1]!;
          const prev = pts[pts.length - 2]!;
          const angle = Math.atan2(last.y - prev.y, last.x - prev.x);
          const arrow = 6;
          return (
            <g key={`trail-${profile.rosterId}`} opacity={0.45}>
              <polyline
                points={pts.map((p) => `${p.x},${p.y}`).join(" ")}
                fill="none"
                stroke={color}
                strokeWidth={1.5}
                strokeDasharray="4 3"
              />
              <path
                d={`M ${last.x} ${last.y}
                    L ${last.x - arrow * Math.cos(angle - 0.5)} ${last.y - arrow * Math.sin(angle - 0.5)}
                    L ${last.x - arrow * Math.cos(angle + 0.5)} ${last.y - arrow * Math.sin(angle + 0.5)} Z`}
                fill={color}
              />
            </g>
          );
        })}

        {/* Team dots + ink name labels */}
        {placed.map(({ profile, x, y, labelSide, dynRankNum, contRankNum }) => {
          const color = STATE_COLOR[profile.teamState] ?? INK_4;
          const name = displayName(profile.ownerName, g.nameMax);
          return (
            <g
              key={profile.rosterId}
              className="wm-dot"
              onClick={() => navigate(`/league/${id}/team/${profile.rosterId}`)}
            >
              <title>
                {`${profile.ownerName}\ncontender #${contRankNum} · dynasty #${dynRankNum} of ${placed.length}\n${STATE_TEXT[profile.teamState]}`}
              </title>
              {/* hover/click target, larger than the mark */}
              <circle cx={x} cy={y} r={HIT_R} fill="transparent" />
              {/* Ring is stateRing, not the old surface colour. BEAUTY is
                  painted in the page background, so a background-coloured ring
                  left that dot with no edge at all and it vanished. */}
              <circle
                cx={x}
                cy={y}
                r={DOT_R}
                fill={color}
                stroke={profile.isMine ? BRAND : stateRing(profile.teamState)}
                strokeWidth={2}
              />
              <text
                x={labelSide === "right" ? x + labelGap : x - labelGap}
                y={y}
                textAnchor={labelSide === "right" ? "start" : "end"}
                dominantBaseline="central"
                className={`wm-name${profile.isMine ? " wm-name-mine" : ""}`}
              >
                {profile.isMine ? `★ ${name}` : name}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
