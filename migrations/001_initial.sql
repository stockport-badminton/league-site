-- Postgres schema converted from MySQL
-- MySQL SET/ENUM → TEXT (with CHECK constraints on live tables)
-- BLOB → BYTEA, TINYINT → SMALLINT, DATETIME → TIMESTAMP, AUTO_INCREMENT → SERIAL
-- AES_ENCRYPT/DECRYPT on playerTel/playerEmail preserved as BYTEA (use pgcrypto)

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS fuzzystrmatch;

-- ============================================================
-- LIVE TABLES
-- ============================================================

CREATE TABLE league (
  id   SERIAL PRIMARY KEY,
  name VARCHAR(45) NOT NULL,
  admin INTEGER,
  url  VARCHAR(45)
);

CREATE TABLE club (
  id                 SERIAL PRIMARY KEY,
  name               VARCHAR(45) NOT NULL,
  venue              INTEGER,
  "matchNightText"   VARCHAR(100),
  "clubNightText"    VARCHAR(100),
  "clubNight"        TEXT CHECK ("clubNight" IN ('Mon','Tue','Wed','Thu','Fri','Sat','Sun','None')),
  "clubNightCourts"  INTEGER,
  "clubWebsite"      VARCHAR(100),
  "matchVenue"       INTEGER,
  "contactUs"        VARCHAR(100),
  "matchSec"         INTEGER,
  "clubSec"          INTEGER,
  facebook           VARCHAR(100),
  instagram          VARCHAR(100),
  twitter            VARCHAR(100)
);

CREATE TABLE division (
  id     SERIAL PRIMARY KEY,
  league INTEGER,
  rank   INTEGER,
  name   VARCHAR(20) NOT NULL
);

CREATE TABLE venue (
  id       SERIAL PRIMARY KEY,
  name     VARCHAR(45)  NOT NULL,
  address  VARCHAR(255) NOT NULL,
  "gMapUrl" VARCHAR(100) NOT NULL,
  "Lat"    REAL,
  "Lng"    REAL,
  "placeId" VARCHAR(45)
);

CREATE TABLE season (
  id          SERIAL PRIMARY KEY,
  name        TEXT      NOT NULL,
  "startDate" TIMESTAMP NOT NULL,
  "endDate"   TIMESTAMP NOT NULL,
  label       TEXT
);

CREATE TABLE team (
  id         SERIAL PRIMARY KEY,
  name       VARCHAR(45) NOT NULL,
  starttime  TEXT,
  endtime    TEXT,
  "matchDay" VARCHAR(50),
  venue      INTEGER NOT NULL,
  courtspace INTEGER DEFAULT 1,
  club       INTEGER NOT NULL,
  division   INTEGER NOT NULL,
  rank       INTEGER NOT NULL,
  "divRank"  INTEGER NOT NULL DEFAULT 1,
  penalties  INTEGER,
  captain    INTEGER,
  section    TEXT CHECK (section IN ('A','B')),
  handicap   VARCHAR(45),
  draw       INTEGER
);

CREATE TABLE player (
  id                    SERIAL PRIMARY KEY,
  first_name            VARCHAR(45) NOT NULL,
  family_name           VARCHAR(45) NOT NULL,
  gender                TEXT CHECK (gender IN ('Male','Female','Other')),
  date_of_registration  TIMESTAMP,
  team                  INTEGER,
  club                  INTEGER NOT NULL,
  rank                  INTEGER,
  "playerTel"           BYTEA,
  "playerEmail"         BYTEA,
  "teamCaptain"         SMALLINT DEFAULT 0,
  "clubSecretary"       SMALLINT DEFAULT 0,
  "matchSecrertary"     SMALLINT DEFAULT 0,
  treasurer             SMALLINT DEFAULT 0,
  "otherComms"          SMALLINT DEFAULT 0,
  rating                INTEGER,
  junior                SMALLINT DEFAULT 0
);

CREATE TABLE fixture (
  id          SERIAL PRIMARY KEY,
  "homeTeam"  INTEGER   NOT NULL,
  "awayTeam"  INTEGER   NOT NULL,
  "homeMan1"  INTEGER,
  "homeMan2"  INTEGER,
  "homeMan3"  INTEGER,
  "homeLady1" INTEGER,
  "homeLady2" INTEGER,
  "homeLady3" INTEGER,
  "awayMan1"  INTEGER,
  "awayMan2"  INTEGER,
  "awayMan3"  INTEGER,
  "awayLady1" INTEGER,
  "awayLady2" INTEGER,
  "awayLady3" INTEGER,
  date        TIMESTAMP NOT NULL,
  status      TEXT NOT NULL DEFAULT 'outstanding'
                   CHECK (status IN ('conceded','rearranging','rearranged','late','outstanding','complete','void')),
  "homeScore" INTEGER,
  "awayScore" INTEGER
);

CREATE TABLE game (
  id               SERIAL PRIMARY KEY,
  "homePlayer1"    INTEGER,
  "homePlayer2"    INTEGER,
  "awayPlayer1"    INTEGER,
  "awayPlayer2"    INTEGER,
  "homeScore"      INTEGER,
  "awayScore"      INTEGER,
  fixture          INTEGER NOT NULL,
  "gameType"       TEXT CHECK ("gameType" IN (
                     'FirstMens','FirstLadies','SecondMens','SecondLadies',
                     'ThirdMens','ThirdLadies','FirstMixed','SecondMixed','ThirdMixed')),
  "awayPlayer2End" INTEGER DEFAULT 0,
  "awayPlayer1End" INTEGER DEFAULT 0,
  "homePlayer2End" INTEGER DEFAULT 0,
  "homePlayer1End" INTEGER DEFAULT 0,
  "awayPlayer2Start" INTEGER NOT NULL DEFAULT 1500,
  "awayPlayer1Start" INTEGER NOT NULL DEFAULT 1500,
  "homePlayer2Start" INTEGER NOT NULL DEFAULT 1500,
  "homePlayer1Start" INTEGER NOT NULL DEFAULT 1500
);

CREATE INDEX idx_game_fixture ON game (fixture);

CREATE TABLE fines (
  id     SERIAL PRIMARY KEY,
  type   TEXT CHECK (type IN ('club','team')),
  club   INTEGER,
  team   INTEGER,
  "desc" TEXT CHECK ("desc" IN ('agm','rearrangement','card')),
  amount INTEGER,
  season VARCHAR(45)
);

CREATE TABLE messer (
  id            SERIAL PRIMARY KEY,
  "homeTeam"    INTEGER NOT NULL,
  "awayTeam"    INTEGER NOT NULL,
  "homeScore"   INTEGER,
  "awayScore"   INTEGER,
  "winningTeam" INTEGER,
  section       VARCHAR(4),
  "drawPos"     INTEGER
);

CREATE TABLE scorecardstore (
  id                    SERIAL PRIMARY KEY,
  date                  TIMESTAMP,
  division              INTEGER NOT NULL,
  "homeTeam"            INTEGER NOT NULL,
  "awayTeam"            INTEGER NOT NULL,
  "homeMan1"            INTEGER NOT NULL,
  "homeMan2"            INTEGER NOT NULL,
  "homeMan3"            INTEGER NOT NULL,
  "homeLady1"           INTEGER NOT NULL,
  "homeLady2"           INTEGER NOT NULL,
  "homeLady3"           INTEGER NOT NULL,
  "awayMan1"            INTEGER NOT NULL,
  "awayMan2"            INTEGER NOT NULL,
  "awayMan3"            INTEGER NOT NULL,
  "awayLady1"           INTEGER NOT NULL,
  "awayLady2"           INTEGER NOT NULL,
  "awayLady3"           INTEGER NOT NULL,
  "FirstMixedhomeMan1"    INTEGER NOT NULL,
  "SecondMixedhomeMan2"   INTEGER NOT NULL,
  "ThirdMixedhomeMan3"    INTEGER NOT NULL,
  "FirstMixedhomeLady1"   INTEGER NOT NULL,
  "SecondMixedhomeLady2"  INTEGER NOT NULL,
  "ThirdMixedhomeLady3"   INTEGER NOT NULL,
  "FirstMixedawayMan1"    INTEGER NOT NULL,
  "SecondMixedawayMan2"   INTEGER NOT NULL,
  "ThirdMixedawayMan3"    INTEGER NOT NULL,
  "FirstMixedawayLady1"   INTEGER NOT NULL,
  "SecondMixedawayLady2"  INTEGER NOT NULL,
  "ThirdMixedawayLady3"   INTEGER NOT NULL,
  "Game1homeScore"   INTEGER NOT NULL,
  "Game1awayScore"   INTEGER NOT NULL,
  "Game2homeScore"   INTEGER NOT NULL,
  "Game2awayScore"   INTEGER NOT NULL,
  "Game3homeScore"   INTEGER NOT NULL,
  "Game3awayScore"   INTEGER NOT NULL,
  "Game4homeScore"   INTEGER NOT NULL,
  "Game4awayScore"   INTEGER NOT NULL,
  "Game5homeScore"   INTEGER NOT NULL,
  "Game5awayScore"   INTEGER NOT NULL,
  "Game6homeScore"   INTEGER NOT NULL,
  "Game6awayScore"   INTEGER NOT NULL,
  "Game7homeScore"   INTEGER NOT NULL,
  "Game7awayScore"   INTEGER NOT NULL,
  "Game8homeScore"   INTEGER NOT NULL,
  "Game8awayScore"   INTEGER NOT NULL,
  "Game9homeScore"   INTEGER NOT NULL,
  "Game9awayScore"   INTEGER NOT NULL,
  "Game10homeScore"  INTEGER NOT NULL,
  "Game10awayScore"  INTEGER NOT NULL,
  "Game11homeScore"  INTEGER NOT NULL,
  "Game11awayScore"  INTEGER NOT NULL,
  "Game12homeScore"  INTEGER NOT NULL,
  "Game12awayScore"  INTEGER NOT NULL,
  "Game13homeScore"  INTEGER NOT NULL,
  "Game13awayScore"  INTEGER NOT NULL,
  "Game14homeScore"  INTEGER NOT NULL,
  "Game14awayScore"  INTEGER NOT NULL,
  "Game15homeScore"  INTEGER NOT NULL,
  "Game15awayScore"  INTEGER NOT NULL,
  "Game16homeScore"  INTEGER NOT NULL,
  "Game16awayScore"  INTEGER NOT NULL,
  "Game17homeScore"  INTEGER NOT NULL,
  "Game17awayScore"  INTEGER NOT NULL,
  "Game18homeScore"  INTEGER NOT NULL,
  "Game18awayScore"  INTEGER NOT NULL,
  "scoresheet-url"   VARCHAR(256),
  email              VARCHAR(100)
);

-- ============================================================
-- SEASONAL SNAPSHOTS — CLUB
-- ============================================================

CREATE TABLE club20122013 (
  id                SERIAL PRIMARY KEY,
  name              VARCHAR(45) NOT NULL,
  venue             INTEGER,
  "matchNightText"  VARCHAR(100),
  "clubNightText"   VARCHAR(45),
  "clubNight"       TEXT,
  "clubNightCourts" INTEGER,
  "clubWebsite"     VARCHAR(100),
  "matchVenue"      INTEGER
);

CREATE TABLE club20132014 (LIKE club20122013 INCLUDING ALL);
CREATE TABLE club20142015 (LIKE club20122013 INCLUDING ALL);
CREATE TABLE club20152016 (LIKE club20122013 INCLUDING ALL);
CREATE TABLE club20162017 (LIKE club20122013 INCLUDING ALL);
CREATE TABLE club20172018 (LIKE club20122013 INCLUDING ALL);
CREATE TABLE club20182019 (LIKE club20122013 INCLUDING ALL);

CREATE TABLE club20192020 (
  id                INTEGER PRIMARY KEY,
  name              VARCHAR(45) NOT NULL,
  venue             INTEGER,
  "matchNightText"  VARCHAR(100),
  "clubNightText"   VARCHAR(45),
  "clubNight"       TEXT,
  "clubNightCourts" INTEGER,
  "clubWebsite"     VARCHAR(100),
  "matchVenue"      INTEGER,
  "contactUs"       VARCHAR(100)
);

CREATE TABLE club20212022 (
  id                INTEGER PRIMARY KEY,
  name              VARCHAR(45) NOT NULL,
  venue             INTEGER,
  "matchNightText"  VARCHAR(100),
  "clubNightText"   VARCHAR(100),
  "clubNight"       TEXT,
  "clubNightCourts" INTEGER,
  "clubWebsite"     VARCHAR(100),
  "matchVenue"      INTEGER,
  "contactUs"       VARCHAR(100),
  "matchSec"        INTEGER,
  "clubSec"         INTEGER
);

CREATE TABLE club20222023 (
  id                SERIAL PRIMARY KEY,
  name              VARCHAR(45) NOT NULL,
  venue             INTEGER,
  "matchNightText"  VARCHAR(100),
  "clubNightText"   VARCHAR(100),
  "clubNight"       TEXT,
  "clubNightCourts" INTEGER,
  "clubWebsite"     VARCHAR(100),
  "matchVenue"      INTEGER,
  "contactUs"       VARCHAR(100),
  "matchSec"        INTEGER,
  "clubSec"         INTEGER
);

CREATE TABLE club20232024 (
  id                SERIAL PRIMARY KEY,
  name              VARCHAR(45) NOT NULL,
  venue             INTEGER,
  "matchNightText"  VARCHAR(100),
  "clubNightText"   VARCHAR(100),
  "clubNight"       TEXT,
  "clubNightCourts" INTEGER,
  "clubWebsite"     VARCHAR(100),
  "matchVenue"      INTEGER,
  "contactUs"       VARCHAR(100),
  "matchSec"        INTEGER,
  "clubSec"         INTEGER,
  facebook          VARCHAR(100),
  instagram         VARCHAR(100),
  twitter           VARCHAR(100)
);

CREATE TABLE club20242025 (LIKE club20232024 INCLUDING ALL);

-- ============================================================
-- SEASONAL SNAPSHOTS — DIVISION
-- ============================================================

CREATE TABLE division20122013 (
  id     SERIAL PRIMARY KEY,
  league INTEGER,
  rank   INTEGER,
  name   VARCHAR(20) NOT NULL
);

CREATE TABLE division20132014 (LIKE division20122013 INCLUDING ALL);
CREATE TABLE division20142015 (LIKE division20122013 INCLUDING ALL);
CREATE TABLE division20152016 (LIKE division20122013 INCLUDING ALL);
CREATE TABLE division20162017 (LIKE division20122013 INCLUDING ALL);
CREATE TABLE division20172018 (LIKE division20122013 INCLUDING ALL);
CREATE TABLE division20182019 (LIKE division20122013 INCLUDING ALL);

CREATE TABLE division20192020 (
  id     INTEGER PRIMARY KEY,
  league INTEGER,
  rank   INTEGER,
  name   VARCHAR(20) NOT NULL
);

CREATE TABLE division20212022 (
  id     INTEGER PRIMARY KEY,
  league INTEGER,
  rank   INTEGER,
  name   VARCHAR(20) NOT NULL
);

CREATE TABLE division20222023 (LIKE division20122013 INCLUDING ALL);
CREATE TABLE division20232024 (LIKE division20122013 INCLUDING ALL);
CREATE TABLE division20242025 (LIKE division20122013 INCLUDING ALL);

-- ============================================================
-- SEASONAL SNAPSHOTS — PLAYER
-- ============================================================

CREATE TABLE player20182019 (
  id                   SERIAL PRIMARY KEY,
  first_name           VARCHAR(45) NOT NULL,
  family_name          VARCHAR(45) NOT NULL,
  gender               TEXT,
  date_of_registration TIMESTAMP,
  team                 INTEGER,
  club                 INTEGER NOT NULL
);

CREATE TABLE player20192020 (
  id                   INTEGER PRIMARY KEY,
  first_name           VARCHAR(45) NOT NULL,
  family_name          VARCHAR(45) NOT NULL,
  gender               TEXT,
  date_of_registration TIMESTAMP,
  team                 INTEGER,
  club                 INTEGER NOT NULL,
  rank                 INTEGER
);

CREATE TABLE player20212022 (
  id                   INTEGER PRIMARY KEY,
  first_name           VARCHAR(45) NOT NULL,
  family_name          VARCHAR(45) NOT NULL,
  gender               TEXT,
  date_of_registration TIMESTAMP,
  team                 INTEGER,
  club                 INTEGER NOT NULL,
  rank                 INTEGER,
  "playerTel"          BYTEA,
  "playerEmail"        BYTEA
);

CREATE TABLE player20222023 (
  id                   SERIAL PRIMARY KEY,
  first_name           VARCHAR(45) NOT NULL,
  family_name          VARCHAR(45) NOT NULL,
  gender               TEXT,
  date_of_registration TIMESTAMP,
  team                 INTEGER,
  club                 INTEGER NOT NULL,
  rank                 INTEGER,
  "playerTel"          BYTEA,
  "playerEmail"        BYTEA,
  "teamCaptain"        SMALLINT DEFAULT 0,
  "clubSecretary"      SMALLINT DEFAULT 0,
  "matchSecrertary"    SMALLINT DEFAULT 0,
  treasurer            SMALLINT DEFAULT 0,
  "otherComms"         SMALLINT DEFAULT 0
);

CREATE TABLE player20232024 (LIKE player20222023 INCLUDING ALL);

CREATE TABLE player20242025 (
  id                   SERIAL PRIMARY KEY,
  first_name           VARCHAR(45) NOT NULL,
  family_name          VARCHAR(45) NOT NULL,
  gender               TEXT,
  date_of_registration TIMESTAMP,
  team                 INTEGER,
  club                 INTEGER NOT NULL,
  rank                 INTEGER,
  "playerTel"          BYTEA,
  "playerEmail"        BYTEA,
  "teamCaptain"        SMALLINT DEFAULT 0,
  "clubSecretary"      SMALLINT DEFAULT 0,
  "matchSecrertary"    SMALLINT DEFAULT 0,
  treasurer            SMALLINT DEFAULT 0,
  "otherComms"         SMALLINT DEFAULT 0,
  rating               INTEGER,
  junior               SMALLINT DEFAULT 0
);

-- ============================================================
-- SEASONAL SNAPSHOTS — TEAM (old-style time values)
-- ============================================================

CREATE TABLE team20122013 (
  id         SERIAL PRIMARY KEY,
  name       VARCHAR(45) NOT NULL,
  starttime  TEXT,
  endtime    TEXT,
  "matchDay" TEXT,
  venue      INTEGER NOT NULL,
  courtspace INTEGER DEFAULT 1,
  club       INTEGER NOT NULL,
  division   INTEGER NOT NULL,
  rank       INTEGER NOT NULL,
  "divRank"  INTEGER NOT NULL DEFAULT 1,
  penalties  INTEGER DEFAULT 0
);

CREATE TABLE team20132014 (LIKE team20122013 INCLUDING ALL);
CREATE TABLE team20142015 (LIKE team20122013 INCLUDING ALL);
CREATE TABLE team20152016 (LIKE team20122013 INCLUDING ALL);
CREATE TABLE team20162017 (LIKE team20122013 INCLUDING ALL);
CREATE TABLE team20172018 (LIKE team20122013 INCLUDING ALL);
CREATE TABLE team20182019 (LIKE team20122013 INCLUDING ALL);

CREATE TABLE team20192020 (
  id         INTEGER PRIMARY KEY,
  name       VARCHAR(45) NOT NULL,
  starttime  TEXT,
  endtime    TEXT,
  "matchDay" TEXT,
  venue      INTEGER NOT NULL,
  courtspace INTEGER DEFAULT 1,
  club       INTEGER NOT NULL,
  division   INTEGER NOT NULL,
  rank       INTEGER NOT NULL,
  "divRank"  INTEGER NOT NULL DEFAULT 1,
  penalties  INTEGER
);

CREATE TABLE team20212022 (
  id         INTEGER PRIMARY KEY,
  name       VARCHAR(45) NOT NULL,
  starttime  TEXT,
  endtime    TEXT,
  "matchDay" TEXT,
  venue      INTEGER NOT NULL,
  courtspace INTEGER DEFAULT 1,
  club       INTEGER NOT NULL,
  division   INTEGER NOT NULL,
  rank       INTEGER NOT NULL,
  "divRank"  INTEGER NOT NULL DEFAULT 1,
  penalties  INTEGER,
  captain    INTEGER
);

CREATE TABLE team20222023 (
  id         SERIAL PRIMARY KEY,
  name       VARCHAR(45) NOT NULL,
  starttime  TEXT,
  endtime    TEXT,
  "matchDay" TEXT,
  venue      INTEGER NOT NULL,
  courtspace INTEGER DEFAULT 1,
  club       INTEGER NOT NULL,
  division   INTEGER NOT NULL,
  rank       INTEGER NOT NULL,
  "divRank"  INTEGER NOT NULL DEFAULT 1,
  penalties  INTEGER,
  captain    INTEGER,
  section    TEXT,
  handicap   VARCHAR(45),
  draw       INTEGER
);

CREATE TABLE team20232024 (LIKE team20222023 INCLUDING ALL);
CREATE TABLE team20242025 (LIKE team20222023 INCLUDING ALL);

-- ============================================================
-- SEASONAL SNAPSHOTS — VENUE
-- ============================================================

CREATE TABLE venue20212022 (
  id        INTEGER PRIMARY KEY,
  name      VARCHAR(45)  NOT NULL,
  address   VARCHAR(255) NOT NULL,
  "gMapUrl" VARCHAR(100) NOT NULL,
  "Lat"     REAL,
  "Lng"     REAL
);

CREATE TABLE venue20222023 (
  id        SERIAL PRIMARY KEY,
  name      VARCHAR(45)  NOT NULL,
  address   VARCHAR(255) NOT NULL,
  "gMapUrl" VARCHAR(100) NOT NULL,
  "Lat"     REAL,
  "Lng"     REAL
);

CREATE TABLE venue20232024 (LIKE venue20222023 INCLUDING ALL);

CREATE TABLE venue20242025 (
  id        SERIAL PRIMARY KEY,
  name      VARCHAR(45)  NOT NULL,
  address   VARCHAR(255) NOT NULL,
  "gMapUrl" VARCHAR(100) NOT NULL,
  "Lat"     REAL,
  "Lng"     REAL,
  "placeId" VARCHAR(45)
);

-- ============================================================
-- SEASONAL SNAPSHOTS — MESSER
-- ============================================================

CREATE TABLE messer20232024 (
  id            SERIAL PRIMARY KEY,
  "homeTeam"    INTEGER NOT NULL,
  "awayTeam"    INTEGER NOT NULL,
  "homeScore"   INTEGER,
  "awayScore"   INTEGER,
  "winningTeam" INTEGER,
  section       VARCHAR(4),
  "drawPos"     INTEGER
);

CREATE TABLE messer20242025 (LIKE messer20232024 INCLUDING ALL);
