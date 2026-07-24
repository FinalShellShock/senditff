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

// api/feedback.ts
var feedback_exports = {};
__export(feedback_exports, {
  default: () => handler
});
module.exports = __toCommonJS(feedback_exports);

// src/algo/version.ts
var ALGO_VERSION = "shotgun";
var ALGO_FINGERPRINT = true ? "b3f7c63e402a" : "dev";

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

// api/feedback.ts
var MAX_REASONS = 12;
var MAX_REASON_LENGTH = 40;
var MAX_COMMENT_LENGTH = 2e3;
async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const user = await requireApprovedUser(req, res);
  if (!user) return;
  const {
    verdict,
    reasons: rawReasons,
    comment: rawComment,
    leagueId,
    rosterId,
    packageIndex: rawPackageIndex,
    search: rawSearch,
    package: pkg,
    diagnostics
  } = req.body;
  if (verdict !== "up" && verdict !== "down") {
    return res.status(400).json({ error: 'verdict must be "up" or "down"' });
  }
  if (typeof leagueId !== "string" || leagueId.length === 0) {
    return res.status(400).json({ error: "leagueId required" });
  }
  if (typeof rosterId !== "number" || !Number.isFinite(rosterId)) {
    return res.status(400).json({ error: "rosterId must be a number" });
  }
  if (pkg == null || typeof pkg !== "object" || Array.isArray(pkg)) {
    return res.status(400).json({ error: "package must be an object" });
  }
  const reasons = Array.isArray(rawReasons) ? rawReasons.filter((r) => typeof r === "string").slice(0, MAX_REASONS).map((r) => r.slice(0, MAX_REASON_LENGTH)) : [];
  const comment = typeof rawComment === "string" ? rawComment.slice(0, MAX_COMMENT_LENGTH) : "";
  const packageIndex = typeof rawPackageIndex === "number" && Number.isFinite(rawPackageIndex) ? rawPackageIndex : 0;
  const pkgRecord = pkg;
  const counterRosterId = typeof pkgRecord["counterRosterId"] === "number" ? pkgRecord["counterRosterId"] : null;
  const search = {
    archetype: rawSearch?.archetype ?? null,
    position: rawSearch?.position ?? null,
    targetRosterId: rawSearch?.targetRosterId ?? null,
    noFillerPicks: rawSearch?.noFillerPicks === true
  };
  try {
    const leagueRef = adminDb.collection("leagues").doc(leagueId);
    const leagueSnap = await leagueRef.get();
    const members = leagueSnap.data()?.["members"] ?? [];
    if (!await ensureLeagueAccess(user.uid, leagueRef, members)) {
      return res.status(403).json({ error: "Forbidden" });
    }
    const docRef = await adminDb.collection("feedback").add({
      createdAt: (/* @__PURE__ */ new Date()).toISOString(),
      userId: user.uid,
      userEmail: user.email,
      algoVersion: ALGO_VERSION,
      algoFingerprint: ALGO_FINGERPRINT,
      verdict,
      reasons,
      comment,
      leagueId,
      rosterId,
      counterRosterId,
      packageIndex,
      search,
      package: pkg,
      diagnostics: diagnostics ?? null
    });
    return res.status(200).json({ ok: true, id: docRef.id });
  } catch (err) {
    console.error("feedback error", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
