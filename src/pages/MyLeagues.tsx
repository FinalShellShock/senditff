import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { makeApiClient, type SleeperLeagueSummary } from "../api/client.ts";
import { useAuth } from "../hooks/useAuth.tsx";
import { useLeagues } from "../hooks/useLeagues.ts";

function formatBadge(league: SleeperLeagueSummary): string {
  const parts = [league.superflex ? "SF" : "1QB", league.scoring.toUpperCase()];
  if (league.tep) parts.push("TEP");
  return parts.join(" · ");
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60_000);
  if (mins < 2) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default function MyLeagues() {
  const { authState, getToken, signOutUser } = useAuth();
  const uid = authState.status === "approved" ? authState.user.uid : "";
  const { leagues: syncedLeagues, loading: syncedLoading } = useLeagues(uid);
  const navigate = useNavigate();
  const api = makeApiClient(getToken);

  const [usernameInput, setUsernameInput] = useState("");
  const [fetchingLeagues, setFetchingLeagues] = useState(false);
  const [sleeperLeagues, setSleeperLeagues] = useState<SleeperLeagueSummary[] | null>(null);
  const [syncing, setSyncing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Whether we already have a stored Sleeper user_id (determined by whether the auto-fetch works)
  const [needsUsername, setNeedsUsername] = useState(false);
  const [initialized, setInitialized] = useState(false);

  const loadLeagues = useCallback(async (username?: string) => {
    setFetchingLeagues(true);
    setError(null);
    try {
      const { leagues } = await api.getUserLeagues(username);
      setSleeperLeagues(leagues);
      setNeedsUsername(false);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to load leagues";
      // 400 = no username stored yet and none provided
      if (msg.includes("username required")) {
        setNeedsUsername(true);
      } else {
        setError(msg);
      }
    } finally {
      setFetchingLeagues(false);
      setInitialized(true);
    }
  }, [api]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-fetch on mount if we might already have a stored Sleeper user_id
  useEffect(() => {
    if (uid) loadLeagues();
  }, [uid]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleUsernameSubmit() {
    if (!usernameInput.trim()) return;
    await loadLeagues(usernameInput.trim());
  }

  async function handleSync(leagueId: string) {
    setSyncing(leagueId);
    setError(null);
    try {
      await api.syncLeague(leagueId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sync failed");
    } finally {
      setSyncing(null);
    }
  }

  // Build a quick lookup of already-synced league metadata
  const syncedById = Object.fromEntries(syncedLeagues.map((l) => [l.leagueId, l]));

  return (
    <div className="shell">
      <div className="status-bar">
        <span className="status-brand">Send It <span className="status-beta">Beta</span></span>
        <div className="status-right">
          <button className="btn-link" onClick={signOutUser}>Sign out</button>
        </div>
      </div>

      <div className="app-content">
        <div className="page-header">
          <h2 className="page-title">My Leagues</h2>
        </div>

        {error && <div className="error-banner">{error}</div>}

        {/* Username setup — shown only if no Sleeper user_id is stored yet */}
        {needsUsername && (
          <div className="add-league">
            <h3 className="add-league-title">Connect your Sleeper account</h3>
            <p className="dim-text">Enter your Sleeper username and we'll pull your dynasty leagues automatically.</p>
            <div className="add-league-form">
              <input
                className="text-input"
                type="text"
                placeholder="Sleeper username"
                value={usernameInput}
                onChange={(e) => setUsernameInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleUsernameSubmit()}
                autoFocus
              />
              <button
                className="btn-primary"
                disabled={!usernameInput.trim() || fetchingLeagues}
                onClick={handleUsernameSubmit}
              >
                {fetchingLeagues ? "Loading..." : "Connect"}
              </button>
            </div>
          </div>
        )}

        {/* League list */}
        {!needsUsername && (
          <>
            {(fetchingLeagues && !initialized) ? (
              <p className="dim-text">Loading your leagues...</p>
            ) : sleeperLeagues !== null && (
              <>
                <div className="league-list">
                  {sleeperLeagues.length === 0 && (
                    <p className="dim-text">No dynasty leagues found on your Sleeper account.</p>
                  )}
                  {sleeperLeagues.map((league) => {
                    const synced = syncedById[league.leagueId];
                    const isSyncing = syncing === league.leagueId;
                    return (
                      <div key={league.leagueId} className="league-card">
                        <div className="league-card-main">
                          <div className="league-name">{league.name}</div>
                          <div className="league-meta-row">
                            <span className="format-badge">{formatBadge(league)}</span>
                            <span className="dim-text">{league.totalRosters} teams</span>
                            {synced?.lastRefreshed ? (
                              <span className="dim-text">synced {timeAgo(synced.lastRefreshed)}</span>
                            ) : (
                              <span className="dim-text">not synced</span>
                            )}
                          </div>
                        </div>
                        <div className="league-card-actions">
                          {synced?.lastRefreshed && (
                            <button
                              className="btn-primary"
                              onClick={() => navigate(`/league/${league.leagueId}`)}
                            >
                              Open
                            </button>
                          )}
                          <button
                            className="btn-secondary"
                            disabled={isSyncing}
                            onClick={() => handleSync(league.leagueId)}
                          >
                            {isSyncing ? "Syncing..." : synced?.lastRefreshed ? "Refresh" : "Sync"}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}>
                  <button
                    className="btn-link"
                    disabled={fetchingLeagues}
                    onClick={() => loadLeagues()}
                  >
                    {fetchingLeagues ? "Refreshing..." : "Refresh league list from Sleeper"}
                  </button>
                </div>
              </>
            )}
          </>
        )}

        {!syncedLoading && !initialized && !needsUsername && (
          <p className="dim-text">Loading...</p>
        )}
      </div>
    </div>
  );
}
