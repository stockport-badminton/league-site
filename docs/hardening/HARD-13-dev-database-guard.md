# HARD-13 — Stop local development pointing at production

**Severity:** high (for handover) · **Wave:** C · **Blocked by:** HARD-04 (same file)
**Owns:** `app.js`, `dev.env`
**Sources:** OPS-2

## Why

`dev.env` and `.env` carry an **identical** `DATABASE_URL`. Running `npm run dev`
connects to production Supabase with `DEV_MODE=true`, which injects a mock superadmin
and bypasses Auth0 entirely.

Neil knows and works around it — the Playwright suite has a network guard
(`e2e/helpers/read-only.js`) that aborts writes precisely because of this. **A successor
will not know.** Their first exploratory click on a local "dev" server, with full
superadmin rights, edits real league data. There is no confirmation step and no undo.

This is the finding that most clearly fails the "hand it to somebody else" test.

## What to do

Best to worst, take the highest you can afford:

1. **A seeded local Postgres.** A docker-compose service plus a seed script from
   `migrations/`. Real fix; the schema is already in the repo.
2. **A read-only Supabase role** in `dev.env`. Cheap, and it makes the failure obvious
   and safe rather than silent and destructive.
3. **A startup guard** in `app.js`: if `DEV_MODE=true` and `DATABASE_URL` matches the
   production host, refuse to boot unless `I_KNOW_THIS_IS_PROD=1` is also set. Print
   why. Perhaps twenty lines, and it converts a silent hazard into a deliberate choice.

Do 3 regardless — it is the backstop for the other two.

Whatever you choose, write it down in the runbook (see the README's note on OPS-3);
a guard nobody has been told about is a puzzle rather than a safeguard.

## Acceptance criteria

- `npm run dev` against production without the override refuses to start, with a message
  that explains the situation and how to proceed deliberately.
- The override works and is logged loudly on every request or at least at boot.
- The Playwright suite still runs (it needs a server; make sure the guard does not break
  `playwright.config.js`, which starts one with `DEV_MODE=true`).

## Tests

- unit: the guard's predicate — prod URL + DEV_MODE → refuse; prod URL + override →
  allow; non-prod URL → allow
- confirm `npm run test:e2e` still starts its server

## Out of scope

- Building a staging environment (OPS-4).
- Changing what `DEV_MODE` grants once running.
