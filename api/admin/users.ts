// Admin: see who is waiting for access, and let them in.
//
// A "join request" is not a separate record. Signing in creates
// users/{uid} with approved:false (src/hooks/useAuth.tsx), so the pending
// queue is just that collection filtered. Nothing new to capture.
//
// Admin is a flag on the admin's own user doc rather than a hardcoded uid, so
// adding a moderator later is one field, not a deploy. The flag is NOT
// client-writable (see firestore.rules): the whole point of this endpoint
// would be lost if anyone could grant themselves the power to grant access.
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { adminDb } from "../_lib/admin";
import { requireAdmin } from "../_lib/auth";

export type PendingUser = {
  uid: string;
  email: string;
  displayName: string | null;
  createdAt: string | null;
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const admin = await requireAdmin(req, res);
  if (!admin) return;

  try {
    if (req.method === "GET") {
      const snap = await adminDb.collection("users").get();
      const pending: PendingUser[] = [];
      for (const d of snap.docs) {
        // V1 docs were keyed by email. They are all migrated, but any stragglers
        // are not join requests and must not show up as ones.
        if (d.id.includes("@")) continue;
        const v = d.data();
        if (v["approved"] === true || v["subscribed"] === true) continue;
        // Already answered. Denying sets approved:false, which is also what a
        // brand new request looks like, so without this the same person would
        // reappear at the top of the queue forever.
        if (v["deniedAt"]) continue;
        pending.push({
          uid: d.id,
          email: (v["email"] as string) ?? "",
          displayName: (v["displayName"] as string) ?? null,
          createdAt: (v["createdAt"] as string) ?? null,
        });
      }
      // Oldest first: whoever has been waiting longest is the one to deal with.
      pending.sort((a, b) => (a.createdAt ?? "").localeCompare(b.createdAt ?? "") || a.uid.localeCompare(b.uid));
      return res.status(200).json({ pending });
    }

    const { uid, action } = req.body as { uid?: string; action?: string };
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
        { approved: true, approvedAt: new Date().toISOString(), approvedBy: admin.uid },
        { merge: true },
      );
    } else {
      // Deny leaves the doc in place rather than deleting it, so the same
      // person signing in again does not silently reappear as a fresh request
      // with no record that it was already answered.
      await ref.set(
        { approved: false, deniedAt: new Date().toISOString(), deniedBy: admin.uid },
        { merge: true },
      );
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("admin users error", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
