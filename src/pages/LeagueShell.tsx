import { Component, useEffect, useRef, useState, type ReactNode } from "react";
import { NavLink, Outlet, useLocation, useNavigate, useParams } from "react-router-dom";
import { makeApiClient, type OverviewResponse } from "../api/client.ts";
import { useAuth } from "../hooks/useAuth.tsx";

class ContentErrorBoundary extends Component<
  { children: ReactNode; onReset: () => void },
  { caught: Error | null }
> {
  state: { caught: Error | null } = { caught: null };
  static getDerivedStateFromError(e: Error) { return { caught: e }; }
  render() {
    if (this.state.caught) {
      return (
        <div className="error-banner" style={{ marginTop: 32 }}>
          <div style={{ marginBottom: 8, fontWeight: 700 }}>Failed to render league data</div>
          <div style={{ marginBottom: 12, opacity: 0.8 }}>{this.state.caught.message}</div>
          <div style={{ marginBottom: 12, opacity: 0.7, fontSize: 11 }}>
            Your league data is from an older version. Refresh to fix this.
          </div>
          <button className="btn-secondary" onClick={() => { this.setState({ caught: null }); this.props.onReset(); }}>
            Refresh Data
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export type LeagueOutletContext = {
  overview: OverviewResponse;
  reload: () => Promise<void>;
};

export default function LeagueShell() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { getToken } = useAuth();
  const api = makeApiClient(getToken);

  const [overview, setOverview] = useState<OverviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [resyncing, setResyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load(): Promise<OverviewResponse | null> {
    if (!id) return null;
    try {
      const data = await api.getOverview(id);
      setOverview(data);
      return data;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load league");
      return null;
    } finally {
      setLoading(false);
    }
  }

  // At most one auto-resync per league per mount, so a league that keeps
  // failing to sync can't spin. StrictMode double-invokes this effect in dev;
  // the check-and-set below is synchronous, so the second pass bails out.
  const resyncedFor = useRef<string | null>(null);

  // Cached profiles paint immediately, then anything past the server's TTL
  // gets refreshed in the background. That's the whole auto-sync: no cron,
  // no cost when nobody's looking.
  async function loadAndFreshen() {
    const data = await load();
    if (!data?.stale || !id) return;
    if (resyncedFor.current === id) return;
    resyncedFor.current = id;

    setResyncing(true);
    try {
      await api.syncLeague(id);
      await load();
    } catch {
      // A failed refresh is not worth an error banner: the stale data on
      // screen is still perfectly usable, and Refresh is one click away.
    } finally {
      setResyncing(false);
    }
  }

  useEffect(() => { loadAndFreshen(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  const fmt = overview?.format;
  const formatStr = fmt
    ? `${fmt.superflex ? "SF" : "1QB"} · ${fmt.scoring?.toUpperCase() ?? "PPR"}${fmt.tep ? " · TEP" : ""}`
    : "";

  const isTeamsRoute = location.pathname.includes("/team/");
  const isSendItRoute = location.pathname.includes("/sendit/");

  const rosterMatch = location.pathname.match(/\/(?:team|sendit)\/(\d+)/);
  const currentRosterId = rosterMatch ? Number(rosterMatch[1]) : null;
  // Tab default: your own team, falling back to the #1 team for leagues
  // you're viewing without a roster.
  const defaultTeam =
    overview?.profiles.find((p) => p.isMine)
    ?? overview?.profiles.slice().sort((a, b) => a.starterRank - b.starterRank)[0];
  const navTeam = currentRosterId
    ? overview?.profiles.find((p) => p.rosterId === currentRosterId)
    : defaultTeam;

  return (
    <div className="shell">
      <div className="status-bar">
        <div className="status-left">
          <button className="btn-link" onClick={() => navigate("/")}>← Leagues</button>
          {overview && <span className="status-brand">{overview.name}</span>}
        </div>
        <div className="status-right">
          {resyncing && <span className="dim-text" style={{ color: "#f59e0b" }}>syncing...</span>}
          {formatStr && <span className="dim-text">{formatStr}</span>}
        </div>
      </div>

      <nav className="league-nav">
        <NavLink
          to={`/league/${id}`}
          end
          className={({ isActive }) => `league-nav-tab${isActive ? " active" : ""}`}
        >
          OVERVIEW
        </NavLink>
        <NavLink
          to={navTeam ? `/league/${id}/team/${navTeam.rosterId}` : "#"}
          className={`league-nav-tab${isTeamsRoute ? " active" : ""}${!navTeam ? " disabled" : ""}`}
        >
          TEAMS
        </NavLink>
        <NavLink
          to={`/league/${id}/calc`}
          className={({ isActive }) => `league-nav-tab${isActive ? " active" : ""}`}
        >
          CALC
        </NavLink>
        <NavLink
          to={`/league/${id}/rankings`}
          className={({ isActive }) => `league-nav-tab${isActive ? " active" : ""}`}
        >
          RANKINGS
        </NavLink>
        <NavLink
          to={`/league/${id}/trades`}
          className={({ isActive }) => `league-nav-tab${isActive ? " active" : ""}`}
        >
          GRADES
        </NavLink>
        <NavLink
          to={navTeam ? `/league/${id}/sendit/${navTeam.rosterId}` : "#"}
          className={`league-nav-tab league-nav-sendit${isSendItRoute ? " active" : ""}${!navTeam ? " disabled" : ""}`}
        >
          SEND IT
        </NavLink>
      </nav>

      <div className="app-content">
        {error && <div className="error-banner">{error}</div>}
        {loading ? (
          <p className="dim-text" style={{ marginTop: 48, textAlign: "center" }}>Loading league...</p>
        ) : overview ? (
          <ContentErrorBoundary onReset={async () => { await makeApiClient(getToken).syncLeague(id!).catch(() => {}); await load(); }}>
            <Outlet context={{ overview, reload: async () => { await load(); } } satisfies LeagueOutletContext} />
          </ContentErrorBoundary>
        ) : null}
      </div>
    </div>
  );
}
