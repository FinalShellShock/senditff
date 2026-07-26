# What real dynasty trades look like

**5,791 completed trades across 400 dynasty leagues.**

Regenerate with `node scripts/research/crawl-trades.mjs [maxLeagues]` (writes
`trades-crawl.json`, gitignored, resumable).

## Where the data comes from

There is no public trade API to call. Checked directly: FantasyCalc serves
values only, Dynasty Daddy and RosterAudit expose none. The big trade
databases build their own by crawling Sleeper. Tradabase says it aggregates
"daily from thousands of Sleeper leagues"; AOD cites 6,500.

We can do the same because two Sleeper endpoints are public and link together:

```
league/{id}/rosters         -> owner_id per team
user/{id}/leagues/nfl/{yr}  -> every league that user is in (settings.type 2 = dynasty)
league/{id}/transactions/{w}-> the trades
```

So leagues snowball outward through shared managers. From 5 seed leagues the
crawler found 10,000+ reachable dynasty leagues within two hops. It is capped
at 400 on purpose: this is someone else's free API, and 400 is already enough
to stabilise every distribution below.

## An earlier reading of this that was WRONG

A first pass over our own 9 leagues (220 trades) concluded that picks are
mostly sweeteners riding along with a player, and that argued against making
picks a first-class part of package generation.

**That does not survive the larger sample.** It was an artifact of one friend
group.

| | 220 trades | 5,791 trades |
|---|---:|---:|
| Picks-only trades | 2% | **30%** |
| Pick stands ALONE on its side | 34% | **68%** |
| Pick rides with a player | 66% | **32%** |

Picks are not garnish. They are a primary trading currency, and across all
assets moved they are **55%** of everything traded (59% in superflex, 49% in
1QB). The engine produces **zero** picks-only packages and 70% of its packages
contain no pick at all.

## What held up

| Shape | 5,791 | 220 | Engine |
|-------|-----:|----:|------:|
| 1 for 2 | 24% | 23% | 78% |
| 1 for 1 | 18% | 23% | 10% |
| 2 for 2 | 12% | 13% | **0%** |
| 2 for 3 | 11% | 14% | **0%** |
| 1 for 3 | 9% | 8% | 12% |
| 3 for 3 | 6% | 4% | **0%** |
| 2 for 4 | 4% | 6% | **0%** |

**44% of real trades carry two or more assets on BOTH sides. The engine has
never produced one** (every package it builds has exactly one asset on at least
one side). That number barely moved between samples, so it is real.

**1-for-1 at the same position is 1.8%** (104 of 5,791), up from 1.4%.
Independently confirms the `lateralSwapOk` gate and the user report behind it.

## Who and what gets traded

- **Superflex dominates dynasty trading: 89%** of trades happen in superflex
  leagues. Our default assumptions should lean that way.
- **12-team is the norm** (77%), then 10-team (15%) and 14-team (7%).
- **Positions moved:** WR 39%, RB 32%, QB 18%, TE 12%.
- **Traded player ages:** median 26, mean 26.4, p25 24, p75 28, p90 31.
  By band: under 24 20%, 24-26 39%, 27-29 25%, **30+ 16%**.

That last number is worth holding onto. Real managers trade thirty-somethings
routinely, so the aging work should keep discouraging *bad* age trades rather
than suppressing old players outright.

## Caveats

- Snowballed from one social circle, so it over-represents whatever leagues
  those managers join. Superflex at 89% is high enough to be suspicious as a
  sampling effect rather than a fact about dynasty at large.
- Completed two-team trades only. Vetoed and multi-team trades dropped.
- Says nothing about whether a trade was GOOD, only that it happened. For
  quality, `npm run validate:history` grades real trades at today's values.
