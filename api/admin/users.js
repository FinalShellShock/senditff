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

// api/admin/users.ts
var users_exports = {};
__export(users_exports, {
  default: () => handler
});
module.exports = __toCommonJS(users_exports);

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
async function requireAdmin(req, res) {
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
  if (userSnap.data()?.["admin"] !== true) {
    res.status(403).json({ error: "Forbidden" });
    return null;
  }
  return { uid, email };
}

// api/admin/users.ts
async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }
  const admin2 = await requireAdmin(req, res);
  if (!admin2) return;
  try {
    if (req.method === "GET") {
      const snap2 = await adminDb.collection("users").get();
      const pending = [];
      for (const d of snap2.docs) {
        if (d.id.includes("@")) continue;
        const v = d.data();
        if (v["approved"] === true || v["subscribed"] === true) continue;
        if (v["deniedAt"]) continue;
        pending.push({
          uid: d.id,
          email: v["email"] ?? "",
          displayName: v["displayName"] ?? null,
          createdAt: v["createdAt"] ?? null
        });
      }
      pending.sort((a, b) => (a.createdAt ?? "").localeCompare(b.createdAt ?? "") || a.uid.localeCompare(b.uid));
      return res.status(200).json({ pending });
    }
    const { uid, action } = req.body;
    if (typeof uid !== "string" || uid.length === 0) {
      return res.status(400).json({ error: "uid required" });
    }
    if (uid.includes("@")) {
      return res.status(400).json({ error: "uid must be an account id, not an email" });
    }
    if (action !== "approve" && action !== "deny") {
      return res.status(400).json({ error: 'action must be "approve" or "deny"' });
    }
    const ref = adminDb.collection("users").doc(uid);
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ error: "No such user" });
    if (action === "approve") {
      await ref.set(
        { approved: true, approvedAt: (/* @__PURE__ */ new Date()).toISOString(), approvedBy: admin2.uid },
        { merge: true }
      );
    } else {
      await ref.set(
        { approved: false, deniedAt: (/* @__PURE__ */ new Date()).toISOString(), deniedBy: admin2.uid },
        { merge: true }
      );
    }
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("admin users error", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
