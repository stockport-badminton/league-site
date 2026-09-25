-- Production data repairs that postdate the seed, replayed so the seed satisfies today's schema.
--
-- migrations/data/002_data.sql is a snapshot of 16 May 2026. The numbered migrations are
-- replayed in full ahead of it, so it is loaded under constraints that production only
-- acquired AFTER a data repair made them satisfiable. Migration 017 is the case that broke
-- the load (HARD-38): its foreign keys from `fixture` to `team` went on in production only
-- once HARD-11 step 3 had reinstated the deleted teams, and the snapshot predates that step.
-- 2,170 of its fixtures point at 21 team ids it does not contain.
--
-- So the seed is loaded with foreign-key enforcement suspended (local-db.sh), this file
-- brings it up to production's history, and the block at the foot RE-VALIDATES EVERY
-- FOREIGN KEY. That last part is what stops this becoming a way to hide orphans: suspended
-- enforcement checks nothing retroactively, so without it an orphan the repairs do not
-- cover would load silently and the local copy would lie. With it, a new orphan stops the
-- load exactly as it did before, naming the key.
--
-- Do NOT fix a load failure by adding rows here that production does not have an
-- equivalent of. Ghost-team fixtures are what `--check ghost-teams` exists to find.

-- ── HARD-11 step 3: the deleted teams, reinstated as withdrawn rows ──────────────────
-- Same rows, same convention as scripts/hard11-reinstate-teams.js, which wrote them to
-- production: club 63 ("No Club"), venue 0, NULL division, withdrawn.
--
-- 56 and 57 are NOT in that script. They were Astrazeneca E and CAP B in 2012-14, deleted
-- before the May export, whose `setval(..., MAX(id))` rewound the team sequence to 55;
-- production then issued both ids to new teams (Manor B, Featherforce B). That was
-- investigated as HARD-39 and deliberately LEFT: past seasons are read through the archive
-- tables, which still hold the 2012 teams at those ids, so every page is right. The snapshot
-- has neither new team, so here they get their 2012 names.
INSERT INTO team (id, name, club, venue, rank, "divRank", division, withdrawn, "withdrawnReason")
SELECT id, name, 63, 0, 0, 0, NULL, NOW(),
       'Reinstated by HARD-11 so historical fixtures resolve; team no longer plays. Name source: ' || source || '.'
  FROM (VALUES
    (9,  'Syddal Park B',      'archive'),
    (11, 'Carrington A',       'owner'),
    (15, 'Disley A',           'archive'),
    (16, 'Altrincham Central', 'archive'),
    (17, 'Carrington B',       'owner'),
    (21, 'Bramhall Village A', 'archive'),
    (31, 'CAP',                'owner'),
    (34, 'Macclesfield B',     'archive'),
    (35, 'GHAP',               'owner'),
    (36, 'New Mills',          'owner'),
    (37, 'Manor B',            'archive'),
    (41, 'Mellor B',           'archive'),
    (42, 'Disley C',           'archive'),
    (44, 'Manor C',            'owner'),
    (48, 'Bramhall Village B', 'owner'),
    (49, 'Disley D',           'owner'),
    (50, 'Blue Triangle',      'owner'),
    (53, 'Alderley Park D',    'archive'),
    (56, 'Astrazeneca E',      'archive (local only, see HARD-39)'),
    (57, 'CAP B',              'archive (local only, see HARD-39)'),
    (58, 'Unknown team',       'unknown')
  ) AS t(id, name, source)
ON CONFLICT (id) DO NOTHING;

-- Explicit ids do not advance a sequence. Without this, the next team created locally
-- is issued 56 — the same reuse that caused HARD-39, reproduced on purpose.
SELECT setval(pg_get_serial_sequence('team', 'id'), (SELECT MAX(id) FROM team));

-- ── HARD-39: player 116's games, reassigned ──────────────────────────────────────────
-- 116 was a second "John Paul" record in 2018/19 and was later edited in place into
-- "Ellie Harper", taking 48 men's and mixed games with it. Production was corrected on
-- 25 Sep 2026 by scripts/hard39-player-116.js; the owner identified the players. Guarded
-- on the old value, so a snapshot taken after the fix passes through unchanged.
DO $$
DECLARE m record; c text;
BEGIN
  FOR m IN SELECT * FROM (VALUES (785, ARRAY[6]), (250, ARRAY[326, 358, 363, 364, 372, 374, 976])) AS t(dest, fixtures)
  LOOP
    FOREACH c IN ARRAY ARRAY['homePlayer1', 'homePlayer2', 'awayPlayer1', 'awayPlayer2'] LOOP
      EXECUTE format('UPDATE game SET %I = $1 WHERE %I = 116 AND fixture = ANY($2)', c, c) USING m.dest, m.fixtures;
    END LOOP;
    FOREACH c IN ARRAY ARRAY['homeMan1', 'homeMan2', 'homeMan3', 'homeLady1', 'homeLady2', 'homeLady3',
                             'awayMan1', 'awayMan2', 'awayMan3', 'awayLady1', 'awayLady2', 'awayLady3'] LOOP
      EXECUTE format('UPDATE fixture SET %I = $1 WHERE %I = 116 AND id = ANY($2)', c, c) USING m.dest, m.fixtures;
    END LOOP;
  END LOOP;
END $$;

-- ── re-validate every foreign key ─────────────────────────────────────────────────────
-- Dropping and re-adding a constraint from its own definition is the only way to make
-- Postgres check existing rows against it. Generic on purpose: a future constraint
-- migration is covered without anyone remembering to list it here.
DO $$
DECLARE c record;
BEGIN
  FOR c IN
    SELECT conrelid::regclass AS tbl, conname, pg_get_constraintdef(oid) AS def
      FROM pg_constraint
     WHERE contype = 'f' AND connamespace = 'public'::regnamespace
  LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', c.tbl, c.conname);
    EXECUTE format('ALTER TABLE %s ADD CONSTRAINT %I %s', c.tbl, c.conname, c.def);
  END LOOP;
END $$;
