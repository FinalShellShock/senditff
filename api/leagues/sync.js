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
var POSITION_CURVES = {
  // QB: long careers, peak 27-32 for pocket / 24-27 for dual-threat. Use averaged window.
  QB: { productiveStart: 23, peakStart: 26, peakEnd: 32, declineStart: 35, done: 38 },
  // RB: short careers, sharp decline 28-29.
  RB: { productiveStart: 21, peakStart: 23, peakEnd: 27, declineStart: 28, done: 30 },
  // WR: peak 26-30, decline 31-32.
  WR: { productiveStart: 22, peakStart: 26, peakEnd: 30, declineStart: 32, done: 34 },
  // TE: late breakout, peak 26-30, decline 32.
  TE: { productiveStart: 23, peakStart: 26, peakEnd: 30, declineStart: 32, done: 34 }
};
var PRESSURE_AT_PRODUCTIVE = 0;
var PRESSURE_AT_PEAK_START = 0;
var PRESSURE_AT_PEAK_END = 25;
var PRESSURE_AT_DECLINE_START = 60;
var PRESSURE_AT_DONE = 100;
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
var WINDOW_LONG_THRESHOLD = 5;
var WINDOW_SHORT_THRESHOLD = 14;
var COMPETITIVENESS_GRID = {
  STRONG: { LONG: "JUGGERNAUT", MID: "CONTEND", SHORT: "CLOSING" },
  AVERAGE: { LONG: "RISING", MID: "AVERAGE", SHORT: "MIDDLING" },
  WEAK: { LONG: "REBUILD", MID: "TRANSITION", SHORT: "STUCK" }
};

// src/algo/archetypes.ts
function detectArchetypes(team, averages, _format) {
  const out = [];
  for (const pos of POSITIONS) {
    const ps = team.positionScores[pos];
    const eliteStarter = averages.starter[pos] > 0 && ps.starterValue > 1.4 * averages.starter[pos];
    const weakDepth = averages.depth[pos] > 0 && ps.depthValue < 0.6 * averages.depth[pos];
    if (eliteStarter && weakDepth) out.push(`tier_down_${pos}`);
  }
  const needPositions = POSITIONS.filter(
    (p) => team.positionScores[p].classification === "CRITICAL_NEED" || team.positionScores[p].classification === "NEED"
  );
  for (const pos of POSITIONS) {
    const ps = team.positionScores[pos];
    const midStarter = ps.starterScore >= 40 && ps.starterScore <= 65;
    const decentDepth = ps.depthScore >= 55;
    if (midStarter && decentDepth && needPositions.some((np) => np !== pos)) {
      out.push(`consolidate_${pos}`);
    }
  }
  if (team.flex.score >= FLEX_CONSOLIDATE_THRESHOLD && needPositions.length > 0) {
    out.push("consolidate_flex");
  }
  if (team.windowTier === "LONG" && team.pickCapital.flag === "PICK_RICH") {
    out.push("age_arb_buy");
  }
  if (team.windowTier === "SHORT" && team.competitiveness !== "WEAK") {
    out.push("age_arb_sell");
  }
  if (team.windowTier === "SHORT" && team.competitiveness === "STRONG") {
    out.push("push_in");
  }
  const hasCritical = POSITIONS.some(
    (p) => team.positionScores[p].classification === "CRITICAL_NEED"
  );
  if (hasCritical) {
    for (const pos of POSITIONS) {
      const ps = team.positionScores[pos];
      const eliteStarter = ps.starterScore >= 80;
      const eliteDepth = ps.depthScore >= 80;
      if (eliteStarter && eliteDepth) {
        out.push(`need_fill_stacked_${pos}`);
        continue;
      }
      if (ps.classification === "SURPLUS") {
        out.push(`need_fill_balanced_${pos}`);
      }
    }
  }
  if ((team.competitiveness === "STRONG" || team.windowLabel === "CONTEND") && team.pickCapital.flag === "PICK_POOR") {
    out.push("capital_convert_picks_to_production");
  }
  if ((team.competitiveness === "WEAK" || team.windowTier === "LONG") && team.pickCapital.flag === "PICK_RICH") {
    out.push("capital_convert_production_to_picks");
  }
  return out;
}

// src/algo/profile.ts
var REDRAFT = (p) => p.valueRedraft;
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
    depth[pos] = sorted.slice(baseN, baseN + 3);
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
function agePressure(age, pos) {
  const c = POSITION_CURVES[pos];
  if (age <= c.productiveStart) return PRESSURE_AT_PRODUCTIVE;
  if (age <= c.peakStart) {
    return interp(age, c.productiveStart, c.peakStart, PRESSURE_AT_PRODUCTIVE, PRESSURE_AT_PEAK_START);
  }
  if (age <= c.peakEnd) {
    return interp(age, c.peakStart, c.peakEnd, PRESSURE_AT_PEAK_START, PRESSURE_AT_PEAK_END);
  }
  if (age <= c.declineStart) {
    return interp(age, c.peakEnd, c.declineStart, PRESSURE_AT_PEAK_END, PRESSURE_AT_DECLINE_START);
  }
  if (age <= c.done) {
    return interp(age, c.declineStart, c.done, PRESSURE_AT_DECLINE_START, PRESSURE_AT_DONE);
  }
  return PRESSURE_AT_DONE;
}
function starterAgePressure(players, format) {
  const { starters } = fillStarters(players, format, REDRAFT);
  let totalNum = 0;
  let totalDen = 0;
  for (const pos of POSITIONS) {
    for (const p of starters[pos]) {
      if (p.age == null) continue;
      const pressure = agePressure(p.age, p.position);
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
function classifyPosition(score) {
  if (score > 70) return "CRITICAL_NEED";
  if (score >= 50) return "NEED";
  if (score >= 30) return "HEALTHY";
  return "SURPLUS";
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
  const depth = depthByPosition(team.players, format);
  const out = {};
  const compFactor = { STRONG: 90, AVERAGE: 60, WEAK: 30 };
  const windowFactor = { SHORT: 90, MID: 60, LONG: 30 };
  const pressure = (compFactor[team.competitiveness] + windowFactor[team.windowTier]) / 2;
  for (const pos of POSITIONS) {
    const starterValue = starters[pos].reduce((s, p) => s + p.valueRedraft, 0);
    const depthValue = depth[pos].reduce((s, p) => s + p.valueRedraft, 0);
    const starterScore = score0to100(starterValue, averages.starter[pos] || 1);
    const depthScore = score0to100(depthValue, averages.depth[pos] || 1);
    const starterGap = Math.max(0, 100 - starterScore);
    const depthGap = Math.max(0, 100 - depthScore);
    const pickFactor = 50;
    const urgency = starterGap * 0.4 + pressure * 0.3 + depthGap * 0.15 + pickFactor * 0.15;
    out[pos] = {
      starterValue,
      starterScore,
      depthValue,
      depthScore,
      urgency,
      classification: classifyPosition(urgency)
    };
  }
  return out;
}
function computeAllProfiles(teams, format, thisYear) {
  const stage1 = teams.map((t) => {
    const playersAdj = applyTep(t.players, format);
    const { starters } = fillStarters(playersAdj, format);
    const depth = depthByPosition(playersAdj, format);
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
  const avgStarter = { QB: 0, RB: 0, WR: 0, TE: 0 };
  const avgDepth = { QB: 0, RB: 0, WR: 0, TE: 0 };
  let avgFlex = 0;
  for (const t of stage2) {
    for (const pos of POSITIONS) {
      avgStarter[pos] += t.starters[pos].reduce((s, p) => s + p.valueRedraft, 0);
      avgDepth[pos] += t.depth[pos].reduce((s, p) => s + p.valueRedraft, 0);
    }
    avgFlex += t.flexValue;
  }
  for (const pos of POSITIONS) {
    avgStarter[pos] /= stage2.length;
    avgDepth[pos] /= stage2.length;
  }
  avgFlex /= stage2.length;
  const averages = {
    starter: avgStarter,
    depth: avgDepth,
    flex: avgFlex,
    pickCapital: meanCap,
    pickCapitalStd: stdCap
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
      archetypes: []
    };
    profile.archetypes = detectArchetypes(profile, averages, format);
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
  const [lR, uR, rR, pR] = await Promise.all([
    fetch(`${SLEEPER}/league/${leagueId}`),
    fetch(`${SLEEPER}/league/${leagueId}/users`),
    fetch(`${SLEEPER}/league/${leagueId}/rosters`),
    fetch(`${SLEEPER}/league/${leagueId}/traded_picks`)
  ]);
  if (!lR.ok) throw new Error(`Sleeper league fetch failed: HTTP ${lR.status}`);
  if (!uR.ok) throw new Error(`Sleeper users fetch failed: HTTP ${uR.status}`);
  if (!rR.ok) throw new Error(`Sleeper rosters fetch failed: HTTP ${rR.status}`);
  return {
    league: await lR.json(),
    users: await uR.json(),
    rosters: await rR.json(),
    tradedPicks: pR.ok ? await pR.json() : []
  };
}
async function fetchPlayers() {
  const r = await fetch(`${SLEEPER}/players/nfl`);
  if (!r.ok) throw new Error(`Sleeper players fetch failed: HTTP ${r.status}`);
  return await r.json();
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
  if (!userSnap.exists || userSnap.data()?.["approved"] !== true) {
    res.status(403).json({ error: "Forbidden" });
    return null;
  }
  return { uid, email };
}

// src/data/normalize.ts
function normName(name) {
  if (!name) return "";
  return name.toLowerCase().replace(/[^a-z0-9]/g, "").replace(/(jr|sr|ii|iii|iv|v)$/, "");
}

// src/data/picks.ts
function buildPicksMap(rosters, tradedPicks, draftYears, rounds = [1, 2, 3, 4]) {
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
function resolvePickValue(dynastyValues, teamCount, year, round, slot) {
  const third = Math.ceil(teamCount / 3);
  if (round === 1) {
    const tier = slot <= third ? "early" : slot <= 2 * third ? "mid" : "late";
    const v2 = dynastyValues.get(normName(`${year} ${tier} 1st`))?.value ?? dynastyValues.get(normName(`${year} 1st`))?.value;
    if (v2) return v2;
    return slot <= third ? 2500 : slot <= 2 * third ? 2e3 : 1500;
  }
  const labels = ["1st", "2nd", "3rd", "4th"];
  const v = dynastyValues.get(normName(`${year} ${labels[round - 1]}`))?.value;
  if (v) return v;
  return round === 2 ? 900 : round === 3 ? 450 : 200;
}
function projectDraftSlots(rosters) {
  const ordered = [...rosters].sort((a, b) => {
    const wa = a.settings?.wins ?? 0;
    const wb = b.settings?.wins ?? 0;
    if (wa !== wb) return wa - wb;
    const fa = parseFloat(String(a.settings?.fpts ?? 0));
    const fb = parseFloat(String(b.settings?.fpts ?? 0));
    if (fa !== fb) return fa - fb;
    return a.roster_id - b.roster_id;
  });
  const map = /* @__PURE__ */ new Map();
  ordered.forEach((r, i) => map.set(r.roster_id, i + 1));
  return map;
}

// api/_lib/buildTeams.ts
var POSITIONS2 = ["QB", "RB", "WR", "TE"];
function buildTeamInputs(params) {
  const { rosters, users, tradedPicks, sleeperPlayers, valueMaps, format, myUid, thisYear } = params;
  const { dynastyValues, redraftValues } = valueMaps;
  const draftYears = [thisYear, thisYear + 1, thisYear + 2];
  const picksMap = buildPicksMap(rosters, tradedPicks, draftYears);
  const draftSlots = projectDraftSlots(rosters);
  return rosters.map((r) => {
    const user = users.find((u) => u.user_id === r.owner_id);
    const ownerName = user?.display_name ?? `Team ${r.roster_id}`;
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
        age: sp.age ?? dyn?.age ?? red?.age ?? null,
        valueRedraft: red?.value ?? 0,
        valueDynasty: dyn?.value ?? 0
      };
    }).filter((p) => p !== null);
    const ownPicks = picksMap.get(r.roster_id) ?? /* @__PURE__ */ new Set();
    const picks = Array.from(ownPicks).map((key) => {
      const [yearStr, roundStr, origStr] = key.split("|");
      const year = parseInt(yearStr, 10);
      const round = parseInt(roundStr, 10);
      const origRosterId = parseInt(origStr, 10);
      const slot = draftSlots.get(origRosterId) ?? rosters.length;
      const value = resolvePickValue(dynastyValues, rosters.length, year, round, slot);
      const slotStr = `${round}.${String(slot).padStart(2, "0")}`;
      const origRoster = rosters.find((rr) => rr.roster_id === origRosterId);
      const origUser = users.find((u) => u.user_id === origRoster?.owner_id);
      const viaSuffix = origRosterId !== r.roster_id ? ` (via ${origUser?.display_name ?? "?"})` : "";
      return {
        year,
        round,
        origRosterId,
        ownerRosterId: r.roster_id,
        slot,
        label: `${year} ${slotStr}${viaSuffix}`,
        value
      };
    }).sort((a, b) => a.label.localeCompare(b.label));
    const isMine = myUid !== void 0 && user?.user_id !== void 0 ? r.owner_id === myUid || users.find((u) => u.user_id === r.owner_id)?.user_id === myUid : false;
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
function formatKey(format) {
  return `${format.superflex ? "sf" : "1qb"}_${format.scoring}${format.tep ? "_tep" : ""}`;
}
async function getValueMaps(format) {
  const key = formatKey(format);
  const ref = adminDb.collection("valueSnapshots").doc(key);
  const snap = await ref.get();
  const now = Date.now();
  if (snap.exists) {
    const updatedAt = snap.data()?.["updatedAt"];
    if (updatedAt && now - new Date(updatedAt).getTime() < SNAPSHOT_TTL_MS) {
      return deserializeSnapshot(snap.data());
    }
  }
  const fcalc = await fetchFantasyCalc(format);
  const dynastyValues = /* @__PURE__ */ new Map();
  const redraftValues = /* @__PURE__ */ new Map();
  for (const e of fcalc.dynasty) {
    const k = normName(e.player?.name);
    if (k) dynastyValues.set(k, { value: e.value, age: e.player?.age });
  }
  for (const e of fcalc.redraft) {
    const k = normName(e.player?.name);
    if (k) redraftValues.set(k, { value: e.value, age: e.player?.age });
  }
  const stored = {
    dynastyValues: Object.fromEntries(dynastyValues),
    redraftValues: Object.fromEntries(redraftValues),
    updatedAt: new Date(now).toISOString()
  };
  await ref.set(stored);
  return { dynastyValues, redraftValues };
}
function deserializeSnapshot(data) {
  return {
    dynastyValues: new Map(Object.entries(data.dynastyValues)),
    redraftValues: new Map(Object.entries(data.redraftValues))
  };
}

// api/leagues/sync.ts
async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const user = await requireApprovedUser(req, res);
  if (!user) return;
  const { leagueId } = req.body;
  if (!leagueId) return res.status(400).json({ error: "leagueId required" });
  try {
    const [{ league, users, rosters, tradedPicks }, sleeperPlayers] = await Promise.all([
      fetchLeague(leagueId),
      fetchPlayers()
    ]);
    const format = detectFormat(league);
    if (format.idp) {
      return res.status(422).json({ error: "IDP leagues are not supported yet." });
    }
    const valueMaps = await getValueMaps(format);
    const thisYear = (/* @__PURE__ */ new Date()).getFullYear();
    const teamInputs = buildTeamInputs({
      rosters,
      users,
      tradedPicks,
      sleeperPlayers,
      valueMaps,
      format,
      myUid: user.uid,
      thisYear
    });
    const profiles = computeAllProfiles(teamInputs, format, thisYear);
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
        lastRefreshed: (/* @__PURE__ */ new Date()).toISOString()
      },
      { merge: true }
    );
    for (const profile of profiles) {
      const profileRef = leagueRef.collection("profiles").doc(String(profile.rosterId));
      batch.set(profileRef, { ...profile, generatedAt: (/* @__PURE__ */ new Date()).toISOString() });
    }
    await batch.commit();
    const userRef = adminDb.collection("users").doc(user.uid);
    const userSnap = await userRef.get();
    const existingLeagues = userSnap.data()?.["leagueIds"] ?? [];
    if (!existingLeagues.includes(leagueId)) {
      await userRef.update({ leagueIds: [...existingLeagues, leagueId] });
    }
    return res.status(200).json({ leagueId, name: league.name, profiles });
  } catch (err) {
    console.error("sync error", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
