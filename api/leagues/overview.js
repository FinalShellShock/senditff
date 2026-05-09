// api/_lib/admin.ts
import * as admin from "firebase-admin";
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(
      JSON.parse(process.env["FIREBASE_SERVICE_ACCOUNT_JSON"] ?? "{}")
    )
  });
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
    const profilesSnap = await leagueRef.collection("profiles").get();
    const profiles = profilesSnap.docs.map((d) => d.data());
    return res.status(200).json({
      leagueId,
      name: leagueSnap.data()?.["name"],
      format: leagueSnap.data()?.["format"],
      lastRefreshed: leagueSnap.data()?.["lastRefreshed"],
      profiles
    });
  } catch (err) {
    console.error("overview error", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
export {
  handler as default
};
