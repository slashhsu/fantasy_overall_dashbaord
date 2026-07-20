# Fantasy Basketball Desk

A private, Vercel-ready Yahoo Fantasy Basketball workspace. It discovers the latest NBA fantasy game available to the authenticated Yahoo account, supports every league in that game, recreates the weekly category report, ranks daily available players, and provides a roster-aware draft assistant.

## Features

- Password-protected dashboard with a signed, HTTP-only session cookie.
- League, week, date, and matchup selection.
- Weekly category results with close-loss and close-win context.
- Daily recommendations from the held-out validated Matchup Swing model.
- Evaluation-ready blended and empirical-Bayes probability candidates using season, last 30 days, and last 7 days.
- Dated Yahoo roster optimization that accounts for active-slot eligibility and displaced starters.
- Confidence, category-level reasons, and percentage-volume effects for every recommendation.
- Sortable projections for PTS, REB, AST, STL, BLK, 3PM, and TO.
- Brief server cache plus an explicit refresh control.
- Demo mode for local UI testing without Yahoo credentials.
- `/draft` live draft board with Yahoo ADP, snake-turn timing, positional scarcity, and dynamic roster fit.
- Target, balanced, and punt controls for every enabled league category.
- Yahoo draft-result sync plus a manual mock-draft mode with undo and locally persisted picks.

## Draft Assistant

The draft model follows the dynamic H-scoring idea described in [Dynamic quantification of player value for fantasy basketball](https://arxiv.org/abs/2409.09884): it evaluates each candidate in the context of the roster already drafted instead of treating a static Z-score list as universally optimal. It also uses the category aggregation principles in [Improving Algorithms for Fantasy Basketball](https://arxiv.org/abs/2307.02188); Rotisserie leagues use a balance-sensitive objective inspired by [Optimizing for Rotisserie Fantasy Basketball](https://arxiv.org/abs/2501.00933).

For every available player, the implementation:

1. Converts the latest usable Yahoo season totals into per-game category projections and uses attempt-volume impact for FG%, FT%, and 3PT%.
2. Normalizes values against the league-sized draftable pool and simulates the marginal category-win or roto-value change after adding the player.
3. Reassigns roster positions, measures scarcity against players likely to remain at the following snake turn, and estimates return probability from Yahoo ADP.
4. Re-ranks immediately after every Yahoo-synced or manual pick. Weak categories can be targeted or explicitly punted; strongly unrecoverable categories are down-weighted only after enough roster evidence exists.

During the offseason, the service first looks for usable current-game statistics and then falls back to the previous accessible Yahoo NBA season. Players without category history, including some rookies, remain visible through Yahoo ADP but are labeled `Market`; category production is never invented from missing totals. Yahoo's `draft_analysis` and `draftresults` resources provide market and live-board context, while all league credentials remain server-side.

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
| `SESSION_SECRET` | Recommended | Cookie signing key; falls back to `APP_PASSWORD`. |
| `YAHOO_CLIENT_ID` | Live mode | Yahoo OAuth application ID. |
| `YAHOO_CLIENT_SECRET` | Live mode | Yahoo OAuth application secret. |
| `YAHOO_REFRESH_TOKEN` | Live mode | Long-lived Yahoo refresh token. |
| `YAHOO_REDIRECT_URI` | Live mode | Exact redirect URI associated with the token. |
| `BALLDONTLIE_API_KEY` | Recommended | Free API key for the primary NBA Games schedule source. |
| `CACHE_TTL_SECONDS` | No | In-memory response lifetime; default `300`. |
| `FREE_AGENT_LIMIT` | No | Maximum paginated available players; default `300`. |
| `YAHOO_DEMO_MODE` | No | Use deterministic preview data; default `false`. |

## Verification

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

## Historical Recommendation Backtest

The production app does not call SportsDataIO. Historical model evaluation is an offline development command using prior-season game logs from SportsDataIO Discovery Lab.

```bash
cp .env.backtest.example .env.backtest.local
set -a; source .env.backtest.local; set +a
pnpm backtest:recommender -- --season=2026REG
```

Raw provider responses are cached under `.cache/recommender/` and excluded from Git. The command discovers regular-season dates from the Discovery Lab schedule feed, checkpoints actual and historical pregame projection downloads, and can resume after an API interruption. Pregame projections define the evaluable player pool, while unexpected DNPs remain zero-valued outcomes instead of disappearing from the sample. The production-parity baseline, blended projections, and Matchup Swing probability model are compared using chronological training, validation, and held-out scenarios. The command writes aggregate evidence to `reports/recommender-backtest.json` and updates `model-artifacts/recommender.json`.

The checked-in `2026REG` artifact promotes Matchup Swing. Its held-out clustered-bootstrap improvement over the production-parity baseline has a 95% interval of `0.01699` to `0.08186`, and its projection NMAE is `0.64635` versus the baseline's `0.65102`. Both promotion checks therefore pass. Probability residual calibration is selected on validation scenarios only; the selected `reference-static` calibration is then applied unchanged to held-out data and production.

The app is recommendation-only. It does not add or drop Yahoo players.
