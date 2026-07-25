# Aging curves from real data

Reproduce with `node scripts/research/aging.mjs`. Downloads cache to
`scripts/research/.cache/` (gitignored, ~15MB).

## Why this exists

`POSITION_CURVES` came from published summaries, never from a dataset this
project checked. A real user thumbs-down exposed the cost: a flat `age >= 27`
age-arb gate was offering Justin Jefferson, CeeDee Lamb and every elite QB as
"aging assets to buy at a discount." On Johnny's league that gate flagged 46
players and 22 of them were prime-age false positives.

## Data

nflverse GitHub releases, free, no auth. Seasons **1999-2024** (2025 is not
published there yet). Season totals joined to `players.csv` on
`player_id = gsis_id` for `birth_date`. Age computed at Sept 1 of the season.

A player-season counts only above a volume floor, so the curve describes
players you would actually roster: `games >= 8` plus QB `attempts >= 200`,
RB `carries + targets >= 100`, WR `targets >= 50`, TE `targets >= 40`.

Qualifying seasons: QB 863 (206 players), RB 1377 (413), WR 1942 (539),
TE 755 (225).

## Method

**The framing.** Dynasty value prices remaining career, not this season. So
players falling out of the league is not missing data to impute away, it is
the signal: a player out of the league produces zero, and that zero belongs in
the average. Every academic treatment corrects dropout away. For dynasty that
is backwards.

For each player startable at age `a`, look forward `k` years and credit his
PPG at `a+k`, or **zero** if he is not startable then:

```
remaining_value(a) = sum over k of discount^k * E[PPG at a+k | startable at a]
```

This folds survival and production into one number without modelling them
separately. Default discount 0.9/yr, horizon 8 years.

**Right-censoring** is handled per horizon: a 2022 season cannot be observed 5
years later in data ending 2024, so each `k` uses only seasons where
`season + k <= 2024`. Using one balanced panel instead would throw away every
recent season and make late careers look like endings.

**Isotonic regression** (pool adjacent violators, weighted by sample size)
fits the loss rate. The raw series goes negative at thin old-age buckets,
which is noise, not players aging in reverse. PAVA returns the least-squares
closest non-decreasing series. **The monotonicity constraint is the load-bearing
assumption here, and it is an assumption, not a fact.**

## The finding that mattered

Remaining-value LEVEL barely separates positions, because it falls for
everyone with age. At 27 it reads 48 for an RB and 46 for a WR, though one is
falling apart and the other is peaking.

**The RATE of loss is what differs.** Annualized percent of remaining value
lost per year, fitted:

| age | QB | RB | WR | TE |
|-----|------|------|------|------|
| 23 | -1.8% | 5.6% | 4.6% | 5.5% |
| 25 | -1.8% | 8.0% | 4.6% | 5.5% |
| 27 | **0.6%** | **9.3%** | **4.6%** | 5.5% |
| 29 | 4.5% | 11.2% | 7.6% | 5.5% |
| 30 | 4.5% | 14.6% | 7.6% | 5.5% |
| 33 | 4.5% | - | 17.9% | - |
| 35 | 12.1% | - | - | - |

At 27 an RB bleeds **twice** as fast as a WR and **fifteen times** faster than
a QB. That is the distinction the age-arb archetype needs, and no version of a
calendar-age gate can express it.

QBs *gain* remaining value through their mid-20s (negative loss rate), hold a
flat ~4.5%/yr plateau from 28 to 34, and only break down at 35.

## What shipped

`VALUE_LOSS_RATE` in `src/algo/constants.ts`, read by `valueLossRate()` in
`src/algo/profile.ts`, gating `isAging`/`isDeclining` in
`api/_lib/tradeEngine.ts`.

Thresholds are **per position**, not global. A global number that catches
genuinely old RBs also catches Bijan Robinson at 24.5, because RBs bleed
5.6%/yr even at 23. What marks a player as aging is his position's curve
accelerating away from its own baseline.

```
AGING_LOSS_RATE      QB 6    RB 8.5   WR 7    TE 7
DECLINING_LOSS_RATE  QB 10   RB 10.5  WR 10   TE 10
```

Effective gates: aging at RB 25.4+, WR 29+, QB 34.6+; declining at RB 28.6+,
WR 33+, QB 34.9+.

Verified on Johnny's league: Bijan Robinson, De'Von Achane, Jaylen Waddle,
Justin Jefferson, Josh Allen, Patrick Mahomes and Brock Bowers all correctly
excluded. Jonathan Taylor, McCaffrey, Barkley, Henry, Davante Adams and
A.J. Brown all correctly included. Engine stays deterministic; default mode
unchanged at 74 packages.

## Confidence and caveats

- **TE is unresolved.** Its fitted curve is flat at 5.5%/yr, so the gate never
  fires. That is n=25-36 above age 30 and a raw series that wanders negative,
  not evidence TEs stop aging. Thresholds are kept in line with WR so the gate
  starts working on its own if the curve is refit with more data.
- **2025 is missing** from nflverse, so nothing here sees the most recent season.
- **Isotonic monotonicity is an assumption.** It is the right shape prior for
  aging, but it manufactures smoothness the raw data does not have.
- Ages 21-22 are excluded from rate fitting: tiny samples and heavy selection
  (a startable 21-year-old WR is a rare early breakout).
- The old delta-method pass is superseded by this but agreed directionally.
  Note its two competing biases: dropout hides decline, while selection into
  consecutive-season pairs plus regression to the mean exaggerates it. The
  literature (Tango, Baseball Prospectus) emphasizes the second.

## Not established

- **Rushing vs pocket QBs.** The delta pass suggested rushing QBs collapse
  around 30 while pocket QBs hold into their mid-30s (cumulative -5.51 vs
  +3.52 by age 33), but n=4-5 per bucket above 30. Suggestive only, and NOT
  built into the curves. Worth revisiting; it is the most interesting unmodelled
  axis we have. Dak Prescott is actively converting from one profile to the
  other (22.3 to 6.8 rush yds/game).
- **Aging identifiers beyond calendar age** (RB career touches and the claimed
  1,500-touch cliff, WR usage trend, games missed) were not tested. Still open.
- **Window classification still uses the old `POSITION_CURVES`.** Only the
  age-arb gates moved to the data-driven curve. Porting window math needs its
  own validation pass, since remaining-value level is monotonic and would
  reclassify rosters wholesale.
