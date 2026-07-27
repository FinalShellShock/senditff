// Scouting plays: what the outcome data says THIS team should do.
//
// Replaces a scouting report built on `archetypeScores`, which had six
// problems, all measured on a real 16 team league:
//
//   1. need_fill appeared in 100% of teams' top four. Wallpaper.
//   2. age_arb_sell was a lookup on the window badge. Two teams with window
//      pressure 26 and 36 both scored exactly 60, because the factor had
//      already saturated. The number restated the label.
//   3. Scores were not comparable across families. age_arb_sell maxed for
//      three teams almost trivially while tier_down_WR reached one team's top
//      four in the entire league, yet both rendered as "100, strong angle".
//   4. It always padded to four rows, so 3 of 16 teams were shown an angle
//      scoring literally zero, labelled "a stretch".
//   5. It contradicted the outcome research: a REBUILD team's top angle was
//      tier_down_QB at 100, and tier-down is the only shape measured to
//      underperform (47%).
//   6. The underlying score has no demonstrated predictive power. Holding
//      player quality constant, positional need was 57% vs 56%.
//
// Every play here carries a HIT RATE from the trade study in
// scripts/research/ (14,343 trades across 1,100 dynasty leagues, outcomes
// followed into later seasons against a baseline that controls for regression
// to the mean). That number is a population statistic, not a prediction for
// this roster, and the UI must say so.

import type { ArchetypeFamily } from "./archetypes";
import type { Player, Position, TeamProfile } from "./types";

export type Play = {
  key: string;
  /** What to do, in plain language. */
  title: string;
  /** The measured claim behind it. */
  evidence: string;
  /** The measured number. 50 = no effect. */
  hitRate: number;
  /** What that number COUNTS. Team-outcome rates and player-level rates are
   *  different units and must not share an unlabelled column. */
  rateLabel: string;
  /** Roster-specific, names real players. */
  detail: string;
  kind: "do" | "avoid";
  /** Set when the trade finder can search for this shape. */
  archetype?: ArchetypeFamily;
  position?: Position;
};

const POSITIONS: Position[] = ["QB", "RB", "WR", "TE"];
const byValue = (a: Player, b: Player) =>
  b.valueDynasty - a.valueDynasty || a.id.localeCompare(b.id);

// Exported so the TEAM STATE charts can shade exactly the bands the play copy
// names. When the chart computed its own thresholds, a rounding difference was
// enough to draw a band that did not match the sentence directly under it,
// which reads as a bug even though both numbers are "right".

/** A veteran is worth selling only if he still carries value; these are the
 *  gate the sell_valuable_veteran play uses. */
export const VETERAN_SELL_AGE = 27;
export const VETERAN_SELL_VALUE = 1500;

/** Rank band (inclusive, 1-indexed) that Stage 1 of the trade study found
 *  actually rises: young players here beat drift about two thirds of the time,
 *  while young players past it lose ground. */
export const FRINGE_RANK_LO = 61;
export const FRINGE_RANK_HI = 100;
export const FRINGE_MAX_AGE = 25;

/** Dynasty values bounding the fringe band in THIS league, high end first.
 *  Null when the league does not roster enough players to have a 100th. */
export function fringeBand(ranking: number[]): { hi: number; lo: number } | null {
  const hi = ranking[FRINGE_RANK_LO - 1];
  const lo = ranking[FRINGE_RANK_HI - 1];
  if (!hi || !lo) return null;
  return { hi, lo };
}

/** League-wide dynasty ranking, the closest thing to an overall rank we have
 *  client-side. A 12 team league rosters roughly the startable universe. */
export function leagueRanking(league: TeamProfile[]): number[] {
  const all: number[] = [];
  for (const t of league) for (const p of t.players) all.push(p.valueDynasty);
  return all.sort((a, b) => b - a);
}
export function rankOf(value: number, ranking: number[]): number {
  let lo = 0, hi = ranking.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (ranking[mid]! > value) lo = mid + 1; else hi = mid;
  }
  return lo + 1;
}

const fmt = (n: number) => n.toLocaleString();
const ordinal = (n: number) => {
  const t = n % 100;
  const suffix = t >= 11 && t <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th";
  return `${n}${suffix}`;
};

export function scoutingPlays(me: TeamProfile, league: TeamProfile[]): Play[] {
  const ranking = leagueRanking(league);
  const roster = [...me.players].sort(byValue);
  const best = roster[0];
  const isContender = me.competitiveness === "STRONG";
  const isRebuild = me.windowTier === "LONG";
  const plays: Play[] = [];

  // What a consolidation would actually package: everything past the top man at
  // each position. These are NOT junk, and the copy must not call them junk. On
  // a contender the top two are routinely a team's 3rd and 4th best assets, and
  // labelling a genuinely good RB2 a "spare part" makes the whole report read
  // as though it has not looked at the roster.
  const spares: Player[] = [];
  for (const pos of POSITIONS) {
    const atPos = roster.filter((p) => p.position === pos);
    spares.push(...atPos.slice(1, 3));
  }
  spares.sort(byValue);

  // ── Universal: quality is the strongest measured predictor ────────────────
  if (spares.length >= 2 && spares[0] && spares[1]) {
    const pair = [spares[0], spares[1]];
    const combined = pair.reduce((s, p) => s + p.valueDynasty, 0);
    plays.push({
      key: "land_a_difference_maker",
      title: "Package depth into one difference-maker",
      evidence: isContender
        ? "Contending teams that packaged pieces into one better player beat expectations 61% of the time. Landing a top-24 dynasty player specifically ran 60%, against 48% when the best piece coming back was outside the top 100."
        : "Landing a top-24 dynasty player beat expectations 60% of the time, against 48% for a trade whose best piece was outside the top 100. It is the strongest single signal in 19,933 trades.",
      hitRate: isContender ? 61 : 60,
      rateLabel: "of teams beat expectations",
      detail: `${pair[0]!.name} and ${pair[1]!.name} are worth ${fmt(combined)} together. One player at that value would be the ${ordinal(rankOf(combined, ranking))} most valuable in this league.`,
      kind: "do",
      // Deliberately NOT position-scoped. This used to force pair[0]'s
      // position, which is arbitrary (whichever spare happened to be worth
      // more) and contradicted the copy: the detail names two players at
      // DIFFERENT positions and the link then searched only one of them.
      // Measured across the league it was also the single biggest source of
      // dead links, turning five rosters' only scouting link into "none
      // survived scoring" while an unscoped search returned five packages.
      archetype: "consolidate",
    });
  }

  // ── Contenders ────────────────────────────────────────────────────────────
  if (isContender) {
    plays.push({
      key: "avoid_tier_down",
      title: "Do not break up your best player",
      evidence:
        "Splitting one star into several lesser pieces is the only trade shape measured to lose ground: 47%, against 61% for contenders going the other direction.",
      hitRate: 47,
      rateLabel: "of teams beat expectations",
      detail: best
        ? `${best.name} (${fmt(best.valueDynasty)}) is your headliner. Splitting him for two lesser pieces is the move that goes wrong most often for a team in your window.`
        : "Splitting a star into pieces is the move that goes wrong most often for a team in your window.",
      kind: "avoid",
    });
  }

  // ── Rebuilders ────────────────────────────────────────────────────────────
  if (isRebuild) {
    const agingAsset = roster.find(
      (p) => (p.age ?? 0) >= VETERAN_SELL_AGE && p.valueDynasty >= VETERAN_SELL_VALUE,
    );
    if (agingAsset) {
      plays.push({
        key: "sell_valuable_veteran",
        title: "Sell a veteran while he still has value",
        evidence:
          "Rebuilding teams that sold a veteran who still carried real value beat expectations 54% of the time by year three. Selling players who were already washed did nothing (52%).",
        hitRate: 54,
        rateLabel: "of rebuilds beat expectations by year three",
        detail: `${agingAsset.name} is ${(agingAsset.age ?? 0).toFixed(1)} and still worth ${fmt(agingAsset.valueDynasty)}. That is the profile that pays off, not the one nobody wants.`,
        kind: "do",
        archetype: "age_arb_sell",
      });
    }

    plays.push({
      key: "bank_picks",
      title: "Bank picks, and expect to wait",
      evidence:
        "Rebuilding teams that came out ahead on picks beat expectations 49% at one year, 53% at two and 58% at three. The payoff is real but it is genuinely delayed.",
      hitRate: 58,
      rateLabel: "of rebuilds beat expectations by year three",
      detail:
        me.pickCapital.flag === "PICK_RICH"
          ? "You are already pick-rich, so the return on stockpiling further is thinner than converting some into a player who matters."
          : "Your pick capital is not deep. Moving production for picks is the play that compounds for a team on your timeline.",
      kind: "do",
      archetype: "capital_convert_production_to_picks",
    });

    // Fringe vs deep flier: the sharpest correction in the study.
    const band = fringeBand(ranking);
    if (band) {
      const { hi, lo } = band;
      plays.push({
        key: "buy_fringe_not_fliers",
        title: "Buy the fringe, not the lottery tickets",
        evidence:
          "Young players ranked 61st to 100th gained 30 to 35 places in a year, with two in three beating the league-wide drift. Young players outside the top 100 lost ground. The two bets look identical if you only check age.",
        hitRate: 65,
        rateLabel: "of those players gained ground",
        detail: `In this league that band is roughly ${fmt(hi)} to ${fmt(lo)} in value, aged ${FRINGE_MAX_AGE} or under. Cheaper fliers than that are the ones that do not come in.`,
        kind: "do",
        archetype: "age_arb_buy",
      });
    }
  }

  // ── Contenders: standing pat is its own decision ─────────────────────────
  if (isContender) {
    plays.push({
      key: "stay_active",
      title: "Work the market rather than standing pat",
      evidence:
        "Contending teams that made any trade at all beat expectations 56% of the time. Contenders who stood pat managed 43%. For rebuilding teams there was no difference either way, so this is specific to your window.",
      hitRate: 56,
      rateLabel: "of active contenders beat expectations",
      detail:
        "Your window is open now, and it is the one situation where doing nothing measurably costs you.",
      kind: "do",
    });
  }

  // NOTE: dropped. "End up with the better player" (the give/get asymmetry:
  // 54% for the side taking the better headliner, 46% for the side giving him
  // away) measured fine but is not advice. Every manager already intends to
  // win the trade, so it fired on nearly every roster while telling nobody
  // anything they could act on. A real finding is not automatically a useful
  // play. Do not reintroduce it.

  // Rank by how far the measured rate sits from a coin flip, "do" first on
  // ties. No padding: a team only sees plays that actually apply to it.
  return plays
    .sort((a, b) => {
      const ea = Math.abs(a.hitRate - 50);
      const eb = Math.abs(b.hitRate - 50);
      if (eb !== ea) return eb - ea;
      if (a.kind !== b.kind) return a.kind === "do" ? -1 : 1;
      return a.key.localeCompare(b.key);
    })
    .slice(0, 5);
}
