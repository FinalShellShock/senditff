# Send It — Dynasty Trade Analyzer

A website that helps dynasty fantasy football managers find smart trades through deterministic math. The algorithm decides everything; Claude only writes prose rationales.

**Core promise:** same inputs always produce same outputs. Trustworthy and consistent, not vibes-based.

**Who it's for:** Johnny and a few friends. Personal MVP, not SaaS. No paywall.

---

## Stack

- **Frontend:** React + TypeScript + Vite (`src/`)
- **Backend:** Vercel serverless functions (`api/`)
- **Auth & DB:** Firebase (Google sign-in, Firestore)
- **AI:** Anthropic Claude API — Haiku for trade rationales, Sonnet for team summaries
- **Player values:** FantasyCalc (cached snapshots, refreshed twice daily)
- **League data:** Sleeper API (live sync)
- **Deployment:** Vercel — auto-deploys from `prod` branch to senditff.com

## Project Structure

```
senditff/
├── src/
│   ├── algo/           # deterministic trade algorithm (archetypes, profiles, scoring)
│   ├── api/            # frontend API client
│   ├── data/           # Sleeper, FantasyCalc, picks, normalization
│   ├── hooks/          # React hooks (useAuth, useLeagues)
│   ├── pages/          # LeagueOverview, TeamDeepDive, SendIt, MyLeagues, Calc, TradeGrades
│   │   └── overview/   # WindowMap (scatter + trajectories), LeverageBoard
│   └── lib/            # Firebase init
├── api/
│   ├── _lib/           # shared server utils (admin, auth, buildTeams, snapshot, tradeEngine, tradeHistory)
│   ├── leagues/        # overview.ts, sync.ts, trades.ts (graded trade history)
│   └── trades/         # find.ts
├── scripts/
│   ├── build-api.mjs   # bundles TS api files to JS (add new endpoints to its entries list!)
│   └── validate/       # tuning harnesses against real league data (see npm run validate:*)
├── _legacy/            # v1 single-file app preserved for reference
├── package.json
└── vercel.json
```

## Branch Strategy

- `prod` — default branch, deploys to senditff.com. Merge features here when ready.
- `legacy` — v1 single-file app frozen in time
- `main` — original deployment branch (kept for reference, superseded by prod)
- feature branches — named after football players (kelce, gronk, pickens, etc.)

## Environment Variables

Never committed to git. Set in Vercel dashboard for production. For local dev, create `.env`:

```
FIREBASE_SERVICE_ACCOUNT_JSON={"type":"service_account",...}
ANTHROPIC_API_KEY=sk-ant-...
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=...
VITE_FIREBASE_PROJECT_ID=...
```

## Development Workflow

```bash
npm install          # install deps
npm run dev          # Vite dev server; /api proxies to live www.senditff.com
                     # (fully usable without server secrets; override target
                     #  with SENDIT_API_PROXY)
vercel dev           # full stack locally (needs Vercel login + server env)
npm run build        # typecheck + build frontend
npm run build:api    # bundle TS api files to JS (required before deploy)

# Validation harnesses (all run against Johnny's real league by default;
# --cache-dir <dir> caches raw Sleeper/FantasyCalc responses for stable diffs)
npm run validate             # team profiles + HTML report
npm run validate:trades      # engine sweep: default mode + every forced archetype, determinism check
npm run validate:history     # trade history chain walk + hindsight grading + ledger
npm run validate:projection  # Shotgun projection table + invariants
```

## Deploying

**Do NOT `git push origin prod`** — historically that triggered a broken
secondary Vercel project. As of 2026-05-18 that project is disconnected
from GitHub, but the canonical deploy flow is direct CLI:

```bash
npm run build:api                                      # rebuild API bundles
npx vercel --prod --yes                                # deploy
# grab the senditff-XXX-...vercel.app URL it prints, then:
npx vercel alias set <that-url> senditff.com
npx vercel alias set <that-url> www.senditff.com
npx vercel inspect senditff.com                        # verify name=senditff
```

## CRITICAL: Commit before deploying or ending a session

`vercel --prod` uploads the **current working tree**, not git HEAD. This means
deployed code can be totally absent from git history. Work has been lost
multiple times because someone treated "live on the site" as a synonym for
"safe in git."

Before any deploy:
```bash
git status --short    # if anything's modified, COMMIT to a branch first
```

Feature branches use dynasty football player names. One feature = one branch.
Stashes are for 30-minute scratch work, never for multi-session storage.

If you find substantial uncommitted work on a fresh session, **commit it
immediately to a new branch before doing anything else** — including a clean
checkpoint commit is better than risking another session resetting it.

---

## Architecture: Claude's Two Jobs

**At build time:** thinking partner. Stress-test the algorithm, propose improvements, push back on bad ideas. Treat the algorithm as a living thing that improves over time.

**At runtime (production):** prose writer only. Claude writes 2-3 sentence rationales for trade packages the algorithm has already selected. Claude does not decide which trades to suggest, which teams are contenders, or which positions are needs. The algorithm does all of that deterministically before Claude is ever called.

---

## Data Flow

```
"Sync my league"    → Sleeper API (live)
                      → store roster snapshot
                      → run team profile math
                      → cache profile

"View my team"      → read cached profile → return deep dive

"Find trades"       → cached profile + values
                      → deterministic candidate filter
                      → deterministic package generation + scoring
                      → top 5 packages
                      → hash inputs → check rationale cache
                        cache miss: call Haiku (200 tokens in/out)
                        cache hit: serve cached

CRON (2x daily)     → pull FantasyCalc values → immutable snapshot
                      → regenerate all team profiles
                      → call Sonnet for team summaries (500 tokens in/out)
```

---

## The Algorithm

### Four Pillars (all pure math, no Claude)

**1. Starter Strength**
For each starter slot, take team's top eligible player by FantasyCalc value. Compare to league average.
`starter_score = 50 + ((team_pos_value - league_avg) / league_avg * 50)` clamped to [0, 100]

**2. Age Curve**
Value-weighted average age of top 10 players with position multipliers:
- QB: 0.85 (longest careers), RB: 1.20 (shortest), WR: 1.00 (baseline), TE: 1.05
- Draft picks count as age 22

**3. Depth**
Players ranked starter+1 through starter+3 per position. Compare to league average → 0-100.

**4. Future Capital**
Sum pick values weighted by year: current 1.0x, next 0.85x, +2yr 0.70x, +3yr 0.55x.
Flag teams 1.5+ std dev above average as PICK_RICH, below as PICK_POOR.

### Window Classification

```
CONTEND:    top 50% starter strength + weighted_age >= 26
CLOSING:    top 50% starter strength + weighted_age >= 28  (urgent)
REBUILD:    bottom 50% starter strength + weighted_age < 25 + above-avg picks
TRANSITION: bottom 50% starter strength + weighted_age < 26 + below-avg picks
MIDDLING:   bottom 50% starter strength + weighted_age >= 26  (stuck, worst spot)
```

### Trade Archetypes (the differentiator)

| Archetype | Trigger | Shape |
|-----------|---------|-------|
| Tier down | Elite asset (top 5%) at position with weak depth | WR1 → WR8 + WR20 + pick |
| Consolidate up | 2-3 mid-tier at one position + hole elsewhere | RB2 + RB3 → RB1 |
| Age arbitrage (buy) | Pick rich + young, can absorb aging asset | Buy 30yo WR1 at discount |
| Age arbitrage (sell) | Old starters with high current value, age >= 28 | Sell aging stud now |
| Need fill | Positional deficit (urgency > 70) + surplus elsewhere | Swap surplus for need |
| Capital play | PICK_POOR contender or PICK_RICH rebuilder | Picks ↔ production |

**Two modes (July 2026 pivot):** default (auto) mode stays menu-free — the
engine runs every applicable archetype and surfaces the best packages. Users
can ALSO force one archetype as an "intent" on the Send It tab ("what would a
tier-down look like?"), optionally scoped to a position and/or target team.
Forced mode skips that generator's archetype-score gates and uses relaxed
hard-reject gates (`FORCED_GATES` in tradeEngine.ts); mediocre results get
honest fairness labels instead of being hidden, and empty results return
deterministic diagnostics the UI turns into "here's why" copy.

**Fairness labels** (`src/algo/fairness.ts`): shared by Send It packages, the
Calc verdict, and Trade Grades. FAIR within 5% (or 150 pts absolute), SLIGHT_*
to 12%, OVERPAY/UNDERPAY beyond. `balance = 1 - |fairnessDelta|`.

### Shotgun projection (`src/algo/projection.ts`)

Deterministic multi-year projection on the West Coast age curves, powering the
Window Map trajectory arrows: player dynasty value scales by remaining
age-curve runway; future picks re-decay toward their draft year (they
appreciate); past picks mature into neutral rookie assets. Dynasty values are
the strength proxy — trajectory arrows, not a standings predictor.

Formation lineage: Pro Set → Spread → Audible → West Coast → Shotgun.

### Needs Urgency Formula

```
urgency = starter_gap * 0.40 + window_pressure * 0.30 + depth_gap * 0.15 + pick_capital * 0.15
```
- urgency > 70 → CRITICAL_NEED
- urgency 50-70 → NEED
- urgency 30-50 → HEALTHY
- urgency < 30 → SURPLUS

### Determinism Rules (critical)

1. Sort tiebreakers always by Sleeper player ID ascending — never dict insertion order
2. Consistent rounding everywhere (banker's rounding)
3. Player values read from immutable snapshots, not live FantasyCalc
4. Rationale caching by sha256 hash of inputs — same hash always returns same rationale
5. No randomness in package generation; ties broken by package size then player ID list

---

## Firestore Data Model

```
users/{userId}               email, sleeperUsername, leagueIds[], createdAt
leagues/{leagueId}           format, scoring, tepEnabled, members[], lastRefreshed, ...
leagues/{leagueId}/profiles/{rosterId}
                             window, weightedAge, positionScores, pickCapital,
                             applicableArchetypes[], aiSummary, generatedAt
leagues/{leagueId}/snapshots/{timestamp}
                             playerValues{}, pickValues{}, leagueAverages{}
leagues/{leagueId}/tradeHistory/{season}
                             raw immutable trades (per-asset fromRosterId),
                             managers{}, draftSelections{} — values applied at
                             READ time against today's snapshot, never stored
rationaleCache/{hash}        rationale, archetype, generatedAt
```

## API Endpoints

- `POST /api/leagues/sync` — add/join a league, verify via Sleeper
- `GET /api/leagues/overview?leagueId=` — all team profiles (+ upcomingDraftYear)
- `POST /api/trades/find` — body: `{ leagueId, rosterId, archetype?, position?, targetRosterId? }` → `{ packages (fairness + scores), diagnostics }` with rationales
- `GET /api/leagues/trades?leagueId=` — graded trade history + power-rankings ledger (`{ needsBackfill: true }` before first backfill)
- `POST /api/leagues/trades` — backfill full league chain / refresh current season (maxDuration 60s in vercel.json)

---

## Johnny's League

Sleeper league ID: `1336158419664506880` — used for algorithm tuning and testing.

## Communication Style

- Casual and direct. No corporate-speak. No em dashes (use commas, colons, or parens instead).
- Bite-sized chunks over walls of text. Bullets and structure help.
- Plain-language explanations when offering technical choices.
- Ask before making big architectural changes.
- Push back when something is wrong — don't just agree. The goal is the best dynasty trade tool out there.
