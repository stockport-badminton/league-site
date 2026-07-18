# Sentry issue triage (read-only)

Pulls client-side JS error issues from Sentry so we can pick off low-hanging fruit.
The app's Sentry is browser-only (`views/header.ejs`), EU region.

## Setup (once)
1. Sentry → **Settings → Auth Tokens** → create a token with read scopes:
   `event:read`, `project:read`, `org:read`, `member:read`
2. Add it to `.env` (gitignored — never commit it):
   ```
   SENTRY_AUTH_TOKEN=sntryu_...
   ```

## Use
```bash
# Top unresolved issues by frequency (last 14 days)
node -r dotenv/config tools/sentry/sentry-issues.js dotenv_config_path=.env

# Detail (exception + stack frames) for one issue, by shortId or numeric id
node -r dotenv/config tools/sentry/sentry-issues.js JAVASCRIPT-XYZ dotenv_config_path=.env
```

Optional env overrides: `SENTRY_API_BASE` (default `https://de.sentry.io/api/0`),
`SENTRY_ORG`, `SENTRY_PROJECT`, `SENTRY_STATS_PERIOD` (default `14d`),
`SENTRY_QUERY` (default `is:unresolved`).
