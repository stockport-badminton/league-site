-- The handful of rows the seed cannot supply, because it predates them.
--
-- migrations/data/002_data.sql is a snapshot whose newest archive is 2024/2025, so a
-- freshly loaded database has: no fixtures in the current season (the scorecard form has
-- nothing to match a result against), no draft carrying a confirmToken (migration 011
-- came later), and no messer_scorecard rows at all. Six browser tests skip on that and
-- the scorecard form is unusable, which is most of what a local database is FOR.
--
-- Everything here is local-only and deliberately obvious as test data.

-- ── a season that contains today ─────────────────────────────────────────────
-- The seed's newest season row is 2025/26, which ends 30 Jul 2026, so from August a
-- fixture dated today belongs to no season and every "this season" query drops it.
-- Stretch the newest season to cover today rather than inserting the next one: a new
-- 2026/27 row would make 2025/26 the "previous" season, and the seed has no 2025/26
-- archive tables, so every past-season page the browser specs open would 500. Only
-- when nothing covers today, so a database that has been `sync`ed is left alone.
UPDATE season SET "endDate" = now() + interval '1 year'
 WHERE id = (SELECT id FROM season ORDER BY "startDate" DESC LIMIT 1)
   AND NOT EXISTS (SELECT 1 FROM season WHERE now() > "startDate" AND now() < "endDate");

-- ── current-season fixtures ──────────────────────────────────────────────────
-- Copied from real rows through a temp table rather than written out column by column:
-- `fixture` has a wide schema that changes, and a copy cannot drift out of date with it.
--
-- Dated around TODAY, not at a fixed point in the season: the live scorecard's start
-- page offers only outstanding fixtures from the last ten days or the coming week
-- (liveScorecardController.START_WINDOW_DAYS_BACK, getScorecardCandidates). Dated 1-20
-- September, as they were, they fell out of that window by October and
-- e2e/live-scorecard.spec.js failed after every fresh load. Six days, two apart, from
-- six days ago to four days ahead; UK local midnight, as `fixture.date` stores it.
DO $$
DECLARE today date := (now() AT TIME ZONE 'Europe/London')::date;
BEGIN
  DROP TABLE IF EXISTS _seed_fixtures;
  CREATE TEMP TABLE _seed_fixtures AS
    SELECT * FROM fixture WHERE "homeTeam" IS NOT NULL AND "awayTeam" IS NOT NULL
     ORDER BY id DESC LIMIT 6;

  UPDATE _seed_fixtures SET
    id         = nextval(pg_get_serial_sequence('fixture','id')),
    date       = today + ((id % 6) * 2 - 6) * interval '1 day',
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
-- predate the column, and those open for a superadmin only (REARCH-09) — so without
-- this there is nothing to test the token path against.
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

-- ── a forwarded registration email ──────────────────────────────────────────
-- For /admin/player-requests and e2e/player-requests.spec.js. One name that is on file
-- under a typo ("Mary Whitle" is stored as "Marry Whitle" in the snapshot — the case
-- that prompted the fuzzy matcher), and one that is not. The fixed message_id makes a
-- re-run a no-op rather than a second copy.
INSERT INTO registration_request (message_id, forwarded_by, original_from, subject, body_text, candidates)
VALUES (
  '<dev-fixture-registration@local>',
  'Neil Cooper <neil@example.com>',
  'Jane Secretary <jane@example.com>',
  'Fwd: New players',
  E'---------- Forwarded message ---------\nFrom: Jane Secretary <jane@example.com>\nSubject: New players\n\nPlease register these for Dome A:\n\nMary Whitle (F)\nNewby Playerton - M\n\nThanks,\nJane',
  '[{"first":"Mary","family":"Whitle","gender":"Female","team":"Dome A","raw":"Mary Whitle (F)","outcome":null,"playerId":null},
    {"first":"Newby","family":"Playerton","gender":"Male","team":"Dome A","raw":"Newby Playerton - M","outcome":null,"playerId":null}]'::jsonb
)
ON CONFLICT (message_id) DO NOTHING;
