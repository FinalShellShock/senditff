// Aging SIGNALS: does anything besides calendar age predict how fast a player
// is about to lose value?
//
// The age curves in aging.mjs say what a typical 28-year-old RB has left.
// This asks whether two 28-year-old RBs should be treated differently based on
// something we can measure about how they got here.
//
// Method, and the two traps it avoids:
//
// 1. NO LOOKAHEAD. Every signal is computed from a player's career THROUGH the
//    season being evaluated. Using career totals would leak the future into
//    the predictor and manufacture a result.
//
// 2. SPLIT WITHIN AGE. Groups are formed by comparing players of the SAME age
//    against each other, at the median for that age. Splitting globally would
//    just re-measure age, since older players have naturally accumulated more
//    of everything, and the "signal" would be age wearing a disguise.
//
// Outcome measure is the same remaining-value idea as aging.mjs: credit each
// player his PPG k years later, ZERO if he is out of the league, discount and
// sum. Signal strength is then reported as an EFFECTIVE AGE SHIFT: if the
// flagged group at 28 looks like the unflagged group at 31, that signal is
// worth +3 years of age pressure.
//
// Usage: node scripts/research/signals.mjs

import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { execSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const CACHE = join(HERE, ".cache");
const LAST_SEASON = 2024;
const DISCOUNT = 0.9;
const HORIZON = 8;

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

const season = parseCSV(readFileSync(join(CACHE, "season.csv"), "utf8"));
const players = parseCSV(readFileSync(join(CACHE, "players.csv"), "utf8"));
const birth = new Map();
for (const r of players.rows) {
  const id = r[players.idx["gsis_id"]], bd = r[players.idx["birth_date"]];
  if (id && bd) birth.set(id, bd);
}
const S = season.idx;
const num = (r, k) => { const v = parseFloat(r[S[k]]); return Number.isFinite(v) ? v : 0; };
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);

const FLOOR = {
  QB: (g, s) => g >= 8 && s.attempts >= 200,
  RB: (g, s) => g >= 8 && s.carries + s.targets >= 100,
  WR: (g, s) => g >= 8 && s.targets >= 50,
  TE: (g, s) => g >= 8 && s.targets >= 40,
};

// Build per-player season lists (ALL seasons, so career totals are complete,
// with a startable flag for the outcome measure).
const byPlayer = new Map();
for (const r of season.rows) {
  if (r[S["season_type"]] !== "REG") continue;
  const pos = r[S["position"]];
  if (!FLOOR[pos]) continue;
  const id = r[S["player_id"]], bd = birth.get(id);
  if (!bd) continue;
  const b = new Date(bd); if (isNaN(b)) continue;
  const yr = parseInt(r[S["season"]], 10);
  if (!(yr >= 1999 && yr <= LAST_SEASON)) continue;
  const games = num(r, "games");
  const st = { attempts: num(r,"attempts"), carries: num(r,"carries"), targets: num(r,"targets") };
  const age = (new Date(`${yr}-09-01`) - b) / (365.25*24*3600*1000);
  if (age < 19 || age > 45) continue;
  if (!byPlayer.has(id)) byPlayer.set(id, { pos, seasons: [] });
  byPlayer.get(id).seasons.push({
    season: yr, age, games,
    startable: FLOOR[pos](games, st),
    ppg: games > 0 ? num(r, "fantasy_points_ppr") / games : 0,
    carries: st.carries, targets: st.targets, attempts: st.attempts,
    rushYds: num(r, "rushing_yards"), rushTds: num(r, "rushing_tds"),
    recYds: num(r, "receiving_yards"), receptions: num(r, "receptions"),
    yac: num(r, "receiving_yards_after_catch"),
    sacks: num(r, "sacks"), fpts: num(r, "fantasy_points_ppr"),
  });
}
for (const v of byPlayer.values()) v.seasons.sort((a, b) => a.season - b.season);

// Remaining value for an arbitrary set of (playerId, age) observations.
function remainingValue(obs) {
  let total = 0;
  for (let k = 0; k <= HORIZON; k++) {
    const vals = [];
    for (const o of obs) {
      if (o.season + k > LAST_SEASON) continue;
      const rec = byPlayer.get(o.id);
      const later = rec.seasons.find((s) => Math.round(s.age) === Math.round(o.age) + k && s.startable);
      vals.push(later ? later.ppg : 0);
    }
    if (vals.length < 8) continue;
    total += Math.pow(DISCOUNT, k) * mean(vals);
  }
  return total;
}

// ── Signal definitions: value computed from career THROUGH this season ───────
const SIGNALS = {
  QB: [
    { key: "rush_share", label: "rushing share of career fantasy points",
      calc: (hist) => {
        const fp = hist.reduce((s, x) => s + x.fpts, 0);
        const rushPts = hist.reduce((s, x) => s + x.rushYds / 10 + x.rushTds * 6, 0);
        return fp > 0 ? rushPts / fp : 0;
      } },
    { key: "sack_rate", label: "career sacks per pass attempt",
      calc: (hist) => {
        const att = hist.reduce((s, x) => s + x.attempts, 0);
        return att > 0 ? hist.reduce((s, x) => s + x.sacks, 0) / att : 0;
      } },
  ],
  RB: [
    { key: "career_touches", label: "career touches to date (carries + targets)",
      calc: (hist) => hist.reduce((s, x) => s + x.carries + x.targets, 0) },
    { key: "rec_share", label: "receiving share of career touches",
      calc: (hist) => {
        const t = hist.reduce((s, x) => s + x.carries + x.targets, 0);
        return t > 0 ? hist.reduce((s, x) => s + x.targets, 0) / t : 0;
      } },
    { key: "peak_workload", label: "heaviest single-season touch load to date",
      calc: (hist) => Math.max(...hist.map((x) => x.carries + x.targets), 0) },
  ],
  WR: [
    { key: "yac_share", label: "share of career receiving yards from YAC",
      calc: (hist) => {
        const ry = hist.reduce((s, x) => s + x.recYds, 0);
        return ry > 0 ? hist.reduce((s, x) => s + x.yac, 0) / ry : 0;
      } },
    { key: "career_targets", label: "career targets to date",
      calc: (hist) => hist.reduce((s, x) => s + x.targets, 0) },
  ],
  TE: [
    { key: "career_targets", label: "career targets to date",
      calc: (hist) => hist.reduce((s, x) => s + x.targets, 0) },
  ],
};

const AGES = { QB: [27,28,29,30,31,32], RB: [24,25,26,27,28,29], WR: [25,26,27,28,29,30], TE: [26,27,28,29] };

for (const pos of ["QB", "RB", "WR", "TE"]) {
  console.log(`\n${"=".repeat(76)}`);
  console.log(`${pos}`);
  console.log("=".repeat(76));

  for (const sig of SIGNALS[pos]) {
    console.log(`\nSIGNAL: ${sig.label}`);
    console.log("  age    n(lo/hi)   median   remaining value lo -> hi    effect      shift   prodgap");
    const shifts = [];
    for (const age of AGES[pos]) {
      // Everyone startable at this age, with the signal measured through that season.
      const obs = [];
      for (const [id, rec] of byPlayer) {
        if (rec.pos !== pos) continue;
        const i = rec.seasons.findIndex((s) => Math.round(s.age) === age && s.startable);
        if (i < 0) continue;
        const hist = rec.seasons.slice(0, i + 1);
        obs.push({ id, age, season: rec.seasons[i].season, sv: sig.calc(hist), ppgNow: rec.seasons[i].ppg });
      }
      if (obs.length < 24) continue;

      // TRAP 3, the one that invalidates a naive run: most of these signals are
      // partly measuring whether a player is GOOD. An RB with 800 career
      // touches is a workhorse starter; one with 200 is a backup. Split on that
      // raw and the "signal" just rediscovers quality, and a warning sign comes
      // out looking like a blessing.
      //
      // So stratify by CURRENT production first and split on the signal only
      // WITHIN each stratum. That compares players producing at the same level
      // right now who differ in how they got there, which is the actual
      // question.
      const strata = 3;
      const byProd = [...obs].sort((a, b) => a.ppgNow - b.ppgNow);
      const lo = [], hi = [];
      for (let s = 0; s < strata; s++) {
        const chunk = byProd.slice(
          Math.floor((s * byProd.length) / strata),
          Math.floor(((s + 1) * byProd.length) / strata),
        );
        if (chunk.length < 6) continue;
        const cs = [...chunk].sort((a, b) => a.sv - b.sv);
        const cmed = cs[Math.floor(cs.length / 2)].sv;
        for (const o of chunk) (o.sv >= cmed ? hi : lo).push(o);
      }
      const sorted = [...obs].sort((a, b) => a.sv - b.sv);
      const med = sorted[Math.floor(sorted.length / 2)].sv;
      if (lo.length < 12 || hi.length < 12) continue;
      // Confirm the strata actually balanced current production, otherwise the
      // control failed and the comparison is still contaminated.
      const prodGap = Math.abs(mean(hi.map((o) => o.ppgNow)) - mean(lo.map((o) => o.ppgNow)));
      const rvLo = remainingValue(lo), rvHi = remainingValue(hi);
      if (rvLo <= 0) continue;
      const effect = (rvHi / rvLo - 1) * 100;

      // Convert to years using how fast this position loses value near this age.
      const allNow = remainingValue(obs);
      const older = [];
      for (const [id, rec] of byPlayer) {
        if (rec.pos !== pos) continue;
        const i = rec.seasons.findIndex((s) => Math.round(s.age) === age + 2 && s.startable);
        if (i < 0) continue;
        older.push({ id, age: age + 2, season: rec.seasons[i].season });
      }
      const rvOlder = older.length >= 12 ? remainingValue(older) : null;
      const perYear = rvOlder != null ? (allNow - rvOlder) / 2 : null;
      const shift = perYear && perYear > 0 ? (rvLo - rvHi) / perYear : null;
      if (shift != null) shifts.push(shift);

      console.log(
        `  ${String(age).padStart(3)}   ${String(lo.length).padStart(3)}/${String(hi.length).padEnd(3)}  ` +
        `${med.toFixed(med < 1 ? 3 : 0).padStart(8)}   ${rvLo.toFixed(1).padStart(6)} -> ${rvHi.toFixed(1).padStart(6)}   ` +
        `${(effect >= 0 ? "+" : "") + effect.toFixed(1) + "%"}`.padStart(9) +
        `   ${shift == null ? "  -" : (shift >= 0 ? "+" : "") + shift.toFixed(1) + "y"}`.padStart(9) +
        `   ${prodGap.toFixed(2)}`.padStart(8)
      );
    }
    if (shifts.length >= 3) {
      const avg = mean(shifts);
      const consistent = shifts.every((s) => s > 0.25) || shifts.every((s) => s < -0.25);
      const effects = shifts.length;
      console.log(`  => avg effective age shift: ${(avg >= 0 ? "+" : "")}${avg.toFixed(1)} years across ${effects} buckets` +
                  `  [${consistent ? "CONSISTENT" : "DIRECTION FLIPS, treat as noise"}]`);
    } else {
      console.log("  => too few usable age buckets to conclude");
    }
  }
}
console.log("\nSIGN: positive shift = the HIGH group has LESS left, i.e. it looks that");
console.log("many years OLDER. That makes the signal a warning sign.");
console.log("\nCAUTION on the years column: it divides the value gap by how fast that");
console.log("position normally declines. QBs decline slowly, so dividing by that small");
console.log("number inflates the years badly. For QB, trust the percent, not the years.");
