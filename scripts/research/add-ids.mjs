// Re-fetch transactions with Sleeper player ids attached.
//
// The crawl stored only {pos, age} per traded player, so nothing joins to
// historical value. This re-fetches transactions for the leagues we can
// actually measure an outcome for, keeping the player id this time.
//
// Targeted on purpose. Only leagues where the trade season AND the following
// season were both played can produce an outcome, which is a few hundred of
// the 1,100 crawled rather than all of them.
//
//   node scripts/research/add-ids.mjs

import { existsSync, readFileSync, writeFileSync } from "node:fs";

const CACHE = "scripts/research/outcomes-cache.json";
const OUT = "scripts/research/trades-with-ids.json";
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
const played = (id) => (cache[id]?.rosters ?? []).some((r) => r.pf > 0);
const successor = {};
for (const [id, v] of Object.entries(cache)) if (v.prev) successor[v.prev] = id;

const measurable = Object.keys(cache).filter(
  (id) => played(id) && successor[id] && played(successor[id]),
);
let out = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : {};
const need = measurable.filter((id) => !out[id]);
console.log(`measurable leagues: ${measurable.length}   needing a fetch: ${need.length}`);

const players = await get("https://api.sleeper.app/v1/players/nfl");
const meta = (pid) => {
  const p = players?.[pid];
  return { id: pid, pos: p?.position ?? "?", age: p?.age ?? null };
};

let done = 0;
for (const id of need) {
  const weeks = await pool([...Array(18).keys()].map((w) => w + 1), (w) =>
    get(`https://api.sleeper.app/v1/league/${id}/transactions/${w}`));
  const trades = [];
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
    trades.push({ league: id, season: cache[id].season, week: tx.leg ?? null, sides: [...sides.values()] });
  }
  out[id] = trades;
  if (++done % 25 === 0) {
    writeFileSync(OUT, JSON.stringify(out));
    console.log(`  ${done}/${need.length} leagues · ${Object.values(out).flat().length} trades`);
  }
}
writeFileSync(OUT, JSON.stringify(out));
const all = Object.values(out).flat();
console.log(`\ndone: ${Object.keys(out).length} leagues, ${all.length} trades with player ids`);

// Coverage against the value index, which is the number that matters.
if (existsSync("scripts/research/values-history.json")) {
  const vals = JSON.parse(readFileSync("scripts/research/values-history.json", "utf8"));
  let priced = 0, total = 0;
  for (const t of all) {
    for (const s of t.sides) {
      for (const p of s.players) { total++; if (vals[p.id]) priced++; }
    }
  }
  console.log(`traded players with a historical value: ${priced}/${total} (${(100 * priced / Math.max(1, total)).toFixed(1)}%)`);
}
