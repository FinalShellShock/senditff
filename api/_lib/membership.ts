import type { DocumentReference } from "firebase-admin/firestore";
import { adminDb } from "./admin";

// League access: being in the members[] array OR owning a roster in the
// league via your linked Sleeper account. members[] only grows when a user
// syncs a league themselves, so leaguemates who opened a league someone else
// synced used to get a hard Forbidden. If their sleeperUserId matches a
// roster owner in the stored profiles, grant access and persist membership
// (self-heals, so it's one extra read only the first time).
export async function ensureLeagueAccess(
  uid: string,
  leagueRef: DocumentReference,
  members: string[],
): Promise<boolean> {
  if (members.includes(uid)) return true;

  const userSnap = await adminDb.collection("users").doc(uid).get();
  const sleeperUserId = userSnap.data()?.["sleeperUserId"] as string | undefined;
  if (!sleeperUserId) return false;

  const match = await leagueRef
    .collection("profiles")
    .where("ownerSleeperUserId", "==", sleeperUserId)
    .limit(1)
    .get();
  if (match.empty) return false;

  await leagueRef.set({ members: [...members, uid] }, { merge: true });
  return true;
}
