import type { TeamProfile } from "../algo/types.ts";

export type TradePackage = {
  counterTeam: string;
  counterRosterId: number;
  give: Array<{ id: string; name: string; position: string; valueDynasty: number }>;
  receive: Array<{ id: string; name: string; position: string; valueDynasty: number }>;
  valueGive: number;
  valueReceive: number;
  archetype: string;
  rationale: string;
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

    getOverview: (leagueId: string) =>
      apiFetch<OverviewResponse>(getToken, `/api/leagues/overview?leagueId=${leagueId}`),

    findTrades: (leagueId: string, rosterId: number) =>
      apiFetch<{ packages: TradePackage[] }>(getToken, "/api/trades/find", {
        method: "POST",
        body: JSON.stringify({ leagueId, rosterId }),
      }),
  };
}
