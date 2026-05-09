import * as admin from "firebase-admin";

// Singleton — Vercel may reuse the same Node process across invocations.
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(
      JSON.parse(process.env["FIREBASE_SERVICE_ACCOUNT_JSON"] ?? "{}"),
    ),
  });
}

export const adminAuth = admin.auth();
export const adminDb = admin.firestore();
