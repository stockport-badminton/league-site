# HARD-12 — helmet and a content security policy

**Severity:** medium · **Wave:** C · **Blocked by:** HARD-04 (same file)
**Owns:** `app.js`
**Sources:** SEC-5

## Why

`helmet` is not installed and no security headers are set by hand: no
Content-Security-Policy, no HSTS, no `X-Content-Type-Options`, no frame protection.

Nothing is broken by this on its own. It removes the second line of defence — the site
can be framed, and any future markup bug that lets a script through has nothing stopping
it running. It is also the first thing a buyer's technical reviewer checks.

## What to do

1. Add `helmet` and enable the uncontroversial headers.
2. Build the CSP from what the pages actually load. Known external sources: jQuery,
   Bootstrap, DataTables, the Sentry browser CDN (`js-de.sentry-cdn.com`, hardcoded in
   `views/header.ejs`), Google Fonts, and the S3 bucket for scorecard photos and
   generated media. Grep the views rather than assuming.
3. **Ship it in report-only mode for a week first.** Sentry will collect the violations.
   A CSP that silently breaks the scorecard modal on a Tuesday night is worse than no
   CSP — and the scorecard forms are heavily inline-scripted, so expect work there.
4. Then enforce.

## Acceptance criteria

- Headers present on every response.
- A week of report-only with no violations from legitimate pages before enforcing.
- `npm run test:e2e` passes with the policy enforced — 48 specs including the scorecard
  modal, which is the part most likely to break.

## Tests

- integration: assert the headers on a representative page
- e2e: full suite green with the policy on

## Out of scope

- Removing inline scripts from the views. That is what makes a strict CSP hard here, and
  it is a much larger piece of work — nonces or hashes are the pragmatic middle path.
