---
name: hardening
description: Pick up a work package from the August 2026 hardening audit (docs/hardening). Use when the user names a package (HARD-01 … HARD-19), asks what to work on next from the audit/backlog, or asks for the status of the hardening work. Loads only the one package's brief plus the rules of engagement, so a session starts with the right context instead of exploring for it.
---

# Working a hardening package

The backlog lives in `docs/hardening/`. Two audits produced it; the findings and the
evidence are in the package files, not in anyone's memory.

## If the user named a package (e.g. `/hardening HARD-01`)

1. Read `docs/hardening/README.md` — rules of engagement and the conflict map.
2. Read the brief: `docs/hardening/HARD-<N>-*.md`, or `docs/hardening/done/HARD-<N>-*.md`
   if it has already landed. Completed packages are moved into `done/` so the top
   level lists only what is still open — a package in `done/` is still worth reading
   when you are working on something that touches the same files.
3. Read `CLAUDE.md` if it is not already in context.

**Do not read the other package files.** Each is self-contained; reading all thirteen is
exactly the waste this command exists to avoid.

Then work the package. Its *Acceptance criteria* is the definition of done and its
*Out of scope* is binding — if you find something else, add it to the backlog rather
than fixing it.

## If the user asked what to work on

Read only `docs/hardening/README.md`. Its status table and priority list answer this.
Recommend one package; don't summarise all of them.

## Rules that apply to every package

- **Every fix needs a test that fails without it.** Write the test, `git stash push`
  the fix, confirm it fails, `git stash pop`, confirm it passes. Three of this year's
  bugs lived behind a green suite because this was skipped.
- **`npm test` before claiming done** (391 tests, ~13s). Add `npm run test:e2e` if you
  touched anything the browser drives (48 specs, ~20s, read-only).
- **Never hand-write database boilerplate.** Use `tools/dbq.js`:
  ```bash
  node tools/dbq.js "SELECT id, name FROM team LIMIT 5"
  node tools/dbq.js --schema player
  node tools/dbq.js --check all          # integrity checks, before and after data work
  node tools/dbq.js --check orphan-results
  ```
  It refuses anything that is not a single read. `DATABASE_URL` is **production** —
  `dev.env` carries the same connection string as `.env`. A write belongs in a reviewed
  script under `scripts/` with a dry run, modelled on
  `scripts/backfill-contact-emails.js`.
- **Do not widen the Playwright read-only allowlist** (`e2e/helpers/read-only.js`).
- Anything hard to reverse — a production data write, a deploy — gets confirmed with
  the user first.

## Finishing

1. Commit with a message that says what was broken and how you know it is fixed.
2. Update the status table at the foot of `docs/hardening/README.md` — package, status,
   commit. That table is how the next session knows where things stand without reading
   git log.
3. Report the acceptance criteria one by one: met, or not, and why.
