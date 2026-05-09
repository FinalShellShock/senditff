import { doc, getDoc, onSnapshot } from "firebase/firestore";
import { useEffect, useState } from "react";
import { db } from "../lib/firebase.ts";

export type LeagueMeta = {
  leagueId: string;
  name: string;
  superflex: boolean;
  scoring: "ppr" | "half" | "std";
  tep: boolean;
  lastRefreshed: string | null; // null = never synced
};

// Subscribes to the user's leagueIds list, then fetches metadata for each.
// Returns live-updating league metadata.
export function useLeagues(uid: string): {
  leagues: LeagueMeta[];
  loading: boolean;
} {
  const [leagues, setLeagues] = useState<LeagueMeta[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const userRef = doc(db, "users", uid);

    const unsub = onSnapshot(userRef, async (userSnap) => {
      const leagueIds: string[] =
        (userSnap.data()?.["leagueIds"] as string[] | undefined) ?? [];

      if (leagueIds.length === 0) {
        setLeagues([]);
        setLoading(false);
        return;
      }

      const metas = await Promise.all(
        leagueIds.map(async (id) => {
          const snap = await getDoc(doc(db, "leagues", id));
          if (!snap.exists()) {
            return { leagueId: id, name: id, superflex: false, scoring: "ppr" as const, tep: false, lastRefreshed: null };
          }
          const d = snap.data();
          return {
            leagueId: id,
            name: d["name"] as string,
            superflex: d["format"]?.superflex as boolean,
            scoring: d["format"]?.scoring as "ppr" | "half" | "std",
            tep: d["format"]?.tep as boolean,
            lastRefreshed: d["lastRefreshed"] as string,
          } satisfies LeagueMeta;
        }),
      );

      setLeagues(metas);
      setLoading(false);
    });

    return unsub;
  }, [uid]);

  return { leagues, loading };
}
