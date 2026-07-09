import { useState, useMemo } from "react";
import { useOutletContext } from "react-router-dom";
import { fairnessColor, fairnessLabel, fairnessText, packageValue } from "../algo/fairness.ts";
import type { Position } from "../algo/types.ts";
import type { TeamProfile } from "../algo/types.ts";
import type { LeagueOutletContext } from "./LeagueShell.tsx";

type TradeAsset = {
  id: string;
  kind: "player" | "pick";
  name: string;
  position?: Position;
  value: number;
  ownerName: string;
  ownerRosterId: number;
  age?: number | null;
};

type TradeSide = {
  rosterId: number | null;
  assets: TradeAsset[];
};

function posColor(pos: string) {
  const map: Record<string, string> = { QB: "#c2410c", RB: "#ca8a04", WR: "#3b82f6", TE: "#a855f7" };
  return map[pos] ?? "#94a3b8";
}

function formatDelta(net: number): string {
  const abs = Math.abs(net);
  const sign = net >= 0 ? "+" : "−";
  if (abs >= 10000) return `${sign}${Math.round(abs / 1000)}k`;
  if (abs >= 1000)  return `${sign}${(abs / 1000).toFixed(1)}k`;
  return `${sign}${abs}`;
}

function PosTag({ position }: { position?: Position }) {
  return (
    <span
      className="pos-tag"
      style={{
        background: position ? posColor(position) : "#475569",
        color: "#fff", padding: "1px 5px", borderRadius: 2,
        fontSize: 8, fontWeight: 700, letterSpacing: 0.5, flexShrink: 0,
      }}
    >
      {position ?? "PICK"}
    </span>
  );
}

function TeamSelector({
  rosterId, profiles, onSelect, onClear, accent,
}: {
  rosterId: number | null;
  profiles: TeamProfile[];
  onSelect: (id: number) => void;
  onClear: () => void;
  accent: string;
}) {
  if (rosterId !== null) {
    const team = profiles.find((p) => p.rosterId === rosterId);
    return (
      <div className="calc-team-locked">
        <span className="calc-team-name" style={{ color: accent }}>{team?.ownerName ?? "?"}</span>
        <span className="calc-team-sends">SENDS</span>
        <button className="calc-team-clear" onClick={onClear}>×</button>
      </div>
    );
  }
  return (
    <select
      className="calc-team-select"
      value=""
      style={{ color: accent }}
      onChange={(e) => onSelect(Number(e.target.value))}
    >
      <option value="" disabled>Select team…</option>
      {profiles.map((p) => (
        <option key={p.rosterId} value={p.rosterId}>{p.ownerName}</option>
      ))}
    </select>
  );
}

function TradePanel({
  side, accent, profiles, total, adjustedTotal, totalColor,
  onSelectTeam, onClearTeam, onRemove,
}: {
  side: TradeSide;
  accent: string;
  profiles: TeamProfile[];
  total: number;
  adjustedTotal: number;
  totalColor: string;
  onSelectTeam: (id: number) => void;
  onClearTeam: () => void;
  onRemove: (id: string) => void;
}) {
  const consolidationDiff = Math.round(total - adjustedTotal);
  const showAdjNote = side.assets.length >= 2 && consolidationDiff !== 0;
  return (
    <div className="calc-panel">
      <div className="calc-panel-header" style={{ borderBottomColor: accent }}>
        <TeamSelector
          rosterId={side.rosterId}
          profiles={profiles}
          onSelect={onSelectTeam}
          onClear={onClearTeam}
          accent={accent}
        />
        <div className="calc-panel-total-col">
          <span className="calc-panel-total" style={{ color: totalColor }}>{total > 0 ? total.toLocaleString() : "—"}</span>
          {showAdjNote && (
            <span className="calc-adj-note">
              adj {Math.round(adjustedTotal).toLocaleString()} (-{consolidationDiff.toLocaleString()} consolidation)
            </span>
          )}
        </div>
      </div>
      <div className="calc-panel-body">
        {side.assets.length === 0 ? (
          <p className="dim-text" style={{ textAlign: "center", fontSize: 11, padding: "20px 0" }}>
            Search below to add
          </p>
        ) : (
          side.assets.map((asset) => (
            <div key={asset.id} className="calc-asset-row">
              <div className="calc-asset-info">
                <PosTag position={asset.position} />
                <span className="calc-asset-name">{asset.name}</span>
                {asset.age != null && <span className="calc-asset-age">{typeof asset.age === "number" ? asset.age.toFixed(1) : asset.age}</span>}
              </div>
              <div className="calc-asset-right">
                <span className="calc-asset-value">{asset.value.toLocaleString()}</span>
                <button className="calc-remove-btn" onClick={() => onRemove(asset.id)}>×</button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ── Trade Impact Report ───────────────────────────────────────────────────

const POSITIONS_ORDER = ["QB", "RB", "WR", "TE"] as const;

function ImpactBar({ score, net }: { score: number; net: number }) {
  const basePct = Math.max(0, Math.min(100, score));
  // Scale: ~8000 value delta → 28% bar width. Capped so it doesn't overflow.
  const deltaW = Math.min(28, Math.abs(net) / 285);
  const neutral = "#334155";

  if (net > 0) {
    // Neutral base → green extension
    const gainW = Math.min(100 - basePct, deltaW);
    return (
      <div className="trade-bar-track">
        <div style={{ width: `${basePct}%`, height: "100%", background: neutral, flexShrink: 0 }} />
        {gainW > 0.3 && <div style={{ width: `${gainW}%`, height: "100%", background: "#22c55e", flexShrink: 0 }} />}
      </div>
    );
  }
  if (net < 0) {
    // Neutral base → red trailing segment
    const lossW = Math.min(basePct, deltaW);
    return (
      <div className="trade-bar-track">
        <div style={{ width: `${basePct - lossW}%`, height: "100%", background: neutral, flexShrink: 0 }} />
        {lossW > 0.3 && <div style={{ width: `${lossW}%`, height: "100%", background: "#ef4444", flexShrink: 0 }} />}
      </div>
    );
  }
  // No change — neutral slate, no level-based color (avoids confusion with side accents)
  return (
    <div className="trade-bar-track">
      <div style={{ width: `${basePct}%`, height: "100%", background: "#334155", flexShrink: 0 }} />
    </div>
  );
}

function TeamImpactPanel({
  profile, givingAssets, receivingAssets,
}: {
  profile: TeamProfile;
  givingAssets: TradeAsset[];
  receivingAssets: TradeAsset[];
}) {
  // Net value change per position for this team
  const posNet: Record<string, number> = { QB: 0, RB: 0, WR: 0, TE: 0 };
  for (const a of givingAssets)    if (a.position && a.position in posNet) posNet[a.position] = (posNet[a.position] ?? 0) - a.value;
  for (const a of receivingAssets) if (a.position && a.position in posNet) posNet[a.position] = (posNet[a.position] ?? 0) + a.value;

  const picksOut = givingAssets.filter((a) => a.kind === "pick");
  const picksIn  = receivingAssets.filter((a) => a.kind === "pick");
  const pickLabel = (a: TradeAsset) => (a.name.split("(")[0] ?? a.name).trim(); // strip "(via ...)"

  return (
    <div className="team-impact-panel">
      <div className="team-impact-name">{profile.ownerName}</div>

      <div className="team-impact-col-row">
        <span />
        <span className="team-impact-col-lbl">STR</span>
        <span className="team-impact-col-lbl">DEP</span>
      </div>

      {POSITIONS_ORDER.map((pos) => {
        const ps  = profile.positionScores[pos];
        const net = posNet[pos] ?? 0;
        const deltaColor = net > 0 ? "#22c55e" : "#ef4444";
        const deltaStr   = net !== 0 ? formatDelta(net) : null;
        return (
          <div key={pos} className="team-impact-row">
            <span className="team-impact-pos" style={{ color: posColor(pos) }}>{pos}</span>
            <div className="team-impact-bar-cell">
              <ImpactBar score={ps?.starterScore ?? 0} net={net} />
              <div className="team-impact-score-row">
                <span className="team-impact-score">{(ps?.starterScore ?? 0).toFixed(0)}</span>
                {deltaStr && <span className="team-impact-delta-inline" style={{ color: deltaColor }}>{deltaStr}</span>}
              </div>
            </div>
            <div className="team-impact-bar-cell">
              <ImpactBar score={ps?.depthScore ?? 0} net={net} />
              <div className="team-impact-score-row">
                <span className="team-impact-score">{(ps?.depthScore ?? 0).toFixed(0)}</span>
                {deltaStr && <span className="team-impact-delta-inline" style={{ color: deltaColor }}>{deltaStr}</span>}
              </div>
            </div>
          </div>
        );
      })}

      {(picksOut.length > 0 || picksIn.length > 0) && (
        <div className="team-impact-picks">
          <span className="team-impact-picks-lbl">PICKS</span>
          {picksOut.map((p) => (
            <div key={p.id} className="team-impact-pick-item" style={{ color: "#ef4444" }}>
              − {pickLabel(p)}
            </div>
          ))}
          {picksIn.map((p) => (
            <div key={p.id} className="team-impact-pick-item" style={{ color: "#22c55e" }}>
              + {pickLabel(p)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function TradeImpactReport({
  sideA, sideB, profiles,
}: {
  sideA: TradeSide;
  sideB: TradeSide;
  profiles: TeamProfile[];
}) {
  const profileA = sideA.rosterId != null ? profiles.find((p) => p.rosterId === sideA.rosterId) : null;
  const profileB = sideB.rosterId != null ? profiles.find((p) => p.rosterId === sideB.rosterId) : null;

  return (
    <div className="trade-impact-report">
      <div className="trade-impact-title">TRADE IMPACT</div>
      <div className="trade-impact-panels">
        {profileA ? (
          <TeamImpactPanel
            profile={profileA}
            givingAssets={sideA.assets}
            receivingAssets={sideB.assets}
          />
        ) : (
          <div className="team-impact-panel team-impact-placeholder">
            <p className="dim-text" style={{ fontSize: 10, textAlign: "center", paddingTop: 24 }}>Select a team</p>
          </div>
        )}
        {profileB ? (
          <TeamImpactPanel
            profile={profileB}
            givingAssets={sideB.assets}
            receivingAssets={sideA.assets}
          />
        ) : (
          <div className="team-impact-panel team-impact-placeholder">
            <p className="dim-text" style={{ fontSize: 10, textAlign: "center", paddingTop: 24 }}>Select a team</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

export default function Calc() {
  const { overview } = useOutletContext<LeagueOutletContext>();
  const profiles = overview.profiles;

  const [sideA, setSideA] = useState<TradeSide>({ rosterId: null, assets: [] });
  const [sideB, setSideB] = useState<TradeSide>({ rosterId: null, assets: [] });
  const [query, setQuery] = useState("");
  const [rosterLocked, setRosterLocked] = useState(true);

  // All assets across the league, players + picks combined, sorted by value
  const allAssets = useMemo<TradeAsset[]>(() => {
    const players: TradeAsset[] = profiles.flatMap((p) =>
      p.players.map((pl): TradeAsset => ({
        id: pl.id,
        kind: "player",
        name: pl.name,
        position: pl.position,
        value: pl.valueDynasty,
        ownerName: p.ownerName,
        ownerRosterId: p.rosterId,
        age: pl.age,
      }))
    );
    const picks: TradeAsset[] = profiles.flatMap((p) =>
      p.picks.map((pk): TradeAsset => ({
        id: `${pk.year}-${pk.round}-${pk.origRosterId}`,
        kind: "pick",
        name: pk.label,
        value: pk.value,
        ownerName: p.ownerName,
        ownerRosterId: p.rosterId,
      }))
    );
    return [...players, ...picks].sort((a, b) => b.value - a.value);
  }, [profiles]);

  const addedIds = useMemo(
    () => new Set([...sideA.assets.map((a) => a.id), ...sideB.assets.map((a) => a.id)]),
    [sideA.assets, sideB.assets],
  );

  // Roster filter only activates once BOTH sides have a team locked.
  // With only one side set you still need to browse all teams to fill the other side.
  const pool = useMemo(() => {
    if (!rosterLocked) return allAssets;
    if (sideA.rosterId === null || sideB.rosterId === null) return allAssets;
    return allAssets.filter(
      (a) => a.ownerRosterId === sideA.rosterId || a.ownerRosterId === sideB.rosterId,
    );
  }, [allAssets, rosterLocked, sideA.rosterId, sideB.rosterId]);

  const searchResults = useMemo(() => {
    const available = pool.filter((a) => !addedIds.has(a.id));
    if (query.length >= 2) {
      return available
        .filter((a) => a.name.toLowerCase().includes(query.toLowerCase()))
        .slice(0, 30);
    }
    // No query: top 25 assets by value (players + picks combined)
    return available.slice(0, 25);
  }, [pool, query, addedIds]);

  function addAsset(asset: TradeAsset, side: "A" | "B") {
    const setter = side === "A" ? setSideA : setSideB;
    setter((prev) => {
      if (prev.assets.some((a) => a.id === asset.id)) return prev;
      return {
        // First asset added locks the team for that side
        rosterId: prev.rosterId ?? asset.ownerRosterId,
        assets: [...prev.assets, asset],
      };
    });
  }

  function removeAsset(id: string, side: "A" | "B") {
    const setter = side === "A" ? setSideA : setSideB;
    setter((prev) => ({ ...prev, assets: prev.assets.filter((a) => a.id !== id) }));
  }

  function setTeam(side: "A" | "B", rosterId: number) {
    (side === "A" ? setSideA : setSideB)((prev) => ({ ...prev, rosterId }));
  }

  function clearTeam(side: "A" | "B") {
    (side === "A" ? setSideA : setSideB)({ rosterId: null, assets: [] });
  }

  function clearAll() {
    setSideA({ rosterId: null, assets: [] });
    setSideB({ rosterId: null, assets: [] });
    setQuery("");
  }

  // ── Value math ──
  const totalA = sideA.assets.reduce((s, a) => s + a.value, 0);
  const totalB = sideB.assets.reduce((s, a) => s + a.value, 0);
  // Consolidation-adjusted totals: dynasty value isn't additive, so multi-asset
  // bundles get discounted (best asset full price, each extra piece decayed).
  // Used only for the shared fairness badge, not the headline verdict.
  const adjA = packageValue(sideA.assets.map((a) => a.value));
  const adjB = packageValue(sideB.assets.map((a) => a.value));
  // diff from A's perspective: positive = A benefits (gets more than gives)
  const diff = totalB - totalA;
  const base = Math.max(totalA, totalB, 1);
  const diffPct = Math.round((Math.abs(diff) / base) * 100);
  const hasItems = sideA.assets.length > 0 || sideB.assets.length > 0;

  const profileA = profiles.find((p) => p.rosterId === sideA.rosterId) ?? null;
  const profileB = profiles.find((p) => p.rosterId === sideB.rosterId) ?? null;

  // Fair threshold: within 8% of the larger side's total.
  // Fair = both sides green. Unfair = winning side green, losing side red.
  const isFair = !hasItems || diffPct < 8;
  const totalColorA = !hasItems ? "#475569" : isFair || diff > 0 ? "#22c55e" : "#ef4444";
  const totalColorB = !hasItems ? "#475569" : isFair || diff < 0 ? "#22c55e" : "#ef4444";

  function getVerdict(): { text: string; color: string } {
    if (!hasItems) return { text: "—", color: "#475569" };
    if (diffPct < 8)  return { text: "FAIR", color: "#94a3b8" };
    // Winner = the side receiving more value than they put in
    const winnerName = diff > 0
      ? (profileA?.ownerName.split(" ")[0] ?? "SIDE A").toUpperCase()
      : (profileB?.ownerName.split(" ")[0] ?? "SIDE B").toUpperCase();
    if (diffPct > 20) return { text: `${winnerName} BIG WIN`, color: "#22c55e" };
    return { text: `${winnerName} WINS`, color: "#4ade80" };
  }
  const verdict = getVerdict();

  // Shared engine fairness label (same math as Send It packages and trade
  // grades). Computed from A's perspective, displayed against the overpayer.
  const engineFairness = fairnessLabel(adjA, adjB);
  const overpayerName =
    engineFairness === "SLIGHT_OVERPAY" || engineFairness === "OVERPAY"
      ? profileA?.ownerName
      : engineFairness === "SLIGHT_UNDERPAY" || engineFairness === "UNDERPAY"
      ? profileB?.ownerName
      : null;
  const engineFairnessDisplay =
    engineFairness === "FAIR"
      ? "FAIR"
      : `${fairnessText(engineFairness).replace("UNDERPAY", "OVERPAY")}${overpayerName ? ` · ${overpayerName.split(" ")[0]?.toUpperCase()}` : ""}`;

  // ── Fit analysis — only shown when the user's own team is one of the sides ──
  const myProfile = profiles.find((p) => p.isMine);
  const fitLines: { text: string; good: boolean | null }[] = [];
  if (myProfile && hasItems) {
    const iAmA = sideA.rosterId === myProfile.rosterId;
    const iAmB = sideB.rosterId === myProfile.rosterId;
    if (iAmA || iAmB) {
      const giveSide = iAmA ? sideA.assets : sideB.assets;
      const getSide  = iAmA ? sideB.assets : sideA.assets;
      const ps = myProfile.positionScores;
      for (const asset of getSide) {
        if (!asset.position) continue;
        const cl = ps[asset.position]?.classification;
        if      (cl === "CRITICAL_NEED") fitLines.push({ text: `+${asset.name} fills CRITICAL ${asset.position} need`, good: true });
        else if (cl === "NEED")          fitLines.push({ text: `+${asset.name} helps ${asset.position} need`, good: true });
        else if (cl === "SURPLUS")       fitLines.push({ text: `+${asset.name} piles onto ${asset.position} surplus`, good: false });
      }
      for (const asset of giveSide) {
        if (!asset.position) continue;
        const cl = ps[asset.position]?.classification;
        if      (cl === "SURPLUS")       fitLines.push({ text: `−${asset.name} sells from ${asset.position} surplus`, good: true });
        else if (cl === "HEALTHY")       fitLines.push({ text: `−${asset.name} thins ${asset.position} depth`, good: null });
        else if (cl === "NEED")          fitLines.push({ text: `−${asset.name} deepens ${asset.position} need`, good: false });
        else if (cl === "CRITICAL_NEED") fitLines.push({ text: `−${asset.name} worsens CRITICAL ${asset.position} need`, good: false });
      }
    }
  }

  // ── Empty-state hint for search area ──
  const emptyHint = query.length > 0 && query.length < 2
    ? "Type at least 2 characters"
    : query.length >= 2
    ? "No results"
    : "No assets";

  return (
    <div className="calc-container">

      {/* ── Trade panels + verdict ── */}
      <div className="calc-panels">
        <TradePanel
          side={sideA}
          accent="#06b6d4"
          profiles={profiles}
          total={totalA}
          adjustedTotal={adjA}
          totalColor={totalColorA}
          onSelectTeam={(id) => setTeam("A", id)}
          onClearTeam={() => clearTeam("A")}
          onRemove={(id) => removeAsset(id, "A")}
        />

        <div className="calc-verdict">
          {hasItems ? (
            <>
              <div className="calc-verdict-label" style={{ color: verdict.color }}>{verdict.text}</div>
              <div className="calc-verdict-diff" style={{ color: isFair ? "#22c55e" : "#ef4444" }}>
                {diff >= 0 ? "+" : "−"}{Math.abs(diff).toLocaleString()}
              </div>
              {diffPct > 0 && (
                <div className="calc-verdict-pct" style={{ color: isFair ? "#22c55e" : "#ef4444" }}>
                  {diffPct}%
                </div>
              )}
              <div className="fairness-badge" style={{ borderColor: fairnessColor(engineFairness), color: fairnessColor(engineFairness) }}>
                {engineFairnessDisplay}
              </div>
              {fitLines.length > 0 && (
                <div className="calc-fit-lines">
                  {fitLines.map((fl, i) => (
                    <div
                      key={i}
                      className="calc-fit-line"
                      style={{ color: fl.good === true ? "#22c55e" : fl.good === false ? "#ef4444" : "#64748b" }}
                    >
                      {fl.text}
                    </div>
                  ))}
                </div>
              )}
              <button className="calc-clear-btn" onClick={clearAll}>CLEAR</button>
            </>
          ) : (
            <p className="dim-text" style={{ fontSize: 11, textAlign: "center", lineHeight: 1.6 }}>
              Add assets to<br />see analysis
            </p>
          )}
        </div>

        <TradePanel
          side={sideB}
          accent="#f59e0b"
          profiles={profiles}
          total={totalB}
          adjustedTotal={adjB}
          totalColor={totalColorB}
          onSelectTeam={(id) => setTeam("B", id)}
          onClearTeam={() => clearTeam("B")}
          onRemove={(id) => removeAsset(id, "B")}
        />
      </div>

      {/* ── Search ── */}
      <div className="calc-search-section">
        <div className="calc-search-bar">
          <input
            className="calc-search-input"
            placeholder="Search players and picks…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <label className="calc-lock-toggle">
            <input
              type="checkbox"
              checked={rosterLocked}
              onChange={(e) => setRosterLocked(e.target.checked)}
            />
            <span>ROSTER FILTER</span>
          </label>
        </div>

        {searchResults.length > 0 ? (
          <div className="calc-results">
            {searchResults.map((asset) => {
              const naturalA = asset.ownerRosterId === sideA.rosterId;
              const naturalB = asset.ownerRosterId === sideB.rosterId;
              return (
                <div key={asset.id} className="calc-result-row">
                  <div className="calc-result-left">
                    <PosTag position={asset.position} />
                    <span className="calc-result-name">{asset.name}</span>
                    {asset.age != null && <span className="calc-result-meta">{typeof asset.age === "number" ? asset.age.toFixed(1) : asset.age}</span>}
                    <span className="calc-result-owner">{asset.ownerName}</span>
                  </div>
                  <div className="calc-result-right">
                    <span className="calc-result-value">{asset.value.toLocaleString()}</span>
                    <button
                      className={`calc-add-btn side-a${naturalA ? " natural" : ""}`}
                      onClick={() => addAsset(asset, "A")}
                    >A</button>
                    <button
                      className={`calc-add-btn side-b${naturalB ? " natural" : ""}`}
                      onClick={() => addAsset(asset, "B")}
                    >B</button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="dim-text" style={{ textAlign: "center", fontSize: 11, padding: "16px 0" }}>
            {emptyHint}
          </p>
        )}
      </div>

      <TradeImpactReport sideA={sideA} sideB={sideB} profiles={profiles} />
    </div>
  );
}
