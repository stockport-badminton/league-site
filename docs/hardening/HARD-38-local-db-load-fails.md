# HARD-38 — `tools/local-db.sh load` stops partway, and the browser suite cannot run

**Severity:** medium · **Wave:** A · **Blocked by:** nothing
**Owns:** `tools/local-db.sh`, `migrations/data/002_data.sql` (gitignored), possibly
`tools/local-db/dev-fixtures.sql`
**Source:** found 23 Sep 2026 while trying to run `e2e/scorecard-submit.spec.js` for the
read-only confirmation page (the draft 2449 fix). Recorded rather than fixed there, at the
owner's request — that change shipped on Jest alone.

## What happened

From a fresh Docker start, `tools/local-db.sh up && tools/local-db.sh load` stopped with:

```
psql:<stdin>:6178: ERROR:  insert or update on table "fixture" violates foreign key constraint "fixture_away_team_fkey"
DETAIL:  Key (awayTeam)=(11) is not present in table "team".
```

`status` afterwards showed a mostly empty database: `team` 34 rows, `club` 19, `venue` 29,
`division` 4, `season` 14, no `player` contact details ("none decryptable — has load run?"),
and no fixtures. The browser suite needs outstanding fixtures and players, so every spec
that writes or reads a scorecard either skips or fails.

## What is known

- **Team 11 is real.** Production has it: `Carrington A`, `division` NULL. Production has
  **55** teams; the local load finished with **34**. So 21 teams did not make it in before
  the fixture insert that referenced one of them. Why is the question.
- `migrations/data/002_data.sql` is dated **16 May 2026** and has not changed since.
  `tools/local-db.sh` last changed **12 Sep 2026**. The load worked when HARD-13 landed, so
  something between the two — the script, a numbered migration replayed ahead of the data,
  or the dev-fixtures step — is the likely suspect, not the snapshot on its own.
- `load` is meant to stop on any error that is not "already exists", so it did what it
  says. The failure is real, not a guard misfiring.

## What to do

1. Reproduce: `tools/local-db.sh nuke && tools/local-db.sh up && tools/local-db.sh load`.
2. Find where the 21 missing teams went. Candidates to check first: a migration that
   deletes or constrains `team` rows (e.g. teams with a NULL division) running before the
   data; the snapshot's `team` COPY/INSERT erroring earlier and being reported as
   "already exists"; or row ordering in `002_data.sql` putting `fixture` before `team`.
3. Fix it at the cause. Do **not** drop the foreign key or skip the offending fixtures to
   make the load pass — ghost-team fixtures are exactly what `--check ghost-teams` exists
   to find, and hiding them locally would make the local copy lie about production.
4. Run the whole browser suite once it loads (`npm run test:e2e`), including
   `scorecard-submit.spec.js`, which was changed for the read-only confirmation page and
   has **not yet been run in a browser**.

## Acceptance

- `nuke → up → load` completes from nothing with no error, and `status` shows players with
  decryptable plus-alias contact details and outstanding current-season fixtures.
- `npm run test:e2e` runs, and `scorecard-submit.spec.js` passes against the read-only
  confirmation view.
