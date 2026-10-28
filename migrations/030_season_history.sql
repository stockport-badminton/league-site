-- REARCH-02 step 2: one history table per archived entity, and a view per entity that
-- reads any season — history for a past one, the live table for the current one.
--
-- Additive and unread. The season archives (team20252026 and the other 53) stay exactly
-- as they are; step 3's backfill copies them in, step 4 moves the readers across one
-- function at a time, and step 8 drops the archives a season after nothing reads them.
-- Until the backfill runs these tables are empty, and nothing reads the views.
--
-- What goes in each history table:
--   - every column any archive has (measured in production 27 Oct 2026), so the backfill
--     loses nothing. Three of those are the officer pointers migration 029 dropped from
--     the live tables (club."matchSec", club."clubSec", team.captain): here they are the
--     record of who was named in 2021/22–2025/26, a snapshot, never read for an officer
--     today. 2021/22 has no player flags, so for that season they are the only record;
--   - every live column too, so the next rollover (step 6) copies the whole row:
--     team.withdrawn*, messer's bracket links and so on, which no archive has yet;
--   - except contact and login details. player."playerEmail", "playerTel" and "authEmail"
--     are not kept (nothing reads the archived copies, checked 24 Oct 2026), nor
--     player.role and "messerAdmin", which are site permissions rather than facts about
--     a season. __tests__/db/season-history.test.js holds that list and fails when a new
--     live column is in neither.
--
-- Types are the live table's. Every column but the key is nullable: an older archive
-- lacks columns the live table now requires (player20182019 has no rank).
--
-- `season` references season.name, so "which seasons have history" is a plain query and a
-- misspelt season cannot be written. season.name had no unique constraint; the index
-- below is what the reference needs. Fifteen rows, all distinct (27 Oct 2026).
--
-- No reference from a history row to the live tables: a past season's team or player may
-- since have been deleted, or its id reused (team ids 51, 54–57; HARD-39).

CREATE UNIQUE INDEX IF NOT EXISTS season_name_key ON season (name);

CREATE TABLE IF NOT EXISTS team_season (
  season              TEXT NOT NULL REFERENCES season (name),
  id                  INTEGER NOT NULL,
  name                VARCHAR(45),
  starttime           TEXT,
  endtime             TEXT,
  "matchDay"          VARCHAR(50),
  venue               INTEGER,
  courtspace          INTEGER,
  club                INTEGER,
  division            INTEGER,
  rank                INTEGER,
  "divRank"           INTEGER,
  penalties           INTEGER,
  section             TEXT,
  handicap            VARCHAR(45),
  draw                INTEGER,
  withdrawn           TIMESTAMP,
  "withdrawnDivision" INTEGER,
  "withdrawnReason"   TEXT,
  "withdrawnFixtures" INTEGER[],
  captain             INTEGER,
  PRIMARY KEY (season, id)
);

CREATE TABLE IF NOT EXISTS club_season (
  season            TEXT NOT NULL REFERENCES season (name),
  id                INTEGER NOT NULL,
  name              VARCHAR(45),
  venue             INTEGER,
  "matchNightText"  VARCHAR(100),
  "clubNightText"   VARCHAR(100),
  "clubNight"       TEXT,
  "clubNightCourts" INTEGER,
  "clubWebsite"     VARCHAR(100),
  "matchVenue"      INTEGER,
  "contactUs"       VARCHAR(100),
  facebook          VARCHAR(100),
  instagram         VARCHAR(100),
  twitter           VARCHAR(100),
  "matchSec"        INTEGER,
  "clubSec"         INTEGER,
  PRIMARY KEY (season, id)
);

CREATE TABLE IF NOT EXISTS division_season (
  season TEXT NOT NULL REFERENCES season (name),
  id     INTEGER NOT NULL,
  league INTEGER,
  rank   INTEGER,
  name   VARCHAR(20),
  PRIMARY KEY (season, id)
);

CREATE TABLE IF NOT EXISTS player_season (
  season                 TEXT NOT NULL REFERENCES season (name),
  id                     INTEGER NOT NULL,
  first_name             VARCHAR(45),
  family_name            VARCHAR(45),
  gender                 TEXT,
  date_of_registration   TIMESTAMP,
  team                   INTEGER,
  club                   INTEGER,
  rank                   INTEGER,
  "teamCaptain"          SMALLINT,
  "clubSecretary"        SMALLINT,
  "matchSecrertary"      SMALLINT,
  treasurer              SMALLINT,
  "otherComms"           SMALLINT,
  rating                 INTEGER,
  junior                 SMALLINT,
  PRIMARY KEY (season, id)
);

CREATE TABLE IF NOT EXISTS venue_season (
  season    TEXT NOT NULL REFERENCES season (name),
  id        INTEGER NOT NULL,
  name      VARCHAR(45),
  address   VARCHAR(255),
  "gMapUrl" VARCHAR(100),
  "Lat"     REAL,
  "Lng"     REAL,
  "placeId" VARCHAR(45),
  PRIMARY KEY (season, id)
);

CREATE TABLE IF NOT EXISTS messer_season (
  season        TEXT NOT NULL REFERENCES season (name),
  id            INTEGER NOT NULL,
  "homeTeam"    INTEGER,
  "awayTeam"    INTEGER,
  "homeScore"   INTEGER,
  "awayScore"   INTEGER,
  "winningTeam" INTEGER,
  section       VARCHAR(4),
  "drawPos"     INTEGER,
  round         INTEGER,
  "nextDrawPos" INTEGER,
  "nextSlot"    VARCHAR(1),
  PRIMARY KEY (season, id)
);

-- RLS on and no policy, as social_result_post: the app's role has BYPASSRLS, and a
-- `TO postgres` policy would stop `tools/local-db.sh load`, whose database has no such role.
ALTER TABLE team_season ENABLE ROW LEVEL SECURITY;
ALTER TABLE club_season ENABLE ROW LEVEL SECURITY;
ALTER TABLE division_season ENABLE ROW LEVEL SECURITY;
ALTER TABLE player_season ENABLE ROW LEVEL SECURITY;
ALTER TABLE venue_season ENABLE ROW LEVEL SECURITY;
ALTER TABLE messer_season ENABLE ROW LEVEL SECURITY;

-- <entity>_at: every season's rows, with the season as a column, so a reader joins
-- `t.id = f."homeTeam" AND t.season = ?` whatever the season.
--
-- The current season is the one whose startDate has most recently passed, the rule
-- season.init() uses. It always comes from the live table, and any history rows for it
-- are left out, which is what every reader does today ("current season → live table").
-- That matters in the weeks a rollover can fall in: the next season's row is added ahead
-- of time (2026/27 started 19 Jun 2026), so a snapshot taken before that date is of the
-- season that is still current, and without the exclusion it would appear twice.
--
-- A column a table lacks is NULL in that arm. security_invoker, so a view never reads
-- with its owner's rights (the Supabase advisor's security_definer_view).

CREATE OR REPLACE VIEW team_at WITH (security_invoker = true) AS
  SELECT season, id, name, starttime, endtime, "matchDay", venue, courtspace, club,
         division, rank, "divRank", penalties, section, handicap, draw, withdrawn,
         "withdrawnDivision", "withdrawnReason", "withdrawnFixtures", captain
    FROM team_season
   WHERE season IS DISTINCT FROM (SELECT name FROM season WHERE "startDate" <= now()
                                   ORDER BY "startDate" DESC LIMIT 1)
  UNION ALL
  SELECT (SELECT name FROM season WHERE "startDate" <= now() ORDER BY "startDate" DESC LIMIT 1),
         id, name, starttime, endtime, "matchDay", venue, courtspace, club,
         division, rank, "divRank", penalties, section, handicap, draw, withdrawn,
         "withdrawnDivision", "withdrawnReason", "withdrawnFixtures", NULL::INTEGER
    FROM team;

CREATE OR REPLACE VIEW club_at WITH (security_invoker = true) AS
  SELECT season, id, name, venue, "matchNightText", "clubNightText", "clubNight",
         "clubNightCourts", "clubWebsite", "matchVenue", "contactUs", facebook, instagram,
         twitter, "matchSec", "clubSec"
    FROM club_season
   WHERE season IS DISTINCT FROM (SELECT name FROM season WHERE "startDate" <= now()
                                   ORDER BY "startDate" DESC LIMIT 1)
  UNION ALL
  SELECT (SELECT name FROM season WHERE "startDate" <= now() ORDER BY "startDate" DESC LIMIT 1),
         id, name, venue, "matchNightText", "clubNightText", "clubNight",
         "clubNightCourts", "clubWebsite", "matchVenue", "contactUs", facebook, instagram,
         twitter, NULL::INTEGER, NULL::INTEGER
    FROM club;

CREATE OR REPLACE VIEW division_at WITH (security_invoker = true) AS
  SELECT season, id, league, rank, name
    FROM division_season
   WHERE season IS DISTINCT FROM (SELECT name FROM season WHERE "startDate" <= now()
                                   ORDER BY "startDate" DESC LIMIT 1)
  UNION ALL
  SELECT (SELECT name FROM season WHERE "startDate" <= now() ORDER BY "startDate" DESC LIMIT 1),
         id, league, rank, name
    FROM division;

CREATE OR REPLACE VIEW player_at WITH (security_invoker = true) AS
  SELECT season, id, first_name, family_name, gender, date_of_registration, team, club,
         rank, "teamCaptain", "clubSecretary", "matchSecrertary", treasurer, "otherComms",
         rating, junior
    FROM player_season
   WHERE season IS DISTINCT FROM (SELECT name FROM season WHERE "startDate" <= now()
                                   ORDER BY "startDate" DESC LIMIT 1)
  UNION ALL
  SELECT (SELECT name FROM season WHERE "startDate" <= now() ORDER BY "startDate" DESC LIMIT 1),
         id, first_name, family_name, gender, date_of_registration, team, club,
         rank, "teamCaptain", "clubSecretary", "matchSecrertary", treasurer, "otherComms",
         rating, junior
    FROM player;

CREATE OR REPLACE VIEW venue_at WITH (security_invoker = true) AS
  SELECT season, id, name, address, "gMapUrl", "Lat", "Lng", "placeId"
    FROM venue_season
   WHERE season IS DISTINCT FROM (SELECT name FROM season WHERE "startDate" <= now()
                                   ORDER BY "startDate" DESC LIMIT 1)
  UNION ALL
  SELECT (SELECT name FROM season WHERE "startDate" <= now() ORDER BY "startDate" DESC LIMIT 1),
         id, name, address, "gMapUrl", "Lat", "Lng", "placeId"
    FROM venue;

CREATE OR REPLACE VIEW messer_at WITH (security_invoker = true) AS
  SELECT season, id, "homeTeam", "awayTeam", "homeScore", "awayScore", "winningTeam",
         section, "drawPos", round, "nextDrawPos", "nextSlot"
    FROM messer_season
   WHERE season IS DISTINCT FROM (SELECT name FROM season WHERE "startDate" <= now()
                                   ORDER BY "startDate" DESC LIMIT 1)
  UNION ALL
  SELECT (SELECT name FROM season WHERE "startDate" <= now() ORDER BY "startDate" DESC LIMIT 1),
         id, "homeTeam", "awayTeam", "homeScore", "awayScore", "winningTeam",
         section, "drawPos", round, "nextDrawPos", "nextSlot"
    FROM messer;
