import {
  buildPicksMap,
  findUpcomingDraft,
  projectDraftSlots,
  resolvePickValue,
  slotToTier,
} from "../../src/data/picks";
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
  const upcoming = findUpcomingDraft(drafts);
  const upcomingYear = upcoming?.season ?? thisYear;
  const upcomingSlots = upcoming?.slotByRoster ?? new Map<number, number>();

  const draftRounds = upcoming?.rounds
    ?? league.settings?.draft_rounds
    ?? 4;
  const draftYears = [upcomingYear, upcomingYear + 1, upcomingYear + 2];

  const picksMap = buildPicksMap(rosters, tradedPicks, draftYears, draftRounds);
  // Standings projection — only used for years beyond the upcoming draft.
  const projectedSlots = projectDraftSlots(rosters);
  const teamCount = rosters.length;

  return rosters.map((r) => {
    const user = users.find((u) => u.user_id === r.owner_id);
    const ownerName = user?.display_name ?? `Team ${r.roster_id}`;

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

    const ownPicks = picksMap.get(r.roster_id) ?? new Set<string>();
    const picks: Pick[] = Array.from(ownPicks)
      .map((key): Pick => {
        const [yearStr, roundStr, origStr] = key.split("|");
        const year = parseInt(yearStr!, 10);
        const round = parseInt(roundStr!, 10);
        const origRosterId = parseInt(origStr!, 10);

        // Slot resolution. Two cases:
        //   1. Upcoming draft: Sleeper has the real slot — use it.
        //   2. Future year: project from current standings, bucket into a
        //      tier. Don't claim a specific slot number to the user.
        const knownSlot = year === upcomingYear ? upcomingSlots.get(origRosterId) : undefined;
        const slotKnown = knownSlot !== undefined;
        const projectedSlot = projectedSlots.get(origRosterId) ?? teamCount;
        const slot = slotKnown ? knownSlot! : projectedSlot;
        const tier: PickTier | null = round === 1 && !slotKnown
          ? slotToTier(projectedSlot, teamCount)
          : null;

        const value = resolvePickValue(
          dynastyValues,
          teamCount,
          year,
          round,
          slotKnown ? slot : (tier ?? slotToTier(projectedSlot, teamCount)),
        );

        // Label format depends on what we actually know.
        //   known slot:        "2026 1.07"
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
      .sort((a, b) => a.label.localeCompare(b.label));

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
