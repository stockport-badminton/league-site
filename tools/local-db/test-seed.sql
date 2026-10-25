-- The synthetic seed for the `db` Jest project (REARCH-08, Part 2).
--
-- NOT migrations/data/002_data.sql. That file is real league data and gitignored, so CI
-- cannot have it and it must not be committed. This is invented, committed and
-- deterministic: the same ids every run, so a test can name a row.
--
-- Loaded by __tests__/db/globalSetup.js after every migration has been replayed, with
-- `sdbl.test_key` set to the test process's DB_PI_KEY so the encrypted contact columns
-- decrypt the way the app reads them.
--
-- Enough SHAPE to exercise the queries, which is the whole job:
--   - three seasons; 2024/25 and 2025/26 archived (team20252026 etc. created here, the way
--     the rollover creates them in production), 2026/27 current — REARCH-02's history
--   - one league, four divisions, two teams each, from five clubs plus No Club
--   - eight players a team: three men and three ladies ranked 1-3, and a reserve of each
--     at 99 and 100 (`rank >= 99` is the reserve line — see the `rosters` skill)
--   - officers recorded by flag, as every one is since 25 Oct 2026; the old pointer
--     columns are left NULL, as they are in production
--   - complete fixtures with all 18 game rows, outstanding ones with none
--   - a draft without a token (pre-migration-011 shape), one with, and a messer draft
--
-- Ids are small and explicit. Every sequence is moved past them at the end, so a test
-- that inserts gets a fresh id rather than a collision.

-- ── league, divisions, venues, clubs ────────────────────────────────────────
INSERT INTO league (id, name) VALUES (1, 'Stockport & District');

INSERT INTO division (id, league, rank, name) VALUES
  (1, 1, 1, 'Premier'),
  (2, 1, 2, 'Division 1'),
  (3, 1, 3, 'Division 2'),
  (4, 1, 4, 'Division 3');

INSERT INTO venue (id, name, address, "gMapUrl") VALUES
  (1, 'Northfield Leisure Centre', '1 Test Road, Stockport', ''),
  (2, 'Southgate School',          '2 Test Road, Stockport', ''),
  (3, 'Eastbank Sports Hall',      '3 Test Road, Stockport', '');

INSERT INTO club (id, name, venue, "matchVenue", "matchNightText") VALUES
  (1,  'Northfield', 1, 1, 'Tuesday'),
  (2,  'Southgate',  2, 2, 'Wednesday'),
  (3,  'Eastbank',   3, 3, 'Thursday'),
  (4,  'Westway',    1, 1, 'Monday'),
  (5,  'Ridgeline',  2, 2, 'Tuesday'),
  -- The placeholder club real data has, which several queries exclude by name.
  (63, 'No Club',    1, 1, NULL);

-- Two teams a division. Premier is Northfield A v Southgate A, and so on down.
INSERT INTO team (id, name, venue, club, division, rank, "divRank", "matchDay") VALUES
  (1, 'Northfield A', 1, 1, 1, 1, 1, 'Tuesday'),
  (2, 'Southgate A',  2, 2, 1, 1, 2, 'Wednesday'),
  (3, 'Eastbank A',   3, 3, 2, 1, 1, 'Thursday'),
  (4, 'Northfield B', 1, 1, 2, 2, 2, 'Tuesday'),
  (5, 'Westway A',    1, 4, 3, 1, 1, 'Monday'),
  (6, 'Southgate B',  2, 2, 3, 2, 2, 'Wednesday'),
  (7, 'Ridgeline A',  2, 5, 4, 1, 1, 'Tuesday'),
  (8, 'Eastbank B',   3, 3, 4, 2, 2, 'Thursday');

-- ── players ─────────────────────────────────────────────────────────────────
-- Player id = team * 10 + slot. Slots 1-3 men ranked 1-3, 4-6 ladies ranked 1-3,
-- 7 a reserve man (99), 8 a reserve lady (100). Names are the team's and the slot's, so
-- a failing assertion says which player it meant.
INSERT INTO player (id, first_name, family_name, gender, team, club, rank,
                    date_of_registration, "playerEmail", "playerTel")
SELECT t.id * 10 + s.slot,
       s.first,
       replace(t.name, ' ', '') ,
       s.gender, t.id, t.club, s.rank,
       '2024-08-01',
       pgp_sym_encrypt(lower(s.first || '.' || replace(t.name, ' ', '')) || '@example.invalid',
                       current_setting('sdbl.test_key')),
       pgp_sym_encrypt('07700 900' || lpad((t.id * 10 + s.slot)::text, 3, '0'),
                       current_setting('sdbl.test_key'))
  FROM team t
 CROSS JOIN (VALUES
   (1, 'Adam',   'Male',   1), (2, 'Ben',    'Male',   2), (3, 'Carl',  'Male',   3),
   (4, 'Dana',   'Female', 1), (5, 'Erin',   'Female', 2), (6, 'Fay',   'Female', 3),
   (7, 'Gus',    'Male',  99), (8, 'Hana',   'Female', 100)
 ) AS s(slot, first, gender, rank);

-- A player with no contact details at all, and one registered to No Club / No Team.
INSERT INTO player (id, first_name, family_name, gender, team, club, rank) VALUES
  (0,   'No',    'Player',   NULL,     NULL, 63, NULL),
  (901, 'Ivy',   'Unplaced', 'Female', NULL, 63, NULL);

-- Officers by flag. Every team has a captain except Eastbank B — six real teams have none,
-- and an INNER JOIN to an optional role is how /event/ pages went blank (gotcha 1c).
UPDATE player SET "teamCaptain" = 1 WHERE id IN (11, 21, 31, 41, 51, 61, 71);
UPDATE player SET "clubSecretary" = 1, "matchSecrertary" = 1 WHERE id IN (14, 24, 34, 54, 74);
UPDATE player SET treasurer = 1 WHERE id = 15;

-- ── seasons ─────────────────────────────────────────────────────────────────
INSERT INTO season (id, name, "startDate", "endDate", label) VALUES
  (1, '20242025', '2024-08-01', '2025-07-30', '2024/25'),
  (2, '20252026', '2025-08-01', '2026-07-30', '2025/26'),
  (3, '20262027', '2026-08-01', '2027-07-29', '2026/27');

-- So a run after July 2027 still has a current season. Without it every "this season"
-- query would find nothing and the suite would fail on the calendar, not on the code.
-- Same rule as dev-fixtures.sql: stretch the newest season, never add one.
UPDATE season SET "endDate" = now() + interval '1 year'
 WHERE id = 3 AND now() >= "endDate";

-- ── season archives ─────────────────────────────────────────────────────────
-- A snapshot of each dimension table at season end, the way the rollover takes them.
-- 2024/25's tables already exist (migration 001, in the shape they had then); 2025/26's
-- do not, because production's rollover created them and no migration did. Copied by the
-- columns both sides have, so an archive in an older shape still loads.
CREATE FUNCTION pg_temp.seed_archive(entity text, season text) RETURNS void AS $$
DECLARE
  target text := entity || season;
  cols text;
BEGIN
  EXECUTE format('CREATE TABLE IF NOT EXISTS %I (LIKE %I)', target, entity);
  SELECT string_agg(quote_ident(a.column_name), ', ' ORDER BY a.ordinal_position) INTO cols
    FROM information_schema.columns a
    JOIN information_schema.columns b
      ON b.table_schema = 'public' AND b.table_name = target AND b.column_name = a.column_name
   WHERE a.table_schema = 'public' AND a.table_name = entity;
  EXECUTE format('INSERT INTO %I (%s) SELECT %s FROM %I', target, cols, cols, entity);
END $$ LANGUAGE plpgsql;

SELECT pg_temp.seed_archive(e, s)
  FROM unnest(ARRAY['club', 'division', 'team', 'player', 'venue']) AS e,
       unnest(ARRAY['20242025', '20252026']) AS s;

-- History that differs from today, which is the reason the archives exist (HARD-39):
-- in 2024/25 team 8 was 'Eastbank C' in Division 2, and in 2025/26 Ben of Northfield A
-- (12) played for Northfield B.
UPDATE team20242025   SET name = 'Eastbank C', division = 3 WHERE id = 8;
UPDATE player20252026 SET team = 4 WHERE id = 12;

-- ── fixtures and games ──────────────────────────────────────────────────────
-- seed_play(fixture) fills in the 18 games from the two teams' ranked players, paired the
-- way the scorecard pairs them, and sets the fixture's score to the games won. Who wins a
-- game is arithmetic on the ids, so it varies and is the same every run.
CREATE FUNCTION pg_temp.seed_play(fx int) RETURNS void AS $$
DECLARE
  h int; a int; g int := 0; hs int; as_ int;
  pairs CONSTANT int[][] := ARRAY[
    [1, 2], [4, 5], [1, 3], [4, 6], [2, 3], [5, 6], [1, 4], [2, 5], [3, 6]];
  types CONSTANT text[] := ARRAY[
    'FirstMens', 'FirstLadies', 'SecondMens', 'SecondLadies', 'ThirdMens', 'ThirdLadies',
    'FirstMixed', 'SecondMixed', 'ThirdMixed'];
BEGIN
  SELECT "homeTeam", "awayTeam" INTO h, a FROM fixture WHERE id = fx;
  UPDATE fixture SET
    "homeMan1" = h*10+1, "homeMan2" = h*10+2, "homeMan3" = h*10+3,
    "homeLady1" = h*10+4, "homeLady2" = h*10+5, "homeLady3" = h*10+6,
    "awayMan1" = a*10+1, "awayMan2" = a*10+2, "awayMan3" = a*10+3,
    "awayLady1" = a*10+4, "awayLady2" = a*10+5, "awayLady3" = a*10+6
   WHERE id = fx;
  FOR i IN 1..9 LOOP
    FOR leg IN 1..2 LOOP
      g := g + 1;
      IF (fx + g) % 3 = 0 THEN hs := 15 + g % 5; as_ := 21; ELSE hs := 21; as_ := 10 + g % 9; END IF;
      INSERT INTO game (fixture, "gameType", "homePlayer1", "homePlayer2", "awayPlayer1",
                        "awayPlayer2", "homeScore", "awayScore")
      VALUES (fx, types[i], h*10 + pairs[i][1], h*10 + pairs[i][2],
              a*10 + pairs[i][1], a*10 + pairs[i][2], hs, as_);
    END LOOP;
  END LOOP;
  UPDATE fixture SET status = 'complete',
    "homeScore" = (SELECT count(*) FROM game WHERE fixture = fx AND "homeScore" > "awayScore"),
    "awayScore" = (SELECT count(*) FROM game WHERE fixture = fx AND "awayScore" > "homeScore")
   WHERE id = fx;
END $$ LANGUAGE plpgsql;

-- Ids by season: 1xx 2024/25, 2xx 2025/26, 3xx 2026/27. Each division's two teams.
INSERT INTO fixture (id, "homeTeam", "awayTeam", date, status) VALUES
  -- 2024/25: one meeting each
  (101, 1, 2, '2024-10-08', 'outstanding'), (102, 3, 4, '2024-10-10', 'outstanding'),
  (103, 5, 6, '2024-10-07', 'outstanding'), (104, 7, 8, '2024-10-08', 'outstanding'),
  -- 2025/26: home and away
  (201, 1, 2, '2025-10-07', 'outstanding'), (202, 2, 1, '2026-02-11', 'outstanding'),
  (203, 3, 4, '2025-10-09', 'outstanding'), (204, 4, 3, '2026-02-10', 'outstanding'),
  (205, 5, 6, '2025-10-06', 'outstanding'), (206, 6, 5, '2026-02-11', 'outstanding'),
  (207, 7, 8, '2025-10-07', 'outstanding'), (208, 8, 7, '2026-02-12', 'outstanding'),
  -- 2026/27: one played, the return still to come
  (301, 1, 2, '2026-09-15', 'outstanding'), (302, 2, 1, '2027-02-10', 'outstanding'),
  (303, 3, 4, '2026-09-17', 'outstanding'), (304, 4, 3, '2027-02-09', 'outstanding'),
  (305, 5, 6, '2026-09-14', 'outstanding'), (306, 6, 5, '2027-02-10', 'outstanding'),
  (307, 7, 8, '2026-09-15', 'outstanding'), (308, 8, 7, '2027-02-11', 'outstanding');

SELECT pg_temp.seed_play(id) FROM fixture
 WHERE id < 300 OR id IN (301, 303, 305, 307) ORDER BY id;

-- ── drafts ──────────────────────────────────────────────────────────────────
-- scorecardstore has ~65 NOT NULL columns with no default (every player slot and every
-- game score), so they are filled from the schema rather than written out: a 0 for each
-- unless named below. Written out, the seed would break on the next column added.
CREATE FUNCTION pg_temp.seed_insert(tbl text, vals jsonb) RETURNS void AS $$
DECLARE cols text; exprs text;
BEGIN
  SELECT string_agg(quote_ident(c.column_name), ', ' ORDER BY c.ordinal_position),
         string_agg(CASE WHEN vals ? c.column_name
                         THEN format('(%L::jsonb ->> %L)::%s', vals, c.column_name, c.udt_name)
                         ELSE '0' END, ', ' ORDER BY c.ordinal_position)
    INTO cols, exprs
    FROM information_schema.columns c
   WHERE c.table_schema = 'public' AND c.table_name = tbl
     AND (vals ? c.column_name OR (c.is_nullable = 'NO' AND c.column_default IS NULL));
  EXECUTE format('INSERT INTO %I (%s) VALUES (%s)', tbl, cols, exprs);
END $$ LANGUAGE plpgsql;

-- Both for return fixtures still outstanding.
-- 1: Southgate A v Northfield A (302), filed before migration 011, so no token — the
--    grandfathered shape (HARD-03).
-- 2: Northfield B v Eastbank A (304), a current draft carrying one.
SELECT pg_temp.seed_insert('scorecardstore', jsonb_build_object(
  'id', 1, 'division', 1, 'homeTeam', 2, 'awayTeam', 1, 'date', '2027-02-10',
  'email', 'captain.one@example.invalid'));
SELECT pg_temp.seed_insert('scorecardstore', jsonb_build_object(
  'id', 2, 'division', 2, 'homeTeam', 4, 'awayTeam', 3, 'date', '2027-02-09',
  'email', 'captain.two@example.invalid', 'confirmToken', 'test-confirm-token'));

INSERT INTO messer_scorecard (id, "homeTeam", "awayTeam", date) VALUES (1, 1, 3, '2026-10-01');

-- ── sequences ───────────────────────────────────────────────────────────────
-- Past every explicit id above, so the first id a test's INSERT gets is predictable
-- and never collides.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT table_name AS tbl, pg_get_serial_sequence(format('public.%I', table_name), 'id') AS seq
      FROM information_schema.columns
     WHERE table_schema = 'public' AND column_name = 'id' AND column_default LIKE 'nextval%'
  LOOP
    EXECUTE format('SELECT setval(%L, GREATEST((SELECT COALESCE(max(id), 0) FROM %I), 1000))',
                   r.seq, r.tbl);
  END LOOP;
END $$;

ANALYZE;
