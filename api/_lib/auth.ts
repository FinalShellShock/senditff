import type { VercelRequest, VercelResponse } from "@vercel/node";
import { adminAuth, adminDb } from "./admin.ts";

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
  if (!userSnap.exists || userSnap.data()?.["approved"] !== true) {
    res.status(403).json({ error: "Forbidden" });
    return null;
  }

  return { uid, email };
}
