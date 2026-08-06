import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useLeagues } from "../hooks/useLeagues.ts";

/**
 * League switcher for the status bar.
 *
 * Replaces a "← Leagues" button that sent you to a separate page whose only
 * job was picking a league. Switching leagues is a two-click action from
 * anywhere now, and it never loses the tab you were on.
 *
 * It also carries the last-synced time, which previously lived only on the
 * overview tab behind a "League data is outdated" banner. That meant the one
 * fact you need before trusting a number was on a different page from every
 * number.
 */

/** "just now" / "14m ago" / "3h ago" / "2d ago". Null when never synced. */
function syncedAgo(iso: string | null): string | null {
  if (!iso) return null;
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return null;
  const mins = Math.floor((Date.now() - then) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export default function LeagueSelector({
  uid,
  currentLeagueId,
  currentName,
  lastRefreshed,
}: {
  uid: string;
  currentLeagueId: string;
  currentName: string;
  /** From the loaded overview, so it reflects the data actually on screen. */
  lastRefreshed: string | null;
}) {
  const navigate = useNavigate();
  const { leagues } = useLeagues(uid);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Close on outside click and on Escape. Without both, the menu stays open
  // behind the next page after a navigation on mobile.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const ago = syncedAgo(lastRefreshed);
  const others = leagues.filter((l) => l.leagueId !== currentLeagueId);

  return (
    <div className="league-select" ref={wrapRef}>
      <button
        className="league-select-btn"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="listbox"
      >
        <span className="league-select-name">{currentName}</span>
        <span className="league-select-caret" aria-hidden="true">
          {open ? "▴" : "▾"}
        </span>
      </button>
      {/* Outside the button so it reads on its own line and is never mistaken
          for part of the league's name. */}
      <span className="league-select-synced">
        {ago ? `synced ${ago}` : "never synced"}
      </span>

      {open && (
        <div className="league-select-menu" role="listbox">
          {others.length === 0 && (
            <div className="league-select-empty">No other leagues synced.</div>
          )}
          {others.map((l) => {
            const other = syncedAgo(l.lastRefreshed);
            return (
              <button
                key={l.leagueId}
                className="league-select-item"
                role="option"
                aria-selected={false}
                onClick={() => {
                  setOpen(false);
                  navigate(`/league/${l.leagueId}`);
                }}
              >
                <span className="league-select-item-name">{l.name}</span>
                <span className="league-select-item-meta">
                  {other ? `synced ${other}` : "never synced"}
                </span>
              </button>
            );
          })}
          <button
            className="league-select-item league-select-all"
            onClick={() => {
              setOpen(false);
              navigate("/");
            }}
          >
            Add or manage leagues
          </button>
        </div>
      )}
    </div>
  );
}
