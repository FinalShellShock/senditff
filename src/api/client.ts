import type { ArchetypeFamily } from "../algo/archetypes.ts";
import type { FairnessLabel } from "../algo/fairness.ts";
import type { LeagueFormat, Position, TeamProfile } from "../algo/types.ts";

export type TradeAssetWire = {
  id: string;
  kind: "player" | "pick";
  name: string;
  position?: string;
  valueDynasty: number;
  age?: number;
};

export type TradePackage = {
  counterTeam: string;
  counterRosterId: number;
  give: TradeAssetWire[];
  receive: TradeAssetWire[];
  valueGive: number;
  valueReceive: number;
  archetype: string;
  // Optional so responses from an older API deploy don't break the UI; the
  // page computes fairness from the values when absent.
  fairness?: FairnessLabel;
  scores?: {
    total: number;
    myFit: number;
    theirFit: number;
    balance: number;
    archMatch: number;
  };
  // Consolidation-adjusted side values. The engine does not treat a package as
  // the plain sum of its parts: bundles decay and the side holding the single
  // best asset charges a premium. These are what `balance` and the fairness
  // label are actually computed from, and they will differ from the raw sums.
  adjValueGive?: number;
  adjValueReceive?: number;
  // How strongly this package fits its archetype, and the bucket the rationale
  // writer was told to use. Same source, so badge and prose never disagree.
  confidence?: {
    tier: "recommended" | "measured" | "inspiration";
    archMatch: number; // 0-1
  };
  rationale: string;
  // The exact prompt sent to Haiku to write `rationale`. Optional: responses
  // from an older API deploy won't have it.
  prompt?: string;
};

export type TradeDiagnostics = {
  rawCandidates: number;
  afterDedup: number;
  rejected: { myFit: number; theirFit: number; balance: number };
  forced: boolean;
  myArchetypeScore?: number;
  counterNote?: string;
  degraded?: "no_archetype" | "gates";
};

export type FindTradesOptions = {
  archetype?: ArchetypeFamily;
  position?: Position;
  targetRosterId?: number;
  noFillerPicks?: boolean;
};

export type FindTradesResponse = {
  packages: TradePackage[];
  diagnostics?: TradeDiagnostics;
};

export type FeedbackVerdict = "up" | "down";

export type FeedbackPayload = {
  verdict: FeedbackVerdict;
  reasons: string[];
  comment: string;
  leagueId: string;
  rosterId: number;
  packageIndex: number;
  search: {
    archetype: string | null;
    position: string | null;
    targetRosterId: number | null;
    noFillerPicks: boolean;
  };
  package: TradePackage;
  diagnostics: TradeDiagnostics | null;
};

// ── Site feedback (footer bell + form) ──────────────────────────────────

export type SiteFeedbackPayload = {
  kind: "site";
  comment: string;
  /** Key from src/data/feedbackCategories.ts. */
  category?: string;
  route?: string;
};

export type FeedbackSummary = {
  total: number;
  mine: number;
  others: number;
  unreviewed: number;
};

// ── Admin: join requests ────────────────────────────────────────────────

export type PendingUser = {
  uid: string;
  email: string;
  displayName: string | null;
  createdAt: string | null;
};

// ── Trade Grades (league trade history, graded at today's values) ───────────

export type GradedAsset = {
  kind: "player" | "pick" | "faab";
  name: string;
  position?: string;
  todayValue: number;
  note?: string; // "off_board" | "drafted:<name>" | "unresolved_pick"
};

export type GradedSide = {
  rosterId: number;
  managerName: string;
  assets: GradedAsset[];
  received: number;
  sent: number;
  net: number;
  label: FairnessLabel;
};

export type GradedTrade = {
  transactionId: string;
  season: number;
  week: number;
  date: string;
  sides: GradedSide[];
  delta: number;
  winnerRosterId: number | null;
  fairness: FairnessLabel;
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

export type TradesResponse = {
  needsBackfill: boolean;
  trades: GradedTrade[];
  ledger: LedgerRow[];
  valuesAsOf: string;
  seasons: number[];
};

type GetTokenFn = () => Promise<string>;

async function apiFetch<T>(
  getToken: GetTokenFn,
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const token = await getToken();
  const res = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(options.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, (body as { error?: string }).error ?? res.statusText);
  }
  return res.json() as Promise<T>;
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export type SleeperLeagueSummary = {
  leagueId: string;
  name: string;
  season: string;
  status: string;
  totalRosters: number;
  superflex: boolean;
  scoring: "ppr" | "half" | "std";
  tep: boolean;
};

export type SyncResponse = {
  leagueId: string;
  name: string;
  profiles: TeamProfile[];
};

export type OverviewResponse = {
  leagueId: string;
  name: string;
  // Sync stores the complete detected format (starter slots included).
  format: LeagueFormat;
  lastRefreshed: string;
  // True once the cached league data is past the server's TTL. Optional so a
  // response from an older API deploy doesn't read as stale and trigger a
  // pointless re-sync on every view.
  stale?: boolean;
  upcomingDraftYear: number | null;
  profiles: TeamProfile[];
};

export function makeApiClient(getToken: GetTokenFn) {
  return {
    syncLeague: (leagueId: string) =>
      apiFetch<SyncResponse>(getToken, "/api/leagues/sync", {
        method: "POST",
        body: JSON.stringify({ leagueId }),
      }),

    getUserLeagues: (username?: string) =>
      apiFetch<{ leagues: SleeperLeagueSummary[] }>(
        getToken,
        username ? `/api/user/leagues?username=${encodeURIComponent(username)}` : "/api/user/leagues",
      ),

    getOverview: (leagueId: string) =>
      apiFetch<OverviewResponse>(getToken, `/api/leagues/overview?leagueId=${leagueId}`),

    findTrades: (leagueId: string, rosterId: number, opts: FindTradesOptions = {}) =>
      apiFetch<FindTradesResponse>(getToken, "/api/trades/find", {
        method: "POST",
        body: JSON.stringify({ leagueId, rosterId, ...opts }),
      }),

    getTrades: (leagueId: string) =>
      apiFetch<TradesResponse>(getToken, `/api/leagues/trades?leagueId=${leagueId}`),

    refreshTrades: (leagueId: string) =>
      apiFetch<TradesResponse>(getToken, "/api/leagues/trades", {
        method: "POST",
        body: JSON.stringify({ leagueId }),
      }),

    submitFeedback: (payload: FeedbackPayload) =>
      apiFetch<{ ok: true; id: string }>(getToken, "/api/feedback", {
        method: "POST",
        body: JSON.stringify(payload),
      }),

    getFeedbackSummary: () => apiFetch<FeedbackSummary>(getToken, "/api/feedback"),

    getPendingUsers: () => apiFetch<{ pending: PendingUser[] }>(getToken, "/api/admin/users"),

    decideUser: (uid: string, action: "approve" | "deny") =>
      apiFetch<{ ok: true }>(getToken, "/api/admin/users", {
        method: "POST",
        body: JSON.stringify({ uid, action }),
      }),

    submitSiteFeedback: (payload: SiteFeedbackPayload) =>
      apiFetch<{ ok: true; id: string }>(getToken, "/api/feedback", {
        method: "POST",
        body: JSON.stringify(payload),
      }),
  };
}
