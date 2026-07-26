// What actually works for a REBUILDING team?
//
// The earlier finding, that nothing helps rebuilders, was probably a
// measurement error rather than a fact. Every outcome so far was measured at
// +1 season, which is a win-now yardstick. A rebuild is a multi-year play by
// definition, so scoring it after one year asks the wrong question and gets
// noise back.
//
// Johnny's framing again, and it applies here: different account types have
// different sales cycles. A contender's cycle is this season. A rebuilder's is
// two or three.
//
// So this measures the same trades at +1, +2 and +3 seasons, and adds two
// success definitions that a one-year rank change cannot express:
//
//   BEST rank reached within 3 seasons   did the rebuild ever actually pay off
//   reached the top half within 3        the binary version of the same thing
//
// Every number is lift over a baseline computed at the SAME horizon over ALL
// teams, traders and non-traders alike, in the same starting-rank bucket.
// Regression to the mean is enormous here and grows with horizon, so a
// baseline built at +1 cannot be reused at +3.
//
//   node scripts/research/rebuild.mjs

import { existsSync, readFileSync } from "node:fs";

const cache = JSON.parse(readFileSync("scripts/research/outcomes-cache.json", "utf8"));
const crawl = JSON.parse(readFileSync("scripts/research/trades-crawl.json", "utf8"));
const extra = existsSync("scripts/research/trades-ancestors.json")
  ? JSON.parse(readFileSync("scripts/research/trades-ancestors.json", "utf8")) : {};
const allTrades = [...crawl.trades, ...Object.values(extra).flat()];

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

// Follow a league forward through played seasons.
function chain(lid, maxHops) {
  const out = [];
  let cur = lid;
  for (let i = 0; i < maxHops; i++) {
    const n = successor[cur];
    if (!n || !played(n)) break;
    out.push(n);
    cur = n;
  }
  return out;
}

// ── Every team-season we can follow, traded or not ───────────────────────────
const universe = [];
for (const lid of Object.keys(cache)) {
  if (!played(lid)) continue;
  const fwd = chain(lid, 3);
  if (!fwd.length) continue;
  for (const r of cache[lid].rosters) {
    const before = rankPct(lid, r.ownerId);
    if (before == null) continue;
    const at = fwd.map((n) => rankPct(n, r.ownerId));
    universe.push({ lid, rosterId: r.rosterId, owner: r.ownerId, before, at });
  }
}

const bucket = (b) => (b < 0.25 ? 0 : b < 0.5 ? 1 : b < 0.75 ? 2 : 3);
// baseline[horizon][bucket] = mean improvement, over EVERYONE at that horizon
const baseline = [0, 1, 2].map((h) => {
  const m = new Map();
  for (const u of universe) {
    const a = u.at[h];
    if (a == null) continue;
    const k = bucket(u.before);
    const c = m.get(k) ?? { n: 0, sum: 0 };
    c.n++; c.sum += u.before - a; m.set(k, c);
  }
  return m;
});
const baseFor = (h, before) => {
  const v = baseline[h].get(bucket(before));
  return v ? v.sum / v.n : 0;
};

console.log("sample by horizon (all teams in followable leagues):");
[0, 1, 2].forEach((h) => {
  const n = universe.filter((u) => u.at[h] != null).length;
  const reb = universe.filter((u) => u.at[h] != null && u.before >= 0.67).length;
  console.log(`   +${h + 1} season: ${n} team-seasons  (${reb} of them rebuilders)`);
});
console.log("\nbaseline improvement by horizon (regression to the mean grows with time):");
[0, 1, 2].forEach((h) => {
  const parts = [0, 1, 2, 3].map((b) => {
    const v = baseline[h].get(b);
    return v ? `${["top", "upmid", "lomid", "bottom"][b]} ${(v.sum / v.n >= 0 ? "+" : "")}${(v.sum / v.n).toFixed(2)}` : "";
  }).filter(Boolean).join("   ");
  console.log(`   +${h + 1}: ${parts}`);
});

// ── What each team did that season ───────────────────────────────────────────
const did = new Map(); // "lid|rosterId" -> flags
for (const t of allTrades) {
  if (!played(t.league)) continue;
  for (const s of t.sides) {
    const key = `${t.league}|${s.rosterId}`;
    const other = t.sides.find((x) => x !== s);
    const got = s.players.length + s.picks.length;
    const gave = other.players.length + other.picks.length;
    const recvAges = s.players.map((p) => p.age).filter(Boolean);
    const gaveAges = other.players.map((p) => p.age).filter(Boolean);
    const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
    const f = did.get(key) ?? {
      traded: true, consolidate: false, tierDown: false,
      tookPicksOnly: false, netPicks: 0, boughtYouth: false, soldAge: false, boughtAge: false,
    };
    f.traded = true;
    if (got === 1 && gave >= 2) f.consolidate = true;
    if (got >= 2 && gave === 1) f.tierDown = true;
    if (s.picks.length > 0 && s.players.length === 0) f.tookPicksOnly = true;
    f.netPicks += s.picks.length - other.picks.length;
    const rm = mean(recvAges), gm = mean(gaveAges);
    if (rm != null && rm < 25) f.boughtYouth = true;
    if (rm != null && rm >= 28) f.boughtAge = true;
    if (gm != null && gm >= 28) f.soldAge = true;
    did.set(key, f);
  }
}

const REB = (u) => u.before >= 0.67;
function line(label, pred, who = REB) {
  const parts = [];
  for (const h of [0, 1, 2]) {
    const g = universe.filter((u) => who(u) && u.at[h] != null && pred(did.get(`${u.lid}|${u.rosterId}`) ?? {}));
    if (g.length < 30) { parts.push(`+${h + 1}: n=${g.length}`.padEnd(18)); continue; }
    const beat = 100 * g.filter((u) => (u.before - u.at[h]) - baseFor(h, u.before) > 0).length / g.length;
    parts.push(`+${h + 1}: ${beat.toFixed(0)}% (n=${g.length})`.padEnd(18));
  }
  console.log(`   ${label.padEnd(26)}${parts.join("")}`);
}

console.log("\n\nREBUILDERS ONLY (started bottom third). Beat-baseline % at each horizon.");
console.log("If a rebuild pays off late, the number should climb from +1 to +3.\n");
line("did NOT trade", (f) => !f.traded);
line("traded at all", (f) => f.traded);
line("took picks only", (f) => f.tookPicksOnly);
line("net picks gained", (f) => f.netPicks > 0);
line("net picks given away", (f) => f.netPicks < 0);
line("bought youth (<25)", (f) => f.boughtYouth);
line("sold age (28+)", (f) => f.soldAge);
line("bought age (28+)", (f) => f.boughtAge);
line("consolidated", (f) => f.consolidate);
line("tiered down", (f) => f.tierDown);

// ── Did the rebuild ever actually pay off? ───────────────────────────────────
console.log("\n\nDID THE REBUILD PAY OFF WITHIN 3 SEASONS?");
console.log("best rank reached, and how often they reached the top half\n");
function payoff(label, pred) {
  const g = universe.filter((u) => REB(u) && u.at.some((x) => x != null) && pred(did.get(`${u.lid}|${u.rosterId}`) ?? {}));
  if (g.length < 30) { console.log(`   ${label.padEnd(26)} n=${g.length}`); return; }
  const best = g.map((u) => Math.min(...u.at.filter((x) => x != null)));
  const avgBest = best.reduce((a, b) => a + b, 0) / best.length;
  const topHalf = 100 * best.filter((b) => b < 0.5).length / best.length;
  console.log(`   ${label.padEnd(26)} best rank pct ${avgBest.toFixed(3)}   reached top half ${topHalf.toFixed(0)}%   (n=${g.length})`);
}
payoff("did NOT trade", (f) => !f.traded);
payoff("traded at all", (f) => f.traded);
payoff("net picks gained", (f) => f.netPicks > 0);
payoff("net picks given away", (f) => f.netPicks < 0);
payoff("bought youth (<25)", (f) => f.boughtYouth);
payoff("sold age (28+)", (f) => f.soldAge);
payoff("consolidated", (f) => f.consolidate);
payoff("tiered down", (f) => f.tierDown);
