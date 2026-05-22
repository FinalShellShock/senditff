var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// api/trades/find.ts
var find_exports = {};
__export(find_exports, {
  default: () => handler
});
module.exports = __toCommonJS(find_exports);
var import_crypto = require("crypto");

// api/_lib/admin.ts
var admin = __toESM(require("firebase-admin"));
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(
      JSON.parse(process.env["FIREBASE_SERVICE_ACCOUNT_JSON"] ?? "{}")
    )
  });
  admin.firestore().settings({ ignoreUndefinedProperties: true });
}
var adminAuth = admin.auth();
var adminDb = admin.firestore();

// api/_lib/auth.ts
async function requireApprovedUser(req, res) {
  const authHeader = req.headers["authorization"] ?? "";
  if (!authHeader.startsWith("Bearer ")) {
    res.status(401).json({ error: "Unauthorized" });
    return null;
  }
  let uid;
  let email;
  try {
    const decoded = await adminAuth.verifyIdToken(authHeader.slice(7));
    uid = decoded.uid;
    email = decoded.email ?? "";
  } catch {
    res.status(401).json({ error: "Unauthorized" });
    return null;
  }
  const userSnap = await adminDb.collection("users").doc(uid).get();
  const d = userSnap.data();
  const isApproved = d?.["approved"] === true || d?.["subscribed"] === true;
  if (!userSnap.exists || !isApproved) {
    res.status(403).json({ error: "Forbidden" });
    return null;
  }
  return { uid, email };
}

// src/data/fantasycalc.ts
var FCALC = "https://api.fantasycalc.com/values/current";
async function fetchFantasyCalcOne(format, isDynasty) {
  const ppr = format.scoring === "ppr" ? 1 : format.scoring === "half" ? 0.5 : 0;
  const numQbs = format.superflex ? 2 : 1;
  const url = `${FCALC}?isDynasty=${isDynasty}&numQbs=${numQbs}&ppr=${ppr}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`FantasyCalc fetch failed: HTTP ${r.status} (${url})`);
  return await r.json();
}
async function fetchFantasyCalc(format) {
  const [dynasty, redraft] = await Promise.all([
    fetchFantasyCalcOne(format, true),
    fetchFantasyCalcOne(format, false)
  ]);
  return { dynasty, redraft };
}

// src/data/normalize.ts
function normName(name) {
  if (!name) return "";
  return name.toLowerCase().replace(/[^a-z0-9]/g, "").replace(/(jr|sr|ii|iii|iv|v)$/, "");
}

// api/_lib/snapshot.ts
var SNAPSHOT_TTL_MS = 12 * 60 * 60 * 1e3;
var SCORING_POSITIONS = ["QB", "RB", "WR", "TE"];
function formatKey(format) {
  return `${format.superflex ? "sf" : "1qb"}_${format.scoring}${format.tep ? "_tep" : ""}`;
}
async function getValueMaps(format) {
  const key = formatKey(format);
  const ref = adminDb.collection("valueSnapshots").doc(key);
  const snap = await ref.get();
  const now = Date.now();
  if (snap.exists) {
    const data = snap.data();
    const updatedAt = data?.["updatedAt"];
    const hasNewSchema = !!data?.["dynastyByPos"] && !!data?.["redraftByPos"];
    if (updatedAt && hasNewSchema && now - new Date(updatedAt).getTime() < SNAPSHOT_TTL_MS) {
      return deserializeSnapshot(data);
    }
  }
  const fcalc = await fetchFantasyCalc(format);
  const dynastyValues = /* @__PURE__ */ new Map();
  const redraftValues = /* @__PURE__ */ new Map();
  const dynastyByPos = { QB: [], RB: [], WR: [], TE: [] };
  const redraftByPos = { QB: [], RB: [], WR: [], TE: [] };
  for (const e of fcalc.dynasty) {
    const k = normName(e.player?.name);
    if (k) dynastyValues.set(k, { value: e.value, age: e.player?.age });
    const pos = e.player?.position;
    if (pos && SCORING_POSITIONS.includes(pos)) dynastyByPos[pos].push(e.value);
  }
  for (const e of fcalc.redraft) {
    const k = normName(e.player?.name);
    if (k) redraftValues.set(k, { value: e.value, age: e.player?.age });
    const pos = e.player?.position;
    if (pos && SCORING_POSITIONS.includes(pos)) redraftByPos[pos].push(e.value);
  }
  for (const pos of SCORING_POSITIONS) {
    dynastyByPos[pos].sort((a, b) => b - a);
    redraftByPos[pos].sort((a, b) => b - a);
  }
  const stored = {
    dynastyValues: Object.fromEntries(dynastyValues),
    redraftValues: Object.fromEntries(redraftValues),
    dynastyByPos,
    redraftByPos,
    updatedAt: new Date(now).toISOString()
  };
  await ref.set(stored);
  return { dynastyValues, redraftValues, dynastyByPos, redraftByPos };
}
function deserializeSnapshot(data) {
  const empty = { QB: [], RB: [], WR: [], TE: [] };
  return {
    dynastyValues: new Map(Object.entries(data.dynastyValues)),
    redraftValues: new Map(Object.entries(data.redraftValues)),
    dynastyByPos: data.dynastyByPos ?? empty,
    redraftByPos: data.redraftByPos ?? empty
  };
}

// src/algo/constants.ts
var POSITIONS = ["QB", "RB", "WR", "TE"];
var PICK_DECAY = {
  0: 1,
  1: 0.85,
  2: 0.7,
  3: 0.55
};

// src/algo/profile.ts
var REDRAFT = (p) => p.valueRedraft;
function depthSlotsFor(pos, format) {
  if (pos === "QB") return format.superflex ? 2 : 1;
  if (pos === "TE") return format.tep ? 2 : 1;
  return 3;
}
function byValueDesc(getValue) {
  return (a, b) => {
    const va = getValue(a);
    const vb = getValue(b);
    if (vb !== va) return vb - va;
    return a.id.localeCompare(b.id);
  };
}
function fillStarters(players, format, getValue = REDRAFT) {
  const used = /* @__PURE__ */ new Set();
  const byPos = { QB: [], RB: [], WR: [], TE: [] };
  for (const p of [...players].sort(byValueDesc(getValue))) byPos[p.position].push(p);
  const starters = { QB: [], RB: [], WR: [], TE: [] };
  const fillFrom = (pos, n) => {
    for (const p of byPos[pos]) {
      if (starters[pos].length >= n) break;
      if (!used.has(p.id)) {
        starters[pos].push(p);
        used.add(p.id);
      }
    }
  };
  fillFrom("QB", format.starterSlots.QB);
  fillFrom("RB", format.starterSlots.RB);
  fillFrom("WR", format.starterSlots.WR);
  fillFrom("TE", format.starterSlots.TE);
  for (let i = 0; i < format.starterSlots.FLEX; i++) {
    let best;
    for (const pos of ["RB", "WR", "TE"]) {
      for (const p of byPos[pos]) {
        if (used.has(p.id)) continue;
        if (!best || getValue(p) > getValue(best)) best = p;
        break;
      }
    }
    if (!best) break;
    starters[best.position].push(best);
    used.add(best.id);
  }
  for (let i = 0; i < format.starterSlots.SUPER_FLEX; i++) {
    let best;
    for (const pos of POSITIONS) {
      for (const p of byPos[pos]) {
        if (used.has(p.id)) continue;
        if (!best || getValue(p) > getValue(best)) best = p;
        break;
      }
    }
    if (!best) break;
    starters[best.position].push(best);
    used.add(best.id);
  }
  return { starters };
}
function depthByPosition(players, format, getValue = REDRAFT) {
  const baseStarters = {
    QB: format.starterSlots.QB + (format.starterSlots.SUPER_FLEX > 0 ? 1 : 0),
    RB: format.starterSlots.RB,
    WR: format.starterSlots.WR,
    TE: format.starterSlots.TE
  };
  const depth = { QB: [], RB: [], WR: [], TE: [] };
  for (const pos of POSITIONS) {
    const sorted = players.filter((p) => p.position === pos).sort(byValueDesc(getValue));
    const baseN = baseStarters[pos];
    const depthN = depthSlotsFor(pos, format);
    depth[pos] = sorted.slice(baseN, baseN + depthN);
  }
  return depth;
}
function flexStrengthValue(players, format, totalStarterValue, getValue = REDRAFT) {
  let positionSpecificValue = 0;
  for (const pos of POSITIONS) {
    const baseN = format.starterSlots[pos];
    if (baseN <= 0) continue;
    const sortedAtPos = players.filter((p) => p.position === pos).sort(byValueDesc(getValue));
    positionSpecificValue += sortedAtPos.slice(0, baseN).reduce((s, p) => s + getValue(p), 0);
  }
  return Math.max(0, totalStarterValue - positionSpecificValue);
}
function score0to100(value, leagueAvg) {
  if (leagueAvg <= 0) return 50;
  const score = 50 + (value - leagueAvg) / leagueAvg * 50;
  return Math.max(0, Math.min(100, score));
}
function topNStats(pool, n) {
  const safeN = Math.max(1, Math.min(pool.length, n));
  const sorted = [...pool].sort((a, b) => b - a).slice(0, safeN);
  if (sorted.length === 0) return { mean: 0, std: 1 };
  const mean = sorted.reduce((s, v) => s + v, 0) / sorted.length;
  const variance = sorted.reduce((s, v) => s + (v - mean) ** 2, 0) / sorted.length;
  return { mean, std: Math.max(1, Math.sqrt(variance)) };
}
function avgRankInPool(value, pool) {
  const n = pool.length;
  if (n <= 1) return { avgRank: 1, n };
  const sorted = [...pool].sort((a, b) => b - a);
  let strictlyGreater = 0;
  let equal = 0;
  for (const v of sorted) {
    if (v > value) strictlyGreater++;
    else if (v === value) equal++;
  }
  const firstRank = strictlyGreater + 1;
  const lastRank = equal === 0 ? firstRank : strictlyGreater + equal;
  return { avgRank: (firstRank + lastRank) / 2, n };
}
function positionScoreFromPool(value, pool, startable) {
  const { avgRank, n } = avgRankInPool(value, pool);
  if (n <= 1) return 50;
  const safeStartable = Math.max(1, Math.min(n, startable));
  if (avgRank <= safeStartable) {
    if (safeStartable <= 1) return 100;
    return Math.max(50, Math.min(100, 100 - 50 * (avgRank - 1) / (safeStartable - 1)));
  }
  const remaining = n - safeStartable;
  if (remaining <= 0) return 50;
  return Math.max(0, Math.min(50, 50 * (n - avgRank) / remaining));
}
function weightedSlotAverage(scores) {
  if (scores.length === 0) return 0;
  if (scores.length === 1) return scores[0] ?? 0;
  const sorted = [...scores].sort((a, b) => a - b);
  let weightedSum = 0;
  let totalWeight = 0;
  for (let i = 0; i < sorted.length; i++) {
    const weight = sorted.length - i;
    weightedSum += (sorted[i] ?? 0) * weight;
    totalWeight += weight;
  }
  return totalWeight > 0 ? weightedSum / totalWeight : 0;
}

// api/_lib/tradeEngine.ts
var ARCHETYPE_THRESHOLD = 30;
function playerAsset(p, ownerRosterId) {
  return { kind: "player", player: p, ownerRosterId };
}
function pickAsset(pk, ownerRosterId) {
  return { kind: "pick", pick: pk, ownerRosterId };
}
function assetValue(a) {
  return a.kind === "player" ? a.player.valueDynasty : a.pick.value;
}
function assetId(a) {
  return a.kind === "player" ? `p:${a.player.id}` : `pk:${a.pick.year}-${a.pick.round}-${a.pick.origRosterId}`;
}
function toWire(a) {
  if (a.kind === "player") {
    return {
      id: a.player.id,
      kind: "player",
      name: a.player.name,
      position: a.player.position,
      valueDynasty: a.player.valueDynasty
    };
  }
  return {
    id: `${a.pick.year}-${a.pick.round}-${a.pick.origRosterId}`,
    kind: "pick",
    name: a.pick.label,
    valueDynasty: a.pick.value
  };
}
function topPlayersByPos(profile, pos, n) {
  return profile.players.filter((p) => p.position === pos).sort((a, b) => {
    if (b.valueDynasty !== a.valueDynasty) return b.valueDynasty - a.valueDynasty;
    return a.id.localeCompare(b.id);
  }).slice(0, n);
}
function computeLeagueAverages(profiles, format, globalPlayerPools) {
  const starter = { QB: 0, RB: 0, WR: 0, TE: 0 };
  const depth = { QB: 0, RB: 0, WR: 0, TE: 0 };
  const starterPool = { QB: [], RB: [], WR: [], TE: [] };
  const depthPool = { QB: [], RB: [], WR: [], TE: [] };
  const starterPlayerPool = globalPlayerPools ? { ...globalPlayerPools.redraftByPos } : { QB: [], RB: [], WR: [], TE: [] };
  const depthPlayerPool = globalPlayerPools ? { ...globalPlayerPools.dynastyByPos } : { QB: [], RB: [], WR: [], TE: [] };
  const startersInUse = { QB: 0, RB: 0, WR: 0, TE: 0 };
  const depthSlotsTotal = { QB: 0, RB: 0, WR: 0, TE: 0 };
  let flex = 0;
  let cap = 0;
  for (const p of profiles) {
    for (const pos of POSITIONS) {
      starter[pos] += p.positionScores[pos].starterValue;
      depth[pos] += p.positionScores[pos].depthValue;
      starterPool[pos].push(p.positionScores[pos].starterValue);
      depthPool[pos].push(p.positionScores[pos].depthValue);
    }
    const { starters } = fillStarters(p.players, format);
    for (const pos of POSITIONS) {
      startersInUse[pos] += starters[pos].length;
    }
    if (!globalPlayerPools) {
      for (const pl of p.players) {
        starterPlayerPool[pl.position].push(pl.valueRedraft);
        depthPlayerPool[pl.position].push(pl.valueDynasty);
      }
    }
    flex += p.flex.value;
    cap += p.pickCapital.value;
  }
  const n = Math.max(1, profiles.length);
  for (const pos of POSITIONS) {
    starter[pos] /= n;
    depth[pos] /= n;
    depthSlotsTotal[pos] = n * depthSlotsFor(pos, format);
  }
  flex /= n;
  cap /= n;
  const starterStats = {};
  const depthStats = {};
  for (const pos of POSITIONS) {
    starterStats[pos] = topNStats(starterPlayerPool[pos], startersInUse[pos]);
    depthStats[pos] = topNStats(depthPlayerPool[pos], depthSlotsTotal[pos]);
  }
  const variance = profiles.reduce((s, p) => s + (p.pickCapital.value - cap) ** 2, 0) / n;
  return {
    starter,
    depth,
    flex,
    pickCapital: cap,
    pickCapitalStd: Math.sqrt(variance),
    starterPool,
    depthPool,
    starterPlayerPool,
    depthPlayerPool,
    starterStats,
    depthStats,
    startersInUse,
    depthSlotsTotal
  };
}
function simulateImpact(team, give, receive, format, averages, thisYear) {
  const giveIds = new Set(give.map(assetId));
  const newPlayers = team.players.filter((p) => !giveIds.has(`p:${p.id}`));
  const newPicks = team.picks.filter(
    (pk) => !giveIds.has(`pk:${pk.year}-${pk.round}-${pk.origRosterId}`)
  );
  for (const a of receive) {
    if (a.kind === "player") newPlayers.push(a.player);
    else newPicks.push(a.pick);
  }
  const { starters } = fillStarters(newPlayers, format);
  const depth = depthByPosition(newPlayers, format, (p) => p.valueDynasty);
  const newStarterTotal = POSITIONS.reduce(
    (s, pos) => s + starters[pos].reduce((a, p) => a + p.valueRedraft, 0),
    0
  );
  const newFlexValue = flexStrengthValue(newPlayers, format, newStarterTotal);
  const perPosition = {};
  for (const pos of POSITIONS) {
    const starterPlayerScores = starters[pos].map(
      (p) => positionScoreFromPool(p.valueRedraft, averages.starterPlayerPool[pos], averages.startersInUse[pos])
    );
    const depthPlayerScores = depth[pos].map(
      (p) => positionScoreFromPool(p.valueDynasty, averages.depthPlayerPool[pos], averages.depthSlotsTotal[pos])
    );
    const newStarterScore = weightedSlotAverage(starterPlayerScores);
    const newDepthScore = weightedSlotAverage(depthPlayerScores);
    perPosition[pos] = {
      starterScoreDelta: newStarterScore - team.positionScores[pos].starterScore,
      depthScoreDelta: newDepthScore - team.positionScores[pos].depthScore,
      urgency: team.positionScores[pos].urgency
    };
  }
  const newFlexScore = score0to100(newFlexValue, averages.flex || 1);
  let newPickCapValue = 0;
  for (const pk of newPicks) {
    const yearsOut = pk.year - thisYear;
    newPickCapValue += pk.value * (PICK_DECAY[yearsOut] ?? 0);
  }
  const newPickCapScore = score0to100(newPickCapValue, averages.pickCapital || 1);
  return {
    perPosition,
    flexScoreDelta: newFlexScore - team.flex.score,
    pickCapitalScoreDelta: newPickCapScore - team.pickCapital.score
  };
}
function fitScore(impact) {
  let score = 0;
  for (const pos of POSITIONS) {
    const ps = impact.perPosition[pos];
    const urgencyWeight = 0.3 + ps.urgency / 100 * 1.2;
    score += ps.starterScoreDelta * urgencyWeight;
    score += ps.depthScoreDelta * urgencyWeight * 0.4;
  }
  score += impact.flexScoreDelta * 0.4;
  score += impact.pickCapitalScoreDelta * 0.3;
  return Math.max(-1, Math.min(1, score / 35));
}
var COUNTER_ARCHETYPES = {
  tier_down: (pos) => pos ? [`consolidate_${pos}`, "push_in"] : [],
  consolidate: (pos) => pos ? [`tier_down_${pos}`] : [],
  consolidate_flex: () => ["tier_down_RB", "tier_down_WR", "tier_down_TE"],
  age_arb_buy: () => ["age_arb_sell", "capital_convert_production_to_picks"],
  age_arb_sell: () => ["age_arb_buy", "capital_convert_picks_to_production", "push_in"],
  push_in: () => ["capital_convert_production_to_picks"],
  capital_convert_picks_to_production: () => ["capital_convert_production_to_picks"],
  capital_convert_production_to_picks: () => ["capital_convert_picks_to_production", "push_in"],
  need_fill: (pos) => pos ? [`consolidate_${pos}`, `tier_down_${pos}`] : []
};
function counterArchetypeScore(archetype, theirProfile) {
  const parts = archetype.split("_");
  const lastIsPos = POSITIONS.includes(parts[parts.length - 1]);
  const pos = lastIsPos ? parts.pop() : void 0;
  const family = parts.join("_");
  const candidates = COUNTER_ARCHETYPES[family]?.(pos) ?? [];
  if (candidates.length === 0) return 0;
  const scores = candidates.map((k) => theirProfile.archetypeScores?.[k] ?? 0);
  return Math.max(...scores) / 100;
}
function scoreCandidate(cand, myProfile, others, ctx) {
  const them = others.find((p) => p.rosterId === cand.counterRosterId);
  const myImpact = simulateImpact(myProfile, cand.give, cand.receive, ctx.format, ctx.averages, ctx.thisYear);
  const theirImpact = simulateImpact(them, cand.receive, cand.give, ctx.format, ctx.averages, ctx.thisYear);
  const myFit = fitScore(myImpact);
  const theirFit = fitScore(theirImpact);
  const valueGive = cand.give.reduce((s, a) => s + assetValue(a), 0);
  const valueReceive = cand.receive.reduce((s, a) => s + assetValue(a), 0);
  const maxVal = Math.max(valueGive, valueReceive, 1);
  const balance = 1 - Math.abs(valueGive - valueReceive) / maxVal;
  const myArchScore = (myProfile.archetypeScores?.[cand.archetype] ?? 0) / 100;
  const myArchScoreFallback = cand.archetype.startsWith("need_fill") ? (myProfile.archetypeScores?.["need_fill"] ?? 0) / 100 : myArchScore;
  const myArch = Math.max(myArchScore, myArchScoreFallback);
  const theirArch = counterArchetypeScore(cand.archetype, them);
  const archMatch = myArch * 0.7 + theirArch * 0.3;
  const total = (myFit + 1) / 2 * 0.4 + balance * 0.2 + archMatch * 0.2 + (theirFit + 1) / 2 * 0.2;
  return {
    ...cand,
    total,
    myFit,
    theirFit,
    balance,
    archMatch,
    valueGive,
    valueReceive
  };
}
function within(value, target, tolerance) {
  if (target <= 0) return false;
  const ratio = value / target;
  return ratio >= 1 - tolerance && ratio <= 1 + tolerance;
}
function* combinations(arr, maxSize) {
  const n = Math.min(arr.length, 12);
  const items = arr.slice(0, n);
  for (let size = 1; size <= maxSize; size++) {
    yield* combs(items, size, 0, []);
  }
}
function* combs(items, size, start, prefix) {
  if (prefix.length === size) {
    yield prefix;
    return;
  }
  for (let i = start; i < items.length; i++) {
    yield* combs(items, size, i + 1, [...prefix, items[i]]);
  }
}
function bestPickSet(picks, target, maxCount) {
  let best = null;
  let bestDelta = Infinity;
  for (const combo of combinations(picks, maxCount)) {
    const v = combo.reduce((s, p) => s + p.value, 0);
    const delta = Math.abs(v - target);
    if (delta < bestDelta) {
      bestDelta = delta;
      best = combo;
    }
  }
  return best;
}
function eligiblePlayersForGiving(mine, excludePos, avoidIds) {
  return mine.players.filter((p) => !excludePos.includes(p.position)).filter((p) => !avoidIds.has(p.id)).sort((a, b) => {
    const aUrg = mine.positionScores[a.position]?.urgency ?? 50;
    const bUrg = mine.positionScores[b.position]?.urgency ?? 50;
    if (aUrg !== bUrg) return aUrg - bUrg;
    if (a.valueDynasty !== b.valueDynasty) return a.valueDynasty - b.valueDynasty;
    return a.id.localeCompare(b.id);
  });
}
function buildGiveSides(mine, targetValue, opts = {}) {
  const players = eligiblePlayersForGiving(mine, opts.excludePos ?? [], opts.avoidIds ?? /* @__PURE__ */ new Set());
  const picks = [...mine.picks].sort((a, b) => a.year - b.year || a.round - b.round);
  const shapes = [];
  let bestSingle = null;
  let bestSingleDelta = Infinity;
  for (const p of players) {
    const d = Math.abs(p.valueDynasty - targetValue);
    if (d < bestSingleDelta) {
      bestSingleDelta = d;
      bestSingle = p;
    }
  }
  if (bestSingle && within(bestSingle.valueDynasty, targetValue, 0.22)) {
    shapes.push([playerAsset(bestSingle, mine.rosterId)]);
  }
  const top = players.slice(0, 8);
  let bestPair = null;
  let bestPairDelta = Infinity;
  for (let i = 0; i < top.length; i++) {
    for (let j = i + 1; j < top.length; j++) {
      const v = top[i].valueDynasty + top[j].valueDynasty;
      const d = Math.abs(v - targetValue);
      if (d < bestPairDelta) {
        bestPairDelta = d;
        bestPair = [top[i], top[j]];
      }
    }
  }
  if (bestPair) {
    const v = bestPair[0].valueDynasty + bestPair[1].valueDynasty;
    if (within(v, targetValue, 0.18)) {
      shapes.push([playerAsset(bestPair[0], mine.rosterId), playerAsset(bestPair[1], mine.rosterId)]);
    }
  }
  if (opts.canIncludePicks && picks.length > 0) {
    for (const pl of players.slice(0, 10)) {
      const gap = targetValue - pl.valueDynasty;
      if (gap < 200) continue;
      const pickSet = bestPickSet(picks, gap, 2);
      if (!pickSet) continue;
      const v = pl.valueDynasty + pickSet.reduce((s, p) => s + p.value, 0);
      if (within(v, targetValue, 0.15)) {
        shapes.push([
          playerAsset(pl, mine.rosterId),
          ...pickSet.map((pk) => pickAsset(pk, mine.rosterId))
        ]);
        break;
      }
    }
    if (targetValue <= 4e3) {
      const pickSet = bestPickSet(picks, targetValue, 3);
      if (pickSet) {
        const v = pickSet.reduce((s, p) => s + p.value, 0);
        if (within(v, targetValue, 0.2)) {
          shapes.push(pickSet.map((pk) => pickAsset(pk, mine.rosterId)));
        }
      }
    }
  }
  return shapes;
}
function genNeedFill(ctx) {
  const out = [];
  const { mine, others } = ctx;
  const needPositions = [...POSITIONS].sort((a, b) => mine.positionScores[b].urgency - mine.positionScores[a].urgency).filter((pos) => mine.positionScores[pos].urgency >= 40).slice(0, 2);
  if (needPositions.length === 0) return out;
  for (const needPos of needPositions) {
    for (const them of others) {
      if (them.positionScores[needPos].classification === "CRITICAL_NEED") continue;
      const targets = topPlayersByPos(them, needPos, 2);
      for (const target of targets) {
        if (target.valueDynasty < 500) continue;
        const giveSides = buildGiveSides(mine, target.valueDynasty, {
          excludePos: [needPos],
          canIncludePicks: true
        });
        for (const give of giveSides) {
          out.push({
            give,
            receive: [playerAsset(target, them.rosterId)],
            counterRosterId: them.rosterId,
            archetype: `need_fill_${needPos}`
          });
        }
      }
    }
  }
  return out;
}
function genTierDown(ctx) {
  const out = [];
  const { mine, others } = ctx;
  for (const pos of POSITIONS) {
    if ((mine.archetypeScores?.[`tier_down_${pos}`] ?? 0) < ARCHETYPE_THRESHOLD) continue;
    const myElite = topPlayersByPos(mine, pos, 1)[0];
    if (!myElite || myElite.valueDynasty < 2500) continue;
    for (const them of others) {
      const theirAtPos = topPlayersByPos(them, pos, 4);
      const pair = theirAtPos.slice(1, 3);
      if (pair.length < 2) continue;
      const pairValue = pair.reduce((s, p) => s + p.valueDynasty, 0);
      const ratio = pairValue / myElite.valueDynasty;
      if (ratio >= 0.75 && ratio <= 1.3) {
        out.push({
          give: [playerAsset(myElite, mine.rosterId)],
          receive: pair.map((p) => playerAsset(p, them.rosterId)),
          counterRosterId: them.rosterId,
          archetype: `tier_down_${pos}`
        });
      }
      if (ratio < 0.95 && them.picks.length > 0) {
        const gap = myElite.valueDynasty - pairValue;
        const pickSet = bestPickSet(them.picks, gap, 2);
        if (pickSet) {
          const sweetenedValue = pairValue + pickSet.reduce((s, p) => s + p.value, 0);
          if (within(sweetenedValue, myElite.valueDynasty, 0.15)) {
            out.push({
              give: [playerAsset(myElite, mine.rosterId)],
              receive: [
                ...pair.map((p) => playerAsset(p, them.rosterId)),
                ...pickSet.map((pk) => pickAsset(pk, them.rosterId))
              ],
              counterRosterId: them.rosterId,
              archetype: `tier_down_${pos}`
            });
          }
        }
      }
      const theirSecond = theirAtPos[1];
      if (theirSecond) {
        const gap = myElite.valueDynasty - theirSecond.valueDynasty;
        if (gap > 500 && them.picks.length > 0) {
          const pickSet = bestPickSet(them.picks, gap, 2);
          if (pickSet) {
            const v = theirSecond.valueDynasty + pickSet.reduce((s, p) => s + p.value, 0);
            if (within(v, myElite.valueDynasty, 0.15)) {
              out.push({
                give: [playerAsset(myElite, mine.rosterId)],
                receive: [
                  playerAsset(theirSecond, them.rosterId),
                  ...pickSet.map((pk) => pickAsset(pk, them.rosterId))
                ],
                counterRosterId: them.rosterId,
                archetype: `tier_down_${pos}`
              });
            }
          }
        }
      }
    }
  }
  return out;
}
function genConsolidate(ctx) {
  const out = [];
  const { mine, others } = ctx;
  for (const pos of POSITIONS) {
    if ((mine.archetypeScores?.[`consolidate_${pos}`] ?? 0) < ARCHETYPE_THRESHOLD) continue;
    const myAtPos = topPlayersByPos(mine, pos, 4);
    const myPair = myAtPos.slice(1, 3);
    if (myPair.length < 2) continue;
    const pairValue = myPair.reduce((s, p) => s + p.valueDynasty, 0);
    for (const them of others) {
      const theirElite = topPlayersByPos(them, pos, 1)[0];
      if (!theirElite) continue;
      if (theirElite.valueDynasty < pairValue * 0.85) continue;
      const ratio = pairValue / theirElite.valueDynasty;
      if (ratio >= 0.8 && ratio <= 1.18) {
        out.push({
          give: myPair.map((p) => playerAsset(p, mine.rosterId)),
          receive: [playerAsset(theirElite, them.rosterId)],
          counterRosterId: them.rosterId,
          archetype: `consolidate_${pos}`
        });
      }
      if (pairValue < theirElite.valueDynasty * 0.95 && mine.picks.length > 0) {
        const gap = theirElite.valueDynasty - pairValue;
        const pickSet = bestPickSet(mine.picks, gap, 2);
        if (pickSet) {
          const v = pairValue + pickSet.reduce((s, p) => s + p.value, 0);
          if (within(v, theirElite.valueDynasty, 0.15)) {
            out.push({
              give: [
                ...myPair.map((p) => playerAsset(p, mine.rosterId)),
                ...pickSet.map((pk) => pickAsset(pk, mine.rosterId))
              ],
              receive: [playerAsset(theirElite, them.rosterId)],
              counterRosterId: them.rosterId,
              archetype: `consolidate_${pos}`
            });
          }
        }
      }
    }
  }
  return out;
}
function genConsolidateFlex(ctx) {
  const out = [];
  const { mine, others } = ctx;
  if ((mine.archetypeScores?.["consolidate_flex"] ?? 0) < ARCHETYPE_THRESHOLD) return out;
  const upgradePos = [...POSITIONS].sort(
    (a, b) => mine.positionScores[b].urgency - mine.positionScores[a].urgency
  )[0];
  const myRB2 = topPlayersByPos(mine, "RB", 3)[1];
  const myWR2 = topPlayersByPos(mine, "WR", 3)[1];
  if (!myRB2 && !myWR2) return out;
  const candidatesGive = [myRB2, myWR2].filter((p) => !!p);
  if (candidatesGive.length < 2) return out;
  const giveValue = candidatesGive.reduce((s, p) => s + p.valueDynasty, 0);
  for (const them of others) {
    const target = topPlayersByPos(them, upgradePos, 2)[0];
    if (!target) continue;
    if (target.valueDynasty < giveValue * 0.85) continue;
    const ratio = giveValue / target.valueDynasty;
    if (ratio >= 0.8 && ratio <= 1.2) {
      out.push({
        give: candidatesGive.map((p) => playerAsset(p, mine.rosterId)),
        receive: [playerAsset(target, them.rosterId)],
        counterRosterId: them.rosterId,
        archetype: "consolidate_flex"
      });
    }
  }
  return out;
}
function genAgeArbBuy(ctx) {
  const out = [];
  const { mine, others } = ctx;
  if ((mine.archetypeScores?.["age_arb_buy"] ?? 0) < ARCHETYPE_THRESHOLD) return out;
  for (const them of others) {
    if (them.windowTier === "LONG") continue;
    for (const pos of POSITIONS) {
      const aging = them.players.filter((p) => p.position === pos && (p.age ?? 0) >= 27 && p.valueDynasty >= 1500).sort((a, b) => b.valueDynasty - a.valueDynasty)[0];
      if (!aging) continue;
      const giveSides = buildGiveSides(mine, aging.valueDynasty * 1.05, {
        excludePos: [],
        canIncludePicks: true
      });
      for (const give of giveSides) {
        out.push({
          give,
          receive: [playerAsset(aging, them.rosterId)],
          counterRosterId: them.rosterId,
          archetype: "age_arb_buy"
        });
      }
    }
  }
  return out;
}
function genAgeArbSell(ctx) {
  const out = [];
  const { mine, others } = ctx;
  if ((mine.archetypeScores?.["age_arb_sell"] ?? 0) < ARCHETYPE_THRESHOLD) return out;
  for (const pos of POSITIONS) {
    const myAging = mine.players.filter((p) => p.position === pos && (p.age ?? 0) >= 28 && p.valueDynasty >= 1500).sort((a, b) => b.valueDynasty - a.valueDynasty)[0];
    if (!myAging) continue;
    for (const them of others) {
      if (them.windowTier === "SHORT") continue;
      const theirYouth = them.players.filter((p) => (p.age ?? 99) <= 25 && p.valueDynasty >= 1e3).sort((a, b) => b.valueDynasty - a.valueDynasty)[0];
      if (theirYouth) {
        out.push({
          give: [playerAsset(myAging, mine.rosterId)],
          receive: [playerAsset(theirYouth, them.rosterId)],
          counterRosterId: them.rosterId,
          archetype: "age_arb_sell"
        });
      }
      if (them.picks.length > 0) {
        const pickSet = bestPickSet(them.picks, myAging.valueDynasty * 0.9, 3);
        if (pickSet) {
          const v = pickSet.reduce((s, p) => s + p.value, 0);
          if (within(v, myAging.valueDynasty, 0.2)) {
            out.push({
              give: [playerAsset(myAging, mine.rosterId)],
              receive: pickSet.map((pk) => pickAsset(pk, them.rosterId)),
              counterRosterId: them.rosterId,
              archetype: "age_arb_sell"
            });
          }
        }
      }
    }
  }
  return out;
}
function genPushIn(ctx) {
  const out = [];
  const { mine, others } = ctx;
  if ((mine.archetypeScores?.["push_in"] ?? 0) < ARCHETYPE_THRESHOLD) return out;
  const needPos = [...POSITIONS].sort(
    (a, b) => mine.positionScores[b].urgency - mine.positionScores[a].urgency
  )[0];
  for (const them of others) {
    if (them.competitiveness === "STRONG" && them.windowTier === "SHORT") continue;
    const target = topPlayersByPos(them, needPos, 2)[0];
    if (!target || target.valueDynasty < 1500) continue;
    const giveSides = buildGiveSides(mine, target.valueDynasty, {
      excludePos: [needPos],
      canIncludePicks: true
    }).filter((g) => g.some((a) => a.kind === "pick"));
    for (const give of giveSides) {
      out.push({
        give,
        receive: [playerAsset(target, them.rosterId)],
        counterRosterId: them.rosterId,
        archetype: "push_in"
      });
    }
  }
  return out;
}
function genCapitalConvertPicksToProduction(ctx) {
  const out = [];
  const { mine, others } = ctx;
  if ((mine.archetypeScores?.["capital_convert_picks_to_production"] ?? 0) < ARCHETYPE_THRESHOLD) return out;
  if (mine.picks.length === 0) return out;
  for (const them of others) {
    for (const pos of POSITIONS) {
      const target = topPlayersByPos(them, pos, 2)[0];
      if (!target || target.valueDynasty < 1200) continue;
      const pickSet = bestPickSet(mine.picks, target.valueDynasty, 3);
      if (!pickSet) continue;
      const v = pickSet.reduce((s, p) => s + p.value, 0);
      if (!within(v, target.valueDynasty, 0.2)) continue;
      out.push({
        give: pickSet.map((pk) => pickAsset(pk, mine.rosterId)),
        receive: [playerAsset(target, them.rosterId)],
        counterRosterId: them.rosterId,
        archetype: "capital_convert_picks_to_production"
      });
    }
  }
  return out;
}
function genCapitalConvertProductionToPicks(ctx) {
  const out = [];
  const { mine, others } = ctx;
  if ((mine.archetypeScores?.["capital_convert_production_to_picks"] ?? 0) < ARCHETYPE_THRESHOLD) return out;
  const sellable = mine.players.filter((p) => p.valueDynasty >= 1500).filter((p) => mine.positionScores[p.position].classification !== "CRITICAL_NEED").sort((a, b) => b.valueDynasty - a.valueDynasty).slice(0, 6);
  for (const seller of sellable) {
    for (const them of others) {
      if (them.picks.length === 0) continue;
      const pickSet = bestPickSet(them.picks, seller.valueDynasty * 0.95, 3);
      if (!pickSet) continue;
      const v = pickSet.reduce((s, p) => s + p.value, 0);
      if (!within(v, seller.valueDynasty, 0.2)) continue;
      out.push({
        give: [playerAsset(seller, mine.rosterId)],
        receive: pickSet.map((pk) => pickAsset(pk, them.rosterId)),
        counterRosterId: them.rosterId,
        archetype: "capital_convert_production_to_picks"
      });
    }
  }
  return out;
}
var GENERATORS = [
  genNeedFill,
  genTierDown,
  genConsolidate,
  genConsolidateFlex,
  genAgeArbBuy,
  genAgeArbSell,
  genPushIn,
  genCapitalConvertPicksToProduction,
  genCapitalConvertProductionToPicks
];
function candidateKey(c) {
  const g = c.give.map(assetId).sort().join("|");
  const r = c.receive.map(assetId).sort().join("|");
  return `${g}::${r}`;
}
function generatePackages(mine, allProfiles, format, thisYear, limit = 5, globalPlayerPools) {
  const others = allProfiles.filter((p) => p.rosterId !== mine.rosterId);
  const averages = computeLeagueAverages(allProfiles, format, globalPlayerPools);
  const ctx = { mine, others, format, averages, thisYear };
  const rawCandidates = GENERATORS.flatMap((g) => g(ctx));
  const seen = /* @__PURE__ */ new Set();
  const unique = [];
  for (const c of rawCandidates) {
    const key = candidateKey(c);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(c);
  }
  const scored = unique.map((c) => scoreCandidate(c, mine, others, ctx));
  const filtered = scored.filter(
    (s) => s.myFit > -0.1 && s.theirFit > -0.4 && s.balance > 0.55
  );
  filtered.sort((a, b) => {
    if (b.total !== a.total) return b.total - a.total;
    return candidateKey(a).localeCompare(candidateKey(b));
  });
  const perCounter = /* @__PURE__ */ new Map();
  const archFamiliesUsed = /* @__PURE__ */ new Set();
  const top = [];
  for (const s of filtered) {
    const cnt = perCounter.get(s.counterRosterId) ?? 0;
    if (cnt >= 2) continue;
    const family = s.archetype.replace(/_(QB|RB|WR|TE)$/, "");
    if (top.length < limit / 2 && archFamiliesUsed.has(family)) continue;
    top.push(s);
    perCounter.set(s.counterRosterId, cnt + 1);
    archFamiliesUsed.add(family);
    if (top.length >= limit) break;
  }
  if (top.length < limit) {
    for (const s of filtered) {
      if (top.includes(s)) continue;
      const cnt = perCounter.get(s.counterRosterId) ?? 0;
      if (cnt >= 2) continue;
      top.push(s);
      perCounter.set(s.counterRosterId, cnt + 1);
      if (top.length >= limit) break;
    }
  }
  return top.map((s) => {
    const counter = others.find((p) => p.rosterId === s.counterRosterId);
    return {
      counterTeam: counter?.ownerName ?? "?",
      counterRosterId: s.counterRosterId,
      give: s.give.map(toWire),
      receive: s.receive.map(toWire),
      valueGive: s.valueGive,
      valueReceive: s.valueReceive,
      archetype: s.archetype
    };
  });
}

// api/trades/find.ts
var MODEL_HAIKU = "claude-haiku-4-5-20251001";
function rationaleHash(pkg, myProfile) {
  const key = JSON.stringify({
    give: pkg.give.map((a) => a.id).sort(),
    receive: pkg.receive.map((a) => a.id).sort(),
    archetype: pkg.archetype,
    myWindow: myProfile.windowLabel
  });
  return (0, import_crypto.createHash)("sha256").update(key).digest("hex");
}
function describeAsset(a) {
  return a.kind === "player" ? `${a.name} (${a.position})` : a.name;
}
async function generateRationale(pkg, myProfile) {
  const giveNames = pkg.give.map(describeAsset).join(", ");
  const receiveNames = pkg.receive.map(describeAsset).join(", ");
  const archetypeLabel = pkg.archetype.replace(/_/g, " ");
  const prompt = `You are analyzing a dynasty fantasy football trade for a team classified as ${myProfile.windowLabel} (${myProfile.competitiveness} competitiveness, ${myProfile.windowTier} window).

Trade: Send ${giveNames} and receive ${receiveNames} from ${pkg.counterTeam}.
Trade type: ${archetypeLabel}.

Write 2-3 sentences explaining why this trade makes sense for this team right now. Be specific about the players, picks, and the team's situation. Do not use em dashes.`;
  const apiRes = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env["ANTHROPIC_API_KEY"] ?? "",
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model: MODEL_HAIKU,
      max_tokens: 200,
      messages: [{ role: "user", content: prompt }]
    })
  });
  if (!apiRes.ok) return "Rationale unavailable.";
  const data = await apiRes.json();
  return data.content?.[0]?.text?.trim() ?? "Rationale unavailable.";
}
async function addRationale(pkg, myProfile) {
  const hash = rationaleHash(pkg, myProfile);
  const cacheRef = adminDb.collection("rationaleCache").doc(hash);
  const cached = await cacheRef.get();
  if (cached.exists) {
    return { ...pkg, rationale: cached.data()?.["rationale"] };
  }
  const rationale = await generateRationale(pkg, myProfile);
  await cacheRef.set({ hash, rationale, archetype: pkg.archetype, generatedAt: (/* @__PURE__ */ new Date()).toISOString() });
  return { ...pkg, rationale };
}
async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const user = await requireApprovedUser(req, res);
  if (!user) return;
  const { leagueId, rosterId } = req.body;
  if (!leagueId || rosterId == null) {
    return res.status(400).json({ error: "leagueId and rosterId required" });
  }
  try {
    const leagueRef = adminDb.collection("leagues").doc(leagueId);
    const [leagueSnap, profilesSnap] = await Promise.all([
      leagueRef.get(),
      leagueRef.collection("profiles").get()
    ]);
    const leagueData = leagueSnap.data();
    const members = leagueData?.["members"] ?? [];
    if (!members.includes(user.uid)) return res.status(403).json({ error: "Forbidden" });
    const format = leagueData?.["format"];
    if (!format) return res.status(500).json({ error: "League format missing" });
    const profiles = profilesSnap.docs.map((d) => d.data());
    const myProfile = profiles.find((p) => p.rosterId === Number(rosterId));
    if (!myProfile) return res.status(404).json({ error: "Team not found" });
    const thisYear = (/* @__PURE__ */ new Date()).getFullYear();
    const valueMaps = await getValueMaps(format);
    const packages = generatePackages(myProfile, profiles, format, thisYear, 5, {
      dynastyByPos: valueMaps.dynastyByPos,
      redraftByPos: valueMaps.redraftByPos
    });
    const withRationales = await Promise.all(
      packages.map((pkg) => addRationale(pkg, myProfile))
    );
    return res.status(200).json({ packages: withRationales });
  } catch (err) {
    console.error("trades/find error", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
