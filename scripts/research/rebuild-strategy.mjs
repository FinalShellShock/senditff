// Test Johnny's rebuild hypothesis against historical value data.
//
// The hypothesis, stated so it can be falsified:
//
//   Successful rebuilders sell age THAT HAS VALUE for picks and undervalued
//   players, take chances on guys hoping their stock rises, then convert picks
//   and risen players into studs, and hit on draft picks.
//
// Every clause needs a value at the time of the trade, which is why the whole
// historical-value pipeline exists. Without it, "sold age" cannot tell a
// valuable veteran from a washed one, and "bought youth" is dominated by 24
// year old dart throws who were never going to matter.
//
// Two stages, because the hypothesis has two testable halves:
//
//   STAGE 1  Did the acquired players actually RISE? This is measurable
//            directly from rank trajectory and needs no team outcome at all,
//            so it isolates "were they good at spotting undervalued guys" from
//            "did their team get better".
//
//   STAGE 2  Do the teams that did those things improve at +1, +2, +3?
//
// Definitions, on dynasty-overall ECR at the trade month:
//   stud            rank <= 24
//   valuable        rank <= 60
//   undervalued     rank > 100 or unranked, and age <= 24
//
//   node scripts/research/rebuild-strategy.mjs

import { existsSync, readFileSync } from "node:fs";

const need = ["outcomes-cache.json", "values-history.json", "trades-with-ids.json"];
for (const f of need) {
  if (!existsSync(`scripts/research/${f}`)) {
    console.error(`missing scripts/research/${f} — run the pipeline first`);
    process.exit(1);
  }
}
const cache = JSON.parse(readFileSync("scripts/research/outcomes-cache.json", "utf8"));
const vals = JSON.parse(readFileSync("scripts/research/values-history.json", "utf8"));
const byLeague = JSON.parse(readFileSync("scripts/research/trades-with-ids.json", "utf8"));
const trades = Object.values(byLeague).flat();

const played = (id) => (cache[id]?.rosters ?? []).some((r) => r.pf > 0);
const successor = {};
for (const [id, v] of Object.entries(cache)) if (v.prev) successor[v.prev] = id;
const rankPct = (lid, owner) => {
  const lg = cache[lid];
  if (!lg || lg.teams < 2) return null;
  const r = lg.rosters.find((x) => x.ownerId === owner);
  return r ? (r.rank - 1) / (lg.teams - 1) : null;
};
const ownerOf = (lid, rid) => cache[lid]?.rosters.find((r) => r.rosterId === rid)?.ownerId ?? null;

// ECR rank for a player at (or just before) a given month.
const rankAt = (pid, ym) => {
  const h = vals[pid];
  if (!h) return null;
  let best = null;
  for (const [m, ecr] of h) {
    if (m <= ym) best = ecr; else break;
  }
  return best;
};
// Where did that player end up N months later?
const rankAfter = (pid, ym, months) => {
  const target = (() => {
    const y = Math.floor(ym / 100), m = ym % 100 + months;
    return (y + Math.floor((m - 1) / 12)) * 100 + ((m - 1) % 12 + 1);
  })();
  const h = vals[pid];
  if (!h) return null;
  let out = null;
  for (const [m, ecr] of h) { if (m <= target) out = ecr; else break; }
  return out;
};
// Trades land in season S; treat them as September of that season.
const tradeYm = (t) => Number(cache[t.league]?.season ?? 0) * 100 + 9;

console.log(`trades with ids: ${trades.length}`);
let pl = 0, priced = 0;
for (const t of trades) for (const s of t.sides) for (const p of s.players) { pl++; if (vals[p.id]) priced++; }
console.log(`traded players priced: ${priced}/${pl} (${(100 * priced / Math.max(1, pl)).toFixed(0)}%)\n`);

// ── STAGE 1: did acquired players rise? ──────────────────────────────────────
console.log("STAGE 1  Did acquired players actually rise in rank 12 months later?");
console.log("         (negative change = rank number fell = player got BETTER)\n");
const acq = [];
for (const t of trades) {
  const ym = tradeYm(t);
  for (const s of t.sides) {
    const owner = ownerOf(t.league, s.rosterId);
    const before = owner ? rankPct(t.league, owner) : null;
    for (const p of s.players) {
      const r0 = rankAt(p.id, ym);
      const r1 = rankAfter(p.id, ym, 12);
      if (r0 == null || r1 == null) continue;
      acq.push({ before, age: p.age, r0, r1, moved: r0 - r1 });
    }
  }
}
console.log(`  acquisitions with a before and after rank: ${acq.length}`);
const band = (a) => {
  if (a == null) return "unknown";
  return a <= 23 ? "<=23" : a <= 25 ? "24-25" : a <= 27 ? "26-27" : a <= 29 ? "28-29" : "30+";
};
const rankBand = (r) => (r <= 24 ? "stud (<=24)" : r <= 60 ? "valuable (25-60)" : r <= 100 ? "fringe (61-100)" : "deep (100+)");
console.log("\n  average rank movement by age at acquisition x rank at acquisition:");
console.log("  (a positive number means the player improved)");
const cells = new Map();
for (const a of acq) {
  const k = `${band(a.age)}|${rankBand(a.r0)}`;
  const c = cells.get(k) ?? { n: 0, sum: 0, rose: 0 };
  c.n++; c.sum += a.moved; if (a.moved > 0) c.rose++;
  cells.set(k, c);
}
const ageOrder = ["<=23", "24-25", "26-27", "28-29", "30+"];
const rkOrder = ["stud (<=24)", "valuable (25-60)", "fringe (61-100)", "deep (100+)"];
let head = "".padEnd(12);
for (const r of rkOrder) head += r.padStart(20);
console.log("  " + head);
for (const ab of ageOrder) {
  let row = ab.padEnd(12);
  for (const rb of rkOrder) {
    const c = cells.get(`${ab}|${rb}`);
    row += (c && c.n >= 25 ? `${(c.sum / c.n >= 0 ? "+" : "")}${(c.sum / c.n).toFixed(0)} (${c.n})` : `n=${c?.n ?? 0}`).padStart(20);
  }
  console.log("  " + row);
}

// ── STAGE 2: do the strategy's moves predict team improvement? ───────────────
console.log("\n\nSTAGE 2  Do rebuilders who follow the strategy improve?\n");
const flags = new Map();
for (const t of trades) {
  const ym = tradeYm(t);
  for (const s of t.sides) {
    const other = t.sides.find((x) => x !== s);
    const key = `${t.league}|${s.rosterId}`;
    const f = flags.get(key) ?? { soldValuableAge: false, boughtUndervalued: false, boughtStud: false, netPicks: 0 };
    f.netPicks += s.picks.length - other.picks.length;
    for (const p of other.players) {
      const r = rankAt(p.id, ym);
      if (r != null && r <= 60 && (p.age ?? 0) >= 27) f.soldValuableAge = true;
    }
    for (const p of s.players) {
      const r = rankAt(p.id, ym);
      if ((p.age ?? 99) <= 24 && (r == null || r > 100)) f.boughtUndervalued = true;
      if (r != null && r <= 24) f.boughtStud = true;
    }
    flags.set(key, f);
  }
}

const universe = [];
for (const lid of Object.keys(cache)) {
  if (!played(lid)) continue;
  const fwd = [];
  let cur = lid;
  for (let i = 0; i < 3; i++) { const n = successor[cur]; if (!n || !played(n)) break; fwd.push(n); cur = n; }
  if (!fwd.length) continue;
  for (const r of cache[lid].rosters) {
    const before = rankPct(lid, r.ownerId);
    if (before == null) continue;
    universe.push({ lid, rosterId: r.rosterId, before, at: fwd.map((n) => rankPct(n, r.ownerId)) });
  }
}
const bucket = (b) => (b < 0.25 ? 0 : b < 0.5 ? 1 : b < 0.75 ? 2 : 3);
const baseline = [0, 1, 2].map((h) => {
  const m = new Map();
  for (const u of universe) {
    const a = u.at[h]; if (a == null) continue;
    const k = bucket(u.before);
    const c = m.get(k) ?? { n: 0, sum: 0 }; c.n++; c.sum += u.before - a; m.set(k, c);
  }
  return m;
});
const baseFor = (h, b) => { const v = baseline[h].get(bucket(b)); return v ? v.sum / v.n : 0; };
const REB = (u) => u.before >= 0.67;

function row(label, pred) {
  const parts = [];
  for (const h of [0, 1, 2]) {
    const g = universe.filter((u) => REB(u) && u.at[h] != null && pred(flags.get(`${u.lid}|${u.rosterId}`) ?? {}));
    if (g.length < 30) { parts.push(`+${h + 1}: n=${g.length}`.padEnd(18)); continue; }
    const beat = 100 * g.filter((u) => (u.before - u.at[h]) - baseFor(h, u.before) > 0).length / g.length;
    parts.push(`+${h + 1}: ${beat.toFixed(0)}% (n=${g.length})`.padEnd(18));
  }
  console.log(`   ${label.padEnd(30)}${parts.join("")}`);
}
console.log("   rebuilders only, beat-baseline % by horizon");
row("sold a VALUABLE veteran", (f) => f.soldValuableAge);
row("sold age but NOT valuable", (f) => !f.soldValuableAge);
row("bought undervalued youth", (f) => f.boughtUndervalued);
row("bought a stud (top 24)", (f) => f.boughtStud);
row("net picks gained", (f) => f.netPicks > 0);
row("the full strategy", (f) => f.soldValuableAge && f.netPicks > 0);
