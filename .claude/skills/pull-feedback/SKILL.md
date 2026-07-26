---
name: pull-feedback
description: Pull Send It trade feedback out of Firestore and turn it into an algorithm tuning plan. Use when Johnny says things like "pull the feedback", "time to pull feedback and put together a plan", "what's the feedback saying", "review the thumbs up/downs", or wants to tune the trade algorithm based on what users flagged.
---

# Pull Send It feedback and build a tuning plan

Users leave thumbs up/down plus reason chips and comments on trade packages in
the Send It tab. This skill pulls that down and turns it into a concrete,
prioritized plan for changing the algorithm.

Everything runs from `/Users/johnny/dynasty-trade/sendit`.

## 1. Pull the data

Credentials live only in Vercel, never on disk. The export script needs a
service account, so pull env first if the file is missing:

```bash
cd /Users/johnny/dynasty-trade/sendit
[ -f .env.vercel.local ] || npx vercel env pull .env.vercel.local
npm run feedback:export
```

This writes `feedback-export.json` and `feedback-export.csv` to the repo root
(both gitignored) and prints a verdict split plus a reason tally.

**App feedback is exported separately** to `feedback-site.json` (also
gitignored) and printed inline, grouped by category. It covers anything in the
app that is not a verdict on one trade: the overview, scouting reports, the
calculator, grades, ideas, bugs. Each entry carries a `category` and the
`route` the person was on.

It never enters the reason tallies or the verdict split, because those only
mean something across comparable trade judgments. Read it and give it its own
heading in the plan. It is where product and UI problems surface, and those are
invisible to the trade thumbs.

Optional filters: `npm run feedback:export -- --since 2026-07-01 --league <id>`

Then delete the pulled secrets once the export succeeds, so a service account
private key and the Anthropic key aren't left sitting on disk between runs.
It costs nothing: the next run just pulls again.

```bash
rm -f .env.vercel.local
```

If `npx vercel env pull` fails on auth, stop and tell Johnny to run
`npx vercel login`. Do not try to work around it.

## 2. Read it properly

Read `feedback-export.json` for the full payloads. Each entry carries the
whole trade package, its engine scores, the search that produced it, and a
version stamp.

**Segment by `algoFingerprint` before drawing any conclusion.** It is a hash
of the algorithm source at the time the trade was generated. Get the current
one with:

```bash
npm run build:api      # prints: API bundles built (algo fingerprint <hash>)
```

Feedback whose fingerprint differs from the current build describes an engine
that no longer exists. Report it separately as history. Never mix it into the
"what should we change now" evidence, and never propose a fix for something a
later commit already changed.

## 3. What to actually look for

Work from the data, in roughly this order:

- **Comments first.** Free text is the richest signal and the least
  structured. Quote them in the plan.
- **Reason-key frequency**, split by verdict. `archetype_mismatch` clustering
  on one archetype is a different problem than `unbalanced` spread evenly
  across all of them.
- **Where the engine disagreed with the human.** For each thumbs-down, compare
  the human verdict against `package.scores` (`myFit`, `theirFit`, `balance`,
  `archMatch`). A package the engine scored highly and a human hated is the
  single most valuable signal available: it means a scoring term is wrong, not
  just mistuned.
- **Archetype breakdown.** Which archetypes earn the most downvotes per
  appearance, not in raw count. A rare archetype with 3 of 3 downvotes matters
  more than a common one with 5 of 60.
- **Forced vs auto.** `search.archetype` non-null means the user forced that
  intent, which runs relaxed gates (`FORCED_GATES` in `api/_lib/tradeEngine.ts`).
  Bad forced results are a much weaker signal than bad auto results.
- **`packageIndex`.** Downvotes concentrated at index 0 mean the ranking is
  wrong, not the generation.

## 4. Write the plan

Deliver a written plan. Do NOT change algorithm code as part of this skill.

The plan should have:

1. **Sample size up front.** State N, the verdict split, and how many entries
   are on the current fingerprint. If N is small, say so plainly and rank the
   findings as provisional. Do not dress up 4 data points as a trend.
2. **Findings ranked by evidence strength**, each with the specific entries
   backing it (quote comments, cite the packages).
3. **Proposed changes**, each naming the file and the specific knob:
   `src/algo/constants.ts` (weights and thresholds), `src/algo/archetypes.ts`
   (archetype triggers/scoring), `src/algo/fairness.ts` (fairness bands),
   `api/_lib/tradeEngine.ts` (generation, gates, ranking).
4. **What NOT to change**, and why. Feedback that reflects taste rather than a
   defect is worth naming so it doesn't get "fixed" later.
5. **A validation step** for each proposed change, using the existing
   harnesses: `npm run validate:trades` (engine sweep + determinism),
   `npm run validate` (team profiles), `npm run validate:projection`.

Then stop and let Johnny pick what to implement.

## Rules

- Never invent player names, roster details, or feedback entries. If the data
  doesn't say it, say the data doesn't say it.
- Determinism is the product's core promise. Any proposed change must keep
  identical inputs producing identical outputs, and must be checked with
  `npm run validate:trades`.
- Don't commit, deploy, or edit env vars from this skill.
- `feedback-export.json` / `.csv` / `feedback-site.json` are gitignored on
  purpose. Leave them untracked; they hold user emails.
- Pulling marks entries reviewed, which RESETS the footer bell for everyone:
  not just the dot, but the counts too, since they are scoped to the unreviewed
  queue. Johnny considers that a feature. A cleared bell tells the others he is
  not sitting on a backlog, and each person can see whether they have
  contributed since the last clear.
  So only pull when actually about to act on it, or the signal becomes a lie.
