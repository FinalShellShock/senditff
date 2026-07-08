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

// api/leagues/overview.ts
var overview_exports = {};
__export(overview_exports, {
  default: () => handler
});
module.exports = __toCommonJS(overview_exports);

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

// api/leagues/overview.ts
async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  const user = await requireApprovedUser(req, res);
  if (!user) return;
  const { leagueId } = req.query;
  if (!leagueId) return res.status(400).json({ error: "leagueId required" });
  try {
    const leagueRef = adminDb.collection("leagues").doc(leagueId);
    const leagueSnap = await leagueRef.get();
    if (!leagueSnap.exists) {
      return res.status(404).json({ error: "League not found. Sync it first." });
    }
    const members = leagueSnap.data()?.["members"] ?? [];
    if (!members.includes(user.uid)) {
      return res.status(403).json({ error: "Forbidden" });
    }
    const userSnap = await adminDb.collection("users").doc(user.uid).get();
    const mySleeperUserId = userSnap.data()?.["sleeperUserId"];
    const profilesSnap = await leagueRef.collection("profiles").get();
    const profiles = profilesSnap.docs.map((d) => {
      const data = d.data();
      return {
        ...data,
        isMine: mySleeperUserId ? data["ownerSleeperUserId"] === mySleeperUserId : data["isMine"] ?? false
      };
    });
    return res.status(200).json({
      leagueId,
      name: leagueSnap.data()?.["name"],
      format: leagueSnap.data()?.["format"],
      lastRefreshed: leagueSnap.data()?.["lastRefreshed"],
      upcomingDraftYear: leagueSnap.data()?.["upcomingDraftYear"] ?? null,
      profiles
    });
  } catch (err) {
    console.error("overview error", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
