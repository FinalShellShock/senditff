// Turn the trade crawl into SIGNALS, not descriptions.
//
// The first pass over this data reported marginal frequencies and they were
// close to useless. "39% of traded players are WRs" is a restatement of the
// player pool. "88% of trades include a pick" is a restatement of the fact that
// picks are how you close the last gap when one side says it is not enough.
// Neither tells the engine anything about what to propose to a specific team.
//
// A trade recommender needs CONDITIONAL structure:
//
//     P(what moves | who the two sides are)
//
// not P(what moves). So everything here is split by the state each side was in
// when the trade happened, because that is the only thing our engine actually
// knows at recommendation time.
//
// Hypotheses being tested, all of which have math we could build:
//
//   H1  Deadline dump. In-season, a contender buys an aging producer from a
//       team that is out of it and pays with picks. If true, age and picks
//       flow in OPPOSITE directions, and the effect strengthens near the
//       deadline.
//
//   H2  Contenders pay a premium. If true, our balance gate should ALLOW
//       asymmetry when the roles match instead of punishing every deviation
//       from even.
//
//   H3  Meat and potatoes. The modal both-sides-accept trade between two
//       similar teams. If it exists it is the shape we should default to.
//
// CAVEAT that limits everything below: records and points-for are END OF
// SEASON, so a team that bought at the deadline and then won is partly winning
// because of the trade. Treat direction as suggestive, not causal.

import { readFileSync } from "node:fs";

const d = JSON.parse(readFileSync("scripts/research/trades-crawl.json", "utf8"));
const trades = d.trades.filter((t) => t.sides.every((s) => s.pfPct != null));

// Contention by points-for percentile: 0 = highest scoring in league, 1 = lowest.
const role = (s) => (s.pfPct <= 0.34 ? "contender" : s.pfPct >= 0.67 ? "rebuilder" : "middle");
// Sleeper reports offseason trades with leg 0/1; the fantasy deadline is ~wk 10-12.
const phase = (t) => (!t.week || t.week <= 1 ? "offseason" : t.week <= 8 ? "early season" : "deadline");
const avgAge = (s) => {
  const a = s.players.map((p) => p.age).filter(Boolean);
  return a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
};

console.log(`trades with team state: ${trades.length} of ${d.trades.length}\n`);

// ── H1: does age flow toward contenders and capital toward rebuilders? ───────
console.log("H1  ASSET FLOW BY ROLE  (what each side RECEIVED)");
console.log("    role         n     avg age recv   picks recv/trade   players recv/trade");
const byRole = new Map();
for (const t of trades) {
  for (const s of t.sides) {
    const k = role(s);
    const cur = byRole.get(k) ?? { n: 0, age: [], picks: 0, players: 0 };
    cur.n++;
    const a = avgAge(s);
    if (a) cur.age.push(a);
    cur.picks += s.picks.length;
    cur.players += s.players.length;
    byRole.set(k, cur);
  }
}
for (const k of ["contender", "middle", "rebuilder"]) {
  const v = byRole.get(k);
  if (!v) continue;
  const age = v.age.length ? (v.age.reduce((x, y) => x + y, 0) / v.age.length).toFixed(1) : "-";
  console.log(`    ${k.padEnd(11)}${String(v.n).padStart(5)}${String(age).padStart(15)}${(v.picks / v.n).toFixed(2).padStart(19)}${(v.players / v.n).toFixed(2).padStart(21)}`);
}

// Only the trades that pit a contender directly against a rebuilder.
const mismatch = trades.filter((t) => {
  const r = t.sides.map(role);
  return r.includes("contender") && r.includes("rebuilder");
});
console.log(`\n    contender-vs-rebuilder trades: ${mismatch.length} (${(100 * mismatch.length / trades.length).toFixed(0)}% of all)`);
for (const ph of ["offseason", "early season", "deadline"]) {
  const g = mismatch.filter((t) => phase(t) === ph);
  if (!g.length) continue;
  let cAge = [], rAge = [], cPicks = 0, rPicks = 0;
  for (const t of g) {
    for (const s of t.sides) {
      const a = avgAge(s);
      if (role(s) === "contender") { if (a) cAge.push(a); cPicks += s.picks.length; }
      if (role(s) === "rebuilder") { if (a) rAge.push(a); rPicks += s.picks.length; }
    }
  }
  const m = (x) => (x.length ? (x.reduce((p, q) => p + q, 0) / x.length).toFixed(1) : "-");
  console.log(`      ${ph.padEnd(13)} n=${String(g.length).padStart(4)}  contender gets age ${m(cAge)} / ${(cPicks / g.length).toFixed(2)} picks   rebuilder gets age ${m(rAge)} / ${(rPicks / g.length).toFixed(2)} picks`);
}

// ── H2: is the exchange lopsided in asset count by role? ─────────────────────
console.log("\nH2  ASSET COUNT ASYMMETRY (does one role systematically give more pieces?)");
for (const ph of ["offseason", "early season", "deadline"]) {
  const g = mismatch.filter((t) => phase(t) === ph);
  if (!g.length) continue;
  let diff = [];
  for (const t of g) {
    const c = t.sides.find((s) => role(s) === "contender");
    const r = t.sides.find((s) => role(s) === "rebuilder");
    if (!c || !r) continue;
    // What the contender RECEIVED minus what the rebuilder received.
    diff.push((c.players.length + c.picks.length) - (r.players.length + r.picks.length));
  }
  const mean = diff.reduce((a, b) => a + b, 0) / (diff.length || 1);
  console.log(`    ${ph.padEnd(13)} contender receives ${mean >= 0 ? "+" : ""}${mean.toFixed(2)} more assets than the rebuilder (n=${diff.length})`);
}

// ── H3: what does the modal same-role trade look like? ───────────────────────
console.log("\nH3  MEAT AND POTATOES: shape by role pairing");
const pairShape = new Map();
for (const t of trades) {
  const r = t.sides.map(role).sort();
  const key = r.join(" + ");
  const shape = t.sides.map((s) => s.players.length + s.picks.length).sort((a, b) => a - b).join("for");
  const cur = pairShape.get(key) ?? { n: 0, shapes: new Map(), picks: 0, assets: 0 };
  cur.n++;
  cur.shapes.set(shape, (cur.shapes.get(shape) ?? 0) + 1);
  cur.picks += t.sides.reduce((a, s) => a + s.picks.length, 0);
  cur.assets += t.sides.reduce((a, s) => a + s.picks.length + s.players.length, 0);
  pairShape.set(key, cur);
}
for (const [k, v] of [...pairShape.entries()].sort((a, b) => b[1].n - a[1].n)) {
  const top = [...v.shapes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3)
    .map(([s, c]) => `${s} ${(100 * c / v.n).toFixed(0)}%`).join(", ");
  console.log(`    ${k.padEnd(24)} n=${String(v.n).padStart(4)}  picks ${(100 * v.picks / v.assets).toFixed(0)}% of assets   top shapes: ${top}`);
}
