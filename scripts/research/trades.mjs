// What do REAL dynasty trades look like?
//
// Mines executed trades from Sleeper (public API, no auth) across every season
// of every league we know, and reports the SHAPES that actually happen. The
// archetype buckets were designed from intuition; this checks them against
// what managers really do.
const LEAGUES = [
  "1336158419664506880", "1337462916953145344",
  "1202869576350576640", "1204479754141450240", "1333976080574341120",
];
const j = async (u) => { const r = await fetch(u); return r.ok ? r.json() : null; };

// Walk previous_league_id back through prior seasons.
async function chain(id) {
  const out = [];
  let cur = id;
  while (cur && out.length < 12) {
    const lg = await j(`https://api.sleeper.app/v1/league/${cur}`);
    if (!lg) break;
    out.push(lg);
    cur = lg.previous_league_id;
  }
  return out;
}

const players = await j("https://api.sleeper.app/v1/players/nfl");
const pos = (pid) => players?.[pid]?.position ?? "?";

const trades = [];
const seenLeagues = new Set();
for (const root of LEAGUES) {
  for (const lg of await chain(root)) {
    if (seenLeagues.has(lg.league_id)) continue;
    seenLeagues.add(lg.league_id);
    for (let w = 1; w <= 18; w++) {
      const tx = await j(`https://api.sleeper.app/v1/league/${lg.league_id}/transactions/${w}`);
      for (const t of tx ?? []) {
        if (t.type !== "trade" || t.status !== "complete") continue;
        const sides = new Map();
        for (const [pid, rid] of Object.entries(t.adds ?? {})) {
          if (!sides.has(rid)) sides.set(rid, { players: [], picks: 0 });
          sides.get(rid).players.push(pos(pid));
        }
        for (const p of t.draft_picks ?? []) {
          const rid = p.owner_id;
          if (!sides.has(rid)) sides.set(rid, { players: [], picks: 0 });
          sides.get(rid).picks++;
        }
        if (sides.size !== 2) continue;
        trades.push({ league: lg.league_id, season: lg.season, sides: [...sides.values()] });
      }
    }
  }
}
console.log(`leagues walked: ${seenLeagues.size}`);
console.log(`completed 2-team trades: ${trades.length}`);

const tally = (label, fn) => {
  const m = new Map();
  for (const t of trades) { const k = fn(t); m.set(k, (m.get(k) ?? 0) + 1); }
  console.log(`\n${label}`);
  for (const [k, v] of [...m.entries()].sort((a,b)=>b[1]-a[1]).slice(0, 12)) {
    console.log(`   ${String(k).padEnd(26)} ${String(v).padStart(3)}  ${(100*v/trades.length).toFixed(0)}%`);
  }
};
const cnt = (s) => s.players.length + s.picks;
tally("SHAPE (assets each side, sorted)", t => t.sides.map(cnt).sort((a,b)=>a-b).join(" for "));
tally("PICKS INVOLVED?", t => {
  const p = t.sides.reduce((s,x)=>s+x.picks,0);
  return p === 0 ? "players only" : t.sides.every(x=>x.players.length===0) ? "picks only" : "mixed";
});
tally("1-for-1 same position?", t => {
  const [a,b] = t.sides;
  if (cnt(a) !== 1 || cnt(b) !== 1) return "(not 1-for-1)";
  if (a.players.length !== 1 || b.players.length !== 1) return "1-for-1 involving a pick";
  return a.players[0] === b.players[0] ? `1-for-1 SAME pos (${a.players[0]})` : "1-for-1 different pos";
});
