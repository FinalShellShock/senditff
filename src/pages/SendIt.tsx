import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useOutletContext, useParams, useSearchParams } from "react-router-dom";
import { FeedbackBlock } from "../components/FeedbackBlock.tsx";
import { INTENT_LABELS } from "../data/intentLabels.ts";
import AssetFilterBar from "./shared/AssetFilterBar.tsx";
import {
  EMPTY_ASSET_FILTERS,
  buildAssetPool,
  filterAssets,
  type AssetFilters,
  type TradeAsset,
} from "../data/assetPool.ts";
import { ARCHETYPE_FAMILIES, POSITIONAL_FAMILIES, type ArchetypeFamily } from "../algo/archetypes.ts";
import { fairnessColor, fairnessLabel, fairnessText } from "../algo/fairness.ts";
import type { Position } from "../algo/types.ts";
import {
  makeApiClient,
  type FindTradesResponse,
  type PositionShiftWire,
  type TradeAssetWire,
  type TradeDiagnostics,
  type TradeImpactWire,
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
  /** Assets the search required on each side, captured at search time. */
  give: TradeAsset[];
  receive: TradeAsset[];
};

const POSITIONS: Position[] = ["QB", "RB", "WR", "TE"];


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

type ConfidenceTier = "recommended" | "measured" | "inspiration";

// Badge copy + color per confidence tier. Same tiers the server used to pick
// the rationale-writing bucket, so the badge and the prose never disagree.
const CONFIDENCE_META: Record<ConfidenceTier, { label: string; color: string; title: string }> = {
  recommended: {
    label: "RECOMMENDED",
    color: "#22c55e",
    title: "Strong archetype fit for this roster.",
  },
  measured: {
    label: "WORTH A LOOK",
    color: "#94a3b8",
    title: "Reasonable fit. Neither a standout nor a stretch.",
  },
  inspiration: {
    label: "INSPIRATION",
    color: "#f59e0b",
    title:
      "This was the closest package available, not a strong fit. Treat it as an idea to consider rather than a recommendation.",
  },
};

// A package is not the plain sum of its parts: bundles decay and the side
// holding the single best asset charges a premium. When the adjusted figure
// differs meaningfully from the raw total, surface both; otherwise keep the
// simple 1-for-1 case free of extra noise.
const ADJ_VALUE_TOOLTIP =
  "Bundles decay and the side with the single best asset charges a premium, so a package is not the plain sum of its parts. Fairness is judged on the adjusted figures.";

function sideValueDisplay(raw: number, adj?: number): { text: string; title?: string } {
  if (adj == null || raw === 0 || Math.abs(adj - raw) / Math.abs(raw) <= 0.01) {
    return { text: raw.toLocaleString() };
  }
  // Rounded: the bundle math produces fractions, and "adj 5,452.75" reads as
  // false precision next to whole-number player values.
  return {
    text: `${raw.toLocaleString()} → adj ${Math.round(adj).toLocaleString()}`,
    title: ADJ_VALUE_TOOLTIP,
  };
}

// Reason chips NAME THE TWO TEAMS rather than saying "me" and "them".
//
// The team switcher lets you inspect any roster, so "me" meant whichever
// roster was on screen, not the person clicking. Reading the feedback back
// later, `fit_me` on a roster that is not yours is unresolvable without
// cross-referencing rosterId, and free-text comments inherited the same
// ambiguity: one downvote said the deal made no sense for "them" and there is
// no way to tell which side was meant.
//
// The stored KEYS are deliberately unchanged, so this stays comparable with
// every entry logged before it. Only the labels move.
const downReasonsFor = (myTeam: string, theirTeam: string): Array<{ key: string; label: string }> => [
  { key: "fit_me", label: `Doesn't fit ${myTeam}` },
  { key: "fit_them", label: `Doesn't fit ${theirTeam}` },
  { key: "archetype_mismatch", label: "Doesn't match the archetype" },
  { key: "unbalanced", label: "Value is unbalanced" },
  { key: "unrealistic", label: `${theirTeam} would never accept` },
  { key: "wrong_players", label: "Wrong players targeted" },
  { key: "bad_rationale", label: "Rationale is off" },
];

const upReasonsFor = (myTeam: string, theirTeam: string): Array<{ key: string; label: string }> => [
  { key: "fit_me_good", label: `Great fit for ${myTeam}` },
  { key: "fit_them_good", label: `Realistic for ${theirTeam}` },
  { key: "archetype_match", label: "Nails the archetype" },
  { key: "fair_value", label: "Value feels fair" },
  { key: "good_rationale", label: "Rationale is sharp" },
  { key: "would_send", label: `${myTeam} should send this` },
];

// Outline code glyph (angle brackets), same drawing style as ThumbIcon so it
// reads as part of the same icon family: stroked paths, no fill.
function PromptIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="15"
      height="15"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <polyline points="9 6 3 12 9 18" />
      <polyline points="15 6 21 12 15 18" />
    </svg>
  );
}

function AssetList({ assets }: { assets: TradeAssetWire[] }) {
  return (
    <span className="trade-names">
      {assets.map((a) => (
        <span key={a.id} className="trade-asset">
          <span
            className="trade-asset-tag"
            style={{ background: a.kind === "pick" ? "#475569" : posColor(a.position) }}
          >
            {a.kind === "pick" ? "PICK" : a.position}
          </span>
          <span className="trade-asset-name">{a.name}</span>
          {a.team && <span className="trade-asset-team">{a.team}</span>}
          {a.age != null && <span className="trade-asset-age">{a.age.toFixed(1)}y</span>}
          <span className="trade-asset-value">{a.valueDynasty.toLocaleString()}</span>
        </span>
      ))}
    </span>
  );
}

// How both rosters move at the positions in the trade.
//
// Replaces the bulk of the written rationale: "I want to see how the teams
// changed more than this long rationale." Deliberately only the positions the
// trade touches, both sides, since a QB-for-RB deal says nothing about tight
// ends and four rows of zeroes would bury the two that matter.
//
// Shows STARTER and DEPTH before -> after, which is what the engine actually
// scored. Note this is a real recomputation of the post-trade roster, not the
// current score with a value delta bolted on: the calculator does the latter,
// and its bars never move.
// One score, drawn rather than printed. Bar length is the post-trade score on
// its 0-100 scale; the segment between before and after is the change, green
// when the room got better and red when it got worse. Reading "did this go up
// or down, and by a lot" is then a glance instead of two subtractions.
//
// Scores are 0-100, so the track needs no normalising.
function ShiftBar({ before, after }: { before: number; after: number }) {
  const clamp = (n: number) => Math.max(0, Math.min(100, n));
  const b = clamp(before);
  const a = clamp(after);
  const base = Math.min(b, a);
  const change = Math.abs(a - b);
  const gained = a > b;
  const flat = change < 0.5;
  return (
    <span
      className="impact-bar"
      title={`${before.toFixed(0)} → ${after.toFixed(0)}`}
      aria-label={`${before.toFixed(0)} to ${after.toFixed(0)}`}
    >
      <span className="impact-bar-base" style={{ width: `${base}%` }} />
      {!flat && (
        <span
          className={`impact-bar-change ${gained ? "gain" : "loss"}`}
          style={{ width: `${change}%` }}
        />
      )}
    </span>
  );
}

function ImpactSide({
  team, rows, side,
}: {
  team: string;
  rows: PositionShiftWire[];
  side: "mine" | "theirs";
}) {
  if (rows.length === 0) return null;
  return (
    <div className={`impact-side impact-side-${side}`}>
      <div className="impact-team">{team}</div>
      <div className="impact-head">
        <span className="impact-pos" />
        <span className="impact-col">STR</span>
        <span className="impact-col">DEP</span>
      </div>
      {rows.map((r) => (
        <div key={r.position} className="impact-row">
          {/* Uncoloured on purpose. The position BADGES on the player rows
              carry the colour code; repeating it here made the panel read as
              four competing colours instead of two bars. */}
          <span className="impact-pos">{r.position}</span>
          <ShiftBar before={r.starterBefore} after={r.starterAfter} />
          <ShiftBar before={r.depthBefore} after={r.depthAfter} />
        </div>
      ))}
    </div>
  );
}

function ImpactTable({
  impact, myTeam, theirTeam,
}: {
  impact?: TradeImpactWire;
  myTeam: string;
  theirTeam: string;
}) {
  if (!impact || (impact.mine.length === 0 && impact.theirs.length === 0)) return null;
  return (
    <div className="trade-impact">
      <ImpactSide team={myTeam} rows={impact.mine} side="mine" />
      <ImpactSide team={theirTeam} rows={impact.theirs} side="theirs" />
    </div>
  );
}

function TradeCard({
  pkg, index, leagueId, rosterId, myTeam, search, diagnostics, api,
}: {
  pkg: TradePackage;
  index: number;
  leagueId: string;
  rosterId: number;
  /** Owner name of the roster on screen, which is not necessarily the viewer. */
  myTeam: string;
  search: ResultSearchContext;
  diagnostics: TradeDiagnostics | null;
  api: ApiClient;
}) {
  const theirTeam = pkg.counterTeam || "the other team";
  // Older API responses don't carry fairness; the label is derivable.
  const fairness = pkg.fairness ?? fairnessLabel(pkg.valueGive, pkg.valueReceive);

  // Independent of the feedback panel state: showing the prompt has nothing to
  // do with logging a thumbs up/down, so it stays here rather than moving into
  // the shared feedback component.
  const [promptOpen, setPromptOpen] = useState(false);

  const giveValue = sideValueDisplay(pkg.valueGive, pkg.adjValueGive);
  const receiveValue = sideValueDisplay(pkg.valueReceive, pkg.adjValueReceive);
  const confidenceMeta = pkg.confidence ? CONFIDENCE_META[pkg.confidence.tier] : null;

  return (
    <div className="trade-card">
      <div className="trade-card-header">
        {/* Confidence leads: how strongly we stand behind the trade is the
            first thing worth knowing, and the archetype is what it IS. Fairness
            moved down to the score strip, where it sits with the other
            measurements it belongs with instead of crowding the headline. */}
        <span className="trade-header-badges">
          {confidenceMeta && (
            <span
              className="fairness-badge"
              style={{ borderColor: confidenceMeta.color, color: confidenceMeta.color, marginTop: 0 }}
              title={confidenceMeta.title}
            >
              {confidenceMeta.label}
            </span>
          )}
          <span className="trade-arch-tag">{pkg.archetype.replace(/_/g, " ")}</span>
        </span>
        <span className="trade-counter-team">{pkg.counterTeam}</span>
      </div>
      <div className="trade-players">
        <div className="trade-side">
          <span className="trade-dir">SEND</span>
          <AssetList assets={pkg.give} />
          <span className="trade-val" title={giveValue.title}>{giveValue.text}</span>
        </div>
        <div className="trade-arrow">⇄</div>
        <div className="trade-side trade-side-receive">
          <span className="trade-dir">GET</span>
          <AssetList assets={pkg.receive} />
          <span className="trade-val" title={receiveValue.title}>{receiveValue.text}</span>
        </div>
      </div>
      <div className="trade-score-strip">
        <span className="trade-fairness-inline" style={{ color: fairnessColor(fairness) }}>
          {fairnessText(fairness)}
        </span>
        {pkg.scores && (
          <>
            {" · "}
            <span className="trade-score-part">
              fit for {myTeam} <FitGrade fit={pkg.scores.myFit} />
            </span>
            {" · "}
            <span className="trade-score-part">
              fit for {theirTeam} <FitGrade fit={pkg.scores.theirFit} />
            </span>
            {" · "}
            <span className="trade-score-part">
              value balance {Math.round(pkg.scores.balance * 100)}%
            </span>
          </>
        )}
      </div>
      <ImpactTable impact={pkg.impact} myTeam={myTeam} theirTeam={theirTeam} />

      {pkg.rationale && <p className="trade-rationale">{pkg.rationale}</p>}

      {pkg.prompt && promptOpen && (
        <div className="trade-prompt-panel">
          <pre className="trade-prompt-pre">{pkg.prompt}</pre>
        </div>
      )}

      <FeedbackBlock
        upReasons={upReasonsFor(myTeam, theirTeam)}
        downReasons={downReasonsFor(myTeam, theirTeam)}
        upLabel="Good trade"
        downLabel="Bad trade"
        leading={
          pkg.prompt ? (
            <button
              type="button"
              className={`trade-prompt-btn${promptOpen ? " trade-prompt-btn-open" : ""}`}
              onClick={() => setPromptOpen((v) => !v)}
              aria-pressed={promptOpen}
              aria-label="Show the prompt sent to Claude"
              title="Show the prompt sent to Claude"
            >
              <PromptIcon />
            </button>
          ) : undefined
        }
        onSubmit={({ verdict, reasons, comment }) =>
          api.submitFeedback({
            verdict,
            reasons,
            comment,
            leagueId,
            rosterId,
            packageIndex: index,
            search,
            package: pkg,
            diagnostics,
          })
        }
      />
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

  // Asset scope explains an empty result better than anything downstream can,
  // because it separates "no such trade exists" from "no good trade exists".
  // `before` is how many packages were built at all; `after` how many contained
  // every asset you named.
  const scope = diagnostics.assetScope;
  if (scope && scope.after === 0) {
    const named = scope.give + scope.receive;
    lines.push(
      `Built ${scope.before} candidate package${scope.before === 1 ? "" : "s"}${targetName ? ` with ${targetName}` : ""}, but none of them involved ${named === 1 ? "the asset" : "all the assets"} you named. The finder builds packages from each roster's position leaders, so a specific piece only turns up when a trade shape naturally reaches for it.`,
    );
    if (named > 1) lines.push("Naming fewer assets is the quickest way to widen this.");
    return (
      <div className="sendit-empty">
        {lines.map((l, i) => <p key={i} className="dim-text">{l}</p>)}
        <button className="sendit-reset-btn" onClick={onReset}>
          Reset to best available, all teams
        </button>
      </div>
    );
  }

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
    give: [],
    receive: [],
  });
  // Asset scope: "find trades that send X" / "that land Y". Empty by default,
  // so the menu-free auto search is unchanged until you name something.
  const [scopeGive, setScopeGive] = useState<TradeAsset[]>([]);
  const [scopeReceive, setScopeReceive] = useState<TradeAsset[]>([]);
  const [scopeOpen, setScopeOpen] = useState(false);
  const [scopeQuery, setScopeQuery] = useState("");
  const [scopeFilters, setScopeFilters] = useState<AssetFilters>(EMPTY_ASSET_FILTERS);

  const showPosition = intent !== "" && POSITIONAL_FAMILIES.includes(intent);

  function runSearch(opts: {
    intent: ArchetypeFamily | "";
    position: Position | "";
    target: number | "";
    noFiller: boolean;
    give?: TradeAsset[];
    receive?: TradeAsset[];
  }) {
    if (!leagueId || !rosterId) return;
    setResult(null);
    setLoading(true);
    setError(null);
    const usePosition = opts.intent !== "" && POSITIONAL_FAMILIES.includes(opts.intent) ? opts.position : "";
    const give = opts.give ?? [];
    const receive = opts.receive ?? [];
    setResultSearch({
      archetype: opts.intent || null,
      position: usePosition || null,
      targetRosterId: opts.target === "" ? null : opts.target,
      noFillerPicks: opts.noFiller,
      give,
      receive,
    });
    // Keep the URL shareable. Asset scope is deliberately NOT in the URL: the
    // ids are long, and a link that pins specific players goes stale the moment
    // either roster changes, which is a worse experience than an unscoped link.
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
      ...(give.length > 0 ? { mustGive: give.map((a) => a.id) } : {}),
      ...(receive.length > 0 ? { mustReceive: receive.map((a) => a.id) } : {}),
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
    // Asset scope is roster-relative (SEND means "this roster owns it"), so
    // switching teams drops it rather than carrying over a scope that would now
    // ask the wrong roster to send someone else's player.
    setScopeGive([]);
    setScopeReceive([]);
    runSearch({ intent, position, target: effectiveTarget, noFiller, give: [], receive: [] });
  }, [leagueId, rosterId]); // eslint-disable-line react-hooks/exhaustive-deps

  const sortedTeams = [...overview.profiles].sort((a, b) => a.starterRank - b.starterRank);
  const targetName =
    target !== "" ? overview.profiles.find((p) => p.rosterId === target)?.ownerName ?? null : null;
  // The roster being INSPECTED, which the team switcher lets you change. Every
  // "me"/"you" on a trade card refers to this team, not to whoever is signed in.
  const myTeam =
    overview.profiles.find((p) => p.rosterId === rosterId)?.ownerName ?? "this team";

  const assetPool = useMemo(() => buildAssetPool(overview.profiles), [overview.profiles]);
  const scopeCount = scopeGive.length + scopeReceive.length;
  const scopedIds = useMemo(
    () => new Set([...scopeGive, ...scopeReceive].map((a) => a.id)),
    [scopeGive, scopeReceive],
  );
  const scopeResults = useMemo(
    () => filterAssets(assetPool, { ...scopeFilters, query: scopeQuery }, { exclude: scopedIds }),
    [assetPool, scopeFilters, scopeQuery, scopedIds],
  );

  function resetControls() {
    setIntent("");
    setPosition("");
    setTarget("");
    setNoFiller(false);
    setScopeGive([]);
    setScopeReceive([]);
    runSearch({ intent: "", position: "", target: "", noFiller: false, give: [], receive: [] });
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
          onClick={() =>
            runSearch({ intent, position, target, noFiller, give: scopeGive, receive: scopeReceive })
          }
        >
          FIND TRADES
        </button>
      </div>

      {/* Asset scope. Collapsed by default so the menu-free auto search stays
          the default experience: naming a player is an extra thing you can do,
          not a step you have to take. */}
      <div className="sendit-scope">
        <button
          type="button"
          className="sendit-scope-toggle"
          aria-expanded={scopeOpen}
          onClick={() => setScopeOpen((v) => !v)}
        >
          {scopeOpen ? "▾" : "▸"} INVOLVE SPECIFIC PLAYERS OR PICKS
          {scopeCount > 0 && <span className="sendit-scope-count">{scopeCount}</span>}
        </button>

        {(scopeGive.length > 0 || scopeReceive.length > 0) && (
          <div className="sendit-scope-summary">
            {scopeGive.length > 0 && (
              <div className="sendit-scope-line">
                <span className="sendit-scope-tag give">SEND</span>
                {scopeGive.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    className="sendit-scope-pill"
                    onClick={() => setScopeGive((prev) => prev.filter((x) => x.id !== a.id))}
                    title="Remove"
                  >
                    {a.name} <span className="sendit-scope-x">×</span>
                  </button>
                ))}
              </div>
            )}
            {scopeReceive.length > 0 && (
              <div className="sendit-scope-line">
                <span className="sendit-scope-tag receive">GET</span>
                {scopeReceive.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    className="sendit-scope-pill"
                    onClick={() => setScopeReceive((prev) => prev.filter((x) => x.id !== a.id))}
                    title="Remove"
                  >
                    {a.name} <span className="sendit-scope-x">×</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {scopeOpen && (
          <div className="sendit-scope-picker">
            <input
              className="calc-search-input"
              placeholder="Search players and picks…"
              value={scopeQuery}
              onChange={(e) => setScopeQuery(e.target.value)}
            />
            <AssetFilterBar filters={scopeFilters} onChange={setScopeFilters} />
            <div className="calc-results">
              {scopeResults.length === 0 ? (
                <p className="dim-text" style={{ textAlign: "center", fontSize: 11, padding: "16px 0" }}>
                  Nothing matches those filters.
                </p>
              ) : (
                scopeResults.map((asset) => {
                  const mine = asset.ownerRosterId === rosterId;
                  return (
                    <div key={asset.id} className="calc-result-row">
                      <div className="calc-result-left">
                        <span className="sendit-scope-pos" style={{ background: posColor(asset.position) }}>
                          {asset.kind === "pick" ? "PICK" : asset.position}
                        </span>
                        <span className="calc-result-name">{asset.name}</span>
                        {asset.age != null && (
                          <span className="calc-result-meta">{asset.age.toFixed(1)}</span>
                        )}
                        <span className="calc-result-owner">{asset.ownerName}</span>
                      </div>
                      <div className="calc-result-right">
                        <span className="calc-result-value">{asset.value.toLocaleString()}</span>
                        {/* You can only send what this roster owns, and only
                            receive what it does not. Offering both on every row
                            would let you build a search that cannot match. */}
                        {mine ? (
                          <button
                            className="calc-add-btn side-a natural"
                            onClick={() => {
                              setScopeGive((prev) =>
                                prev.some((x) => x.id === asset.id) ? prev : [...prev, asset],
                              );
                            }}
                          >
                            SEND
                          </button>
                        ) : (
                          <button
                            className="calc-add-btn side-b natural"
                            onClick={() => {
                              setScopeReceive((prev) =>
                                prev.some((x) => x.id === asset.id) ? prev : [...prev, asset],
                              );
                            }}
                          >
                            GET
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}
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
              myTeam={myTeam}
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
