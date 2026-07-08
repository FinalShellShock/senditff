// Window Map: the league plotted on a continuous 2D field. x = window
// pressure (LONG left → SHORT right), y = starter strength (z-scored, STRONG
// top). The 3x3 band boundaries reproduce the classic grid cells; dots land
// in the region matching their windowLabel because both derive from the same
// numbers. Dashed trails project each team 1-2 years out (Shotgun).
//
// Readability rules (dataviz): identity comes from an ink-colored name label
// beside each dot, never text inside the mark; the dot's color carries the
// windowLabel (the region names double as the legend); dots wear a 2px
// surface ring; band boundaries are solid hairlines; hover targets are
// bigger than the marks.

import { useMemo } from "react";
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

// Field geometry (viewBox units)
const W = 760;
const H = 480;
const PAD = { top: 30, right: 18, bottom: 34, left: 70 };
const FW = W - PAD.left - PAD.right;
const FH = H - PAD.top - PAD.bottom;

// Pressure beyond this pins to the right edge.
const PRESSURE_MAX = 45;
// z beyond ±this pins to the top/bottom edge.
const Z_MAX = 2.0;

const DOT_R = 7;
const HIT_R = 15;
const NAME_MAX = 13;
const LABEL_GAP = DOT_R + 5;

// Piecewise x: each window band (LONG / MID / SHORT) gets a third of the
// width so band boundaries line up with the visual grid.
function xScale(pressure: number): number {
  const p = Math.max(0, Math.min(PRESSURE_MAX, pressure));
  let frac: number;
  if (p <= WINDOW_LONG_THRESHOLD) {
    frac = (p / WINDOW_LONG_THRESHOLD) / 3;
  } else if (p <= WINDOW_SHORT_THRESHOLD) {
    frac = 1 / 3 + ((p - WINDOW_LONG_THRESHOLD) / (WINDOW_SHORT_THRESHOLD - WINDOW_LONG_THRESHOLD)) / 3;
  } else {
    frac = 2 / 3 + ((p - WINDOW_SHORT_THRESHOLD) / (PRESSURE_MAX - WINDOW_SHORT_THRESHOLD)) / 3;
  }
  return PAD.left + frac * FW;
}

// Piecewise y: STRONG band (z >= +0.5σ) top third, AVERAGE middle, WEAK bottom.
function yScale(z: number): number {
  const zc = Math.max(-Z_MAX, Math.min(Z_MAX, z));
  let frac: number;
  if (zc >= STD_THRESHOLD) {
    frac = ((Z_MAX - zc) / (Z_MAX - STD_THRESHOLD)) / 3;
  } else if (zc >= -STD_THRESHOLD) {
    frac = 1 / 3 + ((STD_THRESHOLD - zc) / (2 * STD_THRESHOLD)) / 3;
  } else {
    frac = 2 / 3 + ((-STD_THRESHOLD - zc) / (Z_MAX - STD_THRESHOLD)) / 3;
  }
  return PAD.top + frac * FH;
}

function meanStd(values: number[]): { mean: number; std: number } {
  const n = Math.max(1, values.length);
  const mean = values.reduce((s, v) => s + v, 0) / n;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / n;
  return { mean, std: Math.sqrt(variance) };
}

function displayName(name: string): string {
  return name.length > NAME_MAX ? `${name.slice(0, NAME_MAX - 1)}…` : name;
}

type Placed = {
  profile: TeamProfile;
  x: number;
  y: number;
  labelSide: "right" | "left";
  trail: Array<{ x: number; y: number }>;
};

const REGION_LABELS: Array<{ label: string; col: number; row: number }> = [
  { label: "JUGGERNAUT", col: 0, row: 0 },
  { label: "CONTEND", col: 1, row: 0 },
  { label: "CLOSING", col: 2, row: 0 },
  { label: "RISING", col: 0, row: 1 },
  { label: "AVERAGE", col: 1, row: 1 },
  { label: "MIDDLING", col: 2, row: 1 },
  { label: "REBUILD", col: 0, row: 2 },
  { label: "TRANSITION", col: 1, row: 2 },
  { label: "STUCK", col: 2, row: 2 },
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
      const baseX = p.windowPressure;
      const baseY = zNow(p);
      const trail = [1, 2].map((h) => {
        const dPressure = horizons[h]!.proj[idx]!.agePressure - horizons[0]!.proj[idx]!.agePressure;
        const dz = zAt(idx, h) - zAt(idx, 0);
        return { x: xScale(baseX + dPressure), y: yScale(baseY + dz) };
      });
      const x = xScale(baseX);
      return {
        profile: p,
        x,
        y: yScale(baseY),
        labelSide: x > PAD.left + FW - 110 ? ("left" as const) : ("right" as const),
        trail,
      };
    });

    // Deterministic label decollision: dot + name occupy a horizontal strip
    // (~90 units of text beside the dot), so any two teams whose strips can
    // overlap need vertical separation. Facing labels (right-label followed
    // by a left-label) reach toward each other, hence the generous window.
    // rosterId order, later one pushed down; a few passes settle it.
    for (let pass = 0; pass < 4; pass++) {
      for (let i = 0; i < result.length; i++) {
        for (let j = i + 1; j < result.length; j++) {
          const a = result[i]!;
          const b = result[j]!;
          if (Math.abs(b.x - a.x) >= 160) continue;
          const dy = b.y - a.y;
          if (Math.abs(dy) < 17) {
            b.y = Math.min(PAD.top + FH - DOT_R, a.y + 17);
          }
        }
      }
    }
    return result;
  }, [profiles, format, thisYear]);

  const colX = (col: number) => PAD.left + (col + 0.5) * (FW / 3);
  const rowY = (row: number) => PAD.top + (row + 0.5) * (FH / 3);

  return (
    <div className="wm-wrap">
      <svg viewBox={`0 0 ${W} ${H}`} className="window-map" role="img" aria-label="League window map">
        {/* Band boundaries: solid hairlines, one step off the surface */}
        {[1, 2].map((i) => (
          <line
            key={`v${i}`}
            x1={PAD.left + (i * FW) / 3} y1={PAD.top}
            x2={PAD.left + (i * FW) / 3} y2={PAD.top + FH}
            stroke="rgba(255,255,255,0.07)" strokeWidth={1}
          />
        ))}
        {[1, 2].map((i) => (
          <line
            key={`h${i}`}
            x1={PAD.left} y1={PAD.top + (i * FH) / 3}
            x2={PAD.left + FW} y2={PAD.top + (i * FH) / 3}
            stroke="rgba(255,255,255,0.07)" strokeWidth={1}
          />
        ))}
        <rect
          x={PAD.left} y={PAD.top} width={FW} height={FH}
          fill="none" stroke="rgba(255,255,255,0.06)"
        />

        {/* Region labels (double as the color legend) */}
        {REGION_LABELS.map((r) => (
          <text
            key={r.label}
            x={colX(r.col)} y={rowY(r.row)}
            textAnchor="middle" dominantBaseline="central"
            className="wm-region-label"
          >
            {r.label}
          </text>
        ))}

        {/* Axis labels */}
        <text x={PAD.left} y={H - 10} className="wm-axis-label" textAnchor="start">◀ LONG WINDOW</text>
        <text x={PAD.left + FW} y={H - 10} className="wm-axis-label" textAnchor="end">SHORT WINDOW ▶</text>
        <text x={16} y={PAD.top + 10} className="wm-axis-label" textAnchor="start">STRONG ▲</text>
        <text x={16} y={PAD.top + FH} className="wm-axis-label" textAnchor="start">WEAK ▼</text>
        <text x={PAD.left + FW} y={18} className="wm-axis-label wm-axis-hint" textAnchor="end">
          dashed trail = projected drift (+1y, +2y)
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
          const name = displayName(profile.ownerName);
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
                x={labelSide === "right" ? x + LABEL_GAP : x - LABEL_GAP}
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
