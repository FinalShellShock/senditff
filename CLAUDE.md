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
│   ├── pages/          # LeagueOverview, TeamDeepDive, SendIt, MyLeagues, Calc
│   └── lib/            # Firebase init
├── api/
│   ├── _lib/           # shared server utils (admin, auth, buildTeams, snapshot)
│   ├── leagues/        # overview.ts, sync.ts
│   └── trades/         # find.ts
├── scripts/
│   ├── build-api.mjs   # bundles TS api files to JS
│   └── validate/       # one-off tuning script (runs algo against real league data)
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
npm run dev          # start Vite dev server (frontend only)
vercel dev           # start full stack locally (frontend + API functions)
npm run build        # build frontend
node scripts/build-api.mjs  # bundle TS api files to JS
```

Push to `prod` → Vercel auto-deploys in ~30 seconds.

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
rationaleCache/{hash}        rationale, archetype, generatedAt
```

## API Endpoints

- `POST /api/leagues/sync` — add/join a league, verify via Sleeper
- `GET /api/leagues/:id/overview` — all team profiles for league overview
- `GET /api/leagues/:id/teams/:rosterId` — full team deep dive
- `POST /api/trades/find` — body: `{ leagueId, forRosterId, playerId, direction }` → top 5 packages with rationales
- `POST /api/cron/refresh-leagues` — cron-only, runs twice daily

---

## Johnny's League

Sleeper league ID: `1336158419664506880` — used for algorithm tuning and testing.

## Communication Style

- Casual and direct. No corporate-speak. No em dashes (use commas, colons, or parens instead).
- Bite-sized chunks over walls of text. Bullets and structure help.
- Plain-language explanations when offering technical choices.
- Ask before making big architectural changes.
- Push back when something is wrong — don't just agree. The goal is the best dynasty trade tool out there.
