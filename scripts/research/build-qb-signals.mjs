// Emits src/data/qbSignals.json: normalized player name -> aging-signal
// multiplier on remaining career value. 1.0 means no warning, 0.8 means this
// QB profiles about 20% short of what his calendar age implies.
//
// Two confirmed signals (see scripts/research/SIGNALS.md), both QB-only:
//   rushing share of career fantasy points   ~ -18% remaining value
//   career sacks per pass attempt            ~ -22% remaining value
//
// We take the MAX of the two penalties rather than the sum. They are plausibly
// correlated (a QB who runs and holds the ball also takes hits), so adding them
// would double-count the same underlying story. Max is the conservative read.
//
// Usage: node scripts/research/build-qb-signals.mjs

import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const CACHE = join(HERE, ".cache");
const OUT = join(HERE, "..", "..", "src", "data", "qbSignals.json");
const LAST_SEASON = 2024;
// Only QBs with recent starter usage. Anyone older than this is off dynasty
// rosters anyway and would just bloat the file shipped to the client.
const RECENT_FROM = 2021;

const RUSH_EFFECT = 0.18;
const SACK_EFFECT = 0.22;

const SOURCES = {
  "season.csv": "https://github.com/nflverse/nflverse-data/releases/download/player_stats/player_stats_season.csv",
  "players.csv": "https://github.com/nflverse/nflverse-data/releases/download/players/players.csv",
};
if (!existsSync(CACHE)) mkdirSync(CACHE, { recursive: true });
for (const [f, url] of Object.entries(SOURCES)) {
  const p = join(CACHE, f);
  if (!existsSync(p)) { console.log(`downloading ${f}...`); execSync(`curl -sL --max-time 300 -o "${p}" "${url}"`); }
}

function parseCSV(text) {
  const rows = []; let row = [], field = "", inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) { if (c === '"') { if (text[i+1] === '"') { field += '"'; i++; } else inQ = false; } else field += c; }
    else if (c === '"') inQ = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (c !== "\r") field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  const header = rows.shift();
  return { rows, idx: Object.fromEntries(header.map((h, i) => [h, i])) };
}

// Must match src/data/normalize.ts EXACTLY or the join silently misses every
// player. That version strips all non-alphanumerics including spaces.
function normName(name) {
  if (!name) return "";
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .replace(/(jr|sr|ii|iii|iv|v)$/, "");
}

const season = parseCSV(readFileSync(join(CACHE, "season.csv"), "utf8"));
const players = parseCSV(readFileSync(join(CACHE, "players.csv"), "utf8"));
const displayName = new Map();
for (const r of players.rows) {
  const id = r[players.idx["gsis_id"]], dn = r[players.idx["display_name"]];
  if (id && dn) displayName.set(id, dn);
}

const S = season.idx;
const num = (r, k) => { const v = parseFloat(r[S[k]]); return Number.isFinite(v) ? v : 0; };

// Accumulate whole careers, then keep only QBs seen recently.
const career = new Map();
for (const r of season.rows) {
  if (r[S["season_type"]] !== "REG") continue;
  if (r[S["position"]] !== "QB") continue;
  const yr = parseInt(r[S["season"]], 10);
  if (!(yr >= 1999 && yr <= LAST_SEASON)) continue;
  const id = r[S["player_id"]];
  if (!career.has(id)) career.set(id, { att: 0, sacks: 0, fpts: 0, rushYds: 0, rushTds: 0, last: 0 });
  const c = career.get(id);
  c.att += num(r, "attempts");
  c.sacks += num(r, "sacks");
  c.fpts += num(r, "fantasy_points_ppr");
  c.rushYds += num(r, "rushing_yards");
  c.rushTds += num(r, "rushing_tds");
  c.last = Math.max(c.last, yr);
}

const pool = [];
for (const [id, c] of career) {
  if (c.last < RECENT_FROM) continue;
  if (c.att < 300) continue; // need a real body of work to characterize a style
  const rushShare = c.fpts > 0 ? (c.rushYds / 10 + c.rushTds * 6) / c.fpts : 0;
  const sackRate = c.att > 0 ? c.sacks / c.att : 0;
  const name = displayName.get(id);
  if (!name) continue;
  pool.push({ id, name, key: normName(name), rushShare, sackRate });
}

const pct = (arr, p) => {
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.max(0, Math.min(s.length - 1, Math.floor(p * s.length)))];
};
const rushMed = pct(pool.map((p) => p.rushShare), 0.5);
const rushHigh = pct(pool.map((p) => p.rushShare), 0.9);
const sackMed = pct(pool.map((p) => p.sackRate), 0.5);
const sackHigh = pct(pool.map((p) => p.sackRate), 0.9);

// Continuous ramp from the median to the 90th percentile, so a QB just over
// the line does not get the same hit as an extreme one. Below median = no
// penalty at all.
const ramp = (v, med, high) => (high <= med ? 0 : Math.max(0, Math.min(1, (v - med) / (high - med))));

const out = {};
for (const p of pool) {
  // Sack rate is deliberately NOT applied, despite testing as strong as
  // rushing share in research. In the live population it flags Zach Wilson,
  // Will Levis, Caleb Williams and Bryce Young: young QBs on bad teams, not
  // aging ones. The research controlled for quality by stratifying on current
  // production; applying the raw signal to real rosters throws that control
  // away and the confound walks straight back in. Rushing share survives
  // because it describes a STYLE, not a quality tier.
  const penalty = ramp(p.rushShare, rushMed, rushHigh) * RUSH_EFFECT;
  if (penalty < 0.01) continue; // omit no-ops to keep the file small
  out[p.key] = Math.round((1 - penalty) * 1000) / 1000;
}

writeFileSync(OUT, JSON.stringify(out, null, 0) + "\n");
console.log(`QB pool: ${pool.length}   flagged: ${Object.keys(out).length}`);
console.log(`rush share  median ${rushMed.toFixed(3)}  p90 ${rushHigh.toFixed(3)}`);
console.log(`sack rate   median ${sackMed.toFixed(3)}  p90 ${sackHigh.toFixed(3)}`);
console.log(`\nstrongest signals (lowest multiplier):`);
Object.entries(out).sort((a, b) => a[1] - b[1]).slice(0, 12)
  .forEach(([k, v]) => {
    const p = pool.find((x) => x.key === k);
    console.log(`  ${p.name.padEnd(22)} ${v.toFixed(3)}   rush share ${(p.rushShare * 100).toFixed(1)}%`);
  });
console.log(`\nwrote ${OUT}`);
