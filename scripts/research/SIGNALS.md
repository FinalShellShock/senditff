# Aging signals beyond calendar age

Reproduce with `node scripts/research/signals.mjs`.

The question: two 28-year-old RBs are not the same asset. Is there anything
measurable about *how they got here* that predicts which one falls off first?
If so, that signal should add or remove age pressure in proportion to its
strength.

## Method, and the trap that nearly ruined it

Outcome is the same remaining-value measure as [AGING.md](AGING.md): credit
each player his points-per-game k years later, **zero if he is out of the
league**, discount and sum.

Three controls, in order of how badly each one bites:

1. **No lookahead.** Every signal is computed from a player's career *through*
   the season being evaluated, never his career totals. Using totals leaks the
   future into the predictor.

2. **Split within age.** Groups compare players of the *same* age against each
   other. Split globally and older players trivially have more of everything,
   so the "signal" is just age wearing a disguise.

3. **Stratify by current production.** This is the one that matters most, and
   the first run without it produced completely backwards answers.

### Why control 3 is not optional

Run career touches naively and RBs with MORE touches show **+66% more** value
remaining. Read literally, that says heavy workloads make running backs
younger.

They do not. Touches are a proxy for **being good**. An RB with 800 career
touches by 27 is a workhorse starter; one with 200 is a backup. The "signal"
was a quality detector, and quality swamped everything else.

The fix is to stratify by current points-per-game first and split on the signal
only *within* each stratum, comparing players producing at the same level right
now who differ in how they got there. Every number below uses that control, and
a `prodgap` column reports the residual production difference between groups so
a failed control is visible rather than silent.

## Confirmed signals

### QB rushing share of career fantasy points

Johnny's hypothesis, and it holds.

| age | remaining value, low -> high | effect |
|-----|------------------------------|--------|
| 27 | 62.5 -> 52.1 | **-16.6%** |
| 28 | 65.7 -> 50.6 | **-22.9%** |
| 29 | 59.2 -> 46.3 | **-21.8%** |
| 30 | 63.9 -> 54.6 | **-14.6%** |
| 31 | 57.7 -> 44.9 | **-22.2%** |
| 32 | 48.7 -> 42.6 | **-12.5%** |

Negative in all six buckets, averaging about **-18% remaining value** for QBs
whose production leans on their legs. It survives the production control, which
matters especially here: rushing QBs are often the *good* ones (Lamar, Allen),
so the quality confound works AGAINST this finding rather than manufacturing
it. That makes it more credible than the raw number suggests.

Cam Newton is the archetype rather than the counterexample: a long career, but
finished as a fantasy asset by 32.

### QB sack rate (career sacks per attempt)

Not hypothesized, and roughly as strong: **-11% to -32%**, negative in all six
buckets, averaging about -22%. Plausibly a durability proxy (more hits absorbed)
or a proxy for playing behind bad protection. The mechanism is unestablished;
only the association is measured.

## Rejected

### The RB touch cliff does not survive

The widely-repeated "1,500 career touches and they're done" claim **fails**
once quality is controlled. Direction flips across age buckets (+26%, +18%,
+9%, +0.3%, -8%, +9%), which is noise, not a cliff.

This is the most useful negative result here. It is a popular belief, the naive
analysis appears to confirm it *backwards*, and the corrected analysis says
there is nothing there beyond "good backs get more carries."

### Also rejected

- **RB receiving share**: direction flips, no effect.
- **WR career targets**: direction flips.

## Suggestive, not confirmed

### WR YAC share, ages 27+

Flips overall, so the script marks it noise, but the pattern is not random:
positive at 25-26, then negative in four consecutive buckets (-5.3%, -17.4%,
-16.3%, -18.2% at ages 27, 28, 29, 30).

That is what an age interaction looks like: receivers who depend on yards after
the catch depend on speed, and speed goes first. Worth a dedicated test with
the split restricted to 27+ rather than treating it as a flat signal.

### TE career targets: treat with suspicion

Consistent and large in the "more targets, more value left" direction (+26% to
+50%). But that is the same shape as the RB touches trap, `prodgap` runs as
high as 0.84, and n is only 34-48 per group. Most likely residual quality
leakage that the three-strata control did not fully remove. **Do not ship this
without a stronger control.**

## Getting this into the app

Not wired up yet. The blocker is data plumbing, not statistics: the app knows
each player's name, position, age and value from Sleeper and FantasyCalc, but
nothing about career rushing share or sack rate.

`players.csv` has no `sleeper_id`, so the join has to be by normalized name.
That is already a solved problem in this codebase: `normName` in
`src/data/normalize.ts` does exactly this for FantasyCalc.

Proposed shape:

1. A build step emits a static JSON keyed by normalized name, holding the
   signal values for currently-relevant QBs only (the two confirmed signals are
   both QB-only, so this is a small file).
2. Sync joins it onto players the same way FantasyCalc values are joined.
3. Signals adjust effective age. Scaling the measured effect: a QB in the high
   rushing-share group carries roughly 18% less remaining value than his age
   implies, so his pressure should read as if he were meaningfully older.

Do NOT convert these effects to "years" the way the script's `shift` column
does. That column divides by how fast the position normally declines, and QBs
decline slowly, so it inflates a real 18% effect into an absurd 7 years. Apply
the percentage to remaining value directly.
