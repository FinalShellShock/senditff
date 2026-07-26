// Did the trade actually help? Hindsight outcomes for crawled trades.
//
// The trade crawl says what got ACCEPTED. It says nothing about whether it
// WORKED. These are different questions and only the second one is useful for
// recommending trades.
//
// Method: Sleeper leagues chain across seasons via previous_league_id, and
// owner_id is stable across that chain. So for every trade we can look up each
// participant's points-for rank in the season the trade happened and in the
// season after, and ask what changed.
//
// THE CONFOUNDER THAT RUINS THIS IF IGNORED: regression to the mean. Fantasy
// scoring is enormously noisy, so the best team in a league almost always
// declines next year and the worst almost always improves, regardless of what
// anyone traded. A naive read ("teams that acquired picks got worse") would
// mostly be measuring "good teams acquire picks less, and good teams regress".
//
// So every effect below is reported against a BASELINE: what teams starting at
// the same rank did, whether or not they made that kind of trade. The number
// that matters is the difference from baseline, never the raw change.
//
//   node scripts/research/outcomes.mjs

import { existsSync, readFileSync, writeFileSync } from "node:fs";

const CRAWL = "scripts/research/trades-crawl.json";
const OUT = "scripts/research/outcomes-cache.json";
const CONCURRENCY = 6;
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
async function pool(items, fn) {
  const out = [];
  for (let i = 0; i < items.length; i += CONCURRENCY) {
    out.push(...(await Promise.all(items.slice(i, i + CONCURRENCY).map(fn))));
    await sleep(120);
  }
  return out;
}

const crawl = JSON.parse(readFileSync(CRAWL, "utf8"));
let leagueIds = [...new Set(crawl.trades.map((t) => t.league))];

// Enrich: for each league, who owned each roster and how did they score.
let cache = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : {};
const need = leagueIds.filter((id) => !cache[id]);
console.log(`leagues needing enrichment: ${need.length} of ${leagueIds.length}`);

await pool(need, async (id) => {
  const [lg, rosters] = await Promise.all([
    get(`https://api.sleeper.app/v1/league/${id}`),
    get(`https://api.sleeper.app/v1/league/${id}/rosters`),
  ]);
  if (!lg || !rosters) return;
  const withPf = rosters.map((r) => ({
    rosterId: r.roster_id,
    ownerId: r.owner_id,
    pf: (r.settings?.fpts ?? 0) + (r.settings?.fpts_decimal ?? 0) / 100,
    wins: r.settings?.wins ?? 0,
  }));
  const ranked = [...withPf].sort((a, b) => b.pf - a.pf);
  ranked.forEach((r, i) => { r.rank = i + 1; });
  cache[id] = {
    season: Number(lg.season),
    prev: lg.previous_league_id ?? null,
    teams: withPf.length,
    rosters: withPf,
  };
});
// Walk previous_league_id BACKWARD until the chain runs out.
//
// Without this the analysis is worthless and silently so. The crawl only
// gathered 2026 and 2025, and in July 2026 the 2026 season has not been
// played: all 225 of those leagues have zero points scored. The only available
// transition was 2025 -> 2026, so "rank next season" was a ranking over all
// zeros, i.e. tie-break noise. Measuring an outcome needs BOTH seasons
// complete, so we need 2024 -> 2025 and earlier.
for (let hop = 0; hop < 6; hop++) {
  const ancestors = [...new Set(Object.values(cache).map((v) => v.prev).filter((p) => p && !cache[p]))];
  if (!ancestors.length) break;
  console.log(`  walking back: ${ancestors.length} ancestor leagues (hop ${hop + 1})`);
  await pool(ancestors, async (id) => {
    const [lg, rosters] = await Promise.all([
      get(`https://api.sleeper.app/v1/league/${id}`),
      get(`https://api.sleeper.app/v1/league/${id}/rosters`),
    ]);
    if (!lg || !rosters) { cache[id] = { season: 0, prev: null, teams: 0, rosters: [] }; return; }
    const withPf = rosters.map((r) => ({
      rosterId: r.roster_id, ownerId: r.owner_id,
      pf: (r.settings?.fpts ?? 0) + (r.settings?.fpts_decimal ?? 0) / 100,
      wins: r.settings?.wins ?? 0,
    }));
    [...withPf].sort((a, b) => b.pf - a.pf).forEach((r, i) => { r.rank = i + 1; });
    cache[id] = { season: Number(lg.season), prev: lg.previous_league_id ?? null, teams: withPf.length, rosters: withPf };
  });
  writeFileSync(OUT, JSON.stringify(cache));
}
writeFileSync(OUT, JSON.stringify(cache));
console.log(`enriched ${Object.keys(cache).length} leagues`);

// A season only counts as an OUTCOME if it was actually played.
const played = (id) => (cache[id]?.rosters ?? []).some((r) => r.pf > 0);

// successor[leagueId] = the league that lists it as previous
const successor = {};
for (const [id, v] of Object.entries(cache)) if (v.prev) successor[v.prev] = id;

// The crawl only collected TRADES from the 2025/2026 leagues it snowballed
// through, but those are exactly the ones we cannot measure: 2026 was not
// played, so a 2025 trade has no played successor. The measurable trades live
// in the ancestor seasons we just walked back to, where both that season and
// the next one finished. Fetch their transactions too.
const TRADES_EXTRA = "scripts/research/trades-ancestors.json";
let extra = existsSync(TRADES_EXTRA) ? JSON.parse(readFileSync(TRADES_EXTRA, "utf8")) : {};
const measurable = Object.keys(cache).filter(
  (id) => played(id) && successor[id] && played(successor[id]) && !extra[id],
);
if (measurable.length) {
  console.log(`fetching trades for ${measurable.length} measurable ancestor leagues`);
  const players = await get("https://api.sleeper.app/v1/players/nfl");
  const meta = (pid) => {
    const p = players?.[pid];
    return p ? { pos: p.position ?? "?", age: p.age ?? null } : { pos: "?", age: null };
  };
  for (const id of measurable) {
    const weeks = await pool([...Array(18).keys()].map((w) => w + 1), (w) =>
      get(`https://api.sleeper.app/v1/league/${id}/transactions/${w}`));
    const out = [];
    for (const tx of weeks.flat()) {
      if (!tx || tx.type !== "trade" || tx.status !== "complete") continue;
      const sides = new Map();
      const touch = (rid) => {
        if (!sides.has(rid)) sides.set(rid, { rosterId: rid, players: [], picks: [] });
        return sides.get(rid);
      };
      for (const [pid, rid] of Object.entries(tx.adds ?? {})) touch(rid).players.push(meta(pid));
      for (const p of tx.draft_picks ?? []) touch(p.owner_id).picks.push({ season: p.season, round: p.round });
      if (sides.size !== 2) continue;
      out.push({ league: id, week: tx.leg ?? null, sides: [...sides.values()] });
    }
    extra[id] = out;
  }
  writeFileSync(TRADES_EXTRA, JSON.stringify(extra));
}
const allTrades = [...crawl.trades, ...Object.values(extra).flat()];
console.log(`trades available: ${crawl.trades.length} crawled + ${Object.values(extra).flat().length} ancestor = ${allTrades.length}`);

// ownerRank(leagueId, ownerId) -> percentile 0 (best) .. 1 (worst)
const rankPct = (leagueId, ownerId) => {
  const lg = cache[leagueId];
  if (!lg || lg.teams < 2) return null;
  const r = lg.rosters.find((x) => x.ownerId === ownerId);
  return r ? (r.rank - 1) / (lg.teams - 1) : null;
};
const ownerOf = (leagueId, rosterId) =>
  cache[leagueId]?.rosters.find((r) => r.rosterId === rosterId)?.ownerId ?? null;

// Build observations: one per (trade, side) that we can follow into next season.
const obs = [];
let skippedUnplayed = 0;
for (const t of allTrades) {
  const next = successor[t.league];
  if (!next || !cache[next]) continue;
  // Both the trade season and the following season must have been played.
  if (!played(t.league) || !played(next)) { skippedUnplayed++; continue; }
  for (const s of t.sides) {
    const owner = ownerOf(t.league, s.rosterId);
    if (!owner) continue;
    const before = rankPct(t.league, owner);
    const after = rankPct(next, owner);
    if (before == null || after == null) continue;
    obs.push({
      before, after, delta: before - after, // positive = improved (rank pct fell)
      players: s.players.length,
      picks: s.picks.length,
      gave: t.sides.find((x) => x !== s),
      week: t.week ?? 0,
      ages: s.players.map((p) => p.age).filter(Boolean),
    });
  }
}
console.log(`followable trade-sides: ${obs.length}  (skipped ${skippedUnplayed} where a season had no games played)\n`);

// Baseline: average improvement by starting rank bucket, across EVERYTHING.
// This is the regression-to-the-mean curve we have to subtract out.
const bucket = (b) => (b < 0.25 ? "top quarter" : b < 0.5 ? "upper mid" : b < 0.75 ? "lower mid" : "bottom quarter");
const base = new Map();
for (const o of obs) {
  const k = bucket(o.before);
  const cur = base.get(k) ?? { n: 0, sum: 0 };
  cur.n++; cur.sum += o.delta;
  base.set(k, cur);
}
console.log("BASELINE regression to the mean (all trade participants):");
for (const k of ["top quarter", "upper mid", "lower mid", "bottom quarter"]) {
  const v = base.get(k);
  if (v) console.log(`   started ${k.padEnd(15)} n=${String(v.n).padStart(5)}  avg rank-pct change ${(v.sum / v.n >= 0 ? "+" : "")}${(v.sum / v.n).toFixed(3)}`);
}
const baseFor = (b) => { const v = base.get(bucket(b)); return v ? v.sum / v.n : 0; };

function report(label, pred) {
  const g = obs.filter(pred);
  if (g.length < 25) { console.log(`   ${label.padEnd(42)} n=${g.length} (too few, skipping)`); return; }
  const lift = g.reduce((a, o) => a + (o.delta - baseFor(o.before)), 0) / g.length;
  const better = g.filter((o) => o.delta - baseFor(o.before) > 0).length;
  console.log(`   ${label.padEnd(42)} n=${String(g.length).padStart(5)}  lift vs baseline ${(lift >= 0 ? "+" : "")}${lift.toFixed(3)}   beat baseline ${(100 * better / g.length).toFixed(0)}%`);
}

console.log("\nOUTCOMES, measured as lift over the same-starting-rank baseline");
console.log("(positive = improved MORE than a typical team starting there)\n");
console.log("  Q: does taking back only picks help or hurt next season?");
report("received ONLY picks", (o) => o.picks > 0 && o.players === 0);
report("received ONLY players", (o) => o.players > 0 && o.picks === 0);
report("received a mix", (o) => o.players > 0 && o.picks > 0);

console.log("\n  Q: does consolidating (few pieces back) beat spreading out?");
report("consolidated: got 1, gave 2+", (o) => o.players + o.picks === 1 && (o.gave.players.length + o.gave.picks.length) >= 2);
report("spread out: got 2+, gave 1", (o) => o.players + o.picks >= 2 && (o.gave.players.length + o.gave.picks.length) === 1);
report("even swap: same count both sides", (o) => o.players + o.picks === o.gave.players.length + o.gave.picks.length);

console.log("\n  Q: does buying age help the season you buy, or hurt the next?");
report("received avg age 30+", (o) => o.ages.length > 0 && o.ages.reduce((a, b) => a + b, 0) / o.ages.length >= 30);
report("received avg age 27-29", (o) => { const m = o.ages.length ? o.ages.reduce((a, b) => a + b, 0) / o.ages.length : 0; return m >= 27 && m < 30; });
report("received avg age under 25", (o) => o.ages.length > 0 && o.ages.reduce((a, b) => a + b, 0) / o.ages.length < 25);

console.log("\n  Q: deadline buying vs offseason moves");
report("in-season, week 9+", (o) => o.week >= 9);
report("early season, weeks 2-8", (o) => o.week >= 2 && o.week <= 8);
report("offseason", (o) => o.week <= 1);

// ── Scrutiny pass ────────────────────────────────────────────────────────────
// Only one effect above is large enough to be worth a second look: the side
// that gives ONE asset and takes back TWO OR MORE (a tier-down) beat its
// baseline just 44% of the time. That is also the single most common thing our
// engine proposes, so it needs checking rather than believing.
//
// Two ways it could be an artifact:
//   1. It might be a rebuild move that pays off in year two, not year one, and
//      "next season rank" would score that as a failure.
//   2. It might just be who does it: if mostly contenders tier down, and
//      contenders regress hardest, the bucket baseline may not fully absorb it.
console.log("\n\nSCRUTINY: is the tier-down penalty real, or an artifact?\n");

const spread = (o) => o.players + o.picks >= 2 && (o.gave.players.length + o.gave.picks.length) === 1;
const consol = (o) => o.players + o.picks === 1 && (o.gave.players.length + o.gave.picks.length) >= 2;

console.log("  split by who was doing it (does the effect survive within each tier?)");
for (const [name, lo, hi] of [["contenders", 0, 0.34], ["middle", 0.34, 0.67], ["rebuilders", 0.67, 1.01]]) {
  for (const [what, pred] of [["tier down", spread], ["consolidate", consol]]) {
    const g = obs.filter((o) => o.before >= lo && o.before < hi && pred(o));
    if (g.length < 40) { console.log(`    ${name.padEnd(11)} ${what.padEnd(12)} n=${g.length} (too few)`); continue; }
    const lift = g.reduce((a, o) => a + (o.delta - baseFor(o.before)), 0) / g.length;
    const beat = 100 * g.filter((o) => o.delta - baseFor(o.before) > 0).length / g.length;
    console.log(`    ${name.padEnd(11)} ${what.padEnd(12)} n=${String(g.length).padStart(4)}  lift ${(lift >= 0 ? "+" : "")}${lift.toFixed(3)}  beat baseline ${beat.toFixed(0)}%`);
  }
}

// How big is the pool doing each, per tier? If tier-downs are overwhelmingly
// done by one kind of team, the bucket baseline is doing a lot of work.
console.log("\n  who actually tiers down vs consolidates");
for (const [name, lo, hi] of [["contenders", 0, 0.34], ["middle", 0.34, 0.67], ["rebuilders", 0.67, 1.01]]) {
  const inTier = obs.filter((o) => o.before >= lo && o.before < hi).length;
  const s = obs.filter((o) => o.before >= lo && o.before < hi && spread(o)).length;
  const c = obs.filter((o) => o.before >= lo && o.before < hi && consol(o)).length;
  console.log(`    ${name.padEnd(11)} tier down ${(100 * s / inTier).toFixed(0)}%   consolidate ${(100 * c / inTier).toFixed(0)}%   (n=${inTier})`);
}

// Effect size in plain terms: how many places in a 12-team league?
const sAll = obs.filter(spread);
const cAll = obs.filter(consol);
const liftOf = (g) => g.reduce((a, o) => a + (o.delta - baseFor(o.before)), 0) / g.length;
console.log(`\n  plain-language size, 12-team league:`);
console.log(`    tier down:   ${(liftOf(sAll) * 11).toFixed(2)} places vs a comparable team (n=${sAll.length})`);
console.log(`    consolidate: ${(liftOf(cAll) * 11).toFixed(2)} places vs a comparable team (n=${cAll.length})`);
console.log(`    gap between the two: ${((liftOf(cAll) - liftOf(sAll)) * 11).toFixed(2)} places`);
