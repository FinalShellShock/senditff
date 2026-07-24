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

type ApiClient = ReturnType<typeof makeApiClient>;

type ResultSearchContext = {
  archetype: string | null;
  position: string | null;
  targetRosterId: number | null;
  noFillerPicks: boolean;
};

const POSITIONS: Position[] = ["QB", "RB", "WR", "TE"];

// Friendly intent names for the archetype families. "" = auto (all families).
const INTENT_LABELS: Record<ArchetypeFamily, string> = {
  need_fill: "Fill a need",
  tier_down: "Tier down (1 stud into 2 pieces)",
  consolidate: "Consolidate (2 same-position into 1 stud)",
  consolidate_flex: "Bundle flex spares into a starter",
  age_arb_buy: "Buy an aging stud",
  age_arb_sell: "Sell an aging stud",
  push_in: "Push all-in",
  capital_convert_picks_to_production: "Picks to players",
  capital_convert_production_to_picks: "Players to picks",
};

// Fit scores run in [-1, 1] internally with 0 = neutral. Percentages read
// wrong (50% looks failing), so users get letter grades: C is neutral.
function fitGrade(fit: number): string {
  if (fit >= 0.5) return "A+";
  if (fit >= 0.3) return "A";
  if (fit >= 0.15) return "B+";
  if (fit >= 0.05) return "B";
  if (fit >= -0.05) return "C";
  if (fit >= -0.15) return "C-";
  if (fit >= -0.3) return "D";
  return "F";
}

function gradeColor(grade: string): string {
  if (grade === "A+" || grade === "A") return "#22c55e";
  if (grade === "B+" || grade === "B") return "#4ade80";
  if (grade === "C" || grade === "C-") return "#94a3b8";
  if (grade === "D") return "#eab308";
  return "#ef4444";
}

function FitGrade({ fit }: { fit: number }) {
  const grade = fitGrade(fit);
  return (
    <span
      style={{ color: gradeColor(grade), fontWeight: 700 }}
      title="C is neutral. Grades reflect how much the trade helps or hurts this roster."
    >
      {grade}
    </span>
  );
}

function posColor(pos?: string) {
  const map: Record<string, string> = { QB: "#c2410c", RB: "#ca8a04", WR: "#3b82f6", TE: "#a855f7" };
  return pos ? map[pos] ?? "#94a3b8" : "#475569";
}

const DOWN_REASONS: Array<{ key: string; label: string }> = [
  { key: "fit_me", label: "Doesn't fit for me" },
  { key: "fit_them", label: "Doesn't fit for them" },
  { key: "archetype_mismatch", label: "Doesn't match the archetype" },
  { key: "unbalanced", label: "Value is unbalanced" },
  { key: "unrealistic", label: "They'd never accept" },
  { key: "wrong_players", label: "Wrong players targeted" },
  { key: "bad_rationale", label: "Rationale is off" },
];

const UP_REASONS: Array<{ key: string; label: string }> = [
  { key: "fit_me_good", label: "Great fit for me" },
  { key: "fit_them_good", label: "Realistic for them" },
  { key: "archetype_match", label: "Nails the archetype" },
  { key: "fair_value", label: "Value feels fair" },
  { key: "good_rationale", label: "Rationale is sharp" },
  { key: "would_send", label: "I'd actually send this" },
];

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

function TradeCard({
  pkg, index, leagueId, rosterId, search, diagnostics, api,
}: {
  pkg: TradePackage;
  index: number;
  leagueId: string;
  rosterId: number;
  search: ResultSearchContext;
  diagnostics: TradeDiagnostics | null;
  api: ApiClient;
}) {
  const delta = pkg.valueReceive - pkg.valueGive;
  const deltaColor = delta > 200 ? "#22c55e" : delta < -200 ? "#ef4444" : "#94a3b8";
  // Older API responses don't carry fairness; the label is derivable.
  const fairness = pkg.fairness ?? fairnessLabel(pkg.valueGive, pkg.valueReceive);

  const [verdict, setVerdict] = useState<"up" | "down" | null>(null);
  const [reasons, setReasons] = useState<string[]>([]);
  const [comment, setComment] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  function pickVerdict(next: "up" | "down") {
    if (sent) return;
    if (verdict === next) {
      // Toggle off.
      setVerdict(null);
      setReasons([]);
      return;
    }
    // Either opening fresh or switching sides: the reason keys differ
    // between up and down, so always clear.
    setVerdict(next);
    setReasons([]);
    setSendError(null);
  }

  function toggleReason(key: string) {
    setReasons((prev) => (prev.includes(key) ? prev.filter((r) => r !== key) : [...prev, key]));
  }

  function submit() {
    if (!verdict || sending) return;
    setSending(true);
    setSendError(null);
    api
      .submitFeedback({
        verdict,
        reasons,
        comment: comment.trim(),
        leagueId,
        rosterId,
        packageIndex: index,
        search,
        package: pkg,
        diagnostics,
      })
      .then(() => setSent(true))
      .catch((e) => setSendError(e instanceof Error ? e.message : "Failed to send feedback"))
      .finally(() => setSending(false));
  }

  const reasonOptions = verdict === "down" ? DOWN_REASONS : UP_REASONS;

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
          fit for you <FitGrade fit={pkg.scores.myFit} />
          {" · "}fit for them <FitGrade fit={pkg.scores.theirFit} />
          {" · "}value balance {Math.round(pkg.scores.balance * 100)}%
        </div>
      )}
      {pkg.rationale && <p className="trade-rationale">{pkg.rationale}</p>}

      <div className="trade-feedback-bar">
        <button
          type="button"
          className={`trade-feedback-btn${verdict === "up" ? " trade-feedback-btn-up" : ""}`}
          onClick={() => pickVerdict("up")}
          disabled={sent}
          aria-pressed={verdict === "up"}
          title="Good trade"
        >
          👍
        </button>
        <button
          type="button"
          className={`trade-feedback-btn${verdict === "down" ? " trade-feedback-btn-down" : ""}`}
          onClick={() => pickVerdict("down")}
          disabled={sent}
          aria-pressed={verdict === "down"}
          title="Bad trade"
        >
          👎
        </button>
      </div>

      {verdict && sent && (
        <div className="trade-feedback-panel">
          <p className="trade-feedback-sent">Thanks, logged. {verdict === "up" ? "👍" : "👎"}</p>
        </div>
      )}

      {verdict && !sent && (
        <div className="trade-feedback-panel">
          <div className="trade-feedback-chips">
            {reasonOptions.map((r) => (
              <button
                type="button"
                key={r.key}
                className={`trade-feedback-chip${reasons.includes(r.key) ? " selected" : ""}`}
                onClick={() => toggleReason(r.key)}
              >
                {r.label}
              </button>
            ))}
          </div>
          <textarea
            className="trade-feedback-comment"
            placeholder="Anything else? (optional)"
            maxLength={2000}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
          />
          {sendError && <p className="trade-feedback-error">{sendError}</p>}
          <button
            type="button"
            className="trade-feedback-submit"
            disabled={sending}
            onClick={submit}
          >
            {sending ? "Sending..." : "Send feedback"}
          </button>
        </div>
      )}
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
  const [noFiller, setNoFiller] = useState(searchParams.get("nofiller") === "1");

  const [result, setResult] = useState<FindTradesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // What actually produced `result`, captured at search time. Controls can
  // drift after a search runs (dropdowns change without hitting FIND
  // TRADES), so this must not read the live control state.
  const [resultSearch, setResultSearch] = useState<ResultSearchContext>({
    archetype: null,
    position: null,
    targetRosterId: null,
    noFillerPicks: false,
  });

  const showPosition = intent !== "" && POSITIONAL_FAMILIES.includes(intent);

  function runSearch(opts: {
    intent: ArchetypeFamily | "";
    position: Position | "";
    target: number | "";
    noFiller: boolean;
  }) {
    if (!leagueId || !rosterId) return;
    setResult(null);
    setLoading(true);
    setError(null);
    const usePosition = opts.intent !== "" && POSITIONAL_FAMILIES.includes(opts.intent) ? opts.position : "";
    setResultSearch({
      archetype: opts.intent || null,
      position: usePosition || null,
      targetRosterId: opts.target === "" ? null : opts.target,
      noFillerPicks: opts.noFiller,
    });
    // Keep the URL shareable
    const next = new URLSearchParams();
    if (opts.intent) next.set("archetype", opts.intent);
    if (usePosition) next.set("pos", usePosition);
    if (opts.target !== "") next.set("target", String(opts.target));
    if (opts.noFiller) next.set("nofiller", "1");
    setSearchParams(next, { replace: true });

    api.findTrades(leagueId, rosterId, {
      ...(opts.intent ? { archetype: opts.intent } : {}),
      ...(usePosition ? { position: usePosition } : {}),
      ...(opts.target !== "" ? { targetRosterId: opts.target } : {}),
      ...(opts.noFiller ? { noFillerPicks: true } : {}),
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
    runSearch({ intent, position, target: effectiveTarget, noFiller });
  }, [leagueId, rosterId]); // eslint-disable-line react-hooks/exhaustive-deps

  const sortedTeams = [...overview.profiles].sort((a, b) => a.starterRank - b.starterRank);
  const targetName =
    target !== "" ? overview.profiles.find((p) => p.rosterId === target)?.ownerName ?? null : null;

  function resetControls() {
    setIntent("");
    setPosition("");
    setTarget("");
    setNoFiller(false);
    runSearch({ intent: "", position: "", target: "", noFiller: false });
  }

  return (
    <>
      <div className="sendit-header">
        <h2 className="section-title">Send It Trade Finder</h2>
        <h3 className="sendit-tagline">Pick your angle, scan the league, and when you find a trade you like: send it.</h3>
      </div>

      <div className="sendit-controls">
        <label className="sendit-control">
          <span className="sendit-control-label">FOR</span>
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
        </label>

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

        <div className="sendit-control">
          <span className="sendit-control-label">NO FILLER PICKS</span>
          <label className="sendit-toggle">
            <input
              type="checkbox"
              checked={noFiller}
              onChange={(e) => setNoFiller(e.target.checked)}
            />
            <span>max 1 pick, no 3rds/4ths</span>
          </label>
        </div>

        <button
          className="sendit-find-btn"
          disabled={loading}
          onClick={() => runSearch({ intent, position, target, noFiller })}
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

      {result && result.packages.length > 0 && result.diagnostics?.degraded && (
        <p className="sendit-degraded-note">No clean fits for this roster right now, so these are the closest options. Check the badges before you send.</p>
      )}

      {result && result.packages.length > 0 && (
        <div className="trade-list">
          {result.packages.map((pkg, i) => (
            <TradeCard
              key={i}
              pkg={pkg}
              index={i}
              leagueId={leagueId!}
              rosterId={rosterId}
              search={resultSearch}
              diagnostics={result.diagnostics ?? null}
              api={api}
            />
          ))}
        </div>
      )}
    </>
  );
}
