import type { ArchetypeFamily } from "../algo/archetypes.ts";
import type { FairnessLabel } from "../algo/fairness.ts";
import type { Position, TeamProfile } from "../algo/types.ts";

export type TradeAssetWire = {
  id: string;
  kind: "player" | "pick";
  name: string;
  position?: string;
  valueDynasty: number;
};

export type TradePackage = {
  counterTeam: string;
  counterRosterId: number;
  give: TradeAssetWire[];
  receive: TradeAssetWire[];
  valueGive: number;
  valueReceive: number;
  archetype: string;
  fairness: FairnessLabel;
  scores: {
    total: number;
    myFit: number;
    theirFit: number;
    balance: number;
    archMatch: number;
  };
  rationale: string;
};

export type TradeDiagnostics = {
  rawCandidates: number;
  afterDedup: number;
  rejected: { myFit: number; theirFit: number; balance: number };
  forced: boolean;
  myArchetypeScore?: number;
  counterNote?: string;
};

export type FindTradesOptions = {
  archetype?: ArchetypeFamily;
  position?: Position;
  targetRosterId?: number;
};

export type FindTradesResponse = {
  packages: TradePackage[];
  diagnostics: TradeDiagnostics;
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
  format: {
    superflex: boolean;
    scoring: "ppr" | "half" | "std";
    tep: boolean;
  };
  lastRefreshed: string;
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
  };
}
