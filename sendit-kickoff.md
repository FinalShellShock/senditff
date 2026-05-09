# Send It v2 - Claude Code Kickoff

## Read this first

This is a project handoff document. Everything below was worked out in conversation with Johnny before this build started. Don't relitigate decisions that are settled here. Ask Johnny if something is genuinely unclear, but don't second-guess scope.

---

## What Send It is

A **website** that helps dynasty fantasy football managers find smart trades through deterministic math, with AI providing context (not judgment).

**The core promise:** same inputs always produce same outputs. The algorithm is reproducible, not vibes-based. AI writes the explanation paragraph, not the recommendation.

**Who it's for right now:** Johnny and 2-3 of his friends. This is a personal MVP, not a SaaS product. No paywall, no Stripe, no tier gating. Build it like a product, not a prototype, but don't waste time on monetization yet.

---

## Claude has two jobs on this project (do not conflate them)

### Job 1: Build a superior algorithm (design time, ongoing)

This is your real job. Send It exists to be **better** than FantasyCalc, Dynasty Daddy, KTC, Dynasty Nerds, all of them. That bar is not met by implementing a generic four-pillar formula. It is met by:

- Stress-testing every assumption in the algorithm against real league data
- Surfacing trade archetypes and edge cases that other tools miss (tier-down, consolidation, age-arbitrage, the MIDDLING flag, etc.)
- Researching dynasty community thinking, statistics, sports economics, portfolio theory, anywhere insight lives
- Tuning weights and thresholds against ground truth
- Proposing improvements Johnny hasn't asked for, when you spot them
- Pushing back on Johnny's ideas when they're wrong, with reasoning

Treat the algorithm as a living thing. Every time a user gives feedback, every time the dynasty meta shifts, every time you spot an edge case, the algorithm gets smarter. Don't just maintain it. Improve it.

**Be a thinking partner here, not an implementer.** If Johnny proposes something and you see a flaw, say so. If you see a better approach, propose it. The goal is the best algorithm in the dynasty space, and that requires real intellectual work, not just executing instructions.

### Job 2: Stay out of the way at runtime (production)

When a user clicks "find trades," Claude (Haiku) does exactly one thing: write a 2-3 sentence rationale for a trade package the algorithm has already selected. That's it.

Claude does not decide which trades to suggest. Does not decide which teams are contenders. Does not decide which positions are needs. The algorithm decides all of that, deterministically, before Claude ever gets called.

This is what makes Send It trustworthy and consistent. Same inputs = same outputs. Claude's prose can vary slightly (which is why we cache by input hash), but the recommendations themselves never do.

**The shorthand:** Claude is the thinking partner during build, and the prose writer during use. These are different roles for the same model, and the project depends on keeping them separate.

---

## How we got here (short version)

Send It v1 had Claude doing everything (analyzing teams, judging needs, generating trades, writing rationales). Three problems:
1. Context ballooned every call (sending whole rosters to Claude every time)
2. Recommendations were inconsistent (same player twice = different answers)
3. Cost scaled badly with usage

The v2 architecture flips this: **deterministic math does the analysis, Claude only writes prose.** Player values + roster math are cached. Trade matching is pure combinatorics. Claude's only job is turning numbers into a paragraph a human wants to read.

This means Send It can be cheap, fast, and *trustworthy*. The trustworthy part is the wedge against competitors like Dynasty Daddy and KTC, whose trade finders just match values without explaining why a trade makes sense.

---

## Scope of MVP

**In scope:**
- Sleeper league sync (live, on every page load, it's free and fast)
- Player values from FantasyCalc (cached snapshots, refreshed twice daily)
- Team profile generation (deterministic math)
- Trade recommendation engine (deterministic match + Haiku rationale)
- "My Team" deep dive view
- League overview view
- Multi-league support per user
- Shared leagues across users (Johnny + friends in same league see same data)
- Superflex / 1QB
- PPR / Half / Standard
- TE Premium (with value adjustment)

**Out of scope for now:**
- IDP leagues (block at signup, "coming soon")
- Devy
- Three-way trades
- Power rankings as a separate feature (it's a slice of league overview)
- Reddit sentiment integration (will come back later)
- Subscriptions, billing, tier gating
- Mobile native app (it's a website; PWA wrapping is fine)

---

## Branching strategy: v2 is a new branch, not a wipe

**Do not delete or rewrite anything on `main`.** v1 stays intact and reachable. v2 is a parallel branch we build alongside it.

Steps before writing any code:

1. **Audit the existing repo on `main`.** Read it top to bottom. Don't assume the README is accurate. Document what exists: file structure, key modules, what `/api/analyze` does, what the Reddit sentiment integration looks like, what the Haiku/Sonnet tier logic does. Surface this audit to Johnny before doing anything destructive.

2. **Create a new branch `v2`** (or `redesign`, or whatever Johnny prefers, ask him). All v2 work lives there.

3. **On the v2 branch, identify what gets reused vs replaced.** Don't strip aggressively. Keep:
   - Stack and tooling (Vite, React, TS, Firebase, Vercel)
   - Auth flow
   - Firebase project config
   - Vercel deployment config
   - Any UI components that are generic (buttons, layouts, theme)
   - The `/api/analyze` Vercel function pattern (we'll add new endpoints alongside it)

   Replace (in v2 only, main stays untouched):
   - The trade analysis logic (rewriting from scratch around the new architecture)
   - The Reddit sentiment integration (parking it, will reintroduce later)
   - The Haiku/Sonnet tier system (overengineered, replaced with clearer model)
   - Any prompts where Claude is asked to "decide" things (Claude only writes prose now)

4. **Don't delete replaced code on day one.** Move it into a `_legacy/` folder or comment it out at first. Once v2 is working end-to-end, *then* clean up. This way you have working reference code while building.

5. **Ask Johnny if you find anything that doesn't match this doc** and you're unsure whether to keep, replace, or park it. Don't guess.

The goal: v1 keeps working on `main`, v2 grows in parallel, and when v2 is solid, Johnny decides whether to merge or run them side by side for a while.

---

## The data flow

```
USER ACTION                    SERVER                              CLAUDE
─────────────                  ──────                              ──────
"Sync my league"      →        Sleeper API (live)
                               ↓ store roster snapshot
                               ↓ run team profile math
                               ↓ cache profile

"View my team"        →        Read cached profile
                               ↓ return deep dive

"Find trades for X"   →        Read cached profile + values
                               ↓ deterministic candidate filter
                               ↓ deterministic package generation
                               ↓ deterministic scoring
                               ↓ top 5 packages
                               ↓ for top 3, hash inputs           → Haiku writes
                                 check rationale cache              rationale
                                 if miss, call Haiku                (200 tokens
                                 if hit, return cached                 in/out)

CRON (twice daily)    →        Pull FantasyCalc values
                               ↓ store as immutable snapshot
                               ↓ regenerate all team profiles
                               ↓ regenerate team summaries        → Sonnet writes
                                                                     summaries
                                                                     (500 tokens
                                                                      in/out)
```

**Key principle:** rosters live-sync from Sleeper. Player values are snapshotted. Profiles are cached and regenerated when either changes.

---

## The four-pillar team analysis

Every team gets scored across four pillars. All pure math. No Claude.

### Pillar 1: Starter Strength

For each league starter slot, take the team's top eligible player by FantasyCalc value, sum per position. Compare to league average. Output: per-position starter score 0-100 where 50 = league average.

```
starter_score = 50 + ((team_pos_starter_value - league_avg) / league_avg * 50)
clamped to [0, 100]
```

### Pillar 2: Age Curve

Calculate **value-weighted average age** of top 10 players by FantasyCalc value, with **position-specific age multipliers** to reflect career-length differences:

```
adjusted_age = actual_age * position_multiplier
where:
  QB: 0.85   (longest careers)
  RB: 1.20   (shortest careers, ages fastest)
  WR: 1.00   (baseline)
  TE: 1.05   (slightly shorter than WR)

weighted_age = Σ(adjusted_age * value) / Σ(value)
```

Picks count as adjusted_age 22.

### Pillar 3: Depth

For each position, take players ranked starter+1 through starter+3. Sum FantasyCalc value. Compare to league average → 0-100 depth score.

### Pillar 4: Future Capital

Sum future pick values, weighted by year:
- Current year picks: 1.0x
- Next year: 0.85x
- Two years out: 0.70x
- Three years out: 0.55x

Compare to league average → 0-100 score. Flag teams 1.5+ std dev above as PICK_RICH, below as PICK_POOR.

---

## Window classification

Old approach (CONTEND / TRANSITION / REBUILD / CLOSING) was too rigid. New classification is more nuanced and includes the **MIDDLING** flag for stuck teams:

```
CONTEND:    top 50% starter strength + weighted_age >= 26
CLOSING:    top 50% starter strength + weighted_age >= 28  (urgent contender)
REBUILD:    bottom 50% starter strength + weighted_age < 25 + above-avg picks
TRANSITION: bottom 50% starter strength + weighted_age < 26 + below-avg picks
              (committed to rebuild but pick poor, hardest spot)
MIDDLING:   bottom 50% starter strength + weighted_age >= 26
              (stuck, algo should suggest committing in either direction)
```

The MIDDLING flag is genuinely useful. Dynasty consensus is the middle is the worst place to be. Surface this to users so they know.

---

## Trade archetypes (this is the differentiator)

Don't just suggest "trades that match values." Identify *what kind of imbalance* a team has, then surface trade archetypes that fix it.

When generating recommendations, run all of these checks against the requesting team's profile and surface whichever apply:

| Archetype | Trigger | Suggestion shape |
|-----------|---------|------------------|
| **Tier down** | Team has elite asset (top 5% league-wide) at a position with weak depth behind it | "Trade WR1 for WR8 + WR20 + pick" |
| **Consolidate up** | Team has 2-3 mid-tier players at a position + clear hole at another | "Trade RB2 + RB3 for RB1 elsewhere" |
| **Age arbitrage (buy)** | Pick rich + young roster, can absorb aging high-value player | "Acquire 30yo WR1 at age discount" |
| **Age arbitrage (sell)** | Old starters with high current value, weighted age >= 28 | "Sell aging stud while value holds" |
| **Need fill** | Clear positional deficit (urgency > 70) + clear surplus elsewhere | "Trade surplus position for need" |
| **Capital play** | PICK_POOR contender or PICK_RICH rebuilder | "Convert picks to production" or vice versa |
| **Pure value** | Underpriced asset spotted via market signal (lower priority for now) | "Buy low candidate" |

A team might get multiple archetype suggestions on the same view. That's correct. Three different valid trade ideas for the same team.

**Where Claude (Haiku) comes in:** for each suggested package, write a 2-3 sentence rationale that names the archetype and explains why this specific trade fits. The archetype is identified by code, the prose is written by Claude.

---

## The validation script (build this first)

Before any UI work, build a one-off Python or Node script that:

1. Takes a Sleeper league ID as argument
2. Pulls league info, rosters, users from Sleeper API
3. Pulls FantasyCalc values for the league's format (Superflex, scoring)
4. Runs the four-pillar math on every team
5. Classifies each team's window
6. Identifies surpluses/deficits per position
7. Detects which trade archetypes apply to each team
8. Outputs a readable report (text or HTML, your call)

**Use it to tune the algorithm against Johnny's actual league** (`1336158419664506880`). Johnny will sanity-check whether the math classifies teams correctly. We'll iterate on the weights and thresholds until it feels right.

After the algorithm is tuned, this script gets scrapped. The logic moves into the real app. The script is throwaway, do not over-engineer it.

---

## Algorithm parameters (starting defaults)

These are starting points. Expect to tune them against Johnny's league.

### Needs urgency formula

```
needs_urgency =
    starter_gap_factor      * 0.40
  + window_pressure_factor  * 0.30
  + depth_gap_factor        * 0.15
  + pick_capital_factor     * 0.15
```

Classify positions:
- urgency > 70 → CRITICAL_NEED
- urgency 50-70 → NEED
- urgency 30-50 → HEALTHY
- urgency < 30 → SURPLUS

### Window thresholds

- weighted_age < 24.5 → REBUILD candidate
- weighted_age 24.5-26.0 → TRANSITION candidate
- weighted_age 26.0-27.5 → CONTEND candidate
- weighted_age >= 27.5 → CLOSING candidate

### Pick decay

- Current year: 1.00
- Next year: 0.85
- Two years out: 0.70
- Three years out: 0.55

### TE Premium adjustment

If `scoring_settings.bonus_rec_te > 0`, multiply TE values by 1.15. This is approximate. FantasyCalc doesn't natively support TEP queries. Tune later if needed.

---

## Determinism requirements (critical)

Same inputs must produce same outputs. Every time. This is the trust promise.

**Implement these rules everywhere:**

1. **Sort tiebreakers must be deterministic.** When two players have the same value, sort by Sleeper player ID ascending. Never rely on dict/object insertion order.

2. **Rounding must be consistent.** Pick one (banker's rounding / round-half-to-even is fine) and use it everywhere.

3. **Player values are snapshotted.** When a refresh runs, write an immutable snapshot. Trade rec generation reads from the latest snapshot, not live FantasyCalc.

4. **Rationale caching.** Hash inputs to each Haiku call (the package + relevant team profile slice). Cache the rationale by hash. Same hash = serve cached. This is what guarantees "click twice in 5 minutes, get the same answer."

5. **No randomness in package generation.** If you sort packages by score and there's a tie, break by package "size" then by player ID list. Deterministic all the way down.

---

## Data model (Firestore)

```
users/{userId}
  email: string
  sleeperUsername: string
  leagueIds: string[]
  createdAt: timestamp

leagues/{leagueId}                        // doc ID = sleeper league ID
  sleeperLeagueId: string
  name: string
  format: "superflex" | "1qb"
  scoring: "ppr" | "half" | "std"
  tepEnabled: boolean
  idpDetected: boolean                    // if true, league is BLOCKED
  rosterSize: number
  starterSlots: { QB, RB, WR, TE, FLEX, SF }
  teamCount: number
  members: string[]                       // userIds with access
  ownerId: string                         // first user who added the league
  lastRefreshed: timestamp

leagues/{leagueId}/profiles/{rosterId}
  rosterId: string                        // Sleeper roster ID
  sleeperUsername: string
  claimedByUserId: string | null
  window: "REBUILD" | "TRANSITION" | "CONTEND" | "CLOSING" | "MIDDLING"
  weightedAge: number
  positionScores: {
    QB: { starterScore, depthScore, urgency, classification }
    RB: { ... }
    WR: { ... }
    TE: { ... }
  }
  pickCapital: { score, flag: "PICK_RICH" | "PICK_POOR" | "NEUTRAL" }
  applicableArchetypes: string[]          // ["tier_down_WR", "need_fill_RB", ...]
  aiSummary: string                       // Sonnet-written, 2-3 sentences
  generatedAt: timestamp

leagues/{leagueId}/snapshots/{snapshotId}  // doc ID = ISO timestamp
  timestamp: timestamp
  playerValues: { [playerId]: number }
  pickValues: { [pickId]: number }        // e.g. "2026-1.05"
  leagueAverages: {
    QB: { starterValue, depthValue }
    RB: { ... }
    pickCapital: number
  }

rationaleCache/{hash}                     // top-level for cross-league reuse
  hash: string                            // sha256 of inputs
  rationale: string                       // Haiku-generated paragraph
  archetype: string
  generatedAt: timestamp
```

---

## API endpoints to build

All Anthropic calls go through Vercel functions. API key never in browser.

- `POST /api/leagues/sync`: User adds a league. Verifies via Sleeper API, creates or joins the league doc.
- `GET /api/leagues/:id/overview`: Returns all team profiles for league overview.
- `GET /api/leagues/:id/teams/:rosterId`: Returns full team deep dive.
- `POST /api/trades/find`: Body: { leagueId, forRosterId, playerId, direction }. Returns top 5 packages with rationales.
- `POST /api/cron/refresh-leagues`: Cron-only (secured by Vercel cron secret). Runs twice daily.

---

## Build order

1. **Audit existing Send It code on `main`.** Read it. Document what's there for Johnny.
2. **Create v2 branch.** Don't touch `main`. Confirm branch name with Johnny first.
3. **On v2: identify reuse vs replace.** Move replaced code to `_legacy/` rather than deleting.
4. **Build the validation script.** One-off, separate from the app. Run against Johnny's league.
5. **Tune the algorithm with Johnny.** Iterate on weights and thresholds until output feels right against ground truth.
6. **Move algorithm into the app proper.** Migrate from script to TypeScript modules in the v2 branch.
7. **Build the cron job.** Twice-daily refresh that snapshots values and regenerates profiles.
8. **Build the API endpoints.** Server-side, no browser-facing API key.
9. **Build the UI.** League overview first (simpler), then My Team deep dive, then trade rec view.
10. **Test against multiple leagues.** Get Johnny's friends to sync their leagues, gather feedback.
11. **Decide on merge strategy.** Once v2 is solid, Johnny decides whether to merge to main, replace main, or run side by side.

Steps 4-5 are where 80% of the technical risk lives. If the algorithm calls teams incorrectly, the rest doesn't matter.

---

## Cost expectations (for context, not a constraint)

For 4-5 friends across maybe 5-8 total leagues:
- Twice-daily refresh: ~$0.04/league/day in Sonnet for summaries
- Trade rationales: pennies (mostly cached)
- **Expected total: under $5/month**

This is fine. Don't optimize for cost obsessively at this scale. Optimize for correctness and consistency.

---

## What Johnny cares about most (in priority order)

1. **The math is right.** Misclassifying his team as a rebuilder when it's a contender kills trust instantly.
2. **It's consistent.** Click twice, get the same answer. No randomness.
3. **The trade archetypes feel insightful.** Don't just regurgitate "you're rebuilding, get younger." Suggest tier-downs, consolidations, age-arbitrage moves that make him think "huh, I hadn't considered that."
4. **It's fast.** Pages load fast. No long Claude waits.
5. **Code quality.** Clean, well-organized, readable. This is a long-term project, not a hack.

---

## Things to ask Johnny about, not assume

- The v2 branch name (default suggestion: `v2`, but confirm)
- Existing Send It code: what's there, what's working, what to keep on v2
- His Sleeper username (needed for league member verification)
- Any specific UI/UX patterns he wants from past projects (Blindside Island, Puzzle Shelf use the same stack, there's likely shared component patterns)
- Naming/branding decisions (does "Send It" stay? new name?)
- Whether to use Sleeper OAuth or just username matching for league membership verification

---

## Style preferences (Johnny)

- Casual, direct communication. No corporate-speak.
- No em dashes in writing. Use commas, parentheses, colons, periods.
- Plain-language explanations of technical concepts, especially when offering choices.
- Ask before making big architectural changes.
- Don't make assumptions. If something is unclear, ask.
- ADHD considerations: prefer bite-sized chunks over walls of text. Bullets and structure help.

---

## Final note

Johnny has been thinking about this product for a while and the architecture above is the result of a long conversation. The design is solid, but it's not sacred. If you spot a flaw, say so. If you have a better approach to a piece of the algorithm, propose it. Johnny values honest pushback over agreement.

The bar for this project is "genuinely better than what exists in the dynasty fantasy space." That bar gets met by treating the algorithm as a living thing that improves with every iteration, not by implementing a spec and calling it done.

If anything in this doc contradicts what's in the existing Send It repo, this doc wins. The repo is being rebuilt around this design.
