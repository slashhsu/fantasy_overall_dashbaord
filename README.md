# Fantasy Basketball Desk

A private, Vercel-ready Yahoo Fantasy Basketball workspace. It discovers the latest NBA fantasy game available to the authenticated Yahoo account, supports every league in that game, recreates the weekly category report, ranks daily available players, and provides a roster-aware draft assistant.

## Features

- Password-protected dashboard with a signed, HTTP-only session cookie.
- League, week, date, and matchup selection.
- Weekly category results with close-loss and close-win context.
- Format-aware recommendations for H2H Each Category, H2H Most Categories, Points, and Rotisserie leagues.
- Evaluation-ready blended and empirical-Bayes probability candidates using season, last 30 days, and last 7 days.
- Dated Yahoo roster optimization that accounts for active-slot eligibility and displaced starters.
- Confidence, category-level reasons, and percentage-volume effects for every recommendation.
- Sortable projections for PTS, REB, AST, STL, BLK, 3PM, and TO.
- Bounded TTL/LRU cache with single-flight requests, one-hour stale-if-error fallback, and an explicit refresh control.
- Demo mode for local UI testing without Yahoo credentials.
- `/draft` supports Snake, Linear, Salary Cap/Auction, and Offline draft boards with Yahoo ADP, positional scarcity, dynamic roster fit, and auction budgets.
- Target, balanced, and punt controls for every enabled league category.
- Yahoo draft-result sync plus a manual mock-draft mode with undo and locally persisted picks.

## Draft Assistant

The draft model follows the dynamic H-scoring idea described in [Dynamic quantification of player value for fantasy basketball](https://arxiv.org/abs/2409.09884): it evaluates each candidate in the context of the roster already drafted instead of treating a static Z-score list as universally optimal. It also uses the category aggregation principles in [Improving Algorithms for Fantasy Basketball](https://arxiv.org/abs/2307.02188); Rotisserie leagues use a balance-sensitive objective inspired by [Optimizing for Rotisserie Fantasy Basketball](https://arxiv.org/abs/2501.00933).

For every available player, the implementation:

1. Converts the latest usable Yahoo season totals into per-game category projections and uses attempt-volume impact for FG%, FT%, and 3PT%.
2. Normalizes values against the league-sized draftable pool and simulates the marginal category-win or roto-value change after adding the player.
3. Reassigns roster positions, measures scarcity against players likely to remain at the following turn, and displays an uncalibrated `Estimated Return` market estimate from Yahoo ADP.
4. Re-ranks immediately after every Yahoo-synced or manual pick. Weak categories can be targeted or explicitly punted; strongly unrecoverable categories are down-weighted only after enough roster evidence exists.

During the offseason, the service first looks for usable current-game statistics and then falls back to the previous accessible Yahoo NBA season. Players without category history, including some rookies, remain visible through Yahoo ADP but are labeled `Market`; category production is never invented from missing totals. Yahoo's `draft_analysis` and `draftresults` resources provide market and live-board context, while all league credentials remain server-side.

Salary Cap mode defaults to `$200` per team. Recommendations allocate discretionary dollars above replacement level, adjust for observed league inflation, reserve `$1` for every remaining roster spot, and show Yahoo AAV, suggested price, value, and maximum legal bid.

## Local Setup

Requires Node.js 20.9 or newer and pnpm.

```bash
cp .env.example .env.local
pnpm install
pnpm dev
```

For an immediate local preview, set these values in `.env.local`:

```dotenv
APP_PASSWORD=local-preview-password
SESSION_SECRET=local-preview-signing-secret-at-least-32-characters
YAHOO_DEMO_MODE=true
```

Then open [http://localhost:3000](http://localhost:3000) and sign in with the `APP_PASSWORD` value.

## Yahoo OAuth Configuration

Create or use a Yahoo developer application with Fantasy Sports read access. Complete Yahoo's server-side authorization-code flow once and store the resulting refresh token. The deployed app only uses that refresh token to obtain short-lived access tokens; it never sends Yahoo credentials to the browser.

Set these values with the same redirect URI used when the refresh token was issued:

```dotenv
YAHOO_CLIENT_ID=...
YAHOO_CLIENT_SECRET=...
YAHOO_REFRESH_TOKEN=...
YAHOO_REDIRECT_URI=https://your-project.vercel.app
```

Create a free [BALLDONTLIE API key](https://app.balldontlie.io/) and add it for the documented NBA Games endpoint:

```dotenv
BALLDONTLIE_API_KEY=...
```

The app uses BALLDONTLIE as its primary schedule source, a zero-config ESPN scoreboard fallback, and Yahoo-only rankings if neither schedule source responds. A schedule outage therefore does not make the dashboard unavailable.

Do not reuse credentials or tokens printed in notebook outputs. Rotate the Yahoo client secret and refresh token before deploying because the source notebooks previously contained credential material.

## Deploy To Vercel

1. Push this folder to a private GitHub repository, or run `vercel` from this directory.
2. Import the repository in Vercel with the Next.js framework preset.
3. Add all production variables from `.env.example` in Project Settings > Environment Variables.
4. Set `YAHOO_DEMO_MODE=false` for the production environment.
5. Deploy. No custom build command or output directory is required.

The notebooks, Python reference implementation, OAuth files, tests, and caches are excluded from the Vercel upload by `.vercelignore`.

## Environment Variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `APP_PASSWORD` | Yes | Private dashboard password. |
| `SESSION_SECRET` | Production required | Independent cookie signing key of at least 32 characters. Only local/demo mode may fall back to `APP_PASSWORD`. |
| `YAHOO_CLIENT_ID` | Live mode | Yahoo OAuth application ID. |
| `YAHOO_CLIENT_SECRET` | Live mode | Yahoo OAuth application secret. |
| `YAHOO_REFRESH_TOKEN` | Live mode | Long-lived Yahoo refresh token. |
| `YAHOO_REDIRECT_URI` | Live mode | Exact redirect URI associated with the token. |
| `BALLDONTLIE_API_KEY` | Recommended | Free API key for the primary NBA Games schedule source. |
| `CACHE_TTL_SECONDS` | No | In-memory response lifetime; default `300`. |
| `FREE_AGENT_LIMIT` | No | Maximum paginated available players; default `300`. |
| `YAHOO_DEMO_MODE` | No | Use deterministic preview data; default `false`. |

Login throttling is process-local: five failed attempts in 15 minutes lock that client for 15 minutes, with exponential failure delays up to two seconds. Vercel instances do not share this state because the app intentionally has no Redis/KV dependency.

## Verification

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm test:e2e
pnpm build
pnpm audit --prod --audit-level=high
```

## Historical Recommendation Backtest

The production app does not call SportsDataIO. Historical model evaluation is an offline development command using prior-season game logs from SportsDataIO Discovery Lab.

```bash
cp .env.backtest.example .env.backtest.local
set -a; source .env.backtest.local; set +a
pnpm backtest:recommender -- --season=2026REG
# Future multi-season evaluation:
pnpm backtest:recommender -- --seasons=2025REG,2026REG
```

Raw provider responses are cached under `.cache/recommender/` and excluded from Git. The command discovers regular-season dates from the Discovery Lab schedule feed, checkpoints actual and historical pregame projection downloads, and can resume after an API interruption. Pregame projections define the evaluable player pool, while unexpected DNPs remain zero-valued outcomes instead of disappearing from the sample. The production-parity baseline, blended projections, and Matchup Swing probability model are compared using chronological training, validation, and held-out scenarios. The command writes aggregate evidence to `reports/recommender-backtest.json` and updates `model-artifacts/recommender.json`.

The checked-in v2 `2026REG single-season validation` artifact promotes Matchup Swing. Its held-out clustered-bootstrap improvement over the production-parity baseline has a 95% interval of `0.01699` to `0.08186`, and its projection NMAE is `0.71172` versus the baseline's `0.71479`. Both promotion checks therefore pass. The report contains 435 standard 9-category scenarios plus an extended OREB, derived A/T, and DD profile. Only the standard categories are labeled validated; OREB/A/T/DD remain modeled-unvalidated until multi-season evidence is available.

The app is recommendation-only. It does not add or drop Yahoo players.

### Sharing with league members

The server uses an in-memory cache (default `CACHE_TTL_SECONDS=300`) with per-key
single-flight loading and a 60-second forced-refresh cooldown measured from the
last successful fetch. Reading a cache entry does not extend that cooldown.
Missing keys still load normally, and ordinary reads continue to follow their
resource TTL (including the draft results' shorter sync TTL). Upstream failures
can use cached backup data for up to one hour after the normal TTL expires.

All Fantasy API calls, including retries, pass through an instance-wide queue:
maximum two concurrent requests, ten-second queue timeout. A Yahoo 429 pauses
new Fantasy requests for its numeric or HTTP-date `Retry-After`, or 60 seconds
when absent/invalid. Queued calls fail promptly during this pause; callers can
use backup cache data. OAuth refresh remains deduplicated separately.

Dashboard, draft and league responses may include `updateStatus` with `fetchedAt`
(the oldest contributing cached resource), `stale`, and `nextRefreshAt` (the latest
contributing resource cooldown). The UI shows backup data timestamps and a refresh
countdown. Queue pressure or rate limiting without backup returns HTTP 503,
`code: PROVIDER_BUSY`, and a `Retry-After` header.

A `fantasy_usage` JSON log aggregates activity over 60 seconds: Yahoo request
attempts and average latency, 429s, cache hits, merged loads, forced refreshes
served from cooldown, and queue timeouts. Timers/logs are best effort: a serverless
instance may freeze before emission. No credentials or response bodies are logged.

These protections are **per process/instance**, not a distributed quota. Different
Vercel instances do not share cache, queues, OAuth state or cooldowns, and restarts
reset them. No Redis or paid service is required. Start with one league (roughly
10–20 participants), observe latency/errors and provider usage, then assess scale;
the simulated concurrency tests do not establish a production user capacity.


### Weekly player details

Weekly Report includes a collapsed **球員當週數據** section. Expanding it requests
`GET /api/matchup-players?leagueKey=...&week=...&matchupId=...`; it uses the same
private session as the dashboard. `forceRefresh=true` uses the existing per-key
60-second cooldown. Responses include the actual period, Pacific-time cutoff,
team rosters, missing roster/stat dates, enabled categories and `updateStatus`.

The roster is the union of everyone appearing on each team's daily rosters in
the matchup period. Each athlete's numbers cover the **whole NBA week**, including
bench days and days spent outside that fantasy team. A player may appear for both
teams. These numbers are not the credited fantasy contributions and must not be
summed to reconcile the team scoreboard.

Dates come from Yahoo matchup boundaries or `/game/{gameKey}/game_weeks`; no live
seven-day calendar is assumed. Current periods stop at today's Pacific date;
future periods do not load player data. Daily player stats are batched in groups
of 25 and cached independently, while daily roster data is shared by team/date.
Only two producer tasks are scheduled at a time, in addition to the shared Yahoo
request gate. Large historical periods can still take time on a cold cache.

Counting stats use actual daily values; shooting percentages and assist/turnover
ratios are recomputed from totals. Missing values remain missing (shown as `—`),
while explicit GP=0 permits zero counting stats for no-appearance days. Missing
roster dates mean the membership list itself may be incomplete. Partial and
backup results are labeled; provider failures do not replace the category report.
Demo mode uses explicitly labeled synthetic sample periods and player totals.
