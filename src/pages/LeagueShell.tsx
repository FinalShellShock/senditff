import { Component, useEffect, useState, type ReactNode } from "react";
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
  const [error, setError] = useState<string | null>(null);

  async function load() {
    if (!id) return;
    try {
      const data = await api.getOverview(id);
      setOverview(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load league");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  const formatStr = overview
    ? `${overview.format.superflex ? "SF" : "1QB"} · ${overview.format.scoring.toUpperCase()}${overview.format.tep ? " · TEP" : ""}`
    : "";

  const isTeamsRoute = location.pathname.includes("/team/");
  const isSendItRoute = location.pathname.includes("/sendit/");

  const rosterMatch = location.pathname.match(/\/(?:team|sendit)\/(\d+)/);
  const currentRosterId = rosterMatch ? Number(rosterMatch[1]) : null;
  const rankedFirst = overview?.profiles.slice().sort((a, b) => a.starterRank - b.starterRank)[0];
  const navTeam = currentRosterId
    ? overview?.profiles.find((p) => p.rosterId === currentRosterId)
    : rankedFirst;

  return (
    <div className="shell">
      <div className="status-bar">
        <div className="status-left">
          <button className="btn-link" onClick={() => navigate("/")}>← Leagues</button>
          {overview && <span className="status-brand">{overview.name}</span>}
        </div>
        <div className="status-right">
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
          to={navTeam ? `/league/${id}/sendit/${navTeam.rosterId}` : "#"}
          className={`league-nav-tab${isSendItRoute ? " active" : ""}${!navTeam ? " disabled" : ""}`}
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
            <Outlet context={{ overview, reload: load } satisfies LeagueOutletContext} />
          </ContentErrorBoundary>
        ) : null}
      </div>
    </div>
  );
}
