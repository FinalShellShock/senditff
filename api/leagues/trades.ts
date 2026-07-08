import type { VercelRequest, VercelResponse } from "@vercel/node";
import type { LeagueFormat } from "../../src/algo/types";
import { fetchPlayers } from "../../src/data/sleeper";
import { adminDb } from "../_lib/admin";
import { requireApprovedUser } from "../_lib/auth";
import { ensureLeagueAccess } from "../_lib/membership";
import { getValueMaps } from "../_lib/snapshot";
import {
  buildLedger,
  fetchSeasonTrades,
  gradeTrades,
  walkLeagueChain,
  type GradedTrade,
  type LedgerRow,
  type SeasonTradeDoc,
} from "../_lib/tradeHistory";

export type { GradedAsset, GradedSide, GradedTrade, LedgerRow } from "../_lib/tradeHistory";

export type TradesResponse = {
  needsBackfill: boolean;
  trades: GradedTrade[];
  ledger: LedgerRow[];
  valuesAsOf: string;
  seasons: number[];
};

// Full backfill needs more than Vercel's default duration: a 5-season league
// is ~100 gentle Sleeper calls (~20-30s). maxDuration is raised in
// vercel.json for this route.

async function loadDocs(leagueId: string): Promise<SeasonTradeDoc[]> {
  const snap = await adminDb
    .collection("leagues")
    .doc(leagueId)
    .collection("tradeHistory")
    .get();
  return snap.docs
    .map((d) => d.data() as SeasonTradeDoc)
    .sort((a, b) => b.season - a.season);
}

async function gradeResponse(
  leagueId: string,
  docs: SeasonTradeDoc[],
  format: LeagueFormat,
  currentYear: number,
): Promise<TradesResponse> {
  const valueMaps = await getValueMaps(format);
  const teamCount = Object.keys(docs[0]?.managers ?? {}).length || 12;
  const trades = gradeTrades(docs, valueMaps.dynastyValues, teamCount, currentYear);
  return {
    needsBackfill: false,
    trades,
    ledger: buildLedger(trades),
    valuesAsOf: new Date().toISOString().slice(0, 10),
    seasons: docs.map((d) => d.season),
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const user = await requireApprovedUser(req, res);
  if (!user) return;

  const leagueId =
    req.method === "GET"
      ? (req.query as { leagueId?: string }).leagueId
      : (req.body as { leagueId?: string }).leagueId;
  if (!leagueId) return res.status(400).json({ error: "leagueId required" });

  try {
    const leagueRef = adminDb.collection("leagues").doc(leagueId);
    const leagueSnap = await leagueRef.get();
    if (!leagueSnap.exists) {
      return res.status(404).json({ error: "League not found. Sync it first." });
    }
    const leagueData = leagueSnap.data();
    const members: string[] = (leagueData?.["members"] as string[] | undefined) ?? [];
    if (!(await ensureLeagueAccess(user.uid, leagueRef, members))) {
      return res.status(403).json({ error: "Forbidden" });
    }
    const format = leagueData?.["format"] as LeagueFormat | undefined;
    if (!format) return res.status(500).json({ error: "League format missing" });
    const currentYear =
      (leagueData?.["upcomingDraftYear"] as number | undefined) ?? new Date().getFullYear();

    if (req.method === "GET") {
      const docs = await loadDocs(leagueId);
      if (docs.length === 0) {
        return res.status(200).json({
          needsBackfill: true,
          trades: [],
          ledger: [],
          valuesAsOf: new Date().toISOString().slice(0, 10),
          seasons: [],
        } satisfies TradesResponse);
      }
      return res.status(200).json(await gradeResponse(leagueId, docs, format, currentYear));
    }

    // POST: backfill (no docs yet) or refresh. Refresh refetches only the
    // current chain season plus any season missing a doc (league rollover);
    // closed past seasons are immutable.
    const existing = await loadDocs(leagueId);
    const existingSeasons = new Set(existing.map((d) => d.season));
    const chain = await walkLeagueChain(leagueId);
    const currentSeason = chain[0]?.season;
    const toFetch = chain.filter(
      (link) => link.season === currentSeason || !existingSeasons.has(link.season),
    );

    if (toFetch.length > 0) {
      const players = await fetchPlayers();
      for (const link of toFetch) {
        const doc = await fetchSeasonTrades(link.leagueId, link.season, players);
        await leagueRef.collection("tradeHistory").doc(String(link.season)).set(doc);
      }
    }

    const docs = await loadDocs(leagueId);
    return res.status(200).json(await gradeResponse(leagueId, docs, format, currentYear));
  } catch (err) {
    console.error("leagues/trades error", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
