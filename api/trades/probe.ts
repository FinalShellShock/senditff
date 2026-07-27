// Does a forced-archetype search actually return anything, before we offer it?
//
// The scouting report deep-links each play into the trade finder with a forced
// archetype. Nothing checked that the finder could satisfy the link, so a play
// could sit on the page under a "Find these trades" button and land on "built 4
// candidate packages, but none survived scoring". The engine was right to
// reject them; the page was wrong to promise them.
//
// This runs the SAME generation and scoring path as api/trades/find.ts and
// returns nothing but a count per intent. It is cheap because everything
// expensive in find.ts is downstream of this point: generatePackages is
// deterministic math over profiles already in memory, and the Haiku call that
// writes rationales is skipped entirely.
//
// One request carries every intent on the page so the team view costs one round
// trip rather than one per play.

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { ARCHETYPE_FAMILIES, type ArchetypeFamily } from "../../src/algo/archetypes";
import { POSITIONS } from "../../src/algo/constants";
import type { LeagueFormat, Position, TeamProfile } from "../../src/algo/types";
import { adminDb } from "../_lib/admin";
import { requireApprovedUser } from "../_lib/auth";
import { ensureLeagueAccess } from "../_lib/membership";
import { getValueMaps } from "../_lib/snapshot";
import { generatePackages } from "../_lib/tradeEngine";

/** Small enough that a page cannot turn one click into an unbounded sweep. */
const MAX_INTENTS = 8;

type Intent = { archetype?: string; position?: string | null };

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const user = await requireApprovedUser(req, res);
  if (!user) return;

  const { leagueId, rosterId, intents } = req.body as {
    leagueId?: string;
    rosterId?: number;
    intents?: Intent[];
  };
  if (!leagueId || rosterId == null) {
    return res.status(400).json({ error: "leagueId and rosterId required" });
  }
  if (!Array.isArray(intents) || intents.length === 0) {
    return res.status(400).json({ error: "intents required" });
  }

  // Validate before touching Firestore, and drop anything unrecognised rather
  // than failing the batch: one stale archetype on the page should not blank
  // every other play's button.
  const clean = intents
    .slice(0, MAX_INTENTS)
    .filter((i): i is Intent & { archetype: string } =>
      typeof i?.archetype === "string" &&
      ARCHETYPE_FAMILIES.includes(i.archetype as ArchetypeFamily) &&
      (i.position == null || POSITIONS.includes(i.position as Position)));
  if (clean.length === 0) return res.status(200).json({ results: [] });

  try {
    const leagueRef = adminDb.collection("leagues").doc(leagueId);
    const [leagueSnap, profilesSnap] = await Promise.all([
      leagueRef.get(),
      leagueRef.collection("profiles").get(),
    ]);

    const leagueData = leagueSnap.data();
    const members: string[] = (leagueData?.["members"] as string[] | undefined) ?? [];
    if (!(await ensureLeagueAccess(user.uid, leagueRef, members))) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const format = leagueData?.["format"] as LeagueFormat | undefined;
    if (!format) return res.status(500).json({ error: "League format missing" });

    const profiles = profilesSnap.docs.map((d) => d.data() as TeamProfile);
    const myProfile = profiles.find((p) => p.rosterId === Number(rosterId));
    if (!myProfile) return res.status(404).json({ error: "Team not found" });

    const thisYear =
      (leagueData?.["upcomingDraftYear"] as number | undefined) ?? new Date().getFullYear();
    const valueMaps = await getValueMaps(format);

    const results = clean.map((intent) => {
      const { packages } = generatePackages(myProfile, profiles, format, thisYear, {
        limit: 5,
        pools: {
          dynastyByPos: valueMaps.dynastyByPos,
          redraftByPos: valueMaps.redraftByPos,
        },
        forceArchetype: {
          family: intent.archetype as ArchetypeFamily,
          ...(intent.position ? { position: intent.position as Position } : {}),
        },
      });
      return {
        archetype: intent.archetype,
        position: intent.position ?? null,
        count: packages.length,
      };
    });

    return res.status(200).json({ results });
  } catch (err) {
    console.error("trades/probe error", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
