// Trade history: fetch every real trade in a league's lifetime from Sleeper,
// store it raw (immutable facts only), and grade it at read time against
// today's FantasyCalc values. Values are never stored with trades, so cached
// history can't go stale; "who won" is always the hindsight verdict at
// today's market.

import { fairnessLabel, type FairnessLabel } from "../../src/algo/fairness";
import { resolvePickValue } from "../../src/data/picks";
import { normName } from "../../src/data/normalize";
import {
  fetchDraftSelections,
  fetchLeagueDrafts,
  fetchLeagueOnly,
  fetchLeagueUsersRosters,
  fetchTransactions,
} from "../../src/data/sleeper";
import type { SleeperPlayer, SleeperRoster, SleeperTransaction } from "../../src/data/types";

const MAX_CHAIN_SEASONS = 10;
const WEEKS = Array.from({ length: 18 }, (_, i) => i + 1);
const FETCH_CONCURRENCY = 6;
const BATCH_PAUSE_MS = 150;

// ── Stored shapes (Firestore: leagues/{id}/tradeHistory/{season}) ────────────

export type StoredTradePlayer = {
  id: string;
  name: string;
  position: string;
  fromRosterId: number;
};

export type StoredTradePick = {
  season: number;
  round: number;
  origRosterId: number;
  fromRosterId: number;
};

export type StoredTradeFaab = { amount: number; fromRosterId: number };

// Assets keyed by the RECEIVING rosterId. fromRosterId preserves who gave
// each asset up so multi-team trades can compute per-side nets.
export type StoredTrade = {
  transactionId: string;
  week: number;
  date: string; // ISO from status_updated
  rosterIds: number[];
  sides: Record<
    string,
    { players: StoredTradePlayer[]; picks: StoredTradePick[]; faab: StoredTradeFaab[] }
  >;
};

export type SeasonTradeDoc = {
  season: number;
  chainLeagueId: string;
  fetchedAt: string;
  managers: Record<string, { ownerName: string; ownerSleeperUserId: string | null }>;
  // Completed-draft selections for THIS season, keyed "round|origRosterId".
  // Lets a traded "2025 2nd (via X)" resolve to the player actually taken.
  draftSelections: Record<string, { playerId: string; name: string; position: string }>;
  trades: StoredTrade[];
};

// ── Graded shapes (computed at read time, never stored) ─────────────────────

export type GradedAsset = {
  kind: "player" | "pick" | "faab";
  name: string;
  position?: string;
  todayValue: number;
  // "off_board" (player no longer on the FantasyCalc board),
  // "drafted:<name>" (pick resolved to its selection),
  // "unresolved_pick" (past pick we couldn't map — valued 0, flagged).
  note?: string;
};

export type GradedSide = {
  rosterId: number;
  managerName: string;
  assets: GradedAsset[];
  received: number; // today's value of what this side got
  sent: number; // today's value of what left this side
  net: number;
  label: FairnessLabel; // from this side's perspective (sent vs received)
};

export type GradedTrade = {
  transactionId: string;
  season: number;
  week: number;
  date: string;
  sides: GradedSide[];
  delta: number; // best side's net (0 when fair)
  winnerRosterId: number | null;
  fairness: FairnessLabel; // overall: FAIR unless someone clearly won
};

export type LedgerRow = {
  rosterId: number;
  managerName: string;
  trades: number;
  wins: number;
  losses: number;
  ties: number;
  netValue: number;
};

// ── Fetching ─────────────────────────────────────────────────────────────────

export async function walkLeagueChain(
  leagueId: string,
): Promise<Array<{ leagueId: string; season: number }>> {
  const chain: Array<{ leagueId: string; season: number }> = [];
  let cursor: string | undefined = leagueId;
  while (cursor && chain.length < MAX_CHAIN_SEASONS) {
    const league = await fetchLeagueOnly(cursor);
    const season = parseInt(league.season ?? "", 10);
    if (!Number.isFinite(season)) break;
    chain.push({ leagueId: cursor, season });
    cursor = league.previous_league_id || undefined;
  }
  return chain; // newest first
}

async function inBatches<T, R>(
  items: T[],
  worker: (item: T) => Promise<R>,
  concurrency = FETCH_CONCURRENCY,
): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);
    out.push(...(await Promise.all(batch.map(worker))));
    if (i + concurrency < items.length) {
      await new Promise((r) => setTimeout(r, BATCH_PAUSE_MS));
    }
  }
  return out;
}

function playerName(sp: SleeperPlayer | undefined, id: string): string {
  if (!sp) return `Player ${id}`;
  const name = sp.full_name ?? `${sp.first_name ?? ""} ${sp.last_name ?? ""}`.trim();
  return name || `Player ${id}`;
}

function toStoredTrade(
  tx: SleeperTransaction,
  players: Record<string, SleeperPlayer>,
): StoredTrade {
  const sides: StoredTrade["sides"] = {};
  const side = (rosterId: number) =>
    (sides[String(rosterId)] ??= { players: [], picks: [], faab: [] });
  for (const rid of tx.roster_ids ?? []) side(rid);

  for (const [playerId, toRoster] of Object.entries(tx.adds ?? {})) {
    const sp = players[playerId];
    const fromRosterId = tx.drops?.[playerId] ?? -1;
    side(toRoster).players.push({
      id: playerId,
      name: playerName(sp, playerId),
      position: sp?.position ?? "?",
      fromRosterId,
    });
  }
  for (const pk of tx.draft_picks ?? []) {
    side(pk.owner_id).picks.push({
      season: parseInt(pk.season, 10),
      round: pk.round,
      origRosterId: pk.roster_id,
      fromRosterId: pk.previous_owner_id,
    });
  }
  for (const wb of tx.waiver_budget ?? []) {
    side(wb.receiver).faab.push({ amount: wb.amount, fromRosterId: wb.sender });
  }

  return {
    transactionId: tx.transaction_id,
    week: tx.leg,
    date: new Date(tx.status_updated).toISOString(),
    rosterIds: tx.roster_ids ?? [],
    sides,
  };
}

export async function fetchSeasonTrades(
  chainLeagueId: string,
  season: number,
  players: Record<string, SleeperPlayer>,
): Promise<SeasonTradeDoc> {
  const { users, rosters } = await fetchLeagueUsersRosters(chainLeagueId);
  const managers: SeasonTradeDoc["managers"] = {};
  for (const r of rosters) {
    const user = users.find((u) => u.user_id === r.owner_id);
    managers[String(r.roster_id)] = {
      ownerName: user?.display_name ?? `Team ${r.roster_id}`,
      ownerSleeperUserId: r.owner_id,
    };
  }

  const weekResults = await inBatches(WEEKS, (week) =>
    fetchTransactions(chainLeagueId, week),
  );
  const seen = new Set<string>();
  const trades: StoredTrade[] = [];
  for (const txs of weekResults) {
    for (const tx of txs) {
      if (tx.type !== "trade" || tx.status !== "complete") continue;
      if (seen.has(tx.transaction_id)) continue; // offseason trades can echo across legs
      seen.add(tx.transaction_id);
      trades.push(toStoredTrade(tx, players));
    }
  }
  trades.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  const draftSelections = await resolveDraftSelections(chainLeagueId, season, players, rosters);

  return {
    season,
    chainLeagueId,
    fetchedAt: new Date().toISOString(),
    managers,
    draftSelections,
    trades,
  };
}

// Map this season's completed draft(s) to "round|origRosterId" -> selection,
// so traded picks can be graded as the player actually drafted with them.
// The slot -> original-roster mapping comes from slot_to_roster_id when
// Sleeper publishes it, else from draft_order (user_id -> slot) resolved
// through that season's rosters.
export async function resolveDraftSelections(
  chainLeagueId: string,
  season: number,
  players: Record<string, SleeperPlayer>,
  rosters: SleeperRoster[],
): Promise<SeasonTradeDoc["draftSelections"]> {
  const out: SeasonTradeDoc["draftSelections"] = {};
  const drafts = await fetchLeagueDrafts(chainLeagueId);
  for (const draft of drafts) {
    if (draft.status !== "complete") continue;
    if (parseInt(draft.season, 10) !== season) continue;
    const slotToRoster: Record<string, number> = { ...(draft.slot_to_roster_id ?? {}) };
    if (Object.keys(slotToRoster).length === 0 && draft.draft_order) {
      const rosterByOwner = new Map<string, number>();
      for (const r of rosters) {
        if (r.owner_id) rosterByOwner.set(r.owner_id, r.roster_id);
      }
      for (const [userId, slot] of Object.entries(draft.draft_order)) {
        const rosterId = rosterByOwner.get(userId);
        if (rosterId != null && Number.isFinite(slot)) slotToRoster[String(slot)] = rosterId;
      }
    }
    let selections;
    try {
      selections = await fetchDraftSelections(draft.draft_id);
    } catch {
      continue; // resolution is best-effort; unresolved picks get flagged later
    }
    for (const sel of selections) {
      const origRosterId = slotToRoster[String(sel.draft_slot)];
      if (origRosterId == null || !sel.player_id) continue;
      const sp = players[sel.player_id];
      const metaName = `${sel.metadata?.first_name ?? ""} ${sel.metadata?.last_name ?? ""}`.trim();
      out[`${sel.round}|${origRosterId}`] = {
        playerId: sel.player_id,
        name: sp ? playerName(sp, sel.player_id) : metaName || `Player ${sel.player_id}`,
        position: sp?.position ?? sel.metadata?.position ?? "?",
      };
    }
  }
  return out;
}

// ── Grading ──────────────────────────────────────────────────────────────────

const PICK_ROUND_LABELS = ["1st", "2nd", "3rd", "4th", "5th", "6th", "7th"];

function pickDisplayName(pk: StoredTradePick): string {
  return `${pk.season} ${PICK_ROUND_LABELS[pk.round - 1] ?? `R${pk.round}`}`;
}

export function gradeTrades(
  docs: SeasonTradeDoc[],
  dynastyValues: Map<string, { value: number; age?: number }>,
  teamCount: number,
  currentYear: number,
): GradedTrade[] {
  // Selections across every season, keyed "season|round|origRosterId".
  const allSelections = new Map<string, { name: string; position: string }>();
  for (const doc of docs) {
    for (const [key, sel] of Object.entries(doc.draftSelections ?? {})) {
      allSelections.set(`${doc.season}|${key}`, sel);
    }
  }
  // Manager names: prefer the newest season's mapping for each roster.
  const managerName = new Map<number, string>();
  for (const doc of [...docs].sort((a, b) => a.season - b.season)) {
    for (const [rid, m] of Object.entries(doc.managers ?? {})) {
      managerName.set(Number(rid), m.ownerName);
    }
  }

  const gradePlayer = (p: StoredTradePlayer): GradedAsset => {
    const v = dynastyValues.get(normName(p.name))?.value ?? 0;
    return {
      kind: "player",
      name: p.name,
      position: p.position,
      todayValue: v,
      ...(v === 0 ? { note: "off_board" } : {}),
    };
  };

  const gradePick = (pk: StoredTradePick): GradedAsset => {
    const drafted = allSelections.get(`${pk.season}|${pk.round}|${pk.origRosterId}`);
    if (drafted) {
      const v = dynastyValues.get(normName(drafted.name))?.value ?? 0;
      return {
        kind: "pick",
        name: pickDisplayName(pk),
        todayValue: v,
        note: `drafted:${drafted.name}`,
      };
    }
    if (pk.season >= currentYear) {
      // Still in the future: same time-shifted valuation the rest of the app
      // uses. Slot unknown for stored picks, so round 1 grades as mid tier.
      return {
        kind: "pick",
        name: pickDisplayName(pk),
        todayValue: resolvePickValue(dynastyValues, teamCount, pk.season, pk.round, "mid"),
      };
    }
    // Past pick we couldn't map to a selection. Flag it rather than guess.
    return { kind: "pick", name: pickDisplayName(pk), todayValue: 0, note: "unresolved_pick" };
  };

  const graded: GradedTrade[] = [];
  for (const doc of docs) {
    for (const trade of doc.trades) {
      const received = new Map<number, { assets: GradedAsset[]; total: number }>();
      const sentTotal = new Map<number, number>();
      const rosterIds =
        trade.rosterIds.length > 0
          ? trade.rosterIds
          : Object.keys(trade.sides).map(Number);
      for (const rid of rosterIds) {
        received.set(rid, { assets: [], total: 0 });
        sentTotal.set(rid, 0);
      }
      for (const [ridStr, side] of Object.entries(trade.sides)) {
        const rid = Number(ridStr);
        const bucket = received.get(rid) ?? { assets: [], total: 0 };
        received.set(rid, bucket);
        const add = (asset: GradedAsset, fromRosterId: number) => {
          bucket.assets.push(asset);
          bucket.total += asset.todayValue;
          sentTotal.set(fromRosterId, (sentTotal.get(fromRosterId) ?? 0) + asset.todayValue);
        };
        for (const p of side.players) add(gradePlayer(p), p.fromRosterId);
        for (const pk of side.picks) add(gradePick(pk), pk.fromRosterId);
        for (const fb of side.faab) {
          add(
            { kind: "faab", name: `$${fb.amount} FAAB`, todayValue: 0 },
            fb.fromRosterId,
          );
        }
      }

      const sides: GradedSide[] = [...received.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([rid, bucket]) => {
          const sent = sentTotal.get(rid) ?? 0;
          return {
            rosterId: rid,
            managerName: managerName.get(rid) ?? `Team ${rid}`,
            assets: bucket.assets,
            received: bucket.total,
            sent,
            net: bucket.total - sent,
            label: fairnessLabel(sent, bucket.total),
          };
        });

      const best = sides.reduce((a, b) => (b.net > a.net ? b : a), sides[0]!);
      const someoneWon = sides.some((s) => s.label !== "FAIR");
      graded.push({
        transactionId: trade.transactionId,
        season: doc.season,
        week: trade.week,
        date: trade.date,
        sides,
        delta: someoneWon ? Math.max(0, best.net) : 0,
        winnerRosterId: someoneWon && best.net > 0 ? best.rosterId : null,
        fairness: someoneWon ? best.label : "FAIR",
      });
    }
  }
  // Newest first
  graded.sort((a, b) => (a.date > b.date ? -1 : a.date < b.date ? 1 : 0));
  return graded;
}

export function buildLedger(graded: GradedTrade[]): LedgerRow[] {
  const rows = new Map<number, LedgerRow>();
  for (const trade of graded) {
    for (const side of trade.sides) {
      const row =
        rows.get(side.rosterId) ??
        {
          rosterId: side.rosterId,
          managerName: side.managerName,
          trades: 0,
          wins: 0,
          losses: 0,
          ties: 0,
          netValue: 0,
        };
      rows.set(side.rosterId, row);
      row.managerName = side.managerName; // newest name wins (graded is newest-first, but harmless either way)
      row.trades += 1;
      row.netValue += side.net;
      if (side.label === "FAIR") row.ties += 1;
      else if (side.net > 0) row.wins += 1;
      else row.losses += 1;
    }
  }
  return [...rows.values()].sort((a, b) => b.netValue - a.netValue);
}
