// Positional Leverage: every team ranked at every position, framed as trade
// leverage. DESPERATE = a critical hole on a team whose window makes them a
// live buyer (sell into them). A rebuilder with the same hole is PUNTING it
// on purpose (they want picks and youth, not your veteran depth) — shown dim
// and never suggested as a sell-into target. SELLER teams (surplus) are
// where you go shopping. Pure UI over positionScores + windowLabel.

import { Link, useNavigate, useParams } from "react-router-dom";
import type { Position, SubClassification, TeamProfile, WindowLabel } from "../../algo/types.ts";

// Windows that deliberately don't buy veteran production.
const PUNTING_WINDOWS: WindowLabel[] = ["REBUILD", "TRANSITION"];

function isBuyer(p: TeamProfile): boolean {
  return !PUNTING_WINDOWS.includes(p.windowLabel);
}

const POSITIONS: Position[] = ["QB", "RB", "WR", "TE"];

const POS_COLOR: Record<Position, string> = {
  QB: "#c2410c",
  RB: "#ca8a04",
  WR: "#3b82f6",
  TE: "#a855f7",
};

// CRITICAL and SURPLUS are the two states worth acting on, so they own the
// loud colors. HEALTHY is deliberately neutral: it is the absence of leverage,
// and it covers ~60% of cells by construction (classifySide puts NEED below
// z -1 and CRITICAL below z -2, so the middle is always the big bucket).
// Painting that middle green made 80% of the leverage board green and buried
// the signal.
const CLASS_COLOR: Record<string, string> = {
  CRITICAL: "#ef4444",
  NEED: "#eab308",
  HEALTHY: "#64748b",
  SURPLUS: "#22c55e",
};

function classOf(p: TeamProfile, pos: Position): SubClassification {
  const ps = p.positionScores?.[pos];
  return ps?.starterClassification
    ?? (ps?.classification === "CRITICAL_NEED" ? "CRITICAL" : (ps?.classification as SubClassification) ?? "HEALTHY");
}

export default function LeverageBoard({ profiles }: { profiles: TeamProfile[] }) {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const mine = profiles.find((p) => p.isMine) ?? null;

  // Leverage callouts: where my depth is a surplus and someone is desperate.
  const callouts: Array<{ pos: Position; target: TeamProfile }> = [];
  if (mine) {
    for (const pos of POSITIONS) {
      const myPs = mine.positionScores?.[pos];
      const iHaveSpare =
        myPs?.depthClassification === "SURPLUS" ||
        myPs?.starterClassification === "SURPLUS" ||
        myPs?.classification === "SURPLUS";
      if (!iHaveSpare) continue;
      const desperate = profiles
        .filter((p) => !p.isMine && classOf(p, pos) === "CRITICAL" && isBuyer(p))
        .sort((a, b) => (a.positionScores?.[pos]?.starterValue ?? 0) - (b.positionScores?.[pos]?.starterValue ?? 0));
      for (const target of desperate.slice(0, 2)) callouts.push({ pos, target });
    }
  }

  return (
    <div>
      {callouts.length > 0 && (
        <div className="lb-callouts">
          {callouts.map(({ pos, target }) => (
            <Link
              key={`${pos}-${target.rosterId}`}
              className="lb-callout"
              to={`/league/${id}/sendit/${mine!.rosterId}?target=${target.rosterId}`}
            >
              <span className="lb-callout-pos" style={{ background: POS_COLOR[pos] }}>{pos}</span>
              Sell {pos} depth into {target.ownerName}'s desperation →
            </Link>
          ))}
        </div>
      )}

      <div className="lb-columns">
        {POSITIONS.map((pos) => {
          const ranked = [...profiles].sort(
            (a, b) =>
              (b.positionScores?.[pos]?.starterValue ?? 0) - (a.positionScores?.[pos]?.starterValue ?? 0),
          );
          const maxValue = Math.max(1, ranked[0]?.positionScores?.[pos]?.starterValue ?? 1);
          return (
            <div key={pos} className="lb-col">
              <div className="lb-col-header" style={{ color: POS_COLOR[pos] }}>{pos}</div>
              {ranked.map((p, i) => {
                const ps = p.positionScores?.[pos];
                const cl = classOf(p, pos);
                const hasHole = cl === "CRITICAL";
                const desperate = hasHole && isBuyer(p);
                const punting = hasHole && !isBuyer(p);
                const seller = !hasHole && (cl === "SURPLUS" || ps?.depthClassification === "SURPLUS");
                return (
                  <div
                    key={p.rosterId}
                    className={`lb-row${desperate ? " lb-desperate" : ""}${punting ? " lb-punting" : ""}${seller ? " lb-seller" : ""}${p.isMine ? " lb-mine" : ""}`}
                    onClick={() => navigate(`/league/${id}/team/${p.rosterId}`)}
                  >
                    <span className="lb-rank">{i + 1}</span>
                    <span className="lb-name">{p.ownerName}{p.isMine ? " ★" : ""}</span>
                    <span className="lb-bar-track">
                      <span
                        className="lb-bar-fill"
                        style={{
                          width: `${Math.max(3, ((ps?.starterValue ?? 0) / maxValue) * 100)}%`,
                          background: CLASS_COLOR[cl] ?? "#475569",
                        }}
                      />
                    </span>
                    <span className="lb-tag" style={{ color: punting ? "#64748b" : CLASS_COLOR[cl] ?? "#64748b" }}>
                      {desperate ? "DESPERATE" : punting ? "PUNTING" : seller ? "SELLER" : ""}
                    </span>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
