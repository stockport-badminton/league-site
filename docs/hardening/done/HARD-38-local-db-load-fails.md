# HARD-38 — `tools/local-db.sh load` stops partway, and the browser suite cannot run

**Severity:** medium · **Wave:** A · **Done 25 Sep 2026**
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
   "already exists"; or row ordering in `migrations/data/002_data.sql` putting `fixture` before `team`.
3. Fix it at the cause. Do **not** drop the foreign key or skip the offending fixtures to
   make the load pass — ghost-team fixtures are exactly what `--check ghost-teams` exists
   to find, and hiding them locally would make the local copy lie about production.
4. Run the whole browser suite once it loads (`npm run test:e2e`), including
   `scorecard-submit.spec.js`, which was changed for the read-only confirmation page and
   has **not yet been run in a browser**.

## What it was, 25 Sep 2026

**Neither the script nor the snapshot changed. The migrations in front of the snapshot did.**
Migration 017 (HARD-11 step 4) put foreign keys from `fixture` to `team` on production
*after* HARD-11 step 3 had reinstated the 19 deleted teams, which is the only reason they
were satisfiable there. `load` replays every migration before the seed, so the 16 May
snapshot, which predates step 3, was loaded under a constraint production only acquired
after repairing the data it would have rejected. The 21 missing teams were never in the
snapshot at all. 2,170 of its fixtures point at them.

The brief's second candidate ("a numbered migration replayed ahead of the data") was right.
The first ("a migration that deletes team rows") was not: nothing deletes anything.

**21, not 19.** HARD-11 reinstated 19 ids. The other two, 56 and 57, were orphans in May
too, but by September production had issued those ids to two new teams: the export's
`setval(..., MAX(id))` had rewound the sequence below ids already used. **HARD-39**
followed that up. It turned out harmless for teams, and it found a player record that was not.

**The fix** (`tools/local-db/seed-repairs.sql`, run by `load` straight after the seed):
the seed loads with FK enforcement suspended (`session_replication_role = replica`). The
file then inserts the 21 teams as withdrawn rows, exactly as HARD-11 did in production
(56/57 get their 2012 names locally), resets the team sequence past them, and **drops and
re-adds every foreign key in the schema from its own definition**, which makes Postgres
check every existing row. That last step is what keeps step 3 of *What to do* honoured.
The FKs are all still there, and an orphan the repairs do not cover stops the load:
demonstrated by deleting 57 from the file, which failed with
`Key (homeTeam)=(57) is not present in table "team"` before dev fixtures ran.

Refreshing the snapshot from production was the alternative. It was not done here because
it needs a new exporter (the existing one was MySQL→Postgres) and is a bigger change than
the fault. When it is done, this file's inserts become no-ops (`ON CONFLICT DO NOTHING`)
and the re-validation keeps its value.

## Acceptance

- `nuke → up → load` completes from nothing with no error, and `status` shows players with
  decryptable plus-alias contact details and outstanding current-season fixtures.
- `npm run test:e2e` runs, and `scorecard-submit.spec.js` passes against the read-only
  confirmation view.

**Met, 25 Sep 2026.** `nuke → up → load` completes from nothing: 55 teams (production has
55), plus-alias contact details decrypt, 6 outstanding current-season fixtures. Full
browser run: 93 of 94. The one failure was `scorecard-prefill.spec.js`'s gate test timing
out on a visibility wait; it passed alone (3/3), so it was contention and not a fault.
`scorecard-submit.spec.js` passed both tests against the read-only confirmation view,
its first run in a browser.
