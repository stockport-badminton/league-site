-- The handful of rows the seed cannot supply, because it predates them.
--
-- migrations/data/002_data.sql is a snapshot whose newest archive is 2024/2025, so a
-- freshly loaded database has: no fixtures in the current season (the scorecard form has
-- nothing to match a result against), no draft carrying a confirmToken (migration 011
-- came later), and no messer_scorecard rows at all. Six browser tests skip on that and
-- the scorecard form is unusable, which is most of what a local database is FOR.
--
-- Everything here is local-only and deliberately obvious as test data.

-- ── current-season fixtures ──────────────────────────────────────────────────
-- Copied from real rows through a temp table rather than written out column by column:
-- `fixture` has a wide schema that changes, and a copy cannot drift out of date with it.
DO $$
DECLARE season_start date := date_trunc('year', now())::date + interval '8 months';
BEGIN
  DROP TABLE IF EXISTS _seed_fixtures;
  CREATE TEMP TABLE _seed_fixtures AS
    SELECT * FROM fixture WHERE "homeTeam" IS NOT NULL AND "awayTeam" IS NOT NULL
     ORDER BY id DESC LIMIT 6;

  UPDATE _seed_fixtures SET
    id         = nextval(pg_get_serial_sequence('fixture','id')),
    date       = season_start + (id % 20) * interval '1 day',
    "homeScore" = NULL,
    "awayScore" = NULL,
    -- 'outstanding' is the column's own default and its NOT NULL value in production
    -- too; the app's `status IS NULL OR ...` clauses are belt-and-braces, not a sign
    -- that null is a real state. Checked: production has 0 fixtures with a null status.
    status     = 'outstanding';

  INSERT INTO fixture SELECT * FROM _seed_fixtures;
  RAISE NOTICE 'added % outstanding fixtures in the current season', (SELECT count(*) FROM _seed_fixtures);
END $$;

-- ── a draft carrying a confirmation token ────────────────────────────────────
-- /populated-scorecard-beta/:id requires one (HARD-03); the seed's 1,557 drafts all
-- predate the column, and the app grandfathers those by opening them without a token —
-- so without this there is nothing to test the token path against.
UPDATE scorecardstore
   SET "confirmToken" = 'local-dev-token-not-a-secret'
 WHERE id = (SELECT id FROM scorecardstore ORDER BY id DESC LIMIT 1);

-- ── a messer draft ───────────────────────────────────────────────────────────
-- 15 games, not 18, and negative scores are legal on this card.
DO $$
DECLARE
  new_id int;
  home   int;
  away   int;
  g      int;
BEGIN
  IF EXISTS (SELECT 1 FROM messer_scorecard) THEN
    RAISE NOTICE 'messer_scorecard already has rows — leaving it alone';
    RETURN;
  END IF;

  SELECT id INTO home FROM team WHERE name IS NOT NULL ORDER BY id LIMIT 1;
  SELECT id INTO away FROM team WHERE name IS NOT NULL AND id <> home ORDER BY id LIMIT 1;

  INSERT INTO messer_scorecard (id, "homeTeam", "awayTeam", date)
  VALUES (COALESCE((SELECT max(id) FROM messer_scorecard), 0) + 1, home, away, now())
  RETURNING id INTO new_id;

  FOR g IN 1..15 LOOP
    EXECUTE format('UPDATE messer_scorecard SET %I = $1, %I = $2 WHERE id = $3',
                   'Game' || g || 'homeScore', 'Game' || g || 'awayScore')
      USING 21 - (g % 5), 15 + (g % 4), new_id;
  END LOOP;

  RAISE NOTICE 'added messer draft % (teams % v %)', new_id, home, away;
END $$;
