# What real dynasty trades look like

Regenerate with `node scripts/research/trades.mjs`.

Source: Sleeper's public API, no auth. Walks `previous_league_id` back through
every season of every league we know about, pulls all transactions, keeps
completed two-team trades. **220 trades across 9 league-seasons.**

This exists because the archetype buckets were designed from intuition and had
never been checked against trades people actually make.

## What the data says

### Shape (assets per side)

| Shape | Real | Engine |
|-------|-----:|-------:|
| 1 for 2 | 23% | 78% |
| 1 for 1 | 23% | 10% |
| 2 for 3 | 14% | 0% |
| 2 for 2 | 13% | 0% |
| 1 for 3 | 8% | 12% |
| 2 for 4 | 6% | 0% |
| 3 for 4 | 4% | 0% |
| 3 for 3 | 4% | 0% |

**Roughly 41% of real trades have two or more assets on BOTH sides, and the
engine has never produced one.** Every package it builds has exactly one asset
on at least one side. Directional breakdown of its 80 packages: give 1/get 2
(44%), give 2/get 1 (34%), give 1/get 1 (10%), give 1/get 3 (8%),
give 3/get 1 (5%).

### Picks

| | Real | Engine |
|---|---:|---:|
| Trade includes picks | 88% | 30% |
| Players only | 10% | 70% |
| Picks only | 2% | 0% |

**This is the biggest gap.** Picks are the currency real managers balance with.
The engine reaches for them only in a few hard-coded gap-closing branches
(`genTierDown` when the pair is light, `genConsolidate` likewise,
`genAgeArbSell`, and the two `capital_convert_*` generators which are
pick-centric by design). There is no general "balance this package with a pick"
step.

Likely knock-on effect: without picks as a balancing currency, the engine has
to find two player groups that happen to land near each other in value. That is
hard, so packages settle further from even, score worse on `balance`, and land
as INSPIRATION rather than RECOMMENDED.

### One-for-one, same position

3 of 220, **1.4%**. Two RB-for-RB, one WR-for-WR.

This independently confirms the `lateralSwapOk` gate and the user report that
prompted it ("it'd be very rare for a trade like this 1 wr for 1 wr to make any
sense"). Note that most 1-for-1s in the data (46 of 51) involve a pick on one
side, so a true player-for-player swap is rarer still.

## Two things worth understanding about the archetypes

**`tier_down` and `consolidate` are the same trade seen from opposite sides.**
A 1-for-2 is a tier-down for the manager giving the single player and a
consolidation for the manager giving the pair. The shape tally cannot separate
them and neither can the market. That is not a bug, but it does mean their
scores should be roughly mirror images, and today they are not.

**The archetype concepts hold up.** 1-for-2 in both directions is 23% of real
trades, the single most common non-trivial shape, and that is exactly
tier_down/consolidate. The problem is not that the buckets are wrong. It is
that generation reaches only a narrow slice of the space the buckets describe.

## Caveats

- 9 league-seasons from one social circle. Shapes look stable across leagues,
  but this is not a representative sample of dynasty at large.
- Only completed two-team trades. Vetoed and multi-team trades are dropped.
- Says nothing about whether a trade was GOOD, only that it happened. For
  quality signal, `npm run validate:history` grades real trades at today's
  values.
