# Did the trade actually work?

`node scripts/research/outcomes.mjs` · **8,099 trade-sides** followed from the
season a trade happened into the next season, across 546 league-seasons.

The trade crawl says what gets ACCEPTED. This asks what WORKED. Only the second
question is useful for recommending trades.

## Method, and the two things that would have made it garbage

Sleeper leagues chain across seasons via `previous_league_id`, and `owner_id`
is stable along that chain. So each trade participant's points-for rank can be
read in the trade season and the season after.

**Regression to the mean dominates everything.** It is not a small correction:

| Started | Avg change in rank percentile |
|---|---:|
| top quarter | **-0.234** (got worse) |
| upper middle | -0.063 |
| lower middle | +0.129 |
| bottom quarter | **+0.290** (got better) |

Any uncontrolled read ("teams that acquired picks got worse") would mostly be
measuring this. So every number below is **lift over the baseline for teams
that started at the same rank**, never a raw change.

**The first run of this analysis was completely invalid and looked fine.** The
crawl covered 2025 and 2026, so the only season transition available was
2025 → 2026. In July 2026 that season has not been played: all 225 of those
leagues had zero points scored, so "rank next season" was a ranking over all
zeros, i.e. tie-break noise. It produced a full table of plausible numbers that
meant nothing. Fixed by walking `previous_league_id` backward and requiring
BOTH seasons to have games played.

## The one finding worth acting on

**For contenders, consolidating beats tiering down.**

| Who | Move | n | Beat baseline |
|---|---|---:|---:|
| contenders | consolidate (gave 2+, got 1) | 715 | **57%** |
| contenders | tier down (gave 1, got 2+) | 481 | **44%** |
| middle | consolidate | 508 | 52% |
| middle | tier down | 432 | 47% |
| rebuilders | consolidate | 482 | 44% |
| rebuilders | tier down | 778 | 43% |

The effect is **conditional on being a contender** and essentially vanishes for
rebuilders, which makes sense: breaking a stud into two pieces weakens a
starting lineup that is trying to win now, and a rebuilder does not care about
now.

**Size, stated plainly: 0.28 places in a 12-team league** between consolidating
and tiering down. Real and consistent, but small. Do not oversell it.

**Why it matters to us anyway:** give-1-get-2 is the single most common thing
our engine proposes (44% of all packages). For contenders specifically, that is
the shape the data says underperforms, and `tier_down` currently triggers on
"elite starter plus thin depth" with **no regard for the team's window**.

## What is NOT a signal

Reported so it does not get rediscovered and believed:

| Question | Result |
|---|---|
| Do picks-only returns help? | +0.017 lift, 51% beat baseline. Noise. |
| Players-only? | -0.007, 50%. Noise. |
| Does acquiring age 30+ hurt? | -0.021, 47%. Weak, not separable from noise. |
| Does acquiring youth help? | +0.022, 49%, n=336. Directionally nice, too small. |
| Deadline vs offseason? | -0.012 vs -0.004. Nothing. |

At these sample sizes a couple of points either side of 50% is a coin flip,
especially since trade-sides are not independent (the same team appears in many
trades in a season, in the same league).

**So: picks versus players cannot be predicted from this data.** That was one
of the questions asked, and the honest answer is that the effect, if any, is
smaller than what 8,099 observations can resolve.

## Caveats that limit all of the above

- **Outcome is next-season points-for rank.** A trade is one of many roster
  moves. Attributing a season's rank change to one trade side is generous.
- **One season of lookahead.** A rebuild that pays off in year two scores as a
  failure here. This measurement structurally favours win-now moves.
- **Rebuilders underperform their baseline on BOTH moves** (44% and 43%), which
  suggests rebuilders who trade at all do worse than rebuilders who sit still.
  That is a selection effect this design cannot separate.
- Points-for ignores schedule luck, which is the right call for skill, but it
  is not the same as winning.
