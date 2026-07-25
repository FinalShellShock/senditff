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

// api/leagues/sync.ts
var sync_exports = {};
__export(sync_exports, {
  default: () => handler
});
module.exports = __toCommonJS(sync_exports);

// src/algo/constants.ts
var POSITIONS = ["QB", "RB", "WR", "TE"];
var REMAINING_VALUE = {
  QB: { 23: 56.1, 24: 56.1, 25: 56.1, 26: 56.1, 27: 56.1, 28: 56.1, 29: 55.8, 30: 55.8, 31: 51.2, 32: 47.4, 33: 47.4, 34: 42.8, 35: 42.8, 36: 42.4, 37: 38, 38: 29.6 },
  RB: { 23: 40.7, 24: 38.6, 25: 37.3, 26: 34.3, 27: 31.7, 28: 29, 29: 25, 30: 24.1, 31: 21.8, 32: 17.5, 33: 15 },
  WR: { 23: 45.1, 24: 44.3, 25: 38.7, 26: 37.7, 27: 35.3, 28: 34.6, 29: 34.6, 30: 31.1, 31: 30.3, 32: 25.9, 33: 24.5, 34: 23.6, 35: 23.6, 36: 13.6 },
  TE: { 23: 35.5, 24: 33.9, 25: 30.4, 26: 29.9, 27: 26.6, 28: 25.1, 29: 23.7, 30: 21.4, 31: 21.4, 32: 21.4, 33: 21.4 }
};
var PRESSURE_REFERENCE_AGE = 23;
var DEPTH_COVER_SLOTS = 1;
var DEPTH_RESILIENCE_WEIGHT = 0.5;
var DEPTH_RESILIENCE_CREDIT = 1;
var PICK_DECAY = {
  0: 1,
  1: 0.85,
  2: 0.7,
  3: 0.55
};
var TEP_MULTIPLIER = 1.15;
var PICK_ADJUSTMENT_BY_FLAG = {
  PICK_RICH: -8,
  NEUTRAL: 0,
  PICK_POOR: 12
};
var FLEX_CONSOLIDATE_THRESHOLD = 55;
var STD_THRESHOLD = 0.5;
var WINDOW_LONG_THRESHOLD = 14;
var WINDOW_SHORT_THRESHOLD = 19;
var COMPETITIVENESS_GRID = {
  STRONG: { LONG: "JUGGERNAUT", MID: "CONTEND", SHORT: "CLOSING" },
  AVERAGE: { LONG: "RISING", MID: "AVERAGE", SHORT: "MIDDLING" },
  WEAK: { LONG: "REBUILD", MID: "TRANSITION", SHORT: "STUCK" }
};

// src/algo/archetypes.ts
var ARCHETYPE_THRESHOLD = 50;
function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}
function scoreArchetypes(team, averages) {
  const s = {};
  for (const pos of POSITIONS) {
    const ps = team.positionScores[pos];
    const avgS = averages.starter[pos] || 1;
    const avgD = averages.depth[pos] || 1;
    const eliteFactor = clamp((ps.starterValue / avgS - 1) / 0.4, 0, 1);
    const thinFactor = clamp(1 - ps.depthValue / avgD / 0.6, 0, 1);
    s[`tier_down_${pos}`] = Math.round(eliteFactor * thinFactor * 100);
  }
  for (const pos of POSITIONS) {
    const ps = team.positionScores[pos];
    const midFactor = clamp(1 - Math.abs(ps.starterScore - 52.5) / 12.5, 0, 1);
    const depthFactor = clamp((ps.depthScore - 40) / 15, 0, 1);
    const otherUrgency = POSITIONS.filter((p) => p !== pos).reduce((max, p) => Math.max(max, team.positionScores[p].urgency), 0);
    const needFactor = clamp((otherUrgency - 40) / 60, 0, 1);
    s[`consolidate_${pos}`] = Math.round(midFactor * depthFactor * needFactor * 100);
  }
  const maxUrgency = POSITIONS.reduce((max, p) => Math.max(max, team.positionScores[p].urgency), 0);
  const flexFactor = clamp((team.flex.score - 40) / (FLEX_CONSOLIDATE_THRESHOLD - 40), 0, 1);
  s["consolidate_flex"] = Math.round(flexFactor * clamp(maxUrgency / 70, 0, 1) * 100);
  const longFactor = clamp(1 - team.windowPressure / WINDOW_SHORT_THRESHOLD, 0, 1);
  const richFactor = clamp((team.pickCapital.score - 50) / 50, 0, 1);
  s["age_arb_buy"] = Math.round(longFactor * richFactor * 100);
  const shortFactor = clamp(
    (team.windowPressure - WINDOW_LONG_THRESHOLD) / (WINDOW_SHORT_THRESHOLD - WINDOW_LONG_THRESHOLD),
    0,
    1
  );
  const notWeakFactor = team.competitiveness === "STRONG" ? 1 : team.competitiveness === "AVERAGE" ? 0.6 : 0.1;
  s["age_arb_sell"] = Math.round(shortFactor * notWeakFactor * 100);
  const strongFactor = team.competitiveness === "STRONG" ? 1 : team.competitiveness === "AVERAGE" ? 0.3 : 0;
  const pushInFactor = clamp((team.windowPressure - WINDOW_SHORT_THRESHOLD) / (WINDOW_SHORT_THRESHOLD * 0.5), 0, 1);
  s["push_in"] = Math.round(pushInFactor * strongFactor * 100);
  const minUrgency = POSITIONS.reduce((min, p) => Math.min(min, team.positionScores[p].urgency), 100);
  const spread = maxUrgency - minUrgency;
  const urgencyFactor = clamp((maxUrgency - 40) / 60, 0, 1);
  const surplusFactor = clamp(spread / 50, 0, 1);
  s["need_fill"] = Math.round((urgencyFactor * 0.6 + surplusFactor * 0.4) * 100);
  const contenderFactor = team.competitiveness === "STRONG" ? 1 : team.competitiveness === "AVERAGE" ? 0.4 : 0.1;
  const poorFactor = clamp((50 - team.pickCapital.score) / 50, 0, 1);
  s["capital_convert_picks_to_production"] = Math.round(contenderFactor * poorFactor * 100);
  const rebuilderFactor = team.competitiveness === "WEAK" ? 1 : team.competitiveness === "AVERAGE" ? 0.4 : 0.1;
  s["capital_convert_production_to_picks"] = Math.round(rebuilderFactor * richFactor * 100);
  return s;
}
function detectArchetypes(team, averages, _format) {
  const scores = scoreArchetypes(team, averages);
  return Object.entries(scores).filter(([, score]) => score >= ARCHETYPE_THRESHOLD).map(([key]) => key);
}

// src/algo/profile.ts
var REDRAFT = (p) => p.valueRedraft;
var DYNASTY = (p) => p.valueDynasty;
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
function postInjuryValues(starters, depth) {
  const promoted = [...starters.slice(1), ...depth].slice(0, starters.length);
  return Array.from({ length: starters.length }, (_, i) => promoted[i]?.valueRedraft ?? 0);
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
function fromAgeTable(age, table) {
  const ages = Object.keys(table).map(Number).sort((a, b) => a - b);
  const lo = ages[0], hi = ages[ages.length - 1];
  if (age <= lo) return table[lo];
  if (age >= hi) return table[hi];
  const upper = ages.find((a) => a >= age);
  const lower = ages[ages.indexOf(upper) - 1];
  return interp(age, lower, upper, table[lower], table[upper]);
}
function remainingValue(age, pos) {
  return fromAgeTable(age, REMAINING_VALUE[pos]);
}
function agePressure(age, pos) {
  const reference = REMAINING_VALUE[pos][PRESSURE_REFERENCE_AGE];
  if (!reference) return 0;
  const pressure = 100 * (1 - remainingValue(age, pos) / reference);
  return Math.max(0, Math.min(100, pressure));
}
function effectiveAge(p) {
  const age = p.age;
  if (age == null) return 0;
  const signal = p.agingSignal;
  if (signal == null || signal >= 1) return age;
  const ramp = Math.max(0, Math.min(1, (age - 26) / 4));
  if (ramp <= 0) return age;
  const applied = 1 - (1 - signal) * ramp;
  const target = remainingValue(age, p.position) * applied;
  const table = REMAINING_VALUE[p.position];
  const ages = Object.keys(table).map(Number).sort((a, b) => a - b);
  for (let i = 0; i < ages.length; i++) {
    const a = ages[i];
    if (table[a] <= target) {
      if (i === 0) return Math.max(age, a);
      const prev = ages[i - 1];
      const span = table[prev] - table[a];
      const t = span > 0 ? (table[prev] - target) / span : 0;
      return Math.max(age, prev + t * (a - prev));
    }
  }
  return Math.max(age, ages[ages.length - 1]);
}
function starterAgePressure(players, format) {
  const { starters } = fillStarters(players, format, REDRAFT);
  let totalNum = 0;
  let totalDen = 0;
  for (const pos of POSITIONS) {
    for (const p of starters[pos]) {
      if (p.age == null) continue;
      const pressure = agePressure(effectiveAge(p), p.position);
      totalNum += pressure * p.valueRedraft;
      totalDen += p.valueRedraft;
    }
  }
  return totalDen > 0 ? totalNum / totalDen : 50;
}
function starterCalendarAge(players, format) {
  const { starters } = fillStarters(players, format, REDRAFT);
  let totalNum = 0;
  let totalDen = 0;
  for (const pos of POSITIONS) {
    for (const p of starters[pos]) {
      if (p.age == null) continue;
      totalNum += p.age * p.valueRedraft;
      totalDen += p.valueRedraft;
    }
  }
  return totalDen > 0 ? totalNum / totalDen : 25;
}
function pickCapital(picks, thisYear) {
  let total = 0;
  for (const p of picks) {
    const yearsOut = p.year - thisYear;
    const decay = PICK_DECAY[yearsOut] ?? 0;
    total += p.value * decay;
  }
  return total;
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
function classifySide(args) {
  const { weightedZ, minSlotZ, weightedValue, minSlotValue, worstTopN } = args;
  const criticalFloor = worstTopN * 0.15;
  const needFloor = worstTopN * 0.35;
  if (minSlotZ < -2 || weightedZ < -2 || minSlotValue < criticalFloor) {
    return "CRITICAL";
  }
  if (minSlotZ < -1 || weightedZ < -1 || minSlotValue < needFloor) {
    return "NEED";
  }
  if (weightedZ > 0.75 && minSlotZ > 0) {
    return "SURPLUS";
  }
  return "HEALTHY";
}
function combineClassifications(args) {
  const { starterSub, depthSub, pressure } = args;
  const sIsBad = starterSub === "CRITICAL" || starterSub === "NEED";
  const dIsBad = depthSub === "CRITICAL" || depthSub === "NEED";
  if (starterSub === "SURPLUS" && dIsBad) {
    return depthSub === "CRITICAL" ? { classification: "NEED", needKind: "depth" } : { classification: "HEALTHY", needKind: null };
  }
  if (starterSub === "CRITICAL" || depthSub === "CRITICAL") {
    return {
      classification: "CRITICAL_NEED",
      needKind: sIsBad && dIsBad ? "both" : starterSub === "CRITICAL" ? "starter" : "depth"
    };
  }
  if (sIsBad && dIsBad) {
    return { classification: "NEED", needKind: "both" };
  }
  if (sIsBad) {
    return { classification: "NEED", needKind: "starter" };
  }
  if (dIsBad) {
    return { classification: "NEED", needKind: "depth" };
  }
  if (starterSub === "SURPLUS" && depthSub === "SURPLUS" && pressure < 50) {
    return { classification: "SURPLUS", needKind: null };
  }
  return { classification: "HEALTHY", needKind: null };
}
function positionImportance(pos, format) {
  if (pos === "QB") return format.superflex ? 1 : 0.7;
  if (pos === "TE") return format.tep ? 1 : 0.7;
  if (pos === "RB") return 0.95;
  return 1;
}
function applyTep(players, format) {
  if (!format.tep) return players;
  return players.map(
    (p) => p.position === "TE" ? {
      ...p,
      valueRedraft: p.valueRedraft * TEP_MULTIPLIER,
      valueDynasty: p.valueDynasty * TEP_MULTIPLIER
    } : p
  );
}
function computePositionScores(team, format, averages) {
  const { starters } = fillStarters(team.players, format);
  const depth = depthByPosition(team.players, format, DYNASTY);
  const out = {};
  const compFactor = { STRONG: 90, AVERAGE: 60, WEAK: 30 };
  const windowFactor = { SHORT: 90, MID: 60, LONG: 30 };
  const pressure = (compFactor[team.competitiveness] + windowFactor[team.windowTier]) / 2;
  for (const pos of POSITIONS) {
    const starterValue = starters[pos].reduce((s, p) => s + p.valueRedraft, 0);
    const depthValue = depth[pos].reduce((s, p) => s + p.valueDynasty, 0);
    const starterPlayerScores = starters[pos].map(
      (p) => positionScoreFromPool(p.valueRedraft, averages.starterPlayerPool[pos], averages.startersInUse[pos])
    );
    const depthPlayerScores = depth[pos].map(
      (p) => positionScoreFromPool(p.valueDynasty, averages.depthPlayerPool[pos], averages.depthSlotsTotal[pos])
    );
    const starterScore = weightedSlotAverage(starterPlayerScores);
    const minStarterSlotScore = starterPlayerScores.length > 0 ? Math.min(...starterPlayerScores) : 0;
    const postInjuryRedraft = postInjuryValues(starters[pos], depth[pos]);
    const hasLineup = starters[pos].length > 0;
    const postInjuryTotal = postInjuryRedraft.reduce((s, v) => s + v, 0);
    const rStats = averages.resilienceStats[pos];
    const resilienceScore = hasLineup && rStats.mean > 0 ? Math.max(0, Math.min(100, 50 + (postInjuryTotal - rStats.mean) / rStats.mean * 50)) : 0;
    const isolatedDepthScore = weightedSlotAverage(depthPlayerScores);
    const depthScore = isolatedDepthScore * (1 - DEPTH_RESILIENCE_WEIGHT) + resilienceScore * DEPTH_RESILIENCE_WEIGHT;
    const depthSlots = depthSlotsFor(pos, format);
    const baseDepthWeight = 0.15;
    const baseStarterWeight = 0.5;
    const depthWeight = baseDepthWeight * (depthSlots / 3);
    const starterWeight = baseStarterWeight + (baseDepthWeight - depthWeight);
    const starterGap = Math.max(0, 100 - starterScore);
    const depthGap = Math.max(0, 100 - depthScore);
    const gapUrgency = starterGap * starterWeight + depthGap * depthWeight;
    const pressureMult = 0.6 + pressure / 100 * 0.6;
    const importance = positionImportance(pos, format);
    const urgency = gapUrgency * pressureMult * importance;
    const sStats = averages.starterStats[pos];
    const dStats = averages.depthStats[pos];
    const sortedStarterPool = [...averages.starterPlayerPool[pos]].sort((a, b) => b - a);
    const sortedDepthPool = [...averages.depthPlayerPool[pos]].sort((a, b) => b - a);
    const sWorstTopN = sortedStarterPool[Math.max(0, averages.startersInUse[pos] - 1)] ?? 1;
    const dWorstTopN = sortedDepthPool[Math.max(0, averages.depthSlotsTotal[pos] - 1)] ?? 1;
    const starterPlayerZs = starters[pos].map((p) => (p.valueRedraft - sStats.mean) / sStats.std);
    const depthPlayerZs = depth[pos].map((p) => (p.valueDynasty - dStats.mean) / dStats.std);
    const starterWeightedZ = starterPlayerZs.length > 0 ? weightedSlotAverage(starterPlayerZs) : -3;
    const minStarterZ = starterPlayerZs.length > 0 ? Math.min(...starterPlayerZs) : -3;
    const depthWeightedZ = depthPlayerZs.length > 0 ? weightedSlotAverage(depthPlayerZs) : -3;
    const minDepthZ = depthPlayerZs.length > 0 ? Math.min(...depthPlayerZs) : -3;
    const starterValues = starters[pos].map((p) => p.valueRedraft);
    const depthValues = depth[pos].map((p) => p.valueDynasty);
    const depthMinValue = depthValues.length > 0 ? Math.min(...depthValues) : 0;
    const baseSlotCount = pos === "QB" && format.starterSlots.SUPER_FLEX > 0 ? format.starterSlots.QB + 1 : format.starterSlots[pos];
    const baseZs = starterPlayerZs.slice(0, baseSlotCount);
    const baseValues = starterValues.slice(0, baseSlotCount);
    const starterSub = classifySide({
      weightedZ: baseZs.length > 0 ? weightedSlotAverage(baseZs) : -3,
      minSlotZ: baseZs.length > 0 ? Math.min(...baseZs) : -3,
      weightedValue: baseValues.reduce((s, v) => s + v, 0),
      minSlotValue: baseValues.length > 0 ? Math.min(...baseValues) : 0,
      worstTopN: sWorstTopN
    });
    const resilienceZ = hasLineup && rStats.std > 0 ? (postInjuryTotal - rStats.mean) / rStats.std : -3;
    const resilienceCredit = Math.max(0, Math.min(1, resilienceZ)) * DEPTH_RESILIENCE_CREDIT;
    const coverZs = depthPlayerZs.slice(0, DEPTH_COVER_SLOTS);
    const coverValues = depthValues.slice(0, DEPTH_COVER_SLOTS);
    const depthSub = classifySide({
      weightedZ: (coverZs.length > 0 ? weightedSlotAverage(coverZs) : -3) + resilienceCredit,
      minSlotZ: (coverZs.length > 0 ? Math.min(...coverZs) : -3) + resilienceCredit,
      weightedValue: depthValue,
      minSlotValue: coverValues.length > 0 ? Math.min(...coverValues) : 0,
      worstTopN: dWorstTopN
    });
    const { classification, needKind } = combineClassifications({
      starterSub,
      depthSub,
      pressure
    });
    out[pos] = {
      starterValue,
      starterScore,
      minStarterSlotScore,
      depthValue,
      depthScore,
      urgency,
      starterClassification: starterSub,
      depthClassification: depthSub,
      classification,
      needKind
    };
  }
  return out;
}
function computeAllProfiles(teams, format, thisYear, globalPlayerPools) {
  const stage1 = teams.map((t) => {
    const playersAdj = applyTep(t.players, format);
    const { starters } = fillStarters(playersAdj, format);
    const depth = depthByPosition(playersAdj, format, DYNASTY);
    const starterTotalValue = POSITIONS.reduce(
      (s, pos) => s + starters[pos].reduce((a, p) => a + p.valueRedraft, 0),
      0
    );
    const flexValue = flexStrengthValue(playersAdj, format, starterTotalValue);
    return {
      ...t,
      players: playersAdj,
      starterTotalValue,
      starterAgePressure: starterAgePressure(playersAdj, format),
      starterCalAge: starterCalendarAge(playersAdj, format),
      pickCapValue: pickCapital(t.picks, thisYear),
      flexValue,
      starters,
      depth
    };
  });
  const sortedByStarter = [...stage1].sort((a, b) => {
    if (b.starterTotalValue !== a.starterTotalValue) return b.starterTotalValue - a.starterTotalValue;
    return a.rosterId - b.rosterId;
  });
  const starterRank = /* @__PURE__ */ new Map();
  sortedByStarter.forEach((t, i) => starterRank.set(t.rosterId, i + 1));
  const starterTotals = stage1.map((t) => t.starterTotalValue);
  const meanStarter = starterTotals.reduce((s, v) => s + v, 0) / starterTotals.length;
  const stdStarter = Math.sqrt(
    starterTotals.reduce((s, v) => s + (v - meanStarter) ** 2, 0) / starterTotals.length
  );
  const compFor = (totalValue) => {
    if (totalValue > meanStarter + STD_THRESHOLD * stdStarter) return "STRONG";
    if (totalValue < meanStarter - STD_THRESHOLD * stdStarter) return "WEAK";
    return "AVERAGE";
  };
  const caps = stage1.map((t) => t.pickCapValue);
  const meanCap = caps.reduce((s, v) => s + v, 0) / caps.length;
  const stdCap = Math.sqrt(
    caps.reduce((s, v) => s + (v - meanCap) ** 2, 0) / caps.length
  );
  const pickFlagFor = (cap) => {
    if (cap > meanCap + 1.5 * stdCap) return "PICK_RICH";
    if (cap < meanCap - 1.5 * stdCap) return "PICK_POOR";
    return "NEUTRAL";
  };
  const stage2 = stage1.map((t) => {
    const pickFlag = pickFlagFor(t.pickCapValue);
    const windowPressure = Math.max(0, t.starterAgePressure + PICK_ADJUSTMENT_BY_FLAG[pickFlag]);
    return {
      ...t,
      competitiveness: compFor(t.starterTotalValue),
      windowPressure,
      pickFlag
    };
  });
  const sortedByPressure = [...stage2].sort((a, b) => {
    if (a.windowPressure !== b.windowPressure) return a.windowPressure - b.windowPressure;
    return a.rosterId - b.rosterId;
  });
  const windowRank = /* @__PURE__ */ new Map();
  sortedByPressure.forEach((t, i) => windowRank.set(t.rosterId, i + 1));
  const windowTierFor = (pressure) => {
    if (pressure < WINDOW_LONG_THRESHOLD) return "LONG";
    if (pressure > WINDOW_SHORT_THRESHOLD) return "SHORT";
    return "MID";
  };
  const starterPool = { QB: [], RB: [], WR: [], TE: [] };
  const depthPool = { QB: [], RB: [], WR: [], TE: [] };
  const resiliencePool = { QB: [], RB: [], WR: [], TE: [] };
  const startersInUse = { QB: 0, RB: 0, WR: 0, TE: 0 };
  const depthSlotsTotal = { QB: 0, RB: 0, WR: 0, TE: 0 };
  const starterPlayerPool = globalPlayerPools ? { ...globalPlayerPools.redraftByPos } : { QB: [], RB: [], WR: [], TE: [] };
  const depthPlayerPool = globalPlayerPools ? { ...globalPlayerPools.dynastyByPos } : { QB: [], RB: [], WR: [], TE: [] };
  let avgFlex = 0;
  for (const t of stage2) {
    for (const pos of POSITIONS) {
      starterPool[pos].push(t.starters[pos].reduce((s, p) => s + p.valueRedraft, 0));
      depthPool[pos].push(t.depth[pos].reduce((s, p) => s + p.valueDynasty, 0));
      startersInUse[pos] += t.starters[pos].length;
      resiliencePool[pos].push(
        postInjuryValues(t.starters[pos], t.depth[pos]).reduce((s, v) => s + v, 0)
      );
    }
    if (!globalPlayerPools) {
      for (const p of t.players) {
        starterPlayerPool[p.position].push(p.valueRedraft);
        depthPlayerPool[p.position].push(p.valueDynasty);
      }
    }
    avgFlex += t.flexValue;
  }
  for (const pos of POSITIONS) {
    depthSlotsTotal[pos] = stage2.length * depthSlotsFor(pos, format);
  }
  const starterStats = {};
  const depthStats = {};
  const resilienceStats = {};
  for (const pos of POSITIONS) {
    starterStats[pos] = topNStats(starterPlayerPool[pos], startersInUse[pos]);
    depthStats[pos] = topNStats(depthPlayerPool[pos], depthSlotsTotal[pos]);
    resilienceStats[pos] = topNStats(resiliencePool[pos], resiliencePool[pos].length);
  }
  const avgStarter = { QB: 0, RB: 0, WR: 0, TE: 0 };
  const avgDepth = { QB: 0, RB: 0, WR: 0, TE: 0 };
  for (const pos of POSITIONS) {
    const sSum = starterPool[pos].reduce((s, v) => s + v, 0);
    const dSum = depthPool[pos].reduce((s, v) => s + v, 0);
    avgStarter[pos] = sSum / starterPool[pos].length;
    avgDepth[pos] = dSum / depthPool[pos].length;
  }
  avgFlex /= stage2.length;
  const averages = {
    starter: avgStarter,
    depth: avgDepth,
    flex: avgFlex,
    pickCapital: meanCap,
    pickCapitalStd: stdCap,
    starterPool,
    depthPool,
    starterPlayerPool,
    depthPlayerPool,
    starterStats,
    depthStats,
    startersInUse,
    depthSlotsTotal,
    resiliencePool,
    resilienceStats
  };
  return stage2.map((t) => {
    const tier = windowTierFor(t.windowPressure);
    const positionScores = computePositionScores(
      { players: t.players, competitiveness: t.competitiveness, windowTier: tier },
      format,
      averages
    );
    const profile = {
      rosterId: t.rosterId,
      ownerName: t.ownerName,
      isMine: t.isMine,
      record: t.record,
      players: t.players,
      picks: t.picks,
      starterTotalValue: t.starterTotalValue,
      starterRank: starterRank.get(t.rosterId),
      competitiveness: t.competitiveness,
      starterCalAge: t.starterCalAge,
      starterAgePressure: t.starterAgePressure,
      windowPressure: t.windowPressure,
      windowRank: windowRank.get(t.rosterId),
      windowTier: tier,
      windowLabel: COMPETITIVENESS_GRID[t.competitiveness][tier],
      positionScores,
      flex: {
        value: t.flexValue,
        score: score0to100(t.flexValue, averages.flex || 1)
      },
      pickCapital: {
        value: t.pickCapValue,
        score: score0to100(t.pickCapValue, averages.pickCapital || 1),
        flag: t.pickFlag
      },
      archetypes: [],
      archetypeScores: {}
    };
    profile.archetypes = detectArchetypes(profile, averages, format);
    profile.archetypeScores = scoreArchetypes(profile, averages);
    return profile;
  });
}

// src/data/format.ts
function detectFormat(league) {
  const slots = { QB: 0, RB: 0, WR: 0, TE: 0, FLEX: 0, SUPER_FLEX: 0 };
  const idpSlots = /* @__PURE__ */ new Set(["DL", "LB", "DB", "DEF", "IDP_FLEX", "DT", "DE", "CB", "S"]);
  let idp = false;
  for (const slot of league.roster_positions) {
    if (slot === "QB") slots.QB++;
    else if (slot === "RB") slots.RB++;
    else if (slot === "WR") slots.WR++;
    else if (slot === "TE") slots.TE++;
    else if (slot === "FLEX" || slot === "WRRB_FLEX" || slot === "WRRB_TE") slots.FLEX++;
    else if (slot === "SUPER_FLEX" || slot === "SUPER FLEX") slots.SUPER_FLEX++;
    else if (idpSlots.has(slot)) idp = true;
  }
  const superflex = slots.SUPER_FLEX > 0 || slots.QB >= 2;
  const rec = league.scoring_settings?.rec ?? 0;
  const scoring = rec >= 0.9 ? "ppr" : rec >= 0.4 ? "half" : "std";
  const tep = (league.scoring_settings?.bonus_rec_te ?? 0) > 0;
  return {
    superflex,
    scoring,
    tep,
    idp,
    starterSlots: slots,
    teamCount: league.total_rosters
  };
}

// src/data/sleeper.ts
var SLEEPER = "https://api.sleeper.app/v1";
async function fetchLeague(leagueId) {
  const [lR, uR, rR, pR, dR] = await Promise.all([
    fetch(`${SLEEPER}/league/${leagueId}`),
    fetch(`${SLEEPER}/league/${leagueId}/users`),
    fetch(`${SLEEPER}/league/${leagueId}/rosters`),
    fetch(`${SLEEPER}/league/${leagueId}/traded_picks`),
    fetch(`${SLEEPER}/league/${leagueId}/drafts`)
  ]);
  if (!lR.ok) throw new Error(`Sleeper league fetch failed: HTTP ${lR.status}`);
  if (!uR.ok) throw new Error(`Sleeper users fetch failed: HTTP ${uR.status}`);
  if (!rR.ok) throw new Error(`Sleeper rosters fetch failed: HTTP ${rR.status}`);
  if (!pR.ok) {
    console.warn(`Sleeper traded_picks failed for ${leagueId}: HTTP ${pR.status} - all picks will appear untraded`);
  }
  return {
    league: await lR.json(),
    users: await uR.json(),
    rosters: await rR.json(),
    tradedPicks: pR.ok ? await pR.json() : [],
    drafts: dR.ok ? await dR.json() : []
  };
}
async function fetchLeagueOnly(leagueId) {
  const r = await fetch(`${SLEEPER}/league/${leagueId}`);
  if (!r.ok) throw new Error(`Sleeper league fetch failed: HTTP ${r.status}`);
  return await r.json();
}
async function fetchLeagueUsersRosters(leagueId) {
  const [uR, rR] = await Promise.all([
    fetch(`${SLEEPER}/league/${leagueId}/users`),
    fetch(`${SLEEPER}/league/${leagueId}/rosters`)
  ]);
  if (!uR.ok) throw new Error(`Sleeper users fetch failed: HTTP ${uR.status}`);
  if (!rR.ok) throw new Error(`Sleeper rosters fetch failed: HTTP ${rR.status}`);
  return {
    users: await uR.json(),
    rosters: await rR.json()
  };
}
async function fetchPlayers() {
  const r = await fetch(`${SLEEPER}/players/nfl`);
  if (!r.ok) throw new Error(`Sleeper players fetch failed: HTTP ${r.status}`);
  return await r.json();
}
async function fetchNflState() {
  const r = await fetch(`${SLEEPER}/state/nfl`);
  if (!r.ok) throw new Error(`Sleeper NFL state fetch failed: HTTP ${r.status}`);
  return await r.json();
}

// src/data/normalize.ts
function normName(name) {
  if (!name) return "";
  return name.toLowerCase().replace(/[^a-z0-9]/g, "").replace(/(jr|sr|ii|iii|iv|v)$/, "");
}

// src/data/picks.ts
function buildPicksMap(rosters, tradedPicks, draftYears, draftRounds) {
  const rounds = Array.from({ length: draftRounds }, (_, i) => i + 1);
  const map = /* @__PURE__ */ new Map();
  for (const r of rosters) {
    const set = /* @__PURE__ */ new Set();
    for (const y of draftYears) for (const rd of rounds) set.add(`${y}|${rd}|${r.roster_id}`);
    map.set(r.roster_id, set);
  }
  for (const pk of tradedPicks) {
    const y = parseInt(pk.season, 10);
    if (!draftYears.includes(y)) continue;
    if (!rounds.includes(pk.round)) continue;
    const origKey = `${y}|${pk.round}|${pk.roster_id}`;
    for (const set of map.values()) set.delete(origKey);
    const newOwner = map.get(pk.owner_id);
    if (newOwner) newOwner.add(origKey);
  }
  return map;
}
var ROUND_LABELS = ["1st", "2nd", "3rd", "4th", "5th", "6th", "7th"];
var curveCache = /* @__PURE__ */ new WeakMap();
function slotCurves(dynastyValues) {
  const cached = curveCache.get(dynastyValues);
  if (cached) return cached;
  const byYearRound = /* @__PURE__ */ new Map();
  for (const [key, entry] of dynastyValues) {
    const m = /^(\d{4})pick(\d)(\d{2})$/.exec(key);
    if (!m) continue;
    const yearRound = `${m[1]}|${m[2]}`;
    const slots = byYearRound.get(yearRound) ?? /* @__PURE__ */ new Map();
    slots.set(parseInt(m[3], 10), entry.value);
    byYearRound.set(yearRound, slots);
  }
  const curves = /* @__PURE__ */ new Map();
  const chosenSize = /* @__PURE__ */ new Map();
  for (const [yearRound, slots] of byYearRound) {
    const round = parseInt(yearRound.split("|")[1], 10);
    if (slots.size < 3) continue;
    if (slots.size <= (chosenSize.get(round) ?? 0)) continue;
    chosenSize.set(round, slots.size);
    const mean = [...slots.values()].reduce((s, v) => s + v, 0) / slots.size;
    curves.set(round, { slots, mean });
  }
  curveCache.set(dynastyValues, curves);
  return curves;
}
function tierMultiplier(dynastyValues, round, tier) {
  const curve = slotCurves(dynastyValues).get(round);
  if (!curve || curve.mean <= 0) return 1;
  const slotNums = [...curve.slots.keys()].sort((a, b) => a - b);
  const third = Math.ceil(slotNums.length / 3);
  const bucket = tier === "early" ? slotNums.slice(0, third) : tier === "mid" ? slotNums.slice(third, 2 * third) : slotNums.slice(2 * third);
  if (bucket.length === 0) return 1;
  const bucketMean = bucket.reduce((s, n) => s + (curve.slots.get(n) ?? 0), 0) / bucket.length;
  return bucketMean / curve.mean;
}
var TIER_CONVICTION_DECAY = 0.65;
function resolvePickValue(dynastyValues, teamCount, year, round, slotOrTier, yearsOut = 0) {
  if (typeof slotOrTier === "number") {
    const exact = dynastyValues.get(
      normName(`${year} Pick ${round}.${String(slotOrTier).padStart(2, "0")}`)
    );
    if (exact) return exact.value;
  }
  const tier = typeof slotOrTier === "number" ? slotToTier(slotOrTier, teamCount) : slotOrTier;
  const label = ROUND_LABELS[round - 1];
  const generic = label ? dynastyValues.get(normName(`${year} ${label}`))?.value : void 0;
  if (generic) {
    const tierMult = tierMultiplier(dynastyValues, round, tier);
    const midMult = tierMultiplier(dynastyValues, round, "mid");
    const conviction = yearsOut <= 0 ? 1 : Math.pow(TIER_CONVICTION_DECAY, yearsOut);
    const effMult = midMult + (tierMult - midMult) * conviction;
    return Math.round(generic * effMult);
  }
  if (round === 1) return tier === "early" ? 2500 : tier === "mid" ? 2e3 : 1500;
  return round === 2 ? 900 : round === 3 ? 450 : 200;
}
function slotToTier(slot, teamCount) {
  const third = Math.ceil(teamCount / 3);
  return slot <= third ? "early" : slot <= 2 * third ? "mid" : "late";
}
function findUpcomingDraft(drafts, rosters) {
  const upcoming = drafts.filter((d) => d.status !== "complete").sort((a, b) => parseInt(a.season, 10) - parseInt(b.season, 10))[0];
  if (!upcoming) return null;
  const season = parseInt(upcoming.season, 10);
  if (!Number.isFinite(season)) return null;
  const slotByRoster = /* @__PURE__ */ new Map();
  const s2r = upcoming.slot_to_roster_id;
  if (s2r && Object.keys(s2r).length > 0) {
    for (const [slotStr, rosterId] of Object.entries(s2r)) {
      const slot = parseInt(slotStr, 10);
      if (Number.isFinite(slot) && typeof rosterId === "number") {
        slotByRoster.set(rosterId, slot);
      }
    }
  } else if (upcoming.draft_order) {
    const rosterByOwner = /* @__PURE__ */ new Map();
    for (const r of rosters) {
      if (r.owner_id) rosterByOwner.set(r.owner_id, r.roster_id);
    }
    for (const [userId, slot] of Object.entries(upcoming.draft_order)) {
      const rosterId = rosterByOwner.get(userId);
      if (rosterId !== void 0 && Number.isFinite(slot)) {
        slotByRoster.set(rosterId, slot);
      }
    }
  }
  return {
    season,
    slotByRoster,
    rounds: upcoming.settings?.rounds ?? 4
  };
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

// src/data/qbSignals.json
var qbSignals_default = { ryanfitzpatrick: 0.981, joshjohnson: 0.863, camnewton: 0.82, tyrodtaylor: 0.842, russellwilson: 0.956, genosmith: 0.972, marcusmariota: 0.899, dakprescott: 0.988, jacobybrissett: 0.918, taylorheinicke: 0.97, deshaunwatson: 0.925, mitchelltrubisky: 0.939, cjbeathard: 0.943, jeffdriskel: 0.873, joshuadobbs: 0.82, lamarjackson: 0.82, joshallen: 0.841, samdarnold: 0.981, kylermurray: 0.863, drewlock: 0.947, danieljones: 0.87, tylerhuntley: 0.82, jalenhurts: 0.82, justinfields: 0.82, trevorlawrence: 0.942, zachwilson: 0.94, samhowell: 0.918, kennypickett: 0.943, desmondridder: 0.914, bryceyoung: 0.914, anthonyrichardson: 0.82, bonix: 0.944, drakemaye: 0.861, jaydendaniels: 0.82, calebwilliams: 0.961 };

// api/_lib/buildTeams.ts
var POSITIONS2 = ["QB", "RB", "WR", "TE"];
function calcAge(birthDate) {
  return (Date.now() - new Date(birthDate).getTime()) / (365.25 * 24 * 60 * 60 * 1e3);
}
function buildTeamInputs(params) {
  const {
    rosters,
    users,
    tradedPicks,
    drafts,
    league,
    sleeperPlayers,
    valueMaps,
    format,
    mySleeperUserId,
    thisYear
  } = params;
  const { dynastyValues, redraftValues } = valueMaps;
  const upcoming = findUpcomingDraft(drafts, rosters);
  const upcomingYear = upcoming?.season ?? thisYear;
  const upcomingSlots = upcoming?.slotByRoster ?? /* @__PURE__ */ new Map();
  const draftRounds = upcoming?.rounds ?? league.settings?.draft_rounds ?? 4;
  const draftYears = [upcomingYear, upcomingYear + 1, upcomingYear + 2];
  const picksMap = buildPicksMap(rosters, tradedPicks, draftYears, draftRounds);
  const teamCount = rosters.length;
  const rosterPlayers = /* @__PURE__ */ new Map();
  const rosterStarterTotal = /* @__PURE__ */ new Map();
  for (const r of rosters) {
    const players = (r.players ?? []).map((id) => {
      const sp = sleeperPlayers[id];
      if (!sp) return null;
      const fullName = sp.full_name ?? `${sp.first_name ?? ""} ${sp.last_name ?? ""}`.trim();
      const pos = sp.position;
      if (!pos || !POSITIONS2.includes(pos)) return null;
      const k = normName(fullName);
      const dyn = dynastyValues.get(k);
      const red = redraftValues.get(k);
      return {
        id,
        name: fullName,
        position: pos,
        team: sp.team ?? null,
        age: sp.birth_date ? calcAge(sp.birth_date) : dyn?.age ?? red?.age ?? sp.age ?? null,
        valueRedraft: red?.value ?? 0,
        valueDynasty: dyn?.value ?? 0,
        ...qbSignals_default[k] != null ? { agingSignal: qbSignals_default[k] } : {}
      };
    }).filter((p) => p !== null);
    rosterPlayers.set(r.roster_id, players);
    const adj = applyTep(players, format);
    const { starters } = fillStarters(adj, format);
    const starterTotal = POSITIONS2.reduce(
      (s, pos) => s + starters[pos].reduce((a, p) => a + p.valueRedraft, 0),
      0
    );
    rosterStarterTotal.set(r.roster_id, starterTotal);
  }
  const starterTotals = Array.from(rosterStarterTotal.values());
  const meanStarter = starterTotals.reduce((s, v) => s + v, 0) / starterTotals.length;
  const stdStarter = Math.sqrt(
    starterTotals.reduce((s, v) => s + (v - meanStarter) ** 2, 0) / starterTotals.length
  );
  const tierForRoster = (rosterId) => {
    const total = rosterStarterTotal.get(rosterId) ?? meanStarter;
    if (total > meanStarter + STD_THRESHOLD * stdStarter) return "late";
    if (total < meanStarter - STD_THRESHOLD * stdStarter) return "early";
    return "mid";
  };
  const slotRankByRoster = /* @__PURE__ */ new Map();
  [...rosters].sort(
    (a, b) => (rosterStarterTotal.get(a.roster_id) ?? 0) - (rosterStarterTotal.get(b.roster_id) ?? 0)
  ).forEach((r, i) => slotRankByRoster.set(r.roster_id, i + 1));
  return rosters.map((r) => {
    const user = users.find((u) => u.user_id === r.owner_id);
    const ownerName = user?.display_name ?? `Team ${r.roster_id}`;
    const players = rosterPlayers.get(r.roster_id) ?? [];
    const ownPicks = picksMap.get(r.roster_id) ?? /* @__PURE__ */ new Set();
    const picks = Array.from(ownPicks).map((key) => {
      const [yearStr, roundStr, origStr] = key.split("|");
      const year = parseInt(yearStr, 10);
      const round = parseInt(roundStr, 10);
      const origRosterId = parseInt(origStr, 10);
      const knownSlot = year === upcomingYear ? upcomingSlots.get(origRosterId) : void 0;
      const slotKnown = knownSlot !== void 0;
      const slot = slotKnown ? knownSlot : slotRankByRoster.get(origRosterId) ?? teamCount;
      const tier = !slotKnown ? tierForRoster(origRosterId) : null;
      const value = resolvePickValue(
        dynastyValues,
        teamCount,
        year,
        round,
        slotKnown ? slot : tier ?? "mid",
        year - upcomingYear
      );
      const ordinal = ordinalRound(round);
      const baseLabel = slotKnown ? `${year} ${round}.${String(slot).padStart(2, "0")}` : `${year} ${tier} ${ordinal}`;
      const origRoster = rosters.find((rr) => rr.roster_id === origRosterId);
      const origUser = users.find((u) => u.user_id === origRoster?.owner_id);
      const viaSuffix = origRosterId !== r.roster_id ? ` (via ${origUser?.display_name ?? "?"})` : "";
      return {
        year,
        round,
        origRosterId,
        ownerRosterId: r.roster_id,
        slot,
        slotKnown,
        tier,
        label: `${baseLabel}${viaSuffix}`,
        value
      };
    }).sort((a, b) => {
      if (a.year !== b.year) return a.year - b.year;
      if (a.round !== b.round) return a.round - b.round;
      return a.slot - b.slot;
    });
    const isMine = mySleeperUserId !== void 0 ? r.owner_id === mySleeperUserId : false;
    return {
      rosterId: r.roster_id,
      ownerName,
      isMine,
      record: `${r.settings?.wins ?? 0}-${r.settings?.losses ?? 0}`,
      players,
      picks
    };
  });
}
function ordinalRound(round) {
  const labels = ["1st", "2nd", "3rd", "4th", "5th", "6th", "7th"];
  return labels[round - 1] ?? `${round}th`;
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
  await retainDailySnapshot(ref, stored, now);
  return { dynastyValues, redraftValues, dynastyByPos, redraftByPos };
}
async function retainDailySnapshot(ref, stored, now) {
  try {
    const day = new Date(now).toISOString().slice(0, 10);
    const dailyRef = ref.collection("daily").doc(day);
    if ((await dailyRef.get()).exists) return;
    await dailyRef.set(stored);
  } catch (err) {
    console.error("daily snapshot retention failed", err);
  }
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

// api/leagues/sync.ts
function standings(rosters) {
  const ranked = [...rosters].sort((a, b) => {
    const wa = a.settings?.wins ?? 0;
    const wb = b.settings?.wins ?? 0;
    if (wa !== wb) return wb - wa;
    const fa = parseFloat(String(a.settings?.fpts ?? 0));
    const fb = parseFloat(String(b.settings?.fpts ?? 0));
    if (fa !== fb) return fb - fa;
    return a.roster_id - b.roster_id;
  });
  const map = /* @__PURE__ */ new Map();
  ranked.forEach((r, i) => map.set(r.roster_id, i + 1));
  return map;
}
async function fetchPlacements(league, rosters, nflState) {
  const history = /* @__PURE__ */ new Map();
  let cursor = league.previous_league_id;
  for (let hop = 0; hop < 2 && cursor; hop++) {
    try {
      const prevLeague = await fetchLeagueOnly(cursor);
      const season = parseInt(prevLeague.season ?? "", 10);
      const { rosters: prevRosters } = await fetchLeagueUsersRosters(cursor);
      if (Number.isFinite(season)) {
        const places = standings(prevRosters);
        for (const [rosterId, place] of places) {
          const arr = history.get(rosterId) ?? [];
          arr.push({ season, place });
          history.set(rosterId, arr);
        }
      }
      cursor = prevLeague.previous_league_id;
    } catch {
      break;
    }
  }
  const inSeason = nflState.season_type === "regular" || nflState.season_type === "post";
  return { history, current: inSeason ? standings(rosters) : null };
}
async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const user = await requireApprovedUser(req, res);
  if (!user) return;
  const { leagueId } = req.body;
  if (!leagueId) return res.status(400).json({ error: "leagueId required" });
  try {
    const [{ league, users, rosters, tradedPicks, drafts }, sleeperPlayers, nflState] = await Promise.all([
      fetchLeague(leagueId),
      fetchPlayers(),
      fetchNflState()
    ]);
    const format = detectFormat(league);
    if (format.idp) {
      return res.status(422).json({ error: "IDP leagues are not supported yet." });
    }
    const valueMaps = await getValueMaps(format);
    const userRef = adminDb.collection("users").doc(user.uid);
    const userSnap = await userRef.get();
    const mySleeperUserId = userSnap.data()?.["sleeperUserId"];
    const upcoming = findUpcomingDraft(drafts, rosters);
    const thisYear = upcoming?.season ?? (nflState.league_season ? parseInt(nflState.league_season, 10) : (/* @__PURE__ */ new Date()).getFullYear());
    const teamInputs = buildTeamInputs({
      rosters,
      users,
      tradedPicks,
      drafts,
      league,
      sleeperPlayers,
      valueMaps,
      format,
      mySleeperUserId,
      thisYear
    });
    const profiles = computeAllProfiles(teamInputs, format, thisYear, {
      dynastyByPos: valueMaps.dynastyByPos,
      redraftByPos: valueMaps.redraftByPos
    });
    const batch = adminDb.batch();
    const leagueRef = adminDb.collection("leagues").doc(leagueId);
    const leagueSnap = await leagueRef.get();
    const existingMembers = leagueSnap.exists ? leagueSnap.data()?.["members"] ?? [] : [];
    const members = existingMembers.includes(user.uid) ? existingMembers : [...existingMembers, user.uid];
    batch.set(
      leagueRef,
      {
        sleeperLeagueId: leagueId,
        name: league.name,
        format,
        members,
        ownerId: leagueSnap.exists ? leagueSnap.data()?.["ownerId"] : user.uid,
        upcomingDraftYear: thisYear,
        lastRefreshed: (/* @__PURE__ */ new Date()).toISOString()
      },
      { merge: true }
    );
    const placements = await fetchPlacements(league, rosters, nflState);
    for (const profile of profiles) {
      const profileRef = leagueRef.collection("profiles").doc(String(profile.rosterId));
      const roster = rosters.find((r) => r.roster_id === profile.rosterId);
      batch.set(profileRef, {
        ...profile,
        ownerSleeperUserId: roster?.owner_id ?? null,
        placements: placements.history.get(profile.rosterId) ?? [],
        currentPlace: placements.current?.get(profile.rosterId) ?? null,
        generatedAt: (/* @__PURE__ */ new Date()).toISOString()
      });
    }
    await batch.commit();
    const existingLeagues = userSnap.data()?.["leagueIds"] ?? [];
    const userUpdates = {};
    if (!existingLeagues.includes(leagueId)) {
      userUpdates["leagueIds"] = [...existingLeagues, leagueId];
    }
    if (mySleeperUserId && !userSnap.data()?.["sleeperUserId"]) {
      userUpdates["sleeperUserId"] = mySleeperUserId;
    }
    if (Object.keys(userUpdates).length > 0) {
      await userRef.set(userUpdates, { merge: true });
    }
    return res.status(200).json({ leagueId, name: league.name, profiles });
  } catch (err) {
    console.error("sync error", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
