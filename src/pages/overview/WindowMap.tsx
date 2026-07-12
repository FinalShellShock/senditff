// Window Map: the league plotted on a continuous 2D field. x = window
// pressure (LONG left → SHORT right), y = starter strength (STRONG top) at
// EVERY viewport: same mental model on phone and desktop. Phones just get a
// taller, narrower field (labels stack via decollision) so nothing scrolls
// horizontally. The 3x3 band boundaries reproduce the classic grid cells;
// dots land in the region matching their windowLabel because both derive
// from the same numbers. Dashed trails project each team 1-2 years out
// (Shotgun).
//
// Readability rules (dataviz): identity comes from an ink-colored name label
// beside each dot, never text inside the mark; the dot's color carries the
// windowLabel (the region names double as the legend); dots wear a 2px
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
import type { LeagueFormat, TeamProfile, WindowLabel } from "../../algo/types.ts";

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

const SURFACE = "#0a0c0f";

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
      W, H, pad,
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
    W, H, pad,
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
function windowFrac(pressure: number): number {
  const p = Math.max(0, Math.min(PRESSURE_MAX, pressure));
  if (p <= WINDOW_LONG_THRESHOLD) return (p / WINDOW_LONG_THRESHOLD) / 3;
  if (p <= WINDOW_SHORT_THRESHOLD) {
    return 1 / 3 + ((p - WINDOW_LONG_THRESHOLD) / (WINDOW_SHORT_THRESHOLD - WINDOW_LONG_THRESHOLD)) / 3;
  }
  return 2 / 3 + ((p - WINDOW_SHORT_THRESHOLD) / (PRESSURE_MAX - WINDOW_SHORT_THRESHOLD)) / 3;
}

// Piecewise strength fraction: STRONG band (z >= +0.5σ) is the first third.
// 0 = strongest.
function strengthFrac(z: number): number {
  const zc = Math.max(-Z_MAX, Math.min(Z_MAX, z));
  if (zc >= STD_THRESHOLD) return ((Z_MAX - zc) / (Z_MAX - STD_THRESHOLD)) / 3;
  if (zc >= -STD_THRESHOLD) return 1 / 3 + ((STD_THRESHOLD - zc) / (2 * STD_THRESHOLD)) / 3;
  return 2 / 3 + ((-STD_THRESHOLD - zc) / (Z_MAX - STD_THRESHOLD)) / 3;
}

// Map (window, strength) fractions to viewBox coordinates. Window is always
// the x axis, strength always the y axis, regardless of orientation.
function toPoint(g: Geometry, fWindow: number, fStrength: number): { x: number; y: number } {
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
};

// Region labels by (windowBand, strengthBand): 0 = LONG / STRONG.
const REGIONS: Array<{ label: string; windowBand: number; strengthBand: number }> = [
  { label: "JUGGERNAUT", windowBand: 0, strengthBand: 0 },
  { label: "CONTEND", windowBand: 1, strengthBand: 0 },
  { label: "CLOSING", windowBand: 2, strengthBand: 0 },
  { label: "RISING", windowBand: 0, strengthBand: 1 },
  { label: "AVERAGE", windowBand: 1, strengthBand: 1 },
  { label: "MIDDLING", windowBand: 2, strengthBand: 1 },
  { label: "REBUILD", windowBand: 0, strengthBand: 2 },
  { label: "TRANSITION", windowBand: 1, strengthBand: 2 },
  { label: "STUCK", windowBand: 2, strengthBand: 2 },
];

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
    const { mean, std } = meanStd(sorted.map((p) => p.starterTotalValue));
    const zNow = (p: TeamProfile) => (std > 0 ? (p.starterTotalValue - mean) / std : 0);

    // Projected starter-dynasty distributions per horizon; drift is relative
    // to the league at the same horizon (if everyone ages equally, nobody
    // moves — strength is relative).
    const horizons = [0, 1, 2].map((years) => {
      const proj = sorted.map((p) => projectTeam(p, years, thisYear, format));
      const dist = meanStd(proj.map((t) => t.starterDynastyValue));
      return { proj, dist };
    });
    const zAt = (idx: number, h: number) => {
      const { proj, dist } = horizons[h]!;
      return dist.std > 0 ? (proj[idx]!.starterDynastyValue - dist.mean) / dist.std : 0;
    };

    const result: Placed[] = sorted.map((p, idx) => {
      const baseWindow = p.windowPressure;
      const baseZ = zNow(p);
      const trail = [1, 2].map((h) => {
        const dPressure = horizons[h]!.proj[idx]!.agePressure - horizons[0]!.proj[idx]!.agePressure;
        const dz = zAt(idx, h) - zAt(idx, 0);
        return toPoint(g, windowFrac(baseWindow + dPressure), strengthFrac(baseZ + dz));
      });
      const pt = toPoint(g, windowFrac(baseWindow), strengthFrac(baseZ));
      return {
        profile: p,
        x: pt.x,
        y: pt.y,
        labelSide: pt.x > g.pad.left + g.fw - g.labelFlipMargin ? ("left" as const) : ("right" as const),
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
            x1={g.pad.left + (i * g.fw) / 3} y1={g.pad.top}
            x2={g.pad.left + (i * g.fw) / 3} y2={g.pad.top + g.fh}
            stroke="rgba(255,255,255,0.07)" strokeWidth={1}
          />
        ))}
        {[1, 2].map((i) => (
          <line
            key={`h${i}`}
            x1={g.pad.left} y1={g.pad.top + (i * g.fh) / 3}
            x2={g.pad.left + g.fw} y2={g.pad.top + (i * g.fh) / 3}
            stroke="rgba(255,255,255,0.07)" strokeWidth={1}
          />
        ))}
        <rect
          x={g.pad.left} y={g.pad.top} width={g.fw} height={g.fh}
          fill="none" stroke="rgba(255,255,255,0.06)"
        />

        {/* Region labels (double as the color legend) */}
        {REGIONS.map((r) => {
          const c = regionCenter(r.windowBand, r.strengthBand);
          return (
            <text
              key={r.label}
              x={c.x} y={c.y}
              textAnchor="middle" dominantBaseline="central"
              className={portrait ? "wm-region-label wm-region-label-sm" : "wm-region-label"}
            >
              {r.label}
            </text>
          );
        })}

        {/* Axis labels: same arrangement in both orientations */}
        <text x={g.pad.left} y={g.H - 10} className="wm-axis-label" textAnchor="start">◀ LONG WINDOW</text>
        <text x={g.pad.left + g.fw} y={g.H - 10} className="wm-axis-label" textAnchor="end">SHORT WINDOW ▶</text>
        <text x={portrait ? 4 : 16} y={g.pad.top + 10} className="wm-axis-label" textAnchor="start">STRONG ▲</text>
        <text x={portrait ? 4 : 16} y={g.pad.top + g.fh} className="wm-axis-label" textAnchor="start">WEAK ▼</text>
        <text x={g.pad.left + g.fw} y={portrait ? 14 : 16} className="wm-axis-label wm-axis-hint" textAnchor="end">
          {portrait ? "dashed = drift (+1y, +2y)" : "dashed trail = projected drift (+1y, +2y)"}
        </text>

        {/* Trajectory trails under the dots (dashed = projection) */}
        {placed.map(({ profile, x, y, trail }) => {
          const color = LABEL_COLOR[profile.windowLabel] ?? "#94a3b8";
          const pts = [{ x, y }, ...trail];
          const last = pts[pts.length - 1]!;
          const prev = pts[pts.length - 2]!;
          const angle = Math.atan2(last.y - prev.y, last.x - prev.x);
          const arrow = 6;
          return (
            <g key={`trail-${profile.rosterId}`} opacity={0.45}>
              <polyline
                points={pts.map((p) => `${p.x},${p.y}`).join(" ")}
                fill="none" stroke={color} strokeWidth={1.5} strokeDasharray="4 3"
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
        {placed.map(({ profile, x, y, labelSide }) => {
          const color = LABEL_COLOR[profile.windowLabel] ?? "#94a3b8";
          const name = displayName(profile.ownerName, g.nameMax);
          return (
            <g
              key={profile.rosterId}
              className="wm-dot"
              onClick={() => navigate(`/league/${id}/team/${profile.rosterId}`)}
            >
              <title>
                {`${profile.ownerName} — ${profile.windowLabel}\nstarter rank #${profile.starterRank} · window pressure ${profile.windowPressure.toFixed(0)}`}
              </title>
              {/* hover/click target, larger than the mark */}
              <circle cx={x} cy={y} r={HIT_R} fill="transparent" />
              <circle
                cx={x} cy={y} r={DOT_R}
                fill={color}
                stroke={profile.isMine ? "#f59e0b" : SURFACE}
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
