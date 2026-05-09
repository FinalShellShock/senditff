import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { makeApiClient } from "../api/client.ts";
import { useAuth } from "../hooks/useAuth.tsx";
import { useLeagues, type LeagueMeta } from "../hooks/useLeagues.ts";

function formatBadge(league: LeagueMeta): string {
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
  const { leagues, loading } = useLeagues(uid);
  const navigate = useNavigate();

  const [input, setInput] = useState("");
  const [syncing, setSyncing] = useState<string | null>(null); // leagueId or "new"
  const [error, setError] = useState<string | null>(null);

  const api = makeApiClient(getToken);

  async function handleSync(leagueId: string, label: string) {
    setSyncing(label);
    setError(null);
    try {
      await api.syncLeague(leagueId);
      if (label === "new") setInput("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sync failed");
    } finally {
      setSyncing(null);
    }
  }

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

        {loading ? (
          <p className="dim-text">Loading...</p>
        ) : leagues.length === 0 ? (
          <p className="dim-text">No leagues synced yet. Add one below.</p>
        ) : (
          <div className="league-list">
            {leagues.map((league) => (
              <div key={league.leagueId} className="league-card">
                <div className="league-card-main">
                  <div className="league-name">{league.name}</div>
                  <div className="league-meta-row">
                    {league.lastRefreshed ? (
                      <>
                        <span className="format-badge">{formatBadge(league)}</span>
                        <span className="dim-text">synced {timeAgo(league.lastRefreshed)}</span>
                      </>
                    ) : (
                      <span className="dim-text">not synced yet</span>
                    )}
                  </div>
                </div>
                <div className="league-card-actions">
                  {league.lastRefreshed && (
                    <button
                      className="btn-primary"
                      onClick={() => navigate(`/league/${league.leagueId}`)}
                    >
                      Open
                    </button>
                  )}
                  <button
                    className="btn-secondary"
                    disabled={syncing === league.leagueId}
                    onClick={() => handleSync(league.leagueId, league.leagueId)}
                  >
                    {syncing === league.leagueId ? "Syncing..." : league.lastRefreshed ? "Refresh" : "Sync"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="add-league">
          <h3 className="add-league-title">Add a league</h3>
          <p className="dim-text">Paste your Sleeper league ID. Find it in the Sleeper app under League Settings.</p>
          <div className="add-league-form">
            <input
              className="text-input"
              type="text"
              placeholder="Sleeper league ID"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && input.trim() && handleSync(input.trim(), "new")}
            />
            <button
              className="btn-primary"
              disabled={!input.trim() || syncing === "new"}
              onClick={() => handleSync(input.trim(), "new")}
            >
              {syncing === "new" ? "Syncing..." : "Sync"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
