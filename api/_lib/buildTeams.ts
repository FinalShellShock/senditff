import {
  buildPicksMap,
  projectDraftSlots,
  resolvePickValue,
} from "../../src/data/picks";
import { normName } from "../../src/data/normalize";
import type { LeagueFormat, Pick, Player, TeamInput } from "../../src/algo/types";
import type {
  SleeperRoster,
  SleeperTradedPick,
  SleeperUser,
} from "../../src/data/types";
import type { ValueMaps } from "./snapshot";

const POSITIONS = ["QB", "RB", "WR", "TE"] as const;
type Position = (typeof POSITIONS)[number];

// Assembles TeamInput[] from raw Sleeper data + value maps.
// Shared by the sync endpoint and anything else that needs fresh profiles.
export function buildTeamInputs(params: {
  rosters: SleeperRoster[];
  users: SleeperUser[];
  tradedPicks: SleeperTradedPick[];
  sleeperPlayers: Record<string, { full_name?: string; first_name?: string; last_name?: string; position?: string; team?: string | null; age?: number }>;
  valueMaps: ValueMaps;
  format: LeagueFormat;
  myUid?: string;
  thisYear: number;
}): TeamInput[] {
  const { rosters, users, tradedPicks, sleeperPlayers, valueMaps, format, myUid, thisYear } = params;
  const { dynastyValues, redraftValues } = valueMaps;

  const draftYears = [thisYear, thisYear + 1, thisYear + 2];
  const picksMap = buildPicksMap(rosters, tradedPicks, draftYears);
  const draftSlots = projectDraftSlots(rosters);

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
          age: sp.age ?? dyn?.age ?? red?.age ?? null,
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
        const slot = draftSlots.get(origRosterId) ?? rosters.length;
        const value = resolvePickValue(dynastyValues, rosters.length, year, round, slot);
        const slotStr = `${round}.${String(slot).padStart(2, "0")}`;
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
          label: `${year} ${slotStr}${viaSuffix}`,
          value,
        };
      })
      .sort((a, b) => a.label.localeCompare(b.label));

    // isMine: true if the requesting user owns this roster
    const isMine =
      myUid !== undefined && user?.user_id !== undefined
        ? r.owner_id === myUid ||
          users.find((u) => u.user_id === r.owner_id)?.user_id === myUid
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
