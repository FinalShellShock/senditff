import type { VercelRequest, VercelResponse } from "@vercel/node";
import { adminAuth, adminDb } from "./admin";

export type ApprovedUser = {
  uid: string;
  email: string;
};

// Verifies the Firebase ID token from the Authorization header and confirms
// the user has been manually approved. Returns the user on success or sends
// a 401/403 and returns null.
export async function requireApprovedUser(
  req: VercelRequest,
  res: VercelResponse,
): Promise<ApprovedUser | null> {
  const authHeader = req.headers["authorization"] ?? "";
  if (!authHeader.startsWith("Bearer ")) {
    res.status(401).json({ error: "Unauthorized" });
    return null;
  }

  let uid: string;
  let email: string;
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

export type AdminUser = ApprovedUser;

// Same check, plus the admin flag. Separate from requireApprovedUser so an
// endpoint cannot be admin-gated by accident or un-gated by accident: the
// caller has to name which one it wants.
//
// The flag lives on the user doc and is Admin SDK only (firestore.rules), so
// granting a moderator later is one field rather than a deploy. Never read it
// from the client's token or request body.
export async function requireAdmin(
  req: VercelRequest,
  res: VercelResponse,
): Promise<AdminUser | null> {
  const authHeader = req.headers["authorization"] ?? "";
  if (!authHeader.startsWith("Bearer ")) {
    res.status(401).json({ error: "Unauthorized" });
    return null;
  }

  let uid: string;
  let email: string;
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
