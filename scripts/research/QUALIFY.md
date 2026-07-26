# Which signals qualify a team for an archetype

`node scripts/research/qualify.mjs` · 8,099 trade-sides, 164 measurable
league-seasons.

Johnny's framing, which is the right one: a team is an account, an archetype is
a product, and we want the observable signals saying this account would benefit
from this product. Signals read differently for different account types.

`scoreArchetypes()` already has this shape. The problem is its signals were
invented. This asks the data which ones predict a **benefit**.

## The confound that ate the first answer

Splitting outcomes by contention x roster age produced beautiful tables for
every move. They were nearly all fake.

**Buy age 28+ and sell age 28+ showed the same gradient.** Two opposite actions
cannot both cause the same result. Checking the cells with no move filter at
all:

| | young <25.5 | middle | old 26.5+ |
|---|---:|---:|---:|
| contender | 62% | 59% | 48% |
| middle | 62% | 50% | 33% |
| rebuilder | 49% | 36% | 36% |

That is the same shape as every "move" table, so the tables were measuring
**roster age**, not the trade. The baseline controlled for contention only.

Rebuilt with the baseline computed **inside each contention x age cell**, so
only the move differs. Sanity check that the control works: buy-age and
sell-age now land at exactly 50% each, opposite actions cancelling.

## What survives

| Move | Overall | Contender | Middle | Rebuilder |
|---|---:|---:|---:|---:|
| **consolidate** | **54%** | **61%** | 55% | 43% |
| take picks only | 53% | 56% | 58% | 47% |
| buy age 28+ | 50% | 58% | 46% | 43% |
| sell age 28+ | 50% | 59% | 50% | 42% |
| **tier down** | **47%** | 47% | 50% | 46% |

**One clean signal: consolidation, scaled by contention.** 61% / 55% / 43% is a
monotonic gradient across contention, which is what a real conditional effect
looks like rather than noise. Breaking a stud into pieces weakens a lineup
trying to win now; a rebuilder does not care about now.

**Tier down is 47% everywhere** with no conditional structure. Mildly negative,
flat across contention. It is also **44% of everything our engine proposes.**

**Buy age and sell age are both 50% overall.** The apparent contender edge on
BOTH (58%, 59%) says contenders who work the veteran market at all do better
than contenders making other kinds of trades. That is interesting but it is not
a signal about age direction, and it should not be read as one.

## What this says to change

`scoreArchetypes()` computes `consolidate_{pos}` from mid starter x depth x
need-elsewhere, with **no contention term at all**. The measured signal says
contention is the strongest qualifier it has. Same for `tier_down`, which is
scored purely on elite-starter plus thin-depth and never asks whether the team
is trying to win now.

Proposed, and deliberately modest given the effect sizes:

- Weight `consolidate_*` up with contention and down for rebuilders.
- Weight `tier_down_*` down for contenders specifically.

Both are re-weightings of existing signals, not new archetypes.

## Limits

- **Effect sizes are small.** The consolidate contender-vs-rebuilder spread is
  18 points of beat-baseline rate, but in league position that is a fraction of
  a place. Real, not dramatic.
- **One season of lookahead**, which structurally favours win-now moves. A
  rebuild paying off in year two scores as a failure.
- **CORRECTED:** an earlier draft claimed rebuilders who trade do worse than
  rebuilders who sit still. That claim had no control group in it, since `obs`
  contains only trade participants. Building the real control (every roster in
  a measurable league-season, traded or not) refutes it:

  | | traded | did NOT trade |
  |---|---:|---:|
  | contender | **56%** (n=524) | **43%** (n=105) |
  | middle | 51% | 50% |
  | rebuilder | 45% (n=479) | 46% (n=74) |

  Rebuilders who trade and rebuilders who sit still are indistinguishable.
  Trading helps CONTENDERS and does nothing measurable for rebuilders. The
  earlier reading was an artifact of every listed move being a subset, so the
  unlisted residual absorbed the balance.
- **Age was the only roster signal reconstructable at the time of this
  analysis**, because player values exist only as of today and applying them to
  a 2023 roster would score a since-broken-out rookie as if he were always a
  star. Positional strength, depth and pick capital are therefore missing here,
  and they are exactly the signals the engine leans on most.

  **This limit is now removable.** DynastyProcess publishes
  `files/db_fpecr.csv.gz` (104MB), verified to hold **1,528,918 rows of expert
  consensus rankings stamped with `scrape_date`, spanning 2019 through 2025**.
  Rank is a monotone transform of value and is what DynastyProcess derives its
  own values from, so it is a legitimate historical proxy. FantasyCalc has no
  public historical endpoint (probed; values are current-only). Redoing this
  analysis with historical values would let positional strength, depth and pick
  capital enter as signals for the first time.
