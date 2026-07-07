import { useEffect, useRef, useState } from "react";
import { useNavigate, useOutletContext, useParams, useSearchParams } from "react-router-dom";
import { ARCHETYPE_FAMILIES, POSITIONAL_FAMILIES, type ArchetypeFamily } from "../algo/archetypes.ts";
import { fairnessColor, fairnessLabel, fairnessText } from "../algo/fairness.ts";
import type { Position } from "../algo/types.ts";
import {
  makeApiClient,
  type FindTradesResponse,
  type TradeAssetWire,
  type TradeDiagnostics,
  type TradePackage,
} from "../api/client.ts";
import { useAuth } from "../hooks/useAuth.tsx";
import type { LeagueOutletContext } from "./LeagueShell.tsx";

const POSITIONS: Position[] = ["QB", "RB", "WR", "TE"];

// Friendly intent names for the archetype families. "" = auto (all families).
const INTENT_LABELS: Record<ArchetypeFamily, string> = {
  need_fill: "Fill a need",
  tier_down: "Tier down (1 into 2)",
  consolidate: "Consolidate (2 into 1)",
  consolidate_flex: "Consolidate flex depth",
  age_arb_buy: "Buy an aging stud",
  age_arb_sell: "Sell an aging stud",
  push_in: "Push all-in",
  capital_convert_picks_to_production: "Picks to players",
  capital_convert_production_to_picks: "Players to picks",
};

function posColor(pos?: string) {
  const map: Record<string, string> = { QB: "#c2410c", RB: "#ca8a04", WR: "#3b82f6", TE: "#a855f7" };
  return pos ? map[pos] ?? "#94a3b8" : "#475569";
}

function AssetList({ assets }: { assets: TradeAssetWire[] }) {
  return (
    <span className="trade-names">
      {assets.map((a, i) => (
        <span key={a.id} className="trade-asset">
          <span
            className="trade-asset-tag"
            style={{ background: a.kind === "pick" ? "#475569" : posColor(a.position) }}
          >
            {a.kind === "pick" ? "PICK" : a.position}
          </span>
          <span className="trade-asset-name">{a.name}</span>
          {i < assets.length - 1 && <span className="trade-asset-sep"> + </span>}
        </span>
      ))}
    </span>
  );
}

function TradeCard({ pkg }: { pkg: TradePackage }) {
  const delta = pkg.valueReceive - pkg.valueGive;
  const deltaColor = delta > 200 ? "#22c55e" : delta < -200 ? "#ef4444" : "#94a3b8";
  // Older API responses don't carry fairness; the label is derivable.
  const fairness = pkg.fairness ?? fairnessLabel(pkg.valueGive, pkg.valueReceive);

  return (
    <div className="trade-card">
      <div className="trade-card-header">
        <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span className="trade-arch-tag">{pkg.archetype.replace(/_/g, " ")}</span>
          <span
            className="fairness-badge"
            style={{ borderColor: fairnessColor(fairness), color: fairnessColor(fairness), marginTop: 0 }}
          >
            {fairnessText(fairness)}
          </span>
        </span>
        <span className="trade-counter-team">{pkg.counterTeam}</span>
      </div>
      <div className="trade-players">
        <div className="trade-side">
          <span className="trade-dir">SEND</span>
          <AssetList assets={pkg.give} />
          <span className="trade-val">{pkg.valueGive.toLocaleString()}</span>
        </div>
        <div className="trade-arrow">⇄</div>
        <div className="trade-side trade-side-receive">
          <span className="trade-dir">GET</span>
          <AssetList assets={pkg.receive} />
          <span className="trade-val" style={{ color: deltaColor }}>{pkg.valueReceive.toLocaleString()}</span>
        </div>
      </div>
      {pkg.scores && (
        <div className="trade-score-strip">
          fit {pkg.scores.myFit >= 0 ? "+" : ""}{pkg.scores.myFit.toFixed(2)}
          {" · "}their fit {pkg.scores.theirFit >= 0 ? "+" : ""}{pkg.scores.theirFit.toFixed(2)}
          {" · "}balance {Math.round(pkg.scores.balance * 100)}%
        </div>
      )}
      {pkg.rationale && <p className="trade-rationale">{pkg.rationale}</p>}
    </div>
  );
}

// Deterministic "here's why" copy for empty results, composed from the
// engine's diagnostics. No Claude involved.
function EmptyState({
  diagnostics, intent, targetName, onReset,
}: {
  diagnostics: TradeDiagnostics;
  intent: ArchetypeFamily | "";
  targetName: string | null;
  onReset: () => void;
}) {
  const intentLabel = intent ? INTENT_LABELS[intent] : null;
  const lines: string[] = [];

  if (diagnostics.rawCandidates === 0) {
    if (intent && (diagnostics.myArchetypeScore ?? 0) < 30) {
      lines.push(
        `This roster doesn't really fit "${intentLabel}" (archetype fit ${diagnostics.myArchetypeScore}/100), and no packages of that shape could be built${targetName ? ` with ${targetName}` : ""}.`,
      );
    } else {
      lines.push(
        `No packages of this shape could be built${targetName ? ` with ${targetName}` : " from these rosters"}: the pieces just don't line up on value.`,
      );
    }
  } else {
    const parts: string[] = [];
    if (diagnostics.rejected.myFit > 0) parts.push(`${diagnostics.rejected.myFit} didn't improve this roster enough`);
    if (diagnostics.rejected.theirFit > 0) parts.push(`${diagnostics.rejected.theirFit} made no sense for the other side`);
    if (diagnostics.rejected.balance > 0) parts.push(`${diagnostics.rejected.balance} were too lopsided on value`);
    lines.push(
      `Built ${diagnostics.afterDedup} candidate package${diagnostics.afterDedup === 1 ? "" : "s"}, but none survived scoring: ${parts.join(", ")}.`,
    );
  }
  if (diagnostics.counterNote) lines.push(`${diagnostics.counterNote}.`);

  return (
    <div className="sendit-empty">
      {lines.map((l, i) => <p key={i} className="dim-text">{l}</p>)}
      {(intent || targetName) && (
        <button className="sendit-reset-btn" onClick={onReset}>
          Reset to best available, all teams
        </button>
      )}
    </div>
  );
}

export default function SendIt() {
  const { id: leagueId, rosterId: rosterIdStr } = useParams<{ id: string; rosterId: string }>();
  const rosterId = Number(rosterIdStr);
  const navigate = useNavigate();
  const { getToken } = useAuth();
  const { overview } = useOutletContext<LeagueOutletContext>();
  const api = makeApiClient(getToken);
  const [searchParams, setSearchParams] = useSearchParams();

  // Controls, initialized from URL so other pages can deep-link
  // (?archetype=need_fill&pos=RB&target=4).
  const urlArchetype = searchParams.get("archetype") ?? "";
  const [intent, setIntent] = useState<ArchetypeFamily | "">(
    ARCHETYPE_FAMILIES.includes(urlArchetype as ArchetypeFamily) ? (urlArchetype as ArchetypeFamily) : "",
  );
  const urlPos = searchParams.get("pos") ?? "";
  const [position, setPosition] = useState<Position | "">(
    POSITIONS.includes(urlPos as Position) ? (urlPos as Position) : "",
  );
  const urlTarget = searchParams.get("target");
  const [target, setTarget] = useState<number | "">(
    urlTarget != null && Number(urlTarget) !== rosterId ? Number(urlTarget) : "",
  );

  const [result, setResult] = useState<FindTradesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const showPosition = intent !== "" && POSITIONAL_FAMILIES.includes(intent);

  function runSearch(opts: { intent: ArchetypeFamily | ""; position: Position | ""; target: number | "" }) {
    if (!leagueId || !rosterId) return;
    setResult(null);
    setLoading(true);
    setError(null);
    const usePosition = opts.intent !== "" && POSITIONAL_FAMILIES.includes(opts.intent) ? opts.position : "";
    // Keep the URL shareable
    const next = new URLSearchParams();
    if (opts.intent) next.set("archetype", opts.intent);
    if (usePosition) next.set("pos", usePosition);
    if (opts.target !== "") next.set("target", String(opts.target));
    setSearchParams(next, { replace: true });

    api.findTrades(leagueId, rosterId, {
      ...(opts.intent ? { archetype: opts.intent } : {}),
      ...(usePosition ? { position: usePosition } : {}),
      ...(opts.target !== "" ? { targetRosterId: opts.target } : {}),
    })
      .then(setResult)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to find trades"))
      .finally(() => setLoading(false));
  }

  // Auto-fetch once per team with whatever the controls say (URL-seeded on
  // first mount). After that, fetches happen on the button only.
  const lastAutoKey = useRef<string | null>(null);
  useEffect(() => {
    const key = `${leagueId}:${rosterId}`;
    if (lastAutoKey.current === key) return;
    lastAutoKey.current = key;
    // A stale target equal to the new perspective team gets cleared.
    const effectiveTarget = target !== "" && target === rosterId ? "" : target;
    if (effectiveTarget !== target) setTarget(effectiveTarget);
    runSearch({ intent, position, target: effectiveTarget });
  }, [leagueId, rosterId]); // eslint-disable-line react-hooks/exhaustive-deps

  const profile = overview.profiles.find((p) => p.rosterId === rosterId);
  const sortedTeams = [...overview.profiles].sort((a, b) => a.starterRank - b.starterRank);
  const targetName =
    target !== "" ? overview.profiles.find((p) => p.rosterId === target)?.ownerName ?? null : null;

  function resetControls() {
    setIntent("");
    setPosition("");
    setTarget("");
    runSearch({ intent: "", position: "", target: "" });
  }

  return (
    <>
      <div className="dive-header">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <h1 className="dive-owner">{profile?.ownerName ?? "—"}</h1>
          <div className="team-switcher">
            <span className="dim-text" style={{ fontSize: 10, letterSpacing: 1 }}>TEAM</span>
            <select
              className="team-switcher-select"
              value={rosterId}
              onChange={(e) => navigate(`/league/${leagueId}/sendit/${e.target.value}?${searchParams.toString()}`)}
            >
              {sortedTeams.map((t) => (
                <option key={t.rosterId} value={t.rosterId}>
                  #{t.starterRank} {t.ownerName}{t.isMine ? " ★" : ""}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div className="sendit-controls">
        <label className="sendit-control">
          <span className="sendit-control-label">INTENT</span>
          <select
            className="team-switcher-select"
            value={intent}
            onChange={(e) => setIntent(e.target.value as ArchetypeFamily | "")}
          >
            <option value="">Best available (auto)</option>
            {ARCHETYPE_FAMILIES.map((f) => (
              <option key={f} value={f}>{INTENT_LABELS[f]}</option>
            ))}
          </select>
        </label>

        {showPosition && (
          <label className="sendit-control">
            <span className="sendit-control-label">POSITION</span>
            <select
              className="team-switcher-select"
              value={position}
              onChange={(e) => setPosition(e.target.value as Position | "")}
            >
              <option value="">Any</option>
              {POSITIONS.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </label>
        )}

        <label className="sendit-control">
          <span className="sendit-control-label">WITH</span>
          <select
            className="team-switcher-select"
            value={target}
            onChange={(e) => setTarget(e.target.value === "" ? "" : Number(e.target.value))}
          >
            <option value="">Scan all teams</option>
            {sortedTeams
              .filter((t) => t.rosterId !== rosterId)
              .map((t) => (
                <option key={t.rosterId} value={t.rosterId}>{t.ownerName}</option>
              ))}
          </select>
        </label>

        <button
          className="sendit-find-btn"
          disabled={loading}
          onClick={() => runSearch({ intent, position, target })}
        >
          FIND TRADES
        </button>
      </div>

      {error && <div className="error-banner">{error}</div>}

      {loading && (
        <div className="trades-loading">
          <span className="dim-text">Generating trade packages...</span>
        </div>
      )}

      {result && result.packages.length === 0 && (
        result.diagnostics ? (
          <EmptyState
            diagnostics={result.diagnostics}
            intent={intent}
            targetName={targetName}
            onReset={resetControls}
          />
        ) : (
          <p className="dim-text">No trade packages found for this team.</p>
        )
      )}

      {result && result.packages.length > 0 && (
        <div className="trade-list">
          {result.packages.map((pkg, i) => <TradeCard key={i} pkg={pkg} />)}
        </div>
      )}
    </>
  );
}
