// Haiku rationale prompt.
//
// Split out of api/trades/find.ts so it can be exercised without Firebase
// credentials. find.ts imports the Admin SDK at module load, which meant the
// single highest-churn piece of the app, the exact words sent to the model,
// could only be inspected in production. It is pure and deterministic; keep it
// that way.
//
// NOTE: this file is part of the algo fingerprint (scripts/build-api.mjs).
// Editing the prompt moves the hash, so feedback stays attributable to the
// wording that produced it.

import { fairnessText } from "../../src/algo/fairness";
import type { TeamProfile } from "../../src/algo/types";
import { confidenceTier, type TradePackage } from "./tradeEngine";

export const PROMPT_VERSION = 4;

// Ages are included because the model was otherwise inventing them, and on an
// age-arbitrage trade the age IS the argument. Real feedback caught a rationale
// claiming a 27-year-old was 25. Ages come straight from the FantasyCalc
// snapshot the algorithm scored the trade with, so the prose can't disagree
// with the math.
function describeAsset(a: {
  kind: "player" | "pick";
  name: string;
  position?: string;
  age?: number;
  valueDynasty?: number;
}): string {
  const v = a.valueDynasty != null ? ` ${Math.round(a.valueDynasty)}` : "";
  if (a.kind !== "player") return `${a.name}${v}`;
  return a.age != null
    ? `${a.name} (${a.position}, ${a.age.toFixed(1)})${v}`
    : `${a.name} (${a.position})${v}`;
}

// Haiku ignores the plain-prose instructions often enough that we enforce
// them here, on cached entries too (they were stored unsanitized): no em
// dashes, no markdown headings or bold.
export function sanitizeRationale(text: string): string {
  return text
    .replace(/^#{1,6}[^\n]*$/gm, "")
    .replace(/\*\*/g, "")
    .replace(/\s*[—–]\s*/g, ", ")
    .trim();
}

// Split out from generateRationale so the exact prompt can be returned to the
// UI for inspection, including for cache hits where no API call happens. It is
// deterministic from the same inputs, so rebuilding it always matches what the
// cached rationale was written from.
//
// Token economics drove the rewrite. Output is billed at 5x input on Haiku
// ($5 vs $1 per Mtok), and rationales run longer than the prompt, so ~78% of
// the spend is the response. The lever is therefore asking for less prose, not
// trimming the input. Note max_tokens is a CAP, not a budget: unused tokens
// cost nothing, so lowering it truncates rather than saves. The ask is what
// controls length.
//
// Prompt caching does NOT apply here: Haiku 4.5's minimum cacheable prefix is
// 4096 tokens and this prompt is roughly 300. A cache_control marker would
// silently do nothing.
//
// The instruction boilerplate was cut hard to make room for signal the engine
// already knows and was throwing away: positional need, the two-sided fit
// grades, and how well the package actually matches its archetype.
// Shared by the prompt stance and the confidence badge so they cannot drift.
function isWeakMatch(
  pkg: Omit<TradePackage, "rationale">,
  diagnostics?: { degraded?: string; myArchetypeScore?: number },
): boolean {
  return (
    diagnostics?.degraded != null ||
    (diagnostics?.myArchetypeScore != null && diagnostics.myArchetypeScore < 30)
  );
}

// The badge the UI shows, from the same inputs the prompt stance uses.
export function confidenceForPackage(
  pkg: Omit<TradePackage, "rationale">,
  diagnostics?: { degraded?: string; myArchetypeScore?: number },
): NonNullable<TradePackage["confidence"]> {
  const archMatch = pkg.scores?.archMatch ?? 0;
  return { tier: confidenceTier(archMatch, isWeakMatch(pkg, diagnostics)), archMatch };
}

export function buildRationalePrompt(
  pkg: Omit<TradePackage, "rationale">,
  myProfile: TeamProfile,
  counterProfile?: TeamProfile,
  diagnostics?: { degraded?: string; myArchetypeScore?: number },
): string {
  const giveNames = pkg.give.map(describeAsset).join(", ");
  const receiveNames = pkg.receive.map(describeAsset).join(", ");
  const archetypeLabel = pkg.archetype.replace(/_/g, " ");

  const fairnessNote =
    pkg.fairness === "FAIR"
      ? "Value is even."
      : `Raw value is a ${fairnessText(pkg.fairness).toLowerCase()} for you; acknowledge the lean and what it buys or costs.`;

  // Positional need on what's coming back. The engine computes urgency and a
  // classification per position and previously told the writer none of it, so
  // rationales argued from vibes where hard numbers existed.
  const inbound = [...new Set(pkg.receive.filter((a) => a.kind === "player" && a.position).map((a) => a.position!))];
  const needNotes = inbound
    .map((pos) => {
      const ps = myProfile.positionScores?.[pos as keyof typeof myProfile.positionScores];
      if (!ps) return null;
      return `${pos} ${ps.classification} (urgency ${Math.round(ps.urgency)})`;
    })
    .filter(Boolean);
  const needNote = needNotes.length ? `Your need at what you're getting: ${needNotes.join(", ")}.` : "";

  const fitNote = pkg.scores
    ? `Fit grades: you ${pkg.scores.myFit >= 0.05 ? "gain" : pkg.scores.myFit <= -0.05 ? "lose" : "roughly break even"}, they ${pkg.scores.theirFit >= 0.05 ? "gain" : pkg.scores.theirFit <= -0.05 ? "lose" : "roughly break even"}.`
    : "";

  // Johnny's ask: lead with confidence when the shape genuinely fits, and say
  // plainly when it does not. A forced-intent search that found nothing clean,
  // or a roster that scores badly for this archetype, produces inspiration
  // rather than a recommendation, and the copy should admit that.
  const archMatch = pkg.scores?.archMatch ?? 0;
  const rosterFit = diagnostics?.myArchetypeScore;
  const tier = confidenceTier(archMatch, isWeakMatch(pkg, diagnostics));
  const stance =
    tier === "inspiration"
      ? `IMPORTANT: this roster is a weak match for ${archetypeLabel}${rosterFit != null ? ` (archetype fit ${rosterFit}/100)` : ""} and this was the closest package available, not a strong one. Open by saying plainly that this is an idea to consider rather than a recommendation, and name what is imperfect about it. Do not oversell.`
      : tier === "recommended"
        ? `This is a textbook ${archetypeLabel} for this roster. Lead with why the shape fits, and recommend it directly.`
        : `This is a reasonable ${archetypeLabel} fit. Be measured, neither overselling nor hedging.`;

  // The two numbers `balance` is actually judged on. Raw sums alone made a
  // package the engine called lopsided look even, because bundle decay and the
  // best-asset premium happen after the sum. Only mentioned when they diverge
  // enough to matter, so simple deals stay uncluttered.
  //
  // Deliberately does not claim a direction. Both effects run at once and
  // either side can end up above its raw sum: the multi-piece side gets
  // decayed, and whichever side holds the single best asset charges a premium.
  // An earlier version asserted "worth less together than apart" and was
  // outright wrong on 1-for-2 packages, where the single side goes UP.
  const adjGive = pkg.adjValueGive;
  const adjReceive = pkg.adjValueReceive;
  const rawGive = pkg.valueGive;
  const rawReceive = pkg.valueReceive;
  const diverges =
    Math.abs(adjGive - rawGive) > rawGive * 0.02 || Math.abs(adjReceive - rawReceive) > rawReceive * 0.02;
  const adjNote = diverges
    ? `Trade-effective value (a bundle is worth less than its parts, and the side with the single best asset charges a premium): yours ${Math.round(rawGive)} counts as ${Math.round(adjGive)}, theirs ${Math.round(rawReceive)} counts as ${Math.round(adjReceive)}.`
    : "";

  // What the package does for THEM, positionally. The writer is asked for a
  // whole sentence on why the counter-team accepts and previously had no data
  // to answer it with, so those sentences were guesswork.
  const theirInbound = [...new Set(pkg.give.filter((a) => a.kind === "player" && a.position).map((a) => a.position!))];
  const theirNeeds = counterProfile
    ? theirInbound
        .map((pos) => {
          const ps = counterProfile.positionScores?.[pos as keyof typeof counterProfile.positionScores];
          return ps ? `${pos} ${ps.classification}` : null;
        })
        .filter(Boolean)
    : [];
  const theirNeedNote = theirNeeds.length
    ? `Their need at what they're getting: ${theirNeeds.join(", ")}.`
    : "";

  const theirs = counterProfile
    ? `${pkg.counterTeam} is ${counterProfile.windowLabel} (${counterProfile.competitiveness}, ${counterProfile.windowTier}).`
    : "";

  return `Dynasty fantasy football trade. You are ${myProfile.windowLabel} (${myProfile.competitiveness}, ${myProfile.windowTier} window). ${theirs}

Send: ${giveNames}
Get: ${receiveNames}

Shape: ${archetypeLabel}. ${[fairnessNote, fitNote, needNote, theirNeedNote, adjNote].filter(Boolean).join(" ")}
${stance}

Write 2-3 sentences on why this fits your roster now, then one sentence on why ${pkg.counterTeam} accepts (a trade nobody takes is worthless). Be concrete about the players and both timelines.

Use only the facts above. Never invent an age, stat, injury, contract, or team situation not stated here. Plain prose: no markdown, no bullets, no em dashes.`;
}
