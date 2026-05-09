import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate, useParams } from "react-router-dom";
import { makeApiClient, type OverviewResponse } from "../api/client.ts";
import { useAuth } from "../hooks/useAuth.tsx";

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

  const myProfile = overview?.profiles.find((p) => p.isMine);
  const formatStr = overview
    ? `${overview.format.superflex ? "SF" : "1QB"} · ${overview.format.scoring.toUpperCase()}${overview.format.tep ? " · TEP" : ""}`
    : "";

  const isTeamsRoute = location.pathname.includes("/team/");

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
          to={myProfile ? `/league/${id}/team/${myProfile.rosterId}` : "#"}
          className={`league-nav-tab${isTeamsRoute ? " active" : ""}${!myProfile ? " disabled" : ""}`}
        >
          {myProfile ? myProfile.ownerName.toUpperCase() : "MY TEAM"}
        </NavLink>
        <NavLink
          to={`/league/${id}/trade`}
          className={({ isActive }) => `league-nav-tab${isActive ? " active" : ""}`}
        >
          TRADE EVAL
        </NavLink>
      </nav>

      <div className="app-content">
        {error && <div className="error-banner">{error}</div>}
        {loading ? (
          <p className="dim-text" style={{ marginTop: 48, textAlign: "center" }}>Loading league...</p>
        ) : overview ? (
          <Outlet context={{ overview, reload: load } satisfies LeagueOutletContext} />
        ) : null}
      </div>
    </div>
  );
}
