// Data-driven age curves for SendItFF.
//
// The question this answers is NOT "how many points does a 31-year-old
// score." It is "how much production does a 31-year-old have LEFT." Dynasty
// value prices remaining career, so a player falling out of the league is not
// missing data to impute away: it is the entire signal. A player who is out
// of the league produces zero, and that zero belongs in the average.
//
// So for every player startable at age a, we look forward k years and credit
// his PPG at age a+k, or ZERO if he is not startable then. Averaging across
// players folds survival and production into one number without needing to
// model them separately.
//
//   remaining_value(a) = sum over k of  discount^k * E[PPG at a+k | startable at a]
//   pressure(a)        = 100 * (1 - remaining_value(a) / max_a remaining_value(a))
//
// Right-censoring matters: a player whose season is 2022 cannot be observed 5
// years later in a dataset ending in 2024. Each horizon k is therefore
// computed on its own eligible sample (season + k <= LAST_SEASON), which uses
// the most data available at every horizon instead of throwing away recent
// seasons to keep one balanced panel.
//
// Usage: node scripts/research/aging.mjs [--discount 0.9] [--horizon 8]

import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const CACHE = join(HERE, ".cache");
const LAST_SEASON = 2024; // nflverse coverage ends here
const FIRST_SEASON = 1999;

const SOURCES = {
  "season.csv":
    "https://github.com/nflverse/nflverse-data/releases/download/player_stats/player_stats_season.csv",
  "players.csv":
    "https://github.com/nflverse/nflverse-data/releases/download/players/players.csv",
};

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] != null ? parseFloat(process.argv[i + 1]) : fallback;
}
const DISCOUNT = arg("discount", 0.9);
const HORIZON = arg("horizon", 8);

function ensureData() {
  if (!existsSync(CACHE)) mkdirSync(CACHE, { recursive: true });
  for (const [file, url] of Object.entries(SOURCES)) {
    const path = join(CACHE, file);
    if (existsSync(path)) continue;
    console.log(`downloading ${file} ...`);
    execSync(`curl -sL --max-time 300 -o "${path}" "${url}"`, { stdio: "inherit" });
  }
}

function parseCSV(text) {
  const rows = [];
  let row = [], field = "", inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (c !== "\r") field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  const header = rows.shift();
  return { rows, idx: Object.fromEntries(header.map((h, i) => [h, i])) };
}

// A player-season counts as "startable" only above these volume floors, so the
// curve describes players you would actually roster, not deep bench bodies.
const FLOOR = {
  QB: (g, r) => g >= 8 && r.attempts >= 200,
  RB: (g, r) => g >= 8 && r.carries + r.targets >= 100,
  WR: (g, r) => g >= 8 && r.targets >= 50,
  TE: (g, r) => g >= 8 && r.targets >= 40,
};
const POSITIONS = ["QB", "RB", "WR", "TE"];

ensureData();
const season = parseCSV(readFileSync(join(CACHE, "season.csv"), "utf8"));
const players = parseCSV(readFileSync(join(CACHE, "players.csv"), "utf8"));

const birth = new Map();
for (const r of players.rows) {
  const id = r[players.idx["gsis_id"]], bd = r[players.idx["birth_date"]];
  if (id && bd) birth.set(id, bd);
}

const S = season.idx;
const n = (r, k) => { const v = parseFloat(r[S[k]]); return Number.isFinite(v) ? v : 0; };

// pos -> playerId -> Map(intAge -> ppg) for startable seasons only
const careers = {};
for (const p of POSITIONS) careers[p] = new Map();
// pos -> Set of "id" seen at all (for reporting)
for (const r of season.rows) {
  if (r[S["season_type"]] !== "REG") continue;
  const pos = r[S["position"]];
  if (!POSITIONS.includes(pos)) continue;
  const yr = parseInt(r[S["season"]], 10);
  if (!(yr >= FIRST_SEASON && yr <= LAST_SEASON)) continue;
  const id = r[S["player_id"]];
  const bd = birth.get(id);
  if (!bd) continue;
  const b = new Date(bd);
  if (isNaN(b)) continue;
  const games = n(r, "games");
  const stats = { attempts: n(r, "attempts"), carries: n(r, "carries"), targets: n(r, "targets") };
  if (!FLOOR[pos](games, stats)) continue;
  // Age at Sept 1 of the season being played.
  const age = (new Date(`${yr}-09-01`) - b) / (365.25 * 24 * 3600 * 1000);
  if (age < 19 || age > 45) continue;
  const ppg = n(r, "fantasy_points_ppr") / games;
  const key = Math.round(age); // nearest integer age bucket
  if (!careers[pos].has(id)) careers[pos].set(id, new Map());
  const m = careers[pos].get(id);
  // A player can appear twice in a season (traded); keep the better line.
  const prev = m.get(key);
  if (!prev || ppg > prev.ppg) m.set(key, { ppg, season: yr });
}

const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);

// E[PPG at age a+k | startable at age a], crediting 0 when not startable.
// Only players whose season + k is observable are counted, so late seasons do
// not silently look like career endings.
function expectedAt(pos, a, k) {
  const vals = [];
  for (const [, m] of careers[pos]) {
    const here = m.get(a);
    if (!here) continue;
    if (here.season + k > LAST_SEASON) continue; // censored, cannot observe
    const later = m.get(a + k);
    vals.push(later ? later.ppg : 0);
  }
  return { mean: mean(vals), n: vals.length };
}

function remainingValue(pos, a) {
  let total = 0, baseN = 0;
  for (let k = 0; k <= HORIZON; k++) {
    const { mean: m, n: cnt } = expectedAt(pos, a, k);
    if (k === 0) baseN = cnt;
    if (cnt < 10) continue; // refuse thin horizons
    total += Math.pow(DISCOUNT, k) * m;
  }
  return { rv: total, n: baseN };
}

// ---------------------------------------------------------------- report
console.log(`\nSurvival-weighted remaining value  (discount ${DISCOUNT}/yr, horizon ${HORIZON}y)`);
console.log(`nflverse ${FIRST_SEASON}-${LAST_SEASON}. Zero credited for non-startable years.\n`);

const CURRENT = {
  QB: { productiveStart: 23, peakStart: 26, peakEnd: 32, declineStart: 35, done: 38 },
  RB: { productiveStart: 21, peakStart: 23, peakEnd: 27, declineStart: 28, done: 30 },
  WR: { productiveStart: 22, peakStart: 26, peakEnd: 30, declineStart: 32, done: 34 },
  TE: { productiveStart: 23, peakStart: 26, peakEnd: 30, declineStart: 32, done: 34 },
};
function currentPressure(age, pos) {
  const c = CURRENT[pos];
  const ip = (x, x0, x1, y0, y1) => (x1 === x0 ? y0 : y0 + ((x - x0) / (x1 - x0)) * (y1 - y0));
  if (age <= c.productiveStart) return 0;
  if (age <= c.peakStart) return ip(age, c.productiveStart, c.peakStart, 0, 0);
  if (age <= c.peakEnd) return ip(age, c.peakStart, c.peakEnd, 0, 25);
  if (age <= c.declineStart) return ip(age, c.peakEnd, c.declineStart, 25, 60);
  if (age <= c.done) return ip(age, c.declineStart, c.done, 60, 100);
  return 100;
}

const out = {};
for (const pos of POSITIONS) {
  const rows = [];
  for (let a = 21; a <= 38; a++) {
    const { rv, n: cnt } = remainingValue(pos, a);
    if (cnt < 15) continue;
    rows.push({ age: a, rv, n: cnt });
  }
  const peak = Math.max(...rows.map((r) => r.rv));
  for (const r of rows) r.pressure = 100 * (1 - r.rv / peak);
  out[pos] = rows;

  console.log(`${"=".repeat(70)}`);
  console.log(`${pos}   peak remaining value ${peak.toFixed(1)} at age ${rows.find((r) => r.rv === peak).age}`);
  console.log(`${"=".repeat(70)}`);
  console.log("  age    n    remaining value   DATA pressure   CURRENT pressure   gap");
  for (const r of rows) {
    const cur = currentPressure(r.age, pos);
    const gap = r.pressure - cur;
    const flag = Math.abs(gap) >= 20 ? "  <<<" : "";
    console.log(
      `  ${String(r.age).padStart(3)}  ${String(r.n).padStart(4)}   ${r.rv.toFixed(1).padStart(14)}   ${r.pressure.toFixed(0).padStart(13)}   ${cur.toFixed(0).padStart(16)}   ${gap >= 0 ? "+" : ""}${gap.toFixed(0).padStart(4)}${flag}`
    );
  }
  console.log("");
}

// Breakpoints implied by the data, read off the pressure curve.
console.log(`${"=".repeat(70)}`);
console.log("IMPLIED BREAKPOINTS (first age at which data pressure crosses each level)");
console.log(`${"=".repeat(70)}`);
console.log("pos   peakStart(>0)  peakEnd(>=25)  declineStart(>=60)  done(>=100)   |  current");
for (const pos of POSITIONS) {
  const rows = out[pos];
  const cross = (lvl) => { const r = rows.find((x) => x.pressure >= lvl); return r ? r.age : null; };
  const c = CURRENT[pos];
  console.log(
    `${pos.padEnd(4)}  ${String(cross(0.01) ?? "-").padStart(12)}  ${String(cross(25) ?? "-").padStart(13)}  ${String(cross(60) ?? "-").padStart(18)}  ${String(cross(99) ?? "-").padStart(11)}   |  ${c.peakStart}/${c.peakEnd}/${c.declineStart}/${c.done}`
  );
}

// ---------------------------------------------------------------------------
// Decline RATE, which is a different question from remaining-value LEVEL.
//
// Remaining value falls monotonically with age for everyone, so its level
// barely separates positions: at 27 it reads 48 for an RB and 46 for a WR,
// even though one is falling apart and the other is in his prime. What
// separates them is how fast the value is draining. That rate is the right
// signal for "is this player aging" (the age-arb gates); the level is the
// right signal for valuation and window classification.
console.log(`\n${"=".repeat(70)}`);
console.log("ANNUAL LOSS RATE: %% of remaining value lost going into the next year");
console.log(`${"=".repeat(70)}`);
// Smoothed over a 3-year window: single-year rates swing wildly (and go
// negative) at these sample sizes, which is noise, not a player getting
// younger. Annualizing rv(a+3)/rv(a) gives a stable read on the trend.
const WINDOW = 3;
const lossRate = (pos, a) => {
  const rows = out[pos];
  const here = rows.find((r) => r.age === a);
  const later = rows.find((r) => r.age === a + WINDOW);
  if (!here || !later || here.rv <= 0 || later.rv <= 0) return null;
  return (1 - Math.pow(later.rv / here.rv, 1 / WINDOW)) * 100;
};

console.log(`(annualized over ${WINDOW} years; ages 21-22 omitted, tiny and selection-heavy)`);
console.log("age " + POSITIONS.map((p) => p.padStart(9)).join(""));
for (let a = 23; a <= 34; a++) {
  const cells = POSITIONS.map((pos) => {
    const pct = lossRate(pos, a);
    return pct == null ? "-".padStart(9) : `${pct.toFixed(1)}%`.padStart(9);
  });
  console.log(String(a).padStart(3) + cells.join(""));
}

console.log("\nFirst age where annual loss rate crosses each level:");
console.log("pos    >5%/yr   >8%/yr   >12%/yr");
for (const pos of POSITIONS) {
  const rows = out[pos];
  void rows;
  // sustained: this age AND the next both above the level, on the smoothed rate
  const cross = (lvl) => {
    for (let a = 23; a <= 36; a++) {
      const r1 = lossRate(pos, a), r2 = lossRate(pos, a + 1);
      if (r1 != null && r2 != null && r1 >= lvl && r2 >= lvl) return a;
    }
    return null;
  };
  console.log(
    `${pos.padEnd(6)} ${String(cross(5) ?? "-").padStart(6)}   ${String(cross(8) ?? "-").padStart(6)}   ${String(cross(12) ?? "-").padStart(7)}`
  );
}

// ---------------------------------------------------------------------------
// Isotonic regression (pool adjacent violators) on the loss rate.
//
// Physiologically the rate at which a player bleeds remaining value should not
// go DOWN as he ages. Where the raw series does that (WR 2.5% at 32 then 17.9%
// at 33, TE going negative at 30) it is sampling noise, not a player aging in
// reverse. PAVA is the standard fit under a monotonicity constraint: it
// returns the least-squares closest non-decreasing series, pooling violating
// neighbours into their weighted average. Weighting by n means thin old-age
// buckets bend to the well-populated ones rather than the other way round.
function pava(points) {
  // points: [{ x, y, w }] sorted by x. Returns same shape with y non-decreasing.
  const blocks = points.map((p) => ({ y: p.y, w: p.w, xs: [p.x] }));
  let i = 0;
  while (i < blocks.length - 1) {
    if (blocks[i].y <= blocks[i + 1].y + 1e-12) { i++; continue; }
    const a = blocks[i], b = blocks[i + 1];
    const w = a.w + b.w;
    blocks.splice(i, 2, { y: (a.y * a.w + b.y * b.w) / w, w, xs: [...a.xs, ...b.xs] });
    if (i > 0) i--;
  }
  const res = [];
  for (const b of blocks) for (const x of b.xs) res.push({ x, y: b.y });
  return res.sort((p, q) => p.x - q.x);
}

console.log(`\n${"=".repeat(70)}`);
console.log("FITTED LOSS RATE (isotonic, n-weighted) -- the recommended curve");
console.log(`${"=".repeat(70)}`);
console.log("age " + POSITIONS.map((p) => p.padStart(9)).join(""));
const fitted = {};
for (const pos of POSITIONS) {
  const pts = [];
  for (let a = 23; a <= 36; a++) {
    const r = lossRate(pos, a);
    if (r == null) continue;
    const row = out[pos].find((x) => x.age === a);
    pts.push({ x: a, y: r, w: row ? row.n : 1 });
  }
  fitted[pos] = pava(pts);
}
const allAges = [...new Set(POSITIONS.flatMap((p) => fitted[p].map((q) => q.x)))].sort((a, b) => a - b);
for (const a of allAges) {
  const cells = POSITIONS.map((pos) => {
    const f = fitted[pos].find((q) => q.x === a);
    return f ? `${f.y.toFixed(1)}%`.padStart(9) : "-".padStart(9);
  });
  console.log(String(a).padStart(3) + cells.join(""));
}

console.log("\n// Paste-ready constant for src/algo/constants.ts");
console.log("export const VALUE_LOSS_RATE: Record<Position, Record<number, number>> = {");
for (const pos of POSITIONS) {
  const body = fitted[pos].map((q) => `${q.x}: ${q.y.toFixed(1)}`).join(", ");
  console.log(`  ${pos}: { ${body} },`);
}
console.log("};");

// Raw remaining value, in discounted PPG-years. Comparable ACROSS positions
// (a QB really does have more fantasy value left than an RB), which is what
// window classification needs. Ages 21-22 are dropped: a startable 21-year-old
// WR is a generational outlier and the bucket reads 65.4 against 46.4 at 22.
console.log("\n// Raw remaining value (discounted PPG-years), for window math");
console.log("export const REMAINING_VALUE: Record<Position, Record<number, number>> = {");
for (const pos of POSITIONS) {
  const body = out[pos].filter((r) => r.age >= 23).map((r) => `${r.age}: ${r.rv.toFixed(1)}`).join(", ");
  console.log(`  ${pos}: { ${body} },`);
}
console.log("};");
const globalMax = Math.max(...POSITIONS.flatMap((p) => out[p].filter((r) => r.age >= 23).map((r) => r.rv)));
console.log(`// global max remaining value (all positions, age>=23): ${globalMax.toFixed(1)}`);

writeFileSync(join(HERE, "aging-output.json"), JSON.stringify({ level: out, lossRateFitted: fitted }, null, 2));
console.log(`\nwrote ${join(HERE, "aging-output.json")}`);
