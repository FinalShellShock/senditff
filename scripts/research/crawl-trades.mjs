// Snowball-crawl real dynasty trades from Sleeper's public API.
//
// This is how the big trade databases are built. Tradabase says it aggregates
// "daily from thousands of Sleeper leagues"; AOD cites 6,500. There is no
// public trade API to call (checked: FantasyCalc exposes values only, Dynasty
// Daddy and RosterAudit expose none), so the data has to be gathered the same
// way they gather it.
//
// The crawl works because two Sleeper endpoints are public and link together:
//   league/{id}/rosters        -> owner_id for each team
//   user/{id}/leagues/nfl/{yr} -> every league that user is in
// so leagues reachable from our own snowball outward through shared managers.
//
// Deliberately bounded and polite. This is someone else's free API:
//   - dynasty only (settings.type === 2), which is all we can learn from
//   - hard cap on leagues visited
//   - concurrency capped, with a pause between batches
//   - resumable via the on-disk output, so a rerun does not redo work
//
//   node scripts/research/crawl-trades.mjs [maxLeagues]

import { existsSync, readFileSync, writeFileSync } from "node:fs";

const SEED_LEAGUES = [
  "1336158419664506880", "1337462916953145344",
  "1202869576350576640", "1204479754141450240", "1333976080574341120",
];
const MAX_LEAGUES = Number(process.argv[2] ?? 400);
const SEASONS = ["2026", "2025"];
const CONCURRENCY = 6;
const PAUSE_MS = 120;
const OUT = "scripts/research/trades-crawl.json";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let calls = 0;
async function get(url, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url);
      calls++;
      if (r.status === 429) { await sleep(2000 * (i + 1)); continue; }
      if (!r.ok) return null;
      return await r.json();
    } catch {
      await sleep(500 * (i + 1));
    }
  }
  return null;
}

async function pool(items, fn) {
  const out = [];
  for (let i = 0; i < items.length; i += CONCURRENCY) {
    out.push(...(await Promise.all(items.slice(i, i + CONCURRENCY).map(fn))));
    await sleep(PAUSE_MS);
  }
  return out;
}

const prior = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : { leagues: {}, trades: [] };
const visited = new Set(Object.keys(prior.leagues));
const trades = prior.trades;
const queue = SEED_LEAGUES.filter((id) => !visited.has(id));
const seenUsers = new Set();

console.log(`starting: ${visited.size} leagues already crawled, ${trades.length} trades on disk`);

const players = await get("https://api.sleeper.app/v1/players/nfl");
const meta = (pid) => {
  const p = players?.[pid];
  return p ? { pos: p.position ?? "?", age: p.age ?? null } : { pos: "?", age: null };
};

while (queue.length > 0 && visited.size < MAX_LEAGUES) {
  const id = queue.shift();
  if (!id || visited.has(id)) continue;
  visited.add(id);

  const lg = await get(`https://api.sleeper.app/v1/league/${id}`);
  if (!lg) continue;
  const isDynasty = (lg.settings?.type ?? 0) === 2;
  prior.leagues[id] = {
    name: lg.name, season: lg.season, teams: lg.total_rosters,
    dynasty: isDynasty, superflex: (lg.roster_positions ?? []).includes("SUPER_FLEX"),
  };
  if (!isDynasty) continue;

  // Trades, every week.
  const weeks = await pool([...Array(18).keys()].map((w) => w + 1), (w) =>
    get(`https://api.sleeper.app/v1/league/${id}/transactions/${w}`));
  for (const tx of weeks.flat()) {
    if (!tx || tx.type !== "trade" || tx.status !== "complete") continue;
    const sides = new Map();
    const touch = (rid) => {
      if (!sides.has(rid)) sides.set(rid, { players: [], picks: [] });
      return sides.get(rid);
    };
    for (const [pid, rid] of Object.entries(tx.adds ?? {})) touch(rid).players.push(meta(pid));
    for (const p of tx.draft_picks ?? []) touch(p.owner_id).picks.push({ season: p.season, round: p.round });
    if (sides.size !== 2) continue;
    trades.push({
      league: id, season: lg.season, teams: lg.total_rosters,
      superflex: (lg.roster_positions ?? []).includes("SUPER_FLEX"),
      sides: [...sides.values()],
    });
  }

  // Snowball: this league's managers lead to their other leagues.
  const rosters = await get(`https://api.sleeper.app/v1/league/${id}/rosters`);
  const owners = [...new Set((rosters ?? []).map((r) => r.owner_id).filter(Boolean))]
    .filter((u) => !seenUsers.has(u));
  owners.forEach((u) => seenUsers.add(u));
  const found = await pool(owners, async (u) => {
    const out = [];
    for (const s of SEASONS) {
      for (const l of (await get(`https://api.sleeper.app/v1/user/${u}/leagues/nfl/${s}`)) ?? []) {
        if ((l.settings?.type ?? 0) === 2 && !visited.has(l.league_id)) out.push(l.league_id);
      }
    }
    return out;
  });
  for (const l of new Set(found.flat())) if (!visited.has(l)) queue.push(l);

  if (visited.size % 20 === 0) {
    writeFileSync(OUT, JSON.stringify(prior, null, 0));
    console.log(`  ${visited.size} leagues · ${trades.length} trades · queue ${queue.length} · ${calls} calls`);
  }
}

prior.trades = trades;
writeFileSync(OUT, JSON.stringify(prior, null, 0));
const dyn = Object.values(prior.leagues).filter((l) => l.dynasty).length;
console.log(`\ndone: ${visited.size} leagues visited (${dyn} dynasty), ${trades.length} trades, ${calls} API calls`);
console.log(`wrote ${OUT}`);
