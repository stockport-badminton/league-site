# HARD-06 — Friendly 500 page

**Severity:** medium · **Wave:** B · **Blocked by:** nothing
**Owns:** `views/500-error.ejs`, `routes/index.js` (the error handlers at the foot of the file)
**Sources:** FAIL-4, OPS-6

## Why

`views/500-error.ejs:6` renders `<%= error %>` directly. A `pg` error stringifies with
its message, which routinely contains SQL fragments and column names — so the schema
leaks one failed request at a time.

It is also the page a member sees when something goes wrong, and it currently shows them
a developer's error string. The captain who resubmits a scorecard reads
`Error: no matching fixtures` on it (HARD-01 fixes the cause; this fixes the page).

While you are in these handlers: the 404 and 500 paths still build `canonical` from
`req.get('host')` with a chain of `.replace()` calls — the pattern `utils/canonical.js`
was written to retire. Behind Firebase that is the Cloud Run hostname (CLAUDE.md 1b).

## What to do

1. Replace the raw error with a plain apology and what to do next.
2. Generate a short reference code per error (six hex characters is plenty), show it to
   the visitor, and attach it to the Sentry event as a tag so "I saw error 7F2A" is
   traceable in one search.
3. Keep the error out of the HTML entirely — not merely escaped.
4. Swap the three `req.get('host')` canonicals for `canonicalFor(req)`.

## Acceptance criteria

- A 500 response contains no SQL, no column names and no stack.
- The page shows a reference code, and the same code appears on the Sentry event.
- `__tests__/unit/canonical.test.js`-style assertion: with `Host:` set to a Cloud Run
  hostname, the error page's canonical is still the public origin.

## Tests

- force a handler to throw with a `pg`-shaped error → response body contains none of its
  message
- reference code present in the body and passed to `Sentry.captureException` as a tag
- canonical under a spoofed `Host`

## Out of scope

- Which handlers reach the 500 page at all — **HARD-05**.
