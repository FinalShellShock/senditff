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

// src/algo/constants.ts
var POSITIONS = ["QB", "RB", "WR", "TE"];
var VALUE_LOSS_RATE = {
  QB: { 23: -1.8, 24: -1.8, 25: -1.8, 26: 0.6, 27: 0.6, 28: 4.4, 29: 4.5, 30: 4.5, 31: 4.5, 32: 4.5, 33: 4.5, 34: 4.5, 35: 12.1 },
  RB: { 23: 5.6, 24: 6.4, 25: 8, 26: 9.3, 27: 9.3, 28: 9.3, 29: 11.2, 30: 14.6 },
  WR: { 23: 4.6, 24: 4.6, 25: 4.6, 26: 4.6, 27: 4.6, 28: 4.6, 29: 7.6, 30: 7.6, 31: 7.6, 32: 7.6, 33: 17.9 },
  // TE never accelerates in this data. That is a sample-size limitation
  // (n=25-36 above age 30), not evidence that TEs stop aging: the raw series
  // wanders negative up there and isotonic pooling flattens it. Treat TE
  // age-arb as unsupported by data rather than as a finding.
  TE: { 23: 5.5, 24: 5.5, 25: 5.5, 26: 5.5, 27: 5.5, 28: 5.5, 29: 5.5, 30: 5.5 }
};
var AGING_LOSS_RATE = { QB: 6, RB: 8.5, WR: 7, TE: 7 };
var DECLINING_LOSS_RATE = { QB: 10, RB: 10.5, WR: 10, TE: 10 };
var PICK_DECAY = {
  0: 1,
  1: 0.85,
  2: 0.7,
  3: 0.55
};

// src/algo/archetypes.ts
var ARCHETYPE_FAMILIES = [
  "need_fill",
  "tier_down",
  "consolidate",
  "consolidate_flex",
  "age_arb_buy",
  "age_arb_sell",
  "push_in",
  "capital_convert_picks_to_production",
  "capital_convert_production_to_picks"
];

// src/algo/fairness.ts
var FAIRNESS_FAIR_PCT = 0.05;
var FAIRNESS_FAIR_ABS = 150;
var FAIRNESS_SLIGHT_PCT = 0.12;
var BUNDLE_DECAY = 0.8;
function packageValue(values) {
  const sorted = [...values].sort((a, b) => b - a);
  let total = 0;
  let mult = 1;
  for (const v of sorted) {
    total += v * mult;
    mult *= BUNDLE_DECAY;
  }
  return total;
}
var BEST_ASSET_PREMIUM = 0.15;
function tradeEffectiveValues(giveValues, receiveValues) {
  let give = packageValue(giveValues);
  let receive = packageValue(receiveValues);
  const bestGive = giveValues.length > 0 ? Math.max(...giveValues) : 0;
  const bestReceive = receiveValues.length > 0 ? Math.max(...receiveValues) : 0;
  if (bestGive > bestReceive) give += BEST_ASSET_PREMIUM * (bestGive - bestReceive);
  else if (bestReceive > bestGive) receive += BEST_ASSET_PREMIUM * (bestReceive - bestGive);
  return { give, receive };
}
function fairnessDelta(valueGive, valueReceive) {
  return (valueReceive - valueGive) / Math.max(valueGive, valueReceive, 1);
}
function fairnessLabel(valueGive, valueReceive) {
  const delta = fairnessDelta(valueGive, valueReceive);
  const absGap = Math.abs(valueReceive - valueGive);
  if (Math.abs(delta) <= FAIRNESS_FAIR_PCT || absGap <= FAIRNESS_FAIR_ABS) return "FAIR";
  if (delta < 0) {
    return -delta <= FAIRNESS_SLIGHT_PCT ? "SLIGHT_OVERPAY" : "OVERPAY";
  }
  return delta <= FAIRNESS_SLIGHT_PCT ? "SLIGHT_UNDERPAY" : "UNDERPAY";
}
function fairnessText(label) {
  return label.replace(/_/g, " ");
}

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

// api/_lib/membership.ts
async function ensureLeagueAccess(uid, leagueRef, members) {
  if (members.includes(uid)) return true;
  const userSnap = await adminDb.collection("users").doc(uid).get();
  const sleeperUserId = userSnap.data()?.["sleeperUserId"];
  if (!sleeperUserId) return false;
  const match = await leagueRef.collection("profiles").where("ownerSleeperUserId", "==", sleeperUserId).limit(1).get();
  if (match.empty) return false;
  await leagueRef.set({ members: [...members, uid] }, { merge: true });
  return true;
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
function interp(x, x0, x1, y0, y1) {
  if (x1 === x0) return y0;
  return y0 + (x - x0) / (x1 - x0) * (y1 - y0);
}
function valueLossRate(age, pos) {
  const table = VALUE_LOSS_RATE[pos];
  const ages = Object.keys(table).map(Number).sort((a, b) => a - b);
  const lo = ages[0], hi = ages[ages.length - 1];
  if (age <= lo) return table[lo];
  if (age >= hi) return table[hi];
  const upper = ages.find((a) => a >= age);
  const lower = ages[ages.indexOf(upper) - 1];
  return interp(age, lower, upper, table[lower], table[upper]);
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
function genPositions(ctx) {
  return ctx.forced?.position ? [ctx.forced.position] : POSITIONS;
}
function playerAsset(p, ownerRosterId) {
  return { kind: "player", player: p, ownerRosterId };
}
function pickAsset(pk, ownerRosterId) {
  return { kind: "pick", pick: pk, ownerRosterId };
}
function assetValue(a) {
  return a.kind === "player" ? a.player.valueDynasty : a.pick.value;
}
var FILLER_SWEETENER_MAX = 0.15;
function bundleShapeOk(assets) {
  if (assets.length <= 2) return true;
  const values = assets.map(assetValue).sort((a, b) => b - a);
  const sum = values.reduce((s, v) => s + v, 0);
  if (sum <= 0) return false;
  return values.slice(2).every((v) => v <= FILLER_SWEETENER_MAX * sum);
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
      valueDynasty: a.player.valueDynasty,
      ...a.player.age != null ? { age: a.player.age } : {}
    };
  }
  return {
    id: `${a.pick.year}-${a.pick.round}-${a.pick.origRosterId}`,
    kind: "pick",
    name: a.pick.label,
    valueDynasty: a.pick.value
  };
}
function playerLossRate(p) {
  if (p.age == null) return 0;
  return valueLossRate(p.age, p.position);
}
function isAging(p) {
  return playerLossRate(p) >= AGING_LOSS_RATE[p.position];
}
function isDeclining(p) {
  return playerLossRate(p) >= DECLINING_LOSS_RATE[p.position];
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
  const { give: adjGive, receive: adjReceive } = tradeEffectiveValues(
    cand.give.map(assetValue),
    cand.receive.map(assetValue)
  );
  const maxVal = Math.max(adjGive, adjReceive, 1);
  const balance = 1 - Math.abs(adjGive - adjReceive) / maxVal;
  const myArchScore = (myProfile.archetypeScores?.[cand.archetype] ?? 0) / 100;
  const myArchScoreFallback = cand.archetype.startsWith("need_fill") ? (myProfile.archetypeScores?.["need_fill"] ?? 0) / 100 : myArchScore;
  const myArch = Math.max(myArchScore, myArchScoreFallback);
  const theirArch = counterArchetypeScore(cand.archetype, them);
  const archMatch = myArch * 0.7 + theirArch * 0.3;
  const total = (myFit + 1) / 2 * 0.32 + (theirFit + 1) / 2 * 0.28 + archMatch * 0.22 + balance * 0.18;
  return {
    ...cand,
    total,
    myFit,
    theirFit,
    balance,
    archMatch,
    valueGive,
    valueReceive,
    adjGive,
    adjReceive
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
    const v = packageValue(combo.map((p) => p.value));
    const delta = Math.abs(v - target);
    if (delta < bestDelta) {
      bestDelta = delta;
      best = combo;
    }
  }
  return best;
}
function eligiblePlayersForGiving(mine, excludePos, avoidIds) {
  return mine.players.filter((p) => !excludePos.includes(p.position)).filter((p) => !avoidIds.has(p.id)).filter((p) => p.valueDynasty >= 100).sort((a, b) => {
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
      const v = packageValue([top[i].valueDynasty, top[j].valueDynasty]);
      const d = Math.abs(v - targetValue);
      if (d < bestPairDelta) {
        bestPairDelta = d;
        bestPair = [top[i], top[j]];
      }
    }
  }
  if (bestPair) {
    const v = packageValue([bestPair[0].valueDynasty, bestPair[1].valueDynasty]);
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
      const v = packageValue([pl.valueDynasty, ...pickSet.map((p) => p.value)]);
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
        const v = packageValue(pickSet.map((p) => p.value));
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
  const needPositions = ctx.forced?.position ? [ctx.forced.position] : [...POSITIONS].sort((a, b) => mine.positionScores[b].urgency - mine.positionScores[a].urgency).filter((pos) => ctx.forced ? true : mine.positionScores[pos].urgency >= 40).slice(0, 2);
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
  for (const pos of genPositions(ctx)) {
    const myElite = topPlayersByPos(mine, pos, 1)[0];
    if (!myElite || myElite.valueDynasty < (ctx.forced ? 1500 : 2500)) continue;
    for (const them of others) {
      const theirAtPos = topPlayersByPos(them, pos, 4);
      const pair = theirAtPos.slice(1, 3);
      if (pair.length < 2) continue;
      const pairValue = packageValue(pair.map((p) => p.valueDynasty));
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
          const sweetenedValue = packageValue([
            ...pair.map((p) => p.valueDynasty),
            ...pickSet.map((p) => p.value)
          ]);
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
            const v = packageValue([theirSecond.valueDynasty, ...pickSet.map((p) => p.value)]);
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
      const crossPositions = [...POSITIONS].filter((q) => q !== pos).sort((a, b) => mine.positionScores[b].urgency - mine.positionScores[a].urgency).slice(0, 2);
      for (const q of crossPositions) {
        const theirAtQ = topPlayersByPos(them, q, 3).slice(1, 3);
        for (const pieceAtPos of theirAtPos.slice(1, 3)) {
          for (const pieceAtQ of theirAtQ) {
            const v = packageValue([pieceAtPos.valueDynasty, pieceAtQ.valueDynasty]);
            const ratio2 = v / myElite.valueDynasty;
            if (ratio2 >= 0.75 && ratio2 <= 1.3) {
              out.push({
                give: [playerAsset(myElite, mine.rosterId)],
                receive: [
                  playerAsset(pieceAtPos, them.rosterId),
                  playerAsset(pieceAtQ, them.rosterId)
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
  for (const pos of genPositions(ctx)) {
    const myAtPos = topPlayersByPos(mine, pos, 4);
    const myPair = myAtPos.slice(1, 3);
    if (myPair.length < 2) continue;
    const pairValue = packageValue(myPair.map((p) => p.valueDynasty));
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
          const v = packageValue([
            ...myPair.map((p) => p.valueDynasty),
            ...pickSet.map((p) => p.value)
          ]);
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
  const upgradePos = [...POSITIONS].sort(
    (a, b) => mine.positionScores[b].urgency - mine.positionScores[a].urgency
  )[0];
  const myRB2 = topPlayersByPos(mine, "RB", 3)[1];
  const myWR2 = topPlayersByPos(mine, "WR", 3)[1];
  if (!myRB2 && !myWR2) return out;
  const candidatesGive = [myRB2, myWR2].filter((p) => !!p);
  if (candidatesGive.length < 2) return out;
  const giveValue = packageValue(candidatesGive.map((p) => p.valueDynasty));
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
  for (const them of others) {
    if (them.windowTier === "LONG") continue;
    for (const pos of genPositions(ctx)) {
      const aging = them.players.filter((p) => p.position === pos && isAging(p) && p.valueDynasty >= 1500).sort((a, b) => b.valueDynasty - a.valueDynasty)[0];
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
  for (const pos of genPositions(ctx)) {
    const myAging = mine.players.filter((p) => p.position === pos && isDeclining(p) && p.valueDynasty >= 1500).sort((a, b) => b.valueDynasty - a.valueDynasty)[0];
    if (!myAging) continue;
    for (const them of others) {
      if (them.windowTier === "LONG") continue;
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
          const v = packageValue(pickSet.map((p) => p.value));
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
  const needPos = ctx.forced?.position ?? [...POSITIONS].sort(
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
  if (mine.picks.length === 0) return out;
  for (const them of others) {
    for (const pos of genPositions(ctx)) {
      const target = topPlayersByPos(them, pos, 2)[0];
      if (!target || target.valueDynasty < 1200) continue;
      const pickSet = bestPickSet(mine.picks, target.valueDynasty, 3);
      if (!pickSet) continue;
      const v = packageValue(pickSet.map((p) => p.value));
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
  const sellable = mine.players.filter((p) => !ctx.forced?.position || p.position === ctx.forced.position).filter((p) => p.valueDynasty >= 1500).filter((p) => mine.positionScores[p.position].classification !== "CRITICAL_NEED").sort((a, b) => b.valueDynasty - a.valueDynasty).slice(0, 6);
  for (const seller of sellable) {
    for (const them of others) {
      if (them.picks.length === 0) continue;
      const pickSet = bestPickSet(them.picks, seller.valueDynasty * 0.95, 3);
      if (!pickSet) continue;
      const v = packageValue(pickSet.map((p) => p.value));
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
var GENERATORS = {
  need_fill: genNeedFill,
  tier_down: genTierDown,
  consolidate: genConsolidate,
  consolidate_flex: genConsolidateFlex,
  age_arb_buy: genAgeArbBuy,
  age_arb_sell: genAgeArbSell,
  push_in: genPushIn,
  capital_convert_picks_to_production: genCapitalConvertPicksToProduction,
  capital_convert_production_to_picks: genCapitalConvertProductionToPicks
};
var DEFAULT_GATES = { myFit: -0.15, theirFit: -0.25, balance: 0.55 };
var FORCED_GATES = { myFit: -0.3, theirFit: -0.6, balance: 0.4 };
function candidateKey(c) {
  const g = c.give.map(assetId).sort().join("|");
  const r = c.receive.map(assetId).sort().join("|");
  return `${g}::${r}`;
}
function forcedArchetypeScore(mine, forced) {
  const scores = mine.archetypeScores ?? {};
  if (forced.family === "tier_down" || forced.family === "consolidate") {
    const positions = forced.position ? [forced.position] : POSITIONS;
    return Math.max(...positions.map((pos) => scores[`${forced.family}_${pos}`] ?? 0));
  }
  return scores[forced.family] ?? 0;
}
function buildCounterNote(target, forced) {
  if (!target) return void 0;
  if (forced?.position) {
    const cl = target.positionScores[forced.position]?.classification;
    return `${target.ownerName} is ${cl} at ${forced.position}`;
  }
  return `${target.ownerName} profiles as ${target.windowLabel}`;
}
function generatePackages(mine, allProfiles, format, thisYear, opts = {}) {
  const limit = opts.limit ?? 5;
  const forced = opts.forceArchetype;
  let others = allProfiles.filter((p) => p.rosterId !== mine.rosterId);
  const target = opts.targetRosterId != null ? others.find((p) => p.rosterId === opts.targetRosterId) : void 0;
  if (opts.targetRosterId != null) {
    others = others.filter((p) => p.rosterId === opts.targetRosterId);
  }
  const averages = computeLeagueAverages(allProfiles, format, opts.pools);
  const ctx = { mine, others, format, averages, thisYear, forced };
  const generators = forced ? [GENERATORS[forced.family]] : Object.values(GENERATORS);
  const sideOk = (assets) => {
    if (!bundleShapeOk(assets)) return false;
    if (opts.noFillerPicks) {
      const pickAssets = assets.filter((a) => a.kind === "pick");
      if (pickAssets.length > 1) return false;
      if (pickAssets.some((a) => a.kind === "pick" && a.pick.round >= 3)) return false;
    }
    return true;
  };
  const shapeFilter = (cands) => cands.filter((c) => sideOk(c.give) && sideOk(c.receive));
  let degraded;
  const rawCandidates = shapeFilter(generators.flatMap((g) => g(ctx)));
  const seen = /* @__PURE__ */ new Set();
  const unique = [];
  for (const c of rawCandidates) {
    const key = candidateKey(c);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(c);
  }
  const scored = unique.map((c) => scoreCandidate(c, mine, others, ctx));
  const applyGates = (gates) => {
    const rej = { myFit: 0, theirFit: 0, balance: 0 };
    const passed = scored.filter((s) => {
      let ok = true;
      if (!(s.myFit > gates.myFit)) {
        rej.myFit++;
        ok = false;
      }
      if (!(s.theirFit > gates.theirFit)) {
        rej.theirFit++;
        ok = false;
      }
      if (!(s.balance > gates.balance)) {
        rej.balance++;
        ok = false;
      }
      return ok;
    });
    return { passed, rej };
  };
  let gatePass = applyGates(forced ? FORCED_GATES : DEFAULT_GATES);
  if (!forced && gatePass.passed.length === 0 && scored.length > 0) {
    degraded = "gates";
    gatePass = applyGates(FORCED_GATES);
    if (gatePass.passed.length === 0) {
      gatePass = { passed: [...scored], rej: gatePass.rej };
    }
  }
  const filtered = gatePass.passed;
  const rejected = gatePass.rej;
  const MUTUAL_FLOOR = -0.02;
  const mutualTier = (s) => s.myFit >= MUTUAL_FLOOR && s.theirFit >= MUTUAL_FLOOR ? 0 : 1;
  filtered.sort((a, b) => {
    const ta = mutualTier(a);
    const tb = mutualTier(b);
    if (ta !== tb) return ta - tb;
    if (b.total !== a.total) return b.total - a.total;
    return candidateKey(a).localeCompare(candidateKey(b));
  });
  const perCounterCap = opts.targetRosterId != null ? Infinity : 2;
  const perCounter = /* @__PURE__ */ new Map();
  const archFamiliesUsed = /* @__PURE__ */ new Set();
  const top = [];
  for (const s of filtered) {
    const cnt = perCounter.get(s.counterRosterId) ?? 0;
    if (cnt >= perCounterCap) continue;
    const family = s.archetype.replace(/_(QB|RB|WR|TE)$/, "");
    if (!forced && top.length < limit / 2 && archFamiliesUsed.has(family)) continue;
    top.push(s);
    perCounter.set(s.counterRosterId, cnt + 1);
    archFamiliesUsed.add(family);
    if (top.length >= limit) break;
  }
  if (top.length < limit) {
    for (const s of filtered) {
      if (top.includes(s)) continue;
      const cnt = perCounter.get(s.counterRosterId) ?? 0;
      if (cnt >= perCounterCap) continue;
      top.push(s);
      perCounter.set(s.counterRosterId, cnt + 1);
      if (top.length >= limit) break;
    }
  }
  const packages = top.map((s) => {
    const counter = others.find((p) => p.rosterId === s.counterRosterId);
    return {
      counterTeam: counter?.ownerName ?? "?",
      counterRosterId: s.counterRosterId,
      give: s.give.map(toWire),
      receive: s.receive.map(toWire),
      valueGive: s.valueGive,
      valueReceive: s.valueReceive,
      archetype: s.archetype,
      fairness: fairnessLabel(s.adjGive, s.adjReceive),
      scores: {
        total: s.total,
        myFit: s.myFit,
        theirFit: s.theirFit,
        balance: s.balance,
        archMatch: s.archMatch
      }
    };
  });
  const diagnostics = {
    rawCandidates: rawCandidates.length,
    afterDedup: unique.length,
    rejected,
    forced: !!forced,
    ...degraded ? { degraded } : {},
    ...forced ? { myArchetypeScore: forcedArchetypeScore(mine, forced) } : {},
    ...target ? { counterNote: buildCounterNote(target, forced) } : {}
  };
  return { packages, diagnostics };
}

// api/trades/find.ts
var MODEL_HAIKU = "claude-haiku-4-5-20251001";
var PROMPT_VERSION = 2;
function rationaleHash(pkg, myProfile, counterProfile) {
  const key = JSON.stringify({
    promptVersion: PROMPT_VERSION,
    give: pkg.give.map((a) => a.id).sort(),
    receive: pkg.receive.map((a) => a.id).sort(),
    archetype: pkg.archetype,
    myWindow: myProfile.windowLabel,
    theirWindow: counterProfile?.windowLabel ?? null,
    fairness: pkg.fairness
  });
  return (0, import_crypto.createHash)("sha256").update(key).digest("hex");
}
function describeAsset(a) {
  if (a.kind !== "player") return a.name;
  return a.age != null ? `${a.name} (${a.position}, age ${a.age.toFixed(1)})` : `${a.name} (${a.position})`;
}
function sanitizeRationale(text) {
  return text.replace(/^#{1,6}[^\n]*$/gm, "").replace(/\*\*/g, "").replace(/\s*[—–]\s*/g, ", ").trim();
}
async function generateRationale(pkg, myProfile, counterProfile) {
  const giveNames = pkg.give.map(describeAsset).join(", ");
  const receiveNames = pkg.receive.map(describeAsset).join(", ");
  const archetypeLabel = pkg.archetype.replace(/_/g, " ");
  const fairnessNote = pkg.fairness === "FAIR" ? "The value is even." : `On raw value this is a ${fairnessText(pkg.fairness).toLowerCase()} for this team. Acknowledge that lean and why the deal can still make sense (or what it costs).`;
  const counterNote = counterProfile ? `${pkg.counterTeam} profiles as ${counterProfile.windowLabel} (${counterProfile.competitiveness}, ${counterProfile.windowTier} window).` : "";
  const prompt = `You are analyzing a dynasty fantasy football trade for a team classified as ${myProfile.windowLabel} (${myProfile.competitiveness} competitiveness, ${myProfile.windowTier} window).

Trade: Send ${giveNames} and receive ${receiveNames} from ${pkg.counterTeam}. ${counterNote}
Trade type: ${archetypeLabel}. ${fairnessNote}

Write 3-4 sentences explaining why this trade makes sense for this team right now, and end with one sentence on why ${pkg.counterTeam} says yes given their situation (a trade nobody accepts is worthless). Be specific about the players, picks, and both teams' timelines. Plain prose only: no markdown, no headings, no bullet points, no em dashes.

Use only the facts given above. Ages are stated where they matter: cite them only as given, and never estimate one that is not listed. Do not invent stats, injuries, contracts, team situations, or draft capital that does not appear in this prompt. If you are unsure of a detail, argue from the roster timelines instead of guessing.`;
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
async function addRationale(pkg, myProfile, counterProfile) {
  const hash = rationaleHash(pkg, myProfile, counterProfile);
  const cacheRef = adminDb.collection("rationaleCache").doc(hash);
  const cached = await cacheRef.get();
  if (cached.exists) {
    return { ...pkg, rationale: sanitizeRationale(cached.data()?.["rationale"]) };
  }
  const rationale = sanitizeRationale(await generateRationale(pkg, myProfile, counterProfile));
  await cacheRef.set({ hash, rationale, archetype: pkg.archetype, generatedAt: (/* @__PURE__ */ new Date()).toISOString() });
  return { ...pkg, rationale };
}
async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const user = await requireApprovedUser(req, res);
  if (!user) return;
  const { leagueId, rosterId, archetype, position, targetRosterId, noFillerPicks } = req.body;
  if (!leagueId || rosterId == null) {
    return res.status(400).json({ error: "leagueId and rosterId required" });
  }
  if (archetype != null && !ARCHETYPE_FAMILIES.includes(archetype)) {
    return res.status(400).json({ error: `Unknown archetype: ${archetype}` });
  }
  if (position != null && !POSITIONS.includes(position)) {
    return res.status(400).json({ error: `Unknown position: ${position}` });
  }
  if (targetRosterId != null && Number(targetRosterId) === Number(rosterId)) {
    return res.status(400).json({ error: "Target team must differ from perspective team" });
  }
  try {
    const leagueRef = adminDb.collection("leagues").doc(leagueId);
    const [leagueSnap, profilesSnap] = await Promise.all([
      leagueRef.get(),
      leagueRef.collection("profiles").get()
    ]);
    const leagueData = leagueSnap.data();
    const members = leagueData?.["members"] ?? [];
    if (!await ensureLeagueAccess(user.uid, leagueRef, members)) {
      return res.status(403).json({ error: "Forbidden" });
    }
    const format = leagueData?.["format"];
    if (!format) return res.status(500).json({ error: "League format missing" });
    const profiles = profilesSnap.docs.map((d) => d.data());
    const myProfile = profiles.find((p) => p.rosterId === Number(rosterId));
    if (!myProfile) return res.status(404).json({ error: "Team not found" });
    if (targetRosterId != null && !profiles.some((p) => p.rosterId === Number(targetRosterId))) {
      return res.status(400).json({ error: "Target team not found in league" });
    }
    const thisYear = leagueData?.["upcomingDraftYear"] ?? (/* @__PURE__ */ new Date()).getFullYear();
    const valueMaps = await getValueMaps(format);
    const { packages, diagnostics } = generatePackages(myProfile, profiles, format, thisYear, {
      limit: 5,
      pools: {
        dynastyByPos: valueMaps.dynastyByPos,
        redraftByPos: valueMaps.redraftByPos
      },
      ...archetype ? {
        forceArchetype: {
          family: archetype,
          ...position ? { position } : {}
        }
      } : {},
      ...targetRosterId != null ? { targetRosterId: Number(targetRosterId) } : {},
      ...noFillerPicks === true ? { noFillerPicks: true } : {}
    });
    const withRationales = await Promise.all(
      packages.map(
        (pkg) => addRationale(pkg, myProfile, profiles.find((p) => p.rosterId === pkg.counterRosterId))
      )
    );
    return res.status(200).json({ packages: withRationales, diagnostics });
  } catch (err) {
    console.error("trades/find error", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
