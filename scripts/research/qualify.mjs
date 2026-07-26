// Which team signals actually QUALIFY a team for a trade archetype?
//
// Johnny's framing, and it is the right one: a team is an account, an archetype
// is a product, and we want the observable signals that say this account would
// benefit from this product. Signals mean different things for different
// account types, so a signal has to be read against the team's situation, not
// in isolation.
//
// The engine already does this shape of thing in scoreArchetypes(). The problem
// is those signals were invented, not measured. This asks the data which ones
// predict a BENEFIT.
//
// Design
//   unit      (team, season) where that season AND the next were played
//   signals   contention (points-for rank) and roster age, both observable
//             BEFORE the trade and both things our engine already computes
//   behavior  did they consolidate, tier down, buy age, sell age
//   outcome   next-season points-for rank, as lift over the same-starting-rank
//             baseline (regression to the mean is huge, see OUTCOMES.md)
//
// A cell qualifies for an archetype when teams with that signal profile who
// made that move beat their baseline. That is a measured threshold instead of
// a guessed one.
//
// WHY AGE AND NOT VALUE: player values are only available as of today.
// Applying them to a 2023 roster would score a since-broken-out rookie as if
// he were always a star, which is hindsight leaking into a feature. Ages are
// exact at any date (birth date minus season), so age is the one roster signal
// that can be reconstructed honestly.
//
//   node scripts/research/qualify.mjs

import { existsSync, readFileSync, writeFileSync } from "node:fs";

const CACHE = "scripts/research/outcomes-cache.json";
const ROSTERS = "scripts/research/roster-ages.json";
const EXTRA = "scripts/research/trades-ancestors.json";
const CRAWL = "scripts/research/trades-crawl.json";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url);
      if (r.status === 429) { await sleep(2000 * (i + 1)); continue; }
      if (!r.ok) return null;
      return await r.json();
    } catch { await sleep(400 * (i + 1)); }
  }
  return null;
}
async function pool(items, fn, c = 6) {
  const out = [];
  for (let i = 0; i < items.length; i += c) {
    out.push(...(await Promise.all(items.slice(i, i + c).map(fn))));
    await sleep(120);
  }
  return out;
}

const cache = JSON.parse(readFileSync(CACHE, "utf8"));
const crawl = JSON.parse(readFileSync(CRAWL, "utf8"));
const extra = existsSync(EXTRA) ? JSON.parse(readFileSync(EXTRA, "utf8")) : {};
const allTrades = [...crawl.trades, ...Object.values(extra).flat()];

const played = (id) => (cache[id]?.rosters ?? []).some((r) => r.pf > 0);
const successor = {};
for (const [id, v] of Object.entries(cache)) if (v.prev) successor[v.prev] = id;

// Only leagues we can actually measure an outcome for.
const measurable = Object.keys(cache).filter((id) => played(id) && successor[id] && played(successor[id]));

// ── Roster age per team-season ───────────────────────────────────────────────
let ages = existsSync(ROSTERS) ? JSON.parse(readFileSync(ROSTERS, "utf8")) : {};
const need = measurable.filter((id) => !ages[id]);
if (need.length) {
  console.log(`fetching rosters for ${need.length} leagues to build age profiles`);
  const players = await get("https://api.sleeper.app/v1/players/nfl");
  const born = (pid) => {
    const b = players?.[pid]?.birth_date;
    return b ? new Date(b).getTime() : null;
  };
  const SKILL = new Set(["QB", "RB", "WR", "TE"]);
  await pool(need, async (id) => {
    const rosters = await get(`https://api.sleeper.app/v1/league/${id}/rosters`);
    if (!rosters) { ages[id] = {}; return; }
    // Age AS OF that season, not today. Season start ~ Sept 1.
    const asOf = new Date(`${cache[id].season}-09-01`).getTime();
    const out = {};
    for (const r of rosters) {
      const a = [];
      for (const pid of r.players ?? []) {
        if (!SKILL.has(players?.[pid]?.position)) continue;
        const b = born(pid);
        if (b) a.push((asOf - b) / (365.25 * 24 * 3600 * 1000));
      }
      if (a.length >= 8) {
        a.sort((x, y) => x - y);
        out[r.roster_id] = {
          mean: a.reduce((x, y) => x + y, 0) / a.length,
          youngShare: a.filter((x) => x < 25).length / a.length,
          n: a.length,
        };
      }
    }
    ages[id] = out;
  });
  writeFileSync(ROSTERS, JSON.stringify(ages));
}
console.log(`age profiles for ${Object.keys(ages).length} leagues\n`);

// ── Observations ─────────────────────────────────────────────────────────────
const rankPct = (lid, owner) => {
  const lg = cache[lid];
  if (!lg || lg.teams < 2) return null;
  const r = lg.rosters.find((x) => x.ownerId === owner);
  return r ? (r.rank - 1) / (lg.teams - 1) : null;
};
const ownerOf = (lid, rid) => cache[lid]?.rosters.find((r) => r.rosterId === rid)?.ownerId ?? null;

const obs = [];
for (const t of allTrades) {
  const next = successor[t.league];
  if (!next || !played(t.league) || !played(next)) continue;
  const ageMap = ages[t.league] ?? {};
  for (const s of t.sides) {
    const owner = ownerOf(t.league, s.rosterId);
    const prof = ageMap[s.rosterId];
    if (!owner || !prof) continue;
    const before = rankPct(t.league, owner);
    const after = rankPct(next, owner);
    if (before == null || after == null) continue;
    const other = t.sides.find((x) => x !== s);
    const got = s.players.length + s.picks.length;
    const gave = other.players.length + other.picks.length;
    const recvAges = s.players.map((p) => p.age).filter(Boolean);
    obs.push({
      before, delta: before - after,
      age: prof.mean, youngShare: prof.youngShare,
      consolidate: got === 1 && gave >= 2,
      tierDown: got >= 2 && gave === 1,
      boughtAge: recvAges.length > 0 && recvAges.reduce((a, b) => a + b, 0) / recvAges.length >= 28,
      soldAge: (() => {
        const g = other.players.map((p) => p.age).filter(Boolean);
        return g.length > 0 && g.reduce((a, b) => a + b, 0) / g.length >= 28;
      })(),
      tookPicks: s.picks.length > 0 && s.players.length === 0,
    });
  }
}
console.log(`observations with both signals: ${obs.length}`);

const bucket = (b) => (b < 0.25 ? 0 : b < 0.5 ? 1 : b < 0.75 ? 2 : 3);
const base = new Map();
for (const o of obs) {
  const k = bucket(o.before);
  const c = base.get(k) ?? { n: 0, sum: 0 };
  c.n++; c.sum += o.delta; base.set(k, c);
}
const baseFor = (b) => { const v = base.get(bucket(b)); return v ? v.sum / v.n : 0; };

const ageBands = [
  ["young  (<25.5)", (o) => o.age < 25.5],
  ["middle (25.5-26.5)", (o) => o.age >= 25.5 && o.age < 26.5],
  ["old    (26.5+)", (o) => o.age >= 26.5],
];
const contention = [
  ["contender ", (o) => o.before < 0.34],
  ["middle    ", (o) => o.before >= 0.34 && o.before < 0.67],
  ["rebuilder ", (o) => o.before >= 0.67],
];
const moves = [
  ["consolidate", (o) => o.consolidate],
  ["tier down", (o) => o.tierDown],
  ["buy age 28+", (o) => o.boughtAge],
  ["sell age 28+", (o) => o.soldAge],
  ["take picks only", (o) => o.tookPicks],
];

const a = obs.map((o) => o.age).sort((x, y) => x - y);
console.log(`roster age spread: p10 ${a[Math.floor(a.length*.1)].toFixed(1)}  median ${a[Math.floor(a.length*.5)].toFixed(1)}  p90 ${a[Math.floor(a.length*.9)].toFixed(1)}\n`);

for (const [mv, mpred] of moves) {
  console.log(`${mv.toUpperCase()}   (beat-baseline %, n) by contention x roster age`);
  let header = "".padEnd(12);
  for (const [ab] of ageBands) header += ab.padStart(20);
  console.log(header);
  for (const [cn, cpred] of contention) {
    let row = cn.padEnd(12);
    for (const [, apred] of ageBands) {
      const g = obs.filter((o) => mpred(o) && cpred(o) && apred(o));
      if (g.length < 40) { row += `n=${g.length}`.padStart(20); continue; }
      const beat = 100 * g.filter((o) => o.delta - baseFor(o.before) > 0).length / g.length;
      row += `${beat.toFixed(0)}%  (n=${g.length})`.padStart(20);
    }
    console.log(row);
  }
  console.log();
}

// ── CONFOUND CHECK ───────────────────────────────────────────────────────────
// Every table above shows the same gradient: young/contender good, old/
// rebuilder bad. But "buy age" and "sell age" are OPPOSITE moves, and both
// show it. If two opposite actions predict the same outcome, the action is not
// what is being measured. The cell is.
//
// The baseline only controlled for CONTENTION. If roster age independently
// predicts next-season rank, every cell above is mostly reporting that.
console.log("CONFOUND CHECK: outcome by cell, IGNORING what the team traded");
console.log("if these look like the tables above, the tables were measuring age, not the move\n");
let hdr = "".padEnd(12);
for (const [ab] of ageBands) hdr += ab.padStart(20);
console.log(hdr);
for (const [cn, cpred] of contention) {
  let row = cn.padEnd(12);
  for (const [, apred] of ageBands) {
    const g = obs.filter((o) => cpred(o) && apred(o));
    const beat = 100 * g.filter((o) => o.delta - baseFor(o.before) > 0).length / g.length;
    row += `${beat.toFixed(0)}%  (n=${g.length})`.padStart(20);
  }
  console.log(row);
}

// Rebuild the baseline INSIDE each cell, then re-measure the moves. Now the
// comparison is against teams with the same contention AND the same roster
// age, so only the move differs.
const cellKey = (o) => `${bucket(o.before)}|${o.age < 25.5 ? 0 : o.age < 26.5 ? 1 : 2}`;
const cellBase = new Map();
for (const o of obs) {
  const k = cellKey(o);
  const c = cellBase.get(k) ?? { n: 0, sum: 0 };
  c.n++; c.sum += o.delta; cellBase.set(k, c);
}
const cellBaseFor = (o) => { const v = cellBase.get(cellKey(o)); return v ? v.sum / v.n : 0; };

console.log("\n\nRE-MEASURED with the baseline controlling for contention AND age.");
console.log("Now only the MOVE differs within a cell. 50% = no effect.\n");
for (const [mv, mpred] of moves) {
  let line = `${mv.padEnd(16)}`;
  const g = obs.filter(mpred);
  const beat = 100 * g.filter((o) => o.delta - cellBaseFor(o) > 0).length / g.length;
  line += `overall ${beat.toFixed(0)}%  (n=${String(g.length).padStart(4)})   `;
  for (const [cn, cpred] of contention) {
    const gg = obs.filter((o) => mpred(o) && cpred(o));
    if (gg.length < 60) { line += `${cn.trim()} n=${gg.length}  `; continue; }
    const b = 100 * gg.filter((o) => o.delta - cellBaseFor(o) > 0).length / gg.length;
    line += `${cn.trim()} ${b.toFixed(0)}%  `;
  }
  console.log(line);
}
