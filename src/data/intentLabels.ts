// Friendly names for the archetype families, as shown in the Send It intent
// picker.
//
// Lives here rather than in SendIt.tsx because the scouting report links INTO
// that picker, and the two drifted: a play titled "Buy the fringe, not the
// lottery tickets" opened an intent labelled "Buy an aging stud". A user hit
// that and said it threw him off, which it should have. Sharing the map is
// half the fix; the other half is that the button now says where it goes.
//
// Deliberately NOT in src/algo/, which is hashed into the algo fingerprint.
// Renaming a label is a copy change and must not read as a new engine.

import type { ArchetypeFamily } from "../algo/archetypes.ts";

export const INTENT_LABELS: Record<ArchetypeFamily, string> = {
  need_fill: "Fill a need",
  tier_down: "Tier down (1 stud into 2 pieces)",
  consolidate: "Consolidate (2 same-position into 1 stud)",
  consolidate_flex: "Consolidate (2 positions into 1 stud)",
  age_arb_buy: "Buy an aging stud",
  age_arb_sell: "Sell an aging stud",
  push_in: "Push all-in",
  capital_convert_picks_to_production: "Picks to players",
  capital_convert_production_to_picks: "Players to picks",
};

/** Short form for a button that opens the intent, e.g. "Consolidate". Drops
 *  the parenthetical the picker uses, which is explanation rather than name. */
export function intentShortLabel(family: ArchetypeFamily): string {
  return (INTENT_LABELS[family] ?? family).replace(/\s*\(.*\)$/, "");
}
