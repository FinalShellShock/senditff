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

// api/leagues/trades.ts
var trades_exports = {};
__export(trades_exports, {
  default: () => handler
});
module.exports = __toCommonJS(trades_exports);

// src/data/sleeper.ts
var SLEEPER = "https://api.sleeper.app/v1";
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
async function fetchTransactions(leagueId, week) {
  const r = await fetch(`${SLEEPER}/league/${leagueId}/transactions/${week}`);
  if (!r.ok) throw new Error(`Sleeper transactions fetch failed: HTTP ${r.status} (week ${week})`);
  const data = await r.json();
  return data ?? [];
}
async function fetchLeagueDrafts(leagueId) {
  const r = await fetch(`${SLEEPER}/league/${leagueId}/drafts`);
  if (!r.ok) throw new Error(`Sleeper drafts fetch failed: HTTP ${r.status}`);
  return await r.json() ?? [];
}
async function fetchDraftSelections(draftId) {
  const r = await fetch(`${SLEEPER}/draft/${draftId}/picks`);
  if (!r.ok) throw new Error(`Sleeper draft picks fetch failed: HTTP ${r.status}`);
  return await r.json() ?? [];
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

// src/algo/fairness.ts
var FAIRNESS_FAIR_PCT = 0.05;
var FAIRNESS_FAIR_ABS = 150;
var FAIRNESS_SLIGHT_PCT = 0.12;
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

// src/data/picks.ts
var FCALC_TEAM_COUNT = 12;
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
    const overall = (round - 1) * teamCount + slotOrTier;
    const fcRound = Math.floor((overall - 1) / FCALC_TEAM_COUNT) + 1;
    const fcSlot = (overall - 1) % FCALC_TEAM_COUNT + 1;
    const exact = dynastyValues.get(
      normName(`${year} Pick ${fcRound}.${String(fcSlot).padStart(2, "0")}`)
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

// api/_lib/tradeHistory.ts
var MAX_CHAIN_SEASONS = 10;
var WEEKS = Array.from({ length: 18 }, (_, i) => i + 1);
var FETCH_CONCURRENCY = 6;
var BATCH_PAUSE_MS = 150;
async function walkLeagueChain(leagueId) {
  const chain = [];
  let cursor = leagueId;
  while (cursor && chain.length < MAX_CHAIN_SEASONS) {
    const league = await fetchLeagueOnly(cursor);
    const season = parseInt(league.season ?? "", 10);
    if (!Number.isFinite(season)) break;
    chain.push({ leagueId: cursor, season });
    cursor = league.previous_league_id || void 0;
  }
  return chain;
}
async function inBatches(items, worker, concurrency = FETCH_CONCURRENCY) {
  const out = [];
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);
    out.push(...await Promise.all(batch.map(worker)));
    if (i + concurrency < items.length) {
      await new Promise((r) => setTimeout(r, BATCH_PAUSE_MS));
    }
  }
  return out;
}
function playerName(sp, id) {
  if (!sp) return `Player ${id}`;
  const name = sp.full_name ?? `${sp.first_name ?? ""} ${sp.last_name ?? ""}`.trim();
  return name || `Player ${id}`;
}
function toStoredTrade(tx, players) {
  const sides = {};
  const side = (rosterId) => sides[String(rosterId)] ??= { players: [], picks: [], faab: [] };
  for (const rid of tx.roster_ids ?? []) side(rid);
  for (const [playerId, toRoster] of Object.entries(tx.adds ?? {})) {
    const sp = players[playerId];
    const fromRosterId = tx.drops?.[playerId] ?? -1;
    side(toRoster).players.push({
      id: playerId,
      name: playerName(sp, playerId),
      position: sp?.position ?? "?",
      fromRosterId
    });
  }
  for (const pk of tx.draft_picks ?? []) {
    side(pk.owner_id).picks.push({
      season: parseInt(pk.season, 10),
      round: pk.round,
      origRosterId: pk.roster_id,
      fromRosterId: pk.previous_owner_id
    });
  }
  for (const wb of tx.waiver_budget ?? []) {
    side(wb.receiver).faab.push({ amount: wb.amount, fromRosterId: wb.sender });
  }
  return {
    transactionId: tx.transaction_id,
    week: tx.leg,
    date: new Date(tx.status_updated).toISOString(),
    rosterIds: tx.roster_ids ?? [],
    sides
  };
}
async function fetchSeasonTrades(chainLeagueId, season, players) {
  const { users, rosters } = await fetchLeagueUsersRosters(chainLeagueId);
  const managers = {};
  for (const r of rosters) {
    const user = users.find((u) => u.user_id === r.owner_id);
    managers[String(r.roster_id)] = {
      ownerName: user?.display_name ?? `Team ${r.roster_id}`,
      ownerSleeperUserId: r.owner_id
    };
  }
  const weekResults = await inBatches(
    WEEKS,
    (week) => fetchTransactions(chainLeagueId, week)
  );
  const seen = /* @__PURE__ */ new Set();
  const trades = [];
  for (const txs of weekResults) {
    for (const tx of txs) {
      if (tx.type !== "trade" || tx.status !== "complete") continue;
      if (seen.has(tx.transaction_id)) continue;
      seen.add(tx.transaction_id);
      trades.push(toStoredTrade(tx, players));
    }
  }
  trades.sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
  const draftSelections = await resolveDraftSelections(chainLeagueId, season, players, rosters);
  return {
    season,
    chainLeagueId,
    fetchedAt: (/* @__PURE__ */ new Date()).toISOString(),
    managers,
    draftSelections,
    trades
  };
}
async function resolveDraftSelections(chainLeagueId, season, players, rosters) {
  const out = {};
  const drafts = await fetchLeagueDrafts(chainLeagueId);
  for (const draft of drafts) {
    if (draft.status !== "complete") continue;
    if (parseInt(draft.season, 10) !== season) continue;
    const slotToRoster = { ...draft.slot_to_roster_id ?? {} };
    if (Object.keys(slotToRoster).length === 0 && draft.draft_order) {
      const rosterByOwner = /* @__PURE__ */ new Map();
      for (const r of rosters) {
        if (r.owner_id) rosterByOwner.set(r.owner_id, r.roster_id);
      }
      for (const [userId, slot] of Object.entries(draft.draft_order)) {
        const rosterId = rosterByOwner.get(userId);
        if (rosterId != null && Number.isFinite(slot)) slotToRoster[String(slot)] = rosterId;
      }
    }
    let selections;
    try {
      selections = await fetchDraftSelections(draft.draft_id);
    } catch {
      continue;
    }
    for (const sel of selections) {
      const origRosterId = slotToRoster[String(sel.draft_slot)];
      if (origRosterId == null || !sel.player_id) continue;
      const sp = players[sel.player_id];
      const metaName = `${sel.metadata?.first_name ?? ""} ${sel.metadata?.last_name ?? ""}`.trim();
      out[`${sel.round}|${origRosterId}`] = {
        playerId: sel.player_id,
        name: sp ? playerName(sp, sel.player_id) : metaName || `Player ${sel.player_id}`,
        position: sp?.position ?? sel.metadata?.position ?? "?"
      };
    }
  }
  return out;
}
var PICK_ROUND_LABELS = ["1st", "2nd", "3rd", "4th", "5th", "6th", "7th"];
function pickDisplayName(pk) {
  return `${pk.season} ${PICK_ROUND_LABELS[pk.round - 1] ?? `R${pk.round}`}`;
}
function gradeTrades(docs, dynastyValues, teamCount, currentYear) {
  const allSelections = /* @__PURE__ */ new Map();
  for (const doc of docs) {
    for (const [key, sel] of Object.entries(doc.draftSelections ?? {})) {
      allSelections.set(`${doc.season}|${key}`, sel);
    }
  }
  const managerName = /* @__PURE__ */ new Map();
  for (const doc of [...docs].sort((a, b) => a.season - b.season)) {
    for (const [rid, m] of Object.entries(doc.managers ?? {})) {
      managerName.set(Number(rid), m.ownerName);
    }
  }
  const gradePlayer = (p) => {
    const v = dynastyValues.get(normName(p.name))?.value ?? 0;
    return {
      kind: "player",
      name: p.name,
      position: p.position,
      todayValue: v,
      ...v === 0 ? { note: "off_board" } : {}
    };
  };
  const gradePick = (pk) => {
    const drafted = allSelections.get(`${pk.season}|${pk.round}|${pk.origRosterId}`);
    if (drafted) {
      const v = dynastyValues.get(normName(drafted.name))?.value ?? 0;
      return {
        kind: "pick",
        name: pickDisplayName(pk),
        todayValue: v,
        note: `drafted:${drafted.name}`
      };
    }
    if (pk.season >= currentYear) {
      return {
        kind: "pick",
        name: pickDisplayName(pk),
        todayValue: resolvePickValue(dynastyValues, teamCount, pk.season, pk.round, "mid")
      };
    }
    return { kind: "pick", name: pickDisplayName(pk), todayValue: 0, note: "unresolved_pick" };
  };
  const graded = [];
  for (const doc of docs) {
    for (const trade of doc.trades) {
      const received = /* @__PURE__ */ new Map();
      const sentTotal = /* @__PURE__ */ new Map();
      const rosterIds = trade.rosterIds.length > 0 ? trade.rosterIds : Object.keys(trade.sides).map(Number);
      for (const rid of rosterIds) {
        received.set(rid, { assets: [], total: 0 });
        sentTotal.set(rid, 0);
      }
      for (const [ridStr, side] of Object.entries(trade.sides)) {
        const rid = Number(ridStr);
        const bucket = received.get(rid) ?? { assets: [], total: 0 };
        received.set(rid, bucket);
        const add = (asset, fromRosterId) => {
          bucket.assets.push(asset);
          bucket.total += asset.todayValue;
          sentTotal.set(fromRosterId, (sentTotal.get(fromRosterId) ?? 0) + asset.todayValue);
        };
        for (const p of side.players) add(gradePlayer(p), p.fromRosterId);
        for (const pk of side.picks) add(gradePick(pk), pk.fromRosterId);
        for (const fb of side.faab) {
          add(
            { kind: "faab", name: `$${fb.amount} FAAB`, todayValue: 0 },
            fb.fromRosterId
          );
        }
      }
      const sides = [...received.entries()].sort((a, b) => a[0] - b[0]).map(([rid, bucket]) => {
        const sent = sentTotal.get(rid) ?? 0;
        return {
          rosterId: rid,
          managerName: managerName.get(rid) ?? `Team ${rid}`,
          assets: bucket.assets,
          received: bucket.total,
          sent,
          net: bucket.total - sent,
          label: fairnessLabel(sent, bucket.total)
        };
      });
      const best = sides.reduce((a, b) => b.net > a.net ? b : a, sides[0]);
      const someoneWon = sides.some((s) => s.label !== "FAIR");
      graded.push({
        transactionId: trade.transactionId,
        season: doc.season,
        week: trade.week,
        date: trade.date,
        sides,
        delta: someoneWon ? Math.max(0, best.net) : 0,
        winnerRosterId: someoneWon && best.net > 0 ? best.rosterId : null,
        fairness: someoneWon ? best.label : "FAIR"
      });
    }
  }
  graded.sort((a, b) => a.date > b.date ? -1 : a.date < b.date ? 1 : 0);
  return graded;
}
function buildLedger(graded) {
  const rows = /* @__PURE__ */ new Map();
  for (const trade of graded) {
    for (const side of trade.sides) {
      const row = rows.get(side.rosterId) ?? {
        rosterId: side.rosterId,
        managerName: side.managerName,
        trades: 0,
        wins: 0,
        losses: 0,
        ties: 0,
        netValue: 0
      };
      rows.set(side.rosterId, row);
      row.managerName = side.managerName;
      row.trades += 1;
      row.netValue += side.net;
      if (side.label === "FAIR") row.ties += 1;
      else if (side.net > 0) row.wins += 1;
      else row.losses += 1;
    }
  }
  return [...rows.values()].sort((a, b) => b.netValue - a.netValue);
}

// api/leagues/trades.ts
async function loadDocs(leagueId) {
  const snap = await adminDb.collection("leagues").doc(leagueId).collection("tradeHistory").get();
  return snap.docs.map((d) => d.data()).sort((a, b) => b.season - a.season);
}
async function gradeResponse(leagueId, docs, format, currentYear) {
  const valueMaps = await getValueMaps(format);
  const teamCount = Object.keys(docs[0]?.managers ?? {}).length || 12;
  const trades = gradeTrades(docs, valueMaps.dynastyValues, teamCount, currentYear);
  return {
    needsBackfill: false,
    trades,
    ledger: buildLedger(trades),
    valuesAsOf: (/* @__PURE__ */ new Date()).toISOString().slice(0, 10),
    seasons: docs.map((d) => d.season)
  };
}
async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }
  const user = await requireApprovedUser(req, res);
  if (!user) return;
  const leagueId = req.method === "GET" ? req.query.leagueId : req.body.leagueId;
  if (!leagueId) return res.status(400).json({ error: "leagueId required" });
  try {
    const leagueRef = adminDb.collection("leagues").doc(leagueId);
    const leagueSnap = await leagueRef.get();
    if (!leagueSnap.exists) {
      return res.status(404).json({ error: "League not found. Sync it first." });
    }
    const leagueData = leagueSnap.data();
    const members = leagueData?.["members"] ?? [];
    if (!await ensureLeagueAccess(user.uid, leagueRef, members)) {
      return res.status(403).json({ error: "Forbidden" });
    }
    const format = leagueData?.["format"];
    if (!format) return res.status(500).json({ error: "League format missing" });
    const currentYear = leagueData?.["upcomingDraftYear"] ?? (/* @__PURE__ */ new Date()).getFullYear();
    if (req.method === "GET") {
      const docs2 = await loadDocs(leagueId);
      if (docs2.length === 0) {
        return res.status(200).json({
          needsBackfill: true,
          trades: [],
          ledger: [],
          valuesAsOf: (/* @__PURE__ */ new Date()).toISOString().slice(0, 10),
          seasons: []
        });
      }
      return res.status(200).json(await gradeResponse(leagueId, docs2, format, currentYear));
    }
    const existing = await loadDocs(leagueId);
    const existingSeasons = new Set(existing.map((d) => d.season));
    const chain = await walkLeagueChain(leagueId);
    const currentSeason = chain[0]?.season;
    const toFetch = chain.filter(
      (link) => link.season === currentSeason || !existingSeasons.has(link.season)
    );
    if (toFetch.length > 0) {
      const players = await fetchPlayers();
      for (const link of toFetch) {
        const doc = await fetchSeasonTrades(link.leagueId, link.season, players);
        await leagueRef.collection("tradeHistory").doc(String(link.season)).set(doc);
      }
    }
    const docs = await loadDocs(leagueId);
    return res.status(200).json(await gradeResponse(leagueId, docs, format, currentYear));
  } catch (err) {
    console.error("leagues/trades error", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
