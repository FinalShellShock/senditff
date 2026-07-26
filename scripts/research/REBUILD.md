# What actually works for a rebuilding team

`node scripts/research/rebuild-strategy.mjs` · 11,255 trades with player ids
across 397 measurable leagues · **99.2% of traded players priced** at the time
of the trade.

## The hypothesis under test

> Successful rebuilders sell age THAT HAS VALUE for picks and undervalued
> players, take chances on guys hoping their stock rises, then convert picks
> and risen players into studs, and hit on draft picks.

Testing it needed a value at the trade date, which is why the historical value
pipeline exists. Without it, "sold age" cannot tell a valuable veteran from a
washed one, and "bought youth" is dominated by 24 year old dart throws.

## Stage 1: do acquired players actually rise?

Rank 12 months after acquisition, banded by age and rank at the time. Two
corrections were needed before this said anything:

- **Median, not mean.** Rank movement has huge tails. A top-60 bust can fall
  240 places while improvement is capped by rank 1, so the mean reported
  "everyone declines" off a handful of busts. One cell read -128 on n=68.
- **Drift-adjusted.** ECR is a RELATIVE rank and each rookie class pushes the
  population down, so standing still looks like falling. League-wide drift is
  **-18 places a year**; cells are reported against it.

Median places beaten vs drift, share that beat drift, and n:

| age | stud (≤24) | valuable (25-60) | fringe (61-100) | deep (100+) |
|---|---|---|---|---|
| ≤23 | +1 · 100% (53) | -164 · 25% (68) | **+30 · 69% (110)** | -8 · 45% (394) |
| 24-25 | +22 · 78% (386) | +4 · 66% (730) | **+35 · 65% (375)** | -11 · 43% (1626) |
| 26-27 | +10 · 68% (779) | +0 · 52% (1229) | -15 · 31% (981) | +13 · 53% (3160) |
| 28-29 | +9 · 73% (244) | -2 · 49% (852) | +6 · 58% (995) | -11 · 43% (1881) |
| 30+ | -1 · 48% (412) | -12 · 34% (777) | +10 · 51% (1417) | -14 · 45% (3146) |

**The sweet spot is young AND fringe: ranked 61-100, age 25 or under.** Those
players beat the drift by 30-35 places with roughly two in three rising.

**Deep fliers do not work.** Young players ranked past 100 come in at -8 and
-11, under 45%. This is the single most useful correction in the whole study:
the two bets look identical if you only look at age, and only one pays.

## Stage 2: do the teams doing it improve?

Rebuilders only (started bottom third), beat-baseline % by horizon, with the
baseline recomputed at each horizon over all teams:

| Move | +1 | +2 | +3 |
|---|---|---|---|
| **bought a stud (top 24)** | **60%** (253) | **64%** (98) | **56%** (54) |
| net picks gained | 49% (661) | 53% (274) | **58%** (125) |
| sold a VALUABLE veteran | 46% (543) | 51% (247) | **54%** (111) |
| sold age but NOT valuable | 49% (678) | 49% (267) | 52% (158) |
| bought FRINGE youth (61-100) | 45% (175) | **56%** (61) | n=17 |
| bought DEEP flier (100+) | 45% (224) | 45% (40) | n=13 |
| full strategy | 46% (393) | 52% (178) | 55% (73) |
| ...plus fringe youth | 45% (95) | **66%** (38) | n=10 |
| ...plus a stud | 57% (130) | **65%** (55) | n=29 |

## Verdict

**Supported:**
- **Sell age that has value.** 46/51/54, and it beats selling washed age
  (49/49/52) at both later horizons. The payoff is genuinely delayed, which is
  why measuring only +1 season found nothing.
- **Accumulate picks.** 49 → 53 → 58, the clearest delayed-payoff curve here.

**Supported with an important correction:**
- **Take chances on undervalued players — but fringe, not deep.** Stage 1 is
  unambiguous and Stage 2 agrees as far as its sample goes (45 → 56).

**The surprise, and it cuts against orthodoxy:**
- **Buying a stud is the single best thing a rebuilder can do, and it works
  immediately** (60% at +1, not just late). "Accumulate and wait" is not what
  the data rewards most.

## Caveats

- **Sample collapses at +3** for several rows (n = 17, 13, 10). Anything
  resting only on a +3 cell is not established.
- **"Bought a stud" may be selection.** A rebuilder able to land a top-24
  player is probably a better-resourced rebuild already. This design cannot
  separate having the means from making the move.
- **Stage 1 is the more robust half.** It needs no team outcome, so it avoids
  attributing a whole season to one trade, and its key cells carry n=110 and
  n=375.
- Draft-pick hit rate, the fourth clause of the hypothesis, is **not tested
  here**. It needs draft results joined to pick ownership, which is a separate
  pipeline.


---

# The strongest signal in the study: acquire quality

`node scripts/research/quality.mjs` · 19,933 trade-sides.

Two of my own proposals were killed by checking them first.

**Shape does not matter.** The 44% of real trades our engine structurally
cannot build perform at baseline:

| Shape | Beat baseline |
|---|---:|
| BOTH sides 2+ (unreachable for us) | 51% (8,241) |
| got 1, gave 2+ (consolidate) | 52% (3,923) |
| straight 1-for-1 | 52% (3,888) |
| **got 2+, gave 1 (tier down)** | **47%** (3,881) |

**Picks do not matter.** Picks-only returns beat baseline 51% of the time,
which is noise. I had ranked picks-as-first-class-assets the top priority on
the grounds that they are 55% of traded assets. That is a frequency argument,
and frequency is what gets accepted, not what works.

**What matters is who you end up with.**

| | Beat baseline |
|---|---:|
| got the better player in the trade | **54%** (4,500) |
| gave up the better player | **46%** (4,431) |

| Best player acquired | Beat baseline |
|---|---:|
| **top 24** | **60%** (1,584) |
| top 25-60 | 51% (2,672) |
| top 61-100 | 48% (2,284) |
| nothing better than 100 | 48% (5,105) |

Monotonic, on the largest samples in the study, and symmetric on the give/get
split, which is what a real effect looks like.

## What this says about the engine

Tier down is the only shape that underperforms (47%), it means giving up the
best player in the deal by construction, and it is **55% of everything the
engine generates**.

That is the change worth making, and it is far smaller than the generation
rewrite I was about to propose: stop producing so many trades where the user
gives away the best player, and bias toward packages that land a genuinely
better one. The evidence behind it (n=4,500 and n=4,431, an 8 point spread;
n=1,584 for the top-24 effect, a 12 point spread) is stronger than anything
else measured today.


---

# Signals that turned out to be nothing

Recorded so they are not rediscovered and believed. All on 11,645-19,933
trade-sides, baseline-controlled.

| Candidate | Result |
|---|---|
| **Momentum** (was he rising or falling before you bought?) | falling 48%, drifting 51%, rising 49%. **Nothing.** |
| **Position acquired** | QB 50%, RB 51%, WR 49%, TE 49%. **Nothing.** |
| **Breadth** (positions acquired) | 1 pos 51%, 2 pos 47%, 3+ 45%. Mild, and it just restates quality. |
| **Positional need filled** | 57% vs 56% once quality is held constant. **Nothing.** |

Buy-low / sell-high is the notable null. It is the most intuitive trading
heuristic there is and it does not show up at all.

## The need_fill trap

`node scripts/research/needfill.mjs`

The raw numbers look like the archetype is backwards:

| Position strength when you bought | Beat baseline |
|---|---:|
| under 60% of league average | **38%** (1,899) |
| 60-90% | 41% (2,468) |
| 90-120% | 51% (3,063) |
| over 120% | **64%** (4,208) |

**It is circular.** Sleeper only serves end-of-season rosters, so the player
you acquired is already counted in that position's strength. "Bought into
strength" partly means "bought a good player", which is the known 60% effect.

Holding quality constant at top-60: weakest position **57%**, strongest **56%**.
The effect disappears.

**So need_fill is not refuted, it is redundant.** Positional need adds nothing
once you know how good the acquired player is.

## Where that leaves the engine

Every signal tested either returns nothing or collapses into the same one:
**does this trade land you a better player?** Shape, picks, momentum, position,
breadth and positional need are all either flat or restatements of it.

That is a simplification, not a dead end. It says the engine should spend its
weight on the quality of what the user ends up with, and stop spreading it
across archetype machinery that the outcomes do not support.


---

# Why the good trades never get offered, and what closes them

## The gate diagnostic

`npm run` the forced sweep and tally which gate each family dies on:

| family | raw | myFit | theirFit | balance |
|---|---:|---:|---:|---:|
| capital_convert_picks_to_production | 366 | **0** | **176** | 0 |
| push_in | 163 | 10 | 45 | 0 |
| tier_down | 2,082 | 508 | 161 | 0 |
| capital_convert_production_to_picks | 554 | 341 | **0** | 0 |

**Trades that acquire quality never fail on the user's fit. They fail because
the counterparty says no.** The reverse is also true: trades that shed quality
never fail on the counterparty's fit.

Tier down dominates the surviving pool (50%) purely on volume: 2,082 raw
candidates against 366 for the acquire-quality generator.

**Balance rejects zero candidates in every family.** It is not the binding
constraint, so there is headroom to pay more.

## Is paying more a mistake?

`node scripts/research/payup.mjs` · 14,384 trade-sides.

| Value delta | Beat baseline |
|---|---:|
| received much more (+25% or better) | 52% (6,026) |
| received slightly more | 51% (947) |
| roughly even | 48% (474) |
| paid slightly more | 51% (928) |
| paid much more (-25% or worse) | 49% (6,009) |

**Value balance is not predictive.** Flat across the whole range.

But conditioned on what the premium bought:

| | Beat baseline |
|---|---:|
| **paid up AND landed a top-24 player** | **59%** (264) |
| paid up AND landed nothing better than 60 | 48% (5,917) |

**Overpaying for quality works. Overpaying for mediocrity does not.** That is
the guard rail: a sweetener is justified by what it buys, never by making the
arithmetic balance.

## The design this points to

Candidates that acquire a top-tier player and fail ONLY on the counterparty's
fit should be sweetened until that fit clears, rather than discarded. Balance
has room, and the outcome data says the resulting trade is a good one for the
user.

Explicitly NOT a general "close any gap with a pick" step. The sweetener is
conditioned on landing quality, which is the one thing measured to matter, and
everything else stays gated as it is.
