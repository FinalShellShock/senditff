import { writeFileSync } from "node:fs";
import type { LeagueFormat, TeamProfile, WindowLabel } from "./types.ts";

const ALGO_NAME = "West Coast";

// ── Terminal output (for me / debugging) ─────────────────────────────────────

const C = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  gray: "\x1b[90m",
};

const LABEL_COLOR: Record<WindowLabel, string> = {
  JUGGERNAUT: C.green,
  CONTEND: C.green,
  CLOSING: C.red,
  RISING: C.cyan,
  AVERAGE: C.gray,
  MIDDLING: C.yellow,
  REBUILD: C.blue,
  TRANSITION: C.magenta,
  STUCK: C.red,
};

const PICK_FLAG_COLOR: Record<string, string> = {
  PICK_RICH: C.green,
  PICK_POOR: C.red,
  NEUTRAL: C.gray,
};

const POS_CLASS_COLOR: Record<string, string> = {
  CRITICAL_NEED: C.red,
  NEED: C.yellow,
  HEALTHY: C.green,
  SURPLUS: C.cyan,
};

function pad(s: string, n: number): string {
  if (s.length >= n) return s;
  return s + " ".repeat(n - s.length);
}

function bar(score: number, width = 20): string {
  const filled = Math.round((score / 100) * width);
  const color =
    score >= 70 ? C.green : score >= 50 ? C.cyan : score >= 30 ? C.yellow : C.red;
  return color + "█".repeat(filled) + C.gray + "░".repeat(width - filled) + C.reset;
}

export function printTerminal(
  leagueName: string,
  format: LeagueFormat,
  profiles: TeamProfile[],
): void {
  const slot = format.starterSlots;
  const slotStr = `${slot.QB}QB · ${slot.RB}RB · ${slot.WR}WR · ${slot.TE}TE${slot.FLEX ? ` · ${slot.FLEX}FLEX` : ""}${slot.SUPER_FLEX ? ` · ${slot.SUPER_FLEX}SF` : ""}`;
  const fmtStr = `${format.superflex ? "Superflex" : "1QB"} · ${format.scoring.toUpperCase()}${format.tep ? " · TEP" : ""}`;

  console.log("");
  console.log(C.bold + C.cyan + "═".repeat(80) + C.reset);
  console.log(C.bold + " " + leagueName + C.reset);
  console.log(C.gray + " " + slotStr + "  ·  " + fmtStr + "  ·  " + profiles.length + " teams" + C.reset);
  console.log(C.gray + " algorithm: " + C.reset + C.bold + ALGO_NAME + C.reset);
  console.log(C.bold + C.cyan + "═".repeat(80) + C.reset);

  const sorted = [...profiles].sort((a, b) => a.starterRank - b.starterRank);

  for (const t of sorted) printTeam(t);

  console.log("");
  printLeagueSummary(profiles);
}

function printTeam(t: TeamProfile): void {
  const lColor = LABEL_COLOR[t.windowLabel] ?? C.cyan;
  const pickColor = PICK_FLAG_COLOR[t.pickCapital.flag] ?? C.gray;
  const mine = t.isMine ? C.bold + C.yellow + " ★ YOU" + C.reset : "";

  console.log("");
  console.log(
    C.bold + pad(t.ownerName, 28) + C.reset +
    "  " + C.gray + "(rank #" + t.starterRank + " · " + t.record + ")" + C.reset +
    mine,
  );
  console.log(
    "  " +
    lColor + C.bold + pad(t.windowLabel, 12) + C.reset +
    C.gray + "(" + t.competitiveness + "/" + t.windowTier + ")  " + C.reset +
    C.gray + "cal_age " + C.reset + t.weightedCalendarAge.toFixed(1).padEnd(5) +
    C.gray + "age_pres " + C.reset + t.teamAgePressure.toFixed(0).padEnd(4) +
    C.gray + "starter " + C.reset + Math.round(t.starterTotalValue).toLocaleString().padEnd(8) +
    C.gray + "flex " + C.reset + t.flex.score.toFixed(0).padEnd(4) +
    C.gray + "picks " + C.reset + pickColor + t.pickCapital.flag + C.reset +
    C.gray + " (" + Math.round(t.pickCapital.value).toLocaleString() + ")" + C.reset,
  );

  for (const pos of ["QB", "RB", "WR", "TE"] as const) {
    const ps = t.positionScores[pos];
    const classColor = POS_CLASS_COLOR[ps.classification] ?? C.gray;
    console.log(
      "    " +
      C.dim + pos + C.reset + "  " +
      "starter " + bar(ps.starterScore) + " " + ps.starterScore.toFixed(0).padStart(3) +
      "   depth " + bar(ps.depthScore, 10) + " " + ps.depthScore.toFixed(0).padStart(3) +
      "   urg " + ps.urgency.toFixed(0).padStart(3) + "  " +
      classColor + ps.classification + C.reset,
    );
  }

  if (t.archetypes.length > 0) {
    console.log("    " + C.gray + "archetypes: " + C.reset + C.magenta + t.archetypes.join(", ") + C.reset);
  }
}

function printLeagueSummary(profiles: TeamProfile[]): void {
  console.log(C.bold + C.cyan + "─".repeat(80) + C.reset);
  console.log(C.bold + " LEAGUE SHAPE" + C.reset);
  const counts: Record<string, number> = {};
  for (const t of profiles) counts[t.windowLabel] = (counts[t.windowLabel] ?? 0) + 1;
  const lines: string[] = [];
  for (const [label, n] of Object.entries(counts)) {
    const color = LABEL_COLOR[label as WindowLabel] ?? C.cyan;
    lines.push(`${color}${label}${C.reset}: ${n}`);
  }
  console.log(" " + lines.join("  ·  "));
  console.log(C.bold + C.cyan + "═".repeat(80) + C.reset);
  console.log("");
}

// ── HTML output (for Johnny to actually read) ───────────────────────────────

const LABEL_HEX: Record<WindowLabel, string> = {
  JUGGERNAUT: "#16a34a",
  CONTEND: "#22c55e",
  CLOSING: "#ef4444",
  RISING: "#06b6d4",
  AVERAGE: "#94a3b8",
  MIDDLING: "#eab308",
  REBUILD: "#3b82f6",
  TRANSITION: "#a855f7",
  STUCK: "#dc2626",
};

const POS_CLASS_HEX: Record<string, string> = {
  CRITICAL_NEED: "#ef4444",
  NEED: "#eab308",
  HEALTHY: "#22c55e",
  SURPLUS: "#06b6d4",
};

const PICK_HEX: Record<string, string> = {
  PICK_RICH: "#22c55e",
  PICK_POOR: "#ef4444",
  NEUTRAL: "#64748b",
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function progressBar(score: number, label: string): string {
  const pct = Math.max(0, Math.min(100, score));
  const color = pct >= 70 ? "#22c55e" : pct >= 50 ? "#06b6d4" : pct >= 30 ? "#eab308" : "#ef4444";
  return `
    <div class="bar-row">
      <span class="bar-label">${escapeHtml(label)}</span>
      <div class="bar-track"><div class="bar-fill" style="width:${pct}%;background:${color}"></div></div>
      <span class="bar-num">${score.toFixed(0)}</span>
    </div>`;
}

function teamCardHtml(t: TeamProfile): string {
  const labelColor = LABEL_HEX[t.windowLabel];
  const pickColor = PICK_HEX[t.pickCapital.flag];
  const archetypes = t.archetypes.length > 0
    ? `<div class="archetypes">${t.archetypes.map(a => `<span class="arch-tag">${escapeHtml(a)}</span>`).join("")}</div>`
    : "";

  const positions = (["QB", "RB", "WR", "TE"] as const).map(pos => {
    const ps = t.positionScores[pos];
    const classColor = POS_CLASS_HEX[ps.classification];
    return `
      <div class="pos-row">
        <span class="pos-tag pos-${pos}">${pos}</span>
        ${progressBar(ps.starterScore, "starter")}
        ${progressBar(ps.depthScore, "depth")}
        <span class="urg">urg ${ps.urgency.toFixed(0)}</span>
        <span class="pos-class" style="color:${classColor}">${ps.classification.replace("_", " ")}</span>
      </div>`;
  }).join("");

  const mineMark = t.isMine ? `<span class="mine-mark">★ YOU</span>` : "";

  return `
    <div class="team-card${t.isMine ? " mine" : ""}">
      <div class="team-header">
        <div class="team-name">${escapeHtml(t.ownerName)} ${mineMark}</div>
        <div class="team-rank">rank #${t.starterRank} · ${escapeHtml(t.record)}</div>
      </div>
      <div class="team-meta">
        <span class="window-label" style="background:${labelColor}">${t.windowLabel}</span>
        <span class="meta-pill">${t.competitiveness} / ${t.windowTier}</span>
        <span class="meta-pill">cal_age <strong>${t.weightedCalendarAge.toFixed(1)}</strong></span>
        <span class="meta-pill">age_pres <strong>${t.teamAgePressure.toFixed(0)}</strong></span>
        <span class="meta-pill">starter <strong>${Math.round(t.starterTotalValue).toLocaleString()}</strong></span>
        <span class="meta-pill">flex <strong>${t.flex.score.toFixed(0)}</strong></span>
        <span class="meta-pill" style="color:${pickColor}">${t.pickCapital.flag} (${Math.round(t.pickCapital.value).toLocaleString()})</span>
      </div>
      <div class="positions">${positions}</div>
      ${archetypes}
    </div>`;
}

function gridSummaryHtml(profiles: TeamProfile[]): string {
  const grid: Record<string, TeamProfile[]> = {};
  for (const p of profiles) {
    const key = `${p.competitiveness}-${p.windowTier}`;
    (grid[key] ||= []).push(p);
  }
  const cell = (comp: string, tier: string) => {
    const teams = grid[`${comp}-${tier}`] ?? [];
    if (teams.length === 0) return `<td class="grid-cell empty">—</td>`;
    const label = teams[0]!.windowLabel;
    const color = LABEL_HEX[label];
    const names = teams.map(t => `<div class="grid-name${t.isMine ? " mine-name" : ""}">${escapeHtml(t.ownerName)}</div>`).join("");
    return `<td class="grid-cell"><div class="grid-label" style="background:${color}">${label}</div>${names}</td>`;
  };
  return `
    <table class="grid-table">
      <thead><tr><th></th><th>LONG</th><th>MID</th><th>SHORT</th></tr></thead>
      <tbody>
        <tr><th>STRONG</th>${cell("STRONG", "LONG")}${cell("STRONG", "MID")}${cell("STRONG", "SHORT")}</tr>
        <tr><th>AVERAGE</th>${cell("AVERAGE", "LONG")}${cell("AVERAGE", "MID")}${cell("AVERAGE", "SHORT")}</tr>
        <tr><th>WEAK</th>${cell("WEAK", "LONG")}${cell("WEAK", "MID")}${cell("WEAK", "SHORT")}</tr>
      </tbody>
    </table>`;
}

const HTML_STYLES = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: #0a0c0f; color: #e2e8f0; font-family: ui-monospace, "SF Mono", Menlo, monospace; padding: 24px; line-height: 1.5; }
  h1 { font-size: 22px; margin-bottom: 4px; }
  h2 { font-size: 14px; color: #f59e0b; letter-spacing: 2px; margin: 32px 0 12px; }
  .meta { color: #64748b; font-size: 12px; margin-bottom: 24px; }
  .grid-table { border-collapse: separate; border-spacing: 4px; margin-bottom: 32px; }
  .grid-table th { font-size: 10px; color: #64748b; padding: 4px 8px; letter-spacing: 1px; text-align: left; }
  .grid-table thead th { text-align: center; }
  .grid-cell { background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.06); border-radius: 6px; padding: 8px; min-width: 140px; vertical-align: top; }
  .grid-cell.empty { color: #334155; text-align: center; font-size: 11px; }
  .grid-label { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 9px; font-weight: 700; letter-spacing: 1px; color: #0a0c0f; margin-bottom: 6px; }
  .grid-name { font-size: 11px; color: #cbd5e1; padding: 1px 0; }
  .grid-name.mine-name { color: #f59e0b; font-weight: 700; }
  .team-card { background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.06); border-radius: 8px; padding: 16px; margin-bottom: 12px; }
  .team-card.mine { border-color: #f59e0b; background: rgba(245,158,11,0.04); }
  .team-header { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 10px; }
  .team-name { font-weight: 700; font-size: 15px; }
  .team-rank { font-size: 11px; color: #64748b; }
  .mine-mark { color: #f59e0b; font-size: 11px; margin-left: 8px; }
  .team-meta { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 12px; }
  .window-label { padding: 3px 8px; border-radius: 4px; font-size: 10px; font-weight: 700; letter-spacing: 1px; color: #0a0c0f; }
  .meta-pill { padding: 3px 8px; border-radius: 4px; font-size: 11px; background: rgba(255,255,255,0.04); color: #94a3b8; border: 1px solid rgba(255,255,255,0.06); }
  .meta-pill strong { color: #e2e8f0; }
  .positions { display: flex; flex-direction: column; gap: 4px; margin: 8px 0; }
  .pos-row { display: grid; grid-template-columns: 36px 1fr 1fr 60px 110px; gap: 10px; align-items: center; font-size: 11px; }
  .pos-tag { color: #fff; font-size: 10px; font-weight: 700; padding: 1px 5px; border-radius: 3px; text-align: center; letter-spacing: 1px; width: 28px; }
  .pos-QB { background: #f97316; }
  .pos-RB { background: #22c55e; }
  .pos-WR { background: #3b82f6; }
  .pos-TE { background: #a855f7; }
  .bar-row { display: grid; grid-template-columns: 50px 1fr 30px; gap: 6px; align-items: center; }
  .bar-label { font-size: 10px; color: #64748b; }
  .bar-track { height: 8px; background: rgba(255,255,255,0.05); border-radius: 4px; overflow: hidden; }
  .bar-fill { height: 100%; transition: width 0.2s; }
  .bar-num { font-size: 10px; color: #94a3b8; text-align: right; }
  .urg { font-size: 10px; color: #64748b; }
  .pos-class { font-size: 10px; font-weight: 700; }
  .archetypes { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 8px; padding-top: 8px; border-top: 1px solid rgba(255,255,255,0.06); }
  .arch-tag { font-size: 10px; padding: 2px 8px; border-radius: 3px; background: rgba(168,85,247,0.12); color: #c4b5fd; border: 1px solid rgba(168,85,247,0.25); }
`;

export function writeHtmlReport(
  outPath: string,
  leagueName: string,
  format: LeagueFormat,
  profiles: TeamProfile[],
): void {
  const slot = format.starterSlots;
  const slotStr = `${slot.QB}QB · ${slot.RB}RB · ${slot.WR}WR · ${slot.TE}TE${slot.FLEX ? ` · ${slot.FLEX}FLEX` : ""}${slot.SUPER_FLEX ? ` · ${slot.SUPER_FLEX}SF` : ""}`;
  const fmtStr = `${format.superflex ? "Superflex" : "1QB"} · ${format.scoring.toUpperCase()}${format.tep ? " · TEP" : ""}`;

  const sorted = [...profiles].sort((a, b) => a.starterRank - b.starterRank);

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Send It Validate · ${escapeHtml(leagueName)}</title>
  <style>${HTML_STYLES}</style>
</head>
<body>
  <h1>${escapeHtml(leagueName)}</h1>
  <div class="meta">${escapeHtml(slotStr)}  ·  ${escapeHtml(fmtStr)}  ·  ${profiles.length} teams  ·  algorithm: <strong>${ALGO_NAME}</strong>  ·  generated ${new Date().toISOString()}</div>

  <h2>LEAGUE SHAPE</h2>
  ${gridSummaryHtml(profiles)}

  <h2>TEAMS</h2>
  ${sorted.map(teamCardHtml).join("")}
</body>
</html>`;

  writeFileSync(outPath, html, "utf8");
}
