# Fantasy Basketball Desk

A private, Vercel-ready Yahoo Fantasy Basketball dashboard. It discovers the latest NBA fantasy game available to the authenticated Yahoo account, supports every league in that game, recreates the weekly category report, and ranks daily available players using the matchup-aware logic from `fantasy_recommender.py`.

## Features

- Password-protected dashboard with a signed, HTTP-only session cookie.
- League, week, date, and matchup selection.
- Weekly category results with close-loss and close-win priority weights.
- Daily available-player recommendations filtered by the NBA schedule.
- Recent-form priority: last 30 days, last 7 days, then season.
- Sortable projections for PTS, REB, AST, STL, BLK, 3PM, and TO.
- Brief server cache plus an explicit refresh control.
- Demo mode for local UI testing without Yahoo credentials.

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

The app is recommendation-only. It does not add or drop Yahoo players.
