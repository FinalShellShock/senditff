import {
  buildPicksMap,
  findUpcomingDraft,
  resolvePickValue,
} from "../../src/data/picks";
import { applyTep, fillStarters } from "../../src/algo/profile";
import { STD_THRESHOLD } from "../../src/algo/constants";
import { normName } from "../../src/data/normalize";
import type { LeagueFormat, Pick, PickTier, Player, TeamInput } from "../../src/algo/types";
import type {
  SleeperDraft,
  SleeperLeague,
  SleeperPlayer,
  SleeperRoster,
  SleeperTradedPick,
  SleeperUser,
} from "../../src/data/types";
import type { ValueMaps } from "./snapshot";

const POSITIONS = ["QB", "RB", "WR", "TE"] as const;
type Position = (typeof POSITIONS)[number];

/** Compute exact decimal age from "YYYY-MM-DD" birth date string. */
function calcAge(birthDate: string): number {
  return (Date.now() - new Date(birthDate).getTime()) / (365.25 * 24 * 60 * 60 * 1000);
}

// Assembles TeamInput[] from raw Sleeper data + value maps.
// Shared by the sync endpoint and anything else that needs fresh profiles.
export function buildTeamInputs(params: {
  rosters: SleeperRoster[];
  users: SleeperUser[];
  tradedPicks: SleeperTradedPick[];
  drafts: SleeperDraft[];
  league: SleeperLeague;
  sleeperPlayers: Record<string, SleeperPlayer>;
  valueMaps: ValueMaps;
  format: LeagueFormat;
  mySleeperUserId?: string;
  // Fallback "current" season. Only used if no upcoming draft is published.
  thisYear: number;
}): TeamInput[] {
  const {
    rosters, users, tradedPicks, drafts, league, sleeperPlayers,
    valueMaps, format, mySleeperUserId, thisYear,
  } = params;
  const { dynastyValues, redraftValues } = valueMaps;

  // Sleeper truth for the next draft. If every league draft is complete (or
  // none exist yet), `upcoming` is null and we fall back to projection-only.
  const upcoming = findUpcomingDraft(drafts, rosters);
  const upcomingYear = upcoming?.season ?? thisYear;
  const upcomingSlots = upcoming?.slotByRoster ?? new Map<number, number>();

  const draftRounds = upcoming?.rounds
    ?? league.settings?.draft_rounds
    ?? 4;
  const draftYears = [upcomingYear, upcomingYear + 1, upcomingYear + 2];

  const picksMap = buildPicksMap(rosters, tradedPicks, draftYears, draftRounds);
  const teamCount = rosters.length;

  // ── Pass 1: build the players list per roster + starter strength ──
  // Future-year picks are bucketed by the ORIGINAL team's competitiveness
  // (WEAK/AVERAGE/STRONG), which mirrors what computeAllProfiles will compute
  // downstream. Bad teams get projected early picks; good teams get late.
  const rosterPlayers = new Map<number, Player[]>();
  const rosterStarterTotal = new Map<number, number>();

  for (const r of rosters) {
    const players: Player[] = (r.players ?? [])
      .map((id): Player | null => {
        const sp = sleeperPlayers[id];
        if (!sp) return null;
        const fullName =
          sp.full_name ?? `${sp.first_name ?? ""} ${sp.last_name ?? ""}`.trim();
        const pos = sp.position;
        if (!pos || !(POSITIONS as readonly string[]).includes(pos)) return null;
        const k = normName(fullName);
        const dyn = dynastyValues.get(k);
        const red = redraftValues.get(k);
        return {
          id,
          name: fullName,
          position: pos as Position,
          team: sp.team ?? null,
          age: sp.birth_date ? calcAge(sp.birth_date) : dyn?.age ?? red?.age ?? sp.age ?? null,
          valueRedraft: red?.value ?? 0,
          valueDynasty: dyn?.value ?? 0,
        };
      })
      .filter((p): p is Player => p !== null);
    rosterPlayers.set(r.roster_id, players);

    // Sum starter REDRAFT value the same way computeAllProfiles does, so the
    // tier we assign here will match the competitiveness label downstream.
    const adj = applyTep(players, format);
    const { starters } = fillStarters(adj, format);
    const starterTotal = POSITIONS.reduce(
      (s, pos) => s + starters[pos].reduce((a, p) => a + p.valueRedraft, 0),
      0,
    );
    rosterStarterTotal.set(r.roster_id, starterTotal);
  }

  // Mean + std of starter totals. Same ±0.5*std cuts as profile.ts.
  const starterTotals = Array.from(rosterStarterTotal.values());
  const meanStarter = starterTotals.reduce((s, v) => s + v, 0) / starterTotals.length;
  const stdStarter = Math.sqrt(
    starterTotals.reduce((s, v) => s + (v - meanStarter) ** 2, 0) / starterTotals.length,
  );

  const tierForRoster = (rosterId: number): PickTier => {
    const total = rosterStarterTotal.get(rosterId) ?? meanStarter;
    if (total > meanStarter + STD_THRESHOLD * stdStarter) return "late";  // STRONG
    if (total < meanStarter - STD_THRESHOLD * stdStarter) return "early"; // WEAK
    return "mid"; // AVERAGE
  };

  // Slot rank for sortability (1 = weakest team, N = strongest). Picks with
  // a known Sleeper slot override this; projected picks just use it as a
  // stable secondary sort key.
  const slotRankByRoster = new Map<number, number>();
  [...rosters]
    .sort((a, b) =>
      (rosterStarterTotal.get(a.roster_id) ?? 0) - (rosterStarterTotal.get(b.roster_id) ?? 0)
    )
    .forEach((r, i) => slotRankByRoster.set(r.roster_id, i + 1));

  // ── Pass 2: build picks per roster ──
  return rosters.map((r) => {
    const user = users.find((u) => u.user_id === r.owner_id);
    const ownerName = user?.display_name ?? `Team ${r.roster_id}`;
    const players = rosterPlayers.get(r.roster_id) ?? [];

    const ownPicks = picksMap.get(r.roster_id) ?? new Set<string>();
    const picks: Pick[] = Array.from(ownPicks)
      .map((key): Pick => {
        const [yearStr, roundStr, origStr] = key.split("|");
        const year = parseInt(yearStr!, 10);
        const round = parseInt(roundStr!, 10);
        const origRosterId = parseInt(origStr!, 10);

        // Slot resolution:
        //   - Upcoming draft + Sleeper published the slot order: use it.
        //   - Otherwise: project the tier from the ORIGINAL roster's starter
        //     strength (matches their competitiveness label).
        const knownSlot = year === upcomingYear ? upcomingSlots.get(origRosterId) : undefined;
        const slotKnown = knownSlot !== undefined;
        const slot = slotKnown
          ? knownSlot!
          : (slotRankByRoster.get(origRosterId) ?? teamCount);
        const tier: PickTier | null = round === 1 && !slotKnown
          ? tierForRoster(origRosterId)
          : null;

        const value = resolvePickValue(
          dynastyValues,
          teamCount,
          year,
          round,
          slotKnown ? slot : (tier ?? tierForRoster(origRosterId)),
        );

        // Label format depends on what we actually know:
        //   known slot:         "2026 1.07"
        //   projected, round 1: "2027 mid 1st"
        //   projected, round 2+: "2027 2nd"   (FantasyCalc doesn't tier these)
        const ordinal = ordinalRound(round);
        const baseLabel = slotKnown
          ? `${year} ${round}.${String(slot).padStart(2, "0")}`
          : round === 1
            ? `${year} ${tier} ${ordinal}`
            : `${year} ${ordinal}`;

        const origRoster = rosters.find((rr) => rr.roster_id === origRosterId);
        const origUser = users.find((u) => u.user_id === origRoster?.owner_id);
        const viaSuffix =
          origRosterId !== r.roster_id
            ? ` (via ${origUser?.display_name ?? "?"})`
            : "";

        return {
          year,
          round,
          origRosterId,
          ownerRosterId: r.roster_id,
          slot,
          slotKnown,
          tier,
          label: `${baseLabel}${viaSuffix}`,
          value,
        };
      })
      .sort((a, b) => {
        if (a.year !== b.year) return a.year - b.year;
        if (a.round !== b.round) return a.round - b.round;
        return a.slot - b.slot;
      });

    // isMine: true if the requesting user's Sleeper user_id matches this roster's owner
    const isMine = mySleeperUserId !== undefined
      ? r.owner_id === mySleeperUserId
      : false;

    return {
      rosterId: r.roster_id,
      ownerName,
      isMine,
      record: `${r.settings?.wins ?? 0}-${r.settings?.losses ?? 0}`,
      players,
      picks,
    };
  });
}

function ordinalRound(round: number): string {
  const labels = ["1st", "2nd", "3rd", "4th", "5th", "6th", "7th"];
  return labels[round - 1] ?? `${round}th`;
}
