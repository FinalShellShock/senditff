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

// api/user/leagues.ts
var leagues_exports = {};
__export(leagues_exports, {
  default: () => handler
});
module.exports = __toCommonJS(leagues_exports);

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
async function fetchNflState() {
  const r = await fetch(`${SLEEPER}/state/nfl`);
  if (!r.ok) throw new Error(`Sleeper NFL state fetch failed: HTTP ${r.status}`);
  return await r.json();
}
async function fetchSleeperUser(username) {
  const r = await fetch(`${SLEEPER}/user/${encodeURIComponent(username)}`);
  if (!r.ok) throw new Error(`Sleeper user fetch failed: HTTP ${r.status}`);
  const data = await r.json();
  if (!data?.user_id) throw new Error(`Sleeper user "${username}" not found`);
  return data;
}
async function fetchUserLeagues(userId, year) {
  const r = await fetch(`${SLEEPER}/user/${userId}/leagues/nfl/${year}`);
  if (!r.ok) throw new Error(`Sleeper user leagues fetch failed: HTTP ${r.status}`);
  const data = await r.json();
  return data ?? [];
}

// api/user/leagues.ts
function isDynastyNonIdp(league) {
  if (league.settings?.type !== 2) return false;
  const format = detectFormat(league);
  return !format.idp;
}
function deduplicateLeagues(current, prior) {
  const renewedPriorIds = new Set(
    current.map((l) => l.previous_league_id).filter((id) => Boolean(id) && id !== "0")
  );
  const priorOnly = prior.filter((l) => !renewedPriorIds.has(l.league_id));
  return [...current, ...priorOnly];
}
async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  const user = await requireApprovedUser(req, res);
  if (!user) return;
  const { username } = req.query;
  try {
    const userRef = adminDb.collection("users").doc(user.uid);
    const userSnap = await userRef.get();
    let sleeperUserId = userSnap.data()?.["sleeperUserId"];
    if (!sleeperUserId) {
      if (!username?.trim()) {
        return res.status(400).json({ error: "Sleeper username required for first-time setup" });
      }
      const sleeperUser = await fetchSleeperUser(username.trim());
      sleeperUserId = sleeperUser.user_id;
      await userRef.set({ sleeperUserId }, { merge: true });
    }
    const nflState = await fetchNflState();
    const createYear = parseInt(nflState.league_create_season, 10);
    const [current, prior] = await Promise.all([
      fetchUserLeagues(sleeperUserId, createYear),
      fetchUserLeagues(sleeperUserId, createYear - 1)
    ]);
    const allLeagues = deduplicateLeagues(current, prior);
    const dynastyLeagues = allLeagues.filter(isDynastyNonIdp);
    const summaries = dynastyLeagues.map((l) => {
      const fmt = detectFormat(l);
      return {
        leagueId: l.league_id,
        name: l.name,
        season: l.season ?? String(createYear),
        status: l.status ?? "unknown",
        totalRosters: l.total_rosters,
        superflex: fmt.superflex,
        scoring: fmt.scoring,
        tep: fmt.tep
      };
    });
    return res.status(200).json({ leagues: summaries });
  } catch (err) {
    console.error("user/leagues error", err);
    const msg = err instanceof Error ? err.message : "Internal server error";
    return res.status(500).json({ error: msg });
  }
}
