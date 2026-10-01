var db = require('../db_connect.js');
var seasonModel = require("./season");
const levenshtein = require('js-levenshtein');
const { rankByName } = require('../utils/nameMatch');


// POST
// Returns `[{ id }]`. Without RETURNING the result is an empty rows array, so the
// `row.insertId` its caller read was always undefined — see the note on
// Fixture.createScorecard for the same bug in the scorecard flow. Prefer
// models/roster.js:createPlayer for the roster pages; this one stays for the
// standalone /player/create form.
exports.create = async function(first_name, family_name, team, club, gender) {
  var date_of_registration = new Date();
  const [result] = await (await db.otherConnect()).query(
    'INSERT INTO player (first_name,family_name,date_of_registration,team,club,gender) VALUES (?,?,?,?,?,?) RETURNING id',
    [first_name, family_name, date_of_registration, team, club, gender]
  )
  return result
}

exports.createByName = async function(obj) {
  if (!db.isObject(obj)) throw new Error('not object')
  const sql = 'INSERT INTO player (first_name, family_name, gender, club, team, date_of_registration) VALUES (?, ?, ?, (SELECT id FROM club WHERE name = ?), (SELECT id FROM team WHERE name = ?), ?)'
  const [result] = await (await db.otherConnect()).query(sql, [obj.first_name, obj.family_name, obj.gender, obj.clubName, obj.teamName, obj.date])
  return result
}

exports.createBatch = async function(BatchObj) {
  if (!db.isObject(BatchObj)) throw new Error('not object')
  const fields = BatchObj.fields.map(f => `"${f}"`).join(',')
  const rows = Object.values(BatchObj.data).map(row => Object.values(row))
  const valueClauses = rows.map(row => '(' + row.map(() => '?').join(',') + ')').join(',')
  const sql = `INSERT INTO "${BatchObj.tablename}" (${fields}) VALUES ${valueClauses}`
  const [result] = await (await db.otherConnect()).query(sql, rows.flat())
  return result
}

// PATCH
exports.updateById = async function(first_name, family_name, team, club, gender, playerId) {
  const [result] = await (await db.otherConnect()).query(
    'UPDATE player SET first_name = ?, family_name = ?, team = ?, club = ?, gender = ? WHERE id = ?',
    [first_name, family_name, team, club, gender, playerId]
  )
  return result
}

// Columns updateBulk is allowed to write. It builds its SET clause from
// caller-supplied field names, which was safe enough while every caller was
// server-side — but it was also reachable as POST /player/batch-update, where the
// table name and field list came from the request body. That route is gone (see
// controllers/rosterController.js for what replaced it); the allowlist is here so
// a future caller can't reintroduce the same hole by passing `role` or `authEmail`
// through from user input.
const BULK_WRITABLE = new Set([
  'id', 'first_name', 'family_name', 'gender', 'team', 'club', 'rank', 'rating',
  'playerTel', 'playerEmail', 'teamCaptain', 'clubSecretary', 'matchSecrertary',
  'treasurer', 'otherComms', 'junior', 'date_of_registration'
])

exports.updateBulk = async function(BatchObj) {
  if (!db.isObject(BatchObj)) throw new Error('not object')
  // Authorization-bearing columns (role, messerAdmin, authEmail) are deliberately
  // absent from the allowlist — they go through setAuthRole, which only ever runs
  // for a superadmin.
  if (BatchObj.tablename && BatchObj.tablename !== 'player') {
    throw new Error(`updateBulk only writes the player table, got ${JSON.stringify(BatchObj.tablename)}`)
  }
  const rejected = (BatchObj.fields || []).filter(f => !BULK_WRITABLE.has(f))
  if (rejected.length) {
    throw new Error(`updateBulk cannot write these columns: ${rejected.join(', ')}`)
  }
  const conn = await db.otherConnect()
  for (const x in BatchObj.data) {
    const row = BatchObj.data[x]
    const setClauses = []
    const params = []
    let whereId
    for (const y in BatchObj.data[x]) {
      if (BatchObj.fields[y] === 'id') {
        whereId = row[y]
      } else if (BatchObj.fields[y] === 'playerTel' || BatchObj.fields[y] === 'playerEmail') {
        // Two binds, value then key, in the order the placeholders appear in the clause.
        setClauses.push(`"${BatchObj.fields[y]}" = pgp_sym_encrypt(?, ?)`)
        params.push(String(row[y]), process.env.DB_PI_KEY)
      } else {
        setClauses.push(`"${BatchObj.fields[y]}" = ?`)
        params.push(row[y])
      }
    }
    params.push(whereId)
    await conn.query(`UPDATE "${BatchObj.tablename}" SET ${setClauses.join(',')} WHERE id = ?`, params)
  }
}

// GET
exports.getAll = async function() {
  const [result] = await (await db.otherConnect()).query('SELECT * FROM player')
  return result
}

exports.getNominatedPlayers = async function(teamName) {
  const [result] = await (await db.otherConnect()).query(
    "SELECT CONCAT(first_name,' ',family_name) AS name, gender FROM player JOIN team ON team.id = player.team WHERE team.name = ? AND player.rank IS NOT NULL ORDER BY gender, player.rank",
    teamName
  )
  return result
}

// All players registered to any team at a club, for the team-registration-form
// PDF. rank == 99 marks a reserve (see manage_player_list_clubs_teams); everything
// else is a nominated player. player.rank is only a within-team strength order,
// so team.rank (the team's own pecking order at the club) has to sort first, or
// e.g. every team's #1 player clusters together ahead of any team's #2.
exports.getClubRoster = async function(clubName) {
  const [result] = await (await db.otherConnect()).query(
    `SELECT player.id, CONCAT(player.first_name,' ',player.family_name) AS name,
            player.gender, player.rank, player.junior, team.name AS "teamName"
     FROM player
     JOIN team ON team.id = player.team
     JOIN club ON club.id = team.club
     WHERE club.name = ?
     ORDER BY player.gender, team.rank, player.rank, player.family_name`,
    clubName
  )
  return result
}

// Nominated players who have not appeared in any of their team's last three
// completed matches (rule: "If a player misses 3 consecutive matches...").
//
// `fixture` holds every season back to 2012, so the window must be bounded to
// the current one: without that, a team that had not yet played this season was
// judged on last April's matches, and every player nominated since was listed.
// A team with fewer than three results this season cannot have a player who has
// missed three, so it is left out rather than judged on the matches it has.
// No Club's teams are the holding pen for released players, not a club.
exports.getMissedThreePlayers = async function() {
  const Roster = require('./roster');
  const [result] = await (await db.otherConnect()).query(`WITH season_window AS (
  SELECT "startDate", "endDate" FROM season WHERE name = ?
),
team_fixtures AS (
  SELECT
    f.id        AS fixture_id,
    f.date      AS fixture_date,
    f."homeTeam"  AS team_id,
    f."homeMan1"  AS p1, f."homeMan2" AS p2, f."homeMan3" AS p3,
    f."homeLady1" AS p4, f."homeLady2" AS p5, f."homeLady3" AS p6
  FROM fixture f
  JOIN season_window w ON f.date >= w."startDate" AND f.date <= w."endDate"
  WHERE f.status = 'complete'

  UNION ALL

  SELECT
    f.id,
    f.date,
    f."awayTeam",
    f."awayMan1",  f."awayMan2",  f."awayMan3",
    f."awayLady1", f."awayLady2", f."awayLady3"
  FROM fixture f
  JOIN season_window w ON f.date >= w."startDate" AND f.date <= w."endDate"
  WHERE f.status = 'complete'
),
ranked AS (
  SELECT
    tf.*,
    ROW_NUMBER() OVER (
      PARTITION BY tf.team_id
      ORDER BY tf.fixture_date DESC, tf.fixture_id DESC
    ) AS rn
  FROM team_fixtures tf
),
last3 AS (
  SELECT *
  FROM ranked
  WHERE rn <= 3
),
teams_with_three AS (
  SELECT team_id FROM ranked GROUP BY team_id HAVING COUNT(*) >= 3
),
men_used AS (
  SELECT
    m.team_id,
    COUNT(DISTINCT m.player_id) AS mendistinctused
  FROM (
    SELECT team_id, p1 AS player_id FROM last3
    UNION ALL SELECT team_id, p2 FROM last3
    UNION ALL SELECT team_id, p3 FROM last3
  ) m
  JOIN player p
    ON p.id = m.player_id
   AND p.team = m.team_id
  WHERE m.player_id <> 0
  GROUP BY m.team_id
),
ladies_used AS (
  SELECT
    l.team_id,
    COUNT(DISTINCT l.player_id) AS ladiesdistinctused
  FROM (
    SELECT team_id, p4 AS player_id FROM last3
    UNION ALL SELECT team_id, p5 FROM last3
    UNION ALL SELECT team_id, p6 FROM last3
  ) l
  JOIN player p
    ON p.id = l.player_id
   AND p.team = l.team_id
  WHERE l.player_id <> 0
  GROUP BY l.team_id
),

fixture_players AS (
  SELECT team_id, fixture_id, p1 AS player_id FROM last3
  UNION ALL SELECT team_id, fixture_id, p2 FROM last3
  UNION ALL SELECT team_id, fixture_id, p3 FROM last3
  UNION ALL SELECT team_id, fixture_id, p4 FROM last3
  UNION ALL SELECT team_id, fixture_id, p5 FROM last3
  UNION ALL SELECT team_id, fixture_id, p6 FROM last3
),
appearances AS (
  SELECT
    team_id,
    player_id,
    COUNT(DISTINCT fixture_id) AS numplayed
  FROM fixture_players
  WHERE player_id <> 0
  GROUP BY team_id, player_id
),
nom_players AS (
  SELECT
    p.team AS team_id,
    p.id   AS player_id,
    p.first_name,
    p.family_name,
    p.gender
  FROM player p
  WHERE p."rank" IS NULL OR p."rank" < ?
),
team_filtered AS (
  SELECT
    t.*,
    COUNT(*) OVER (PARTITION BY t.club) AS club_team_count,
    MAX(t."rank") OVER (PARTITION BY t.club) AS club_lowest_rank
  FROM team t
  WHERE t.club <> ?
)
SELECT
  t.id   AS team_id,
  t.name AS team_name,
  t.club AS club,
  t."rank" AS team_rank,
  np.player_id AS "playerID",
  np.first_name,
  np.family_name,
  np.gender,
  COALESCE(a.numPlayed, 0) AS "numPlayed",
  -- The team a replacement would be promoted from. Never NULL here: the club's
  -- lowest team is filtered out below, so there is always one beneath.
  (SELECT n.name FROM team n
    WHERE n.club = t.club AND n."rank" > t."rank"
    ORDER BY n."rank", n.id LIMIT 1) AS next_team_name
FROM team_filtered t
JOIN teams_with_three twt
  ON twt.team_id = t.id
JOIN nom_players np
  ON np.team_id = t.id
LEFT JOIN appearances a
  ON a.team_id = t.id AND a.player_id = np.player_id
LEFT JOIN men_used mu
  ON mu.team_id = t.id
LEFT JOIN ladies_used lu
  ON lu.team_id = t.id
WHERE
  t.club_team_count > 1
  AND t."rank" < t.club_lowest_rank
  AND COALESCE(a.numPlayed, 0) = 0
  AND NOT (
    COALESCE(mu.menDistinctUsed, 0) >= 3
    AND COALESCE(lu.ladiesDistinctUsed, 0) >= 3
  )
ORDER BY t.club, t."rank", np.family_name, np.first_name;`,
    [seasonModel.current(), Roster.RESERVE_BASE, Roster.NO_CLUB_ID])
  return result
}

exports.getMatchStats = async function(fixtureId) {
  const [result] = await (await db.otherConnect()).query(
    "SELECT CONCAT(player.first_name,' ',player.family_name) AS name, team.name AS \"teamName\", b.\"avgPtsFor\", b.\"avgPtsAgainst\", \"gamesWon\" FROM ( SELECT playerId, AVG(ptsFor) AS \"avgPtsFor\", AVG(ptsAgainst) AS \"avgPtsAgainst\", SUM(won) AS \"gamesWon\" FROM ( SELECT \"homePlayer1\" AS playerid, \"homeScore\" AS ptsfor, \"awayScore\" AS ptsagainst, CASE WHEN \"homeScore\" > \"awayScore\" THEN 1 ELSE 0 END AS won FROM game WHERE fixture = ? AND (\"awayPlayer1\" !=0 AND \"awayPlayer2\" != 0 AND \"homePlayer2\" != 0 AND \"homePlayer1\" !=0) UNION ALL SELECT \"homePlayer2\" AS playerid, \"homeScore\" AS ptsfor, \"awayScore\" AS ptsagainst, CASE WHEN \"homeScore\" > \"awayScore\" THEN 1 ELSE 0 END AS won FROM game WHERE fixture = ? AND (\"awayPlayer1\" !=0 AND \"awayPlayer2\" != 0 AND \"homePlayer2\" != 0 AND \"homePlayer1\" !=0) UNION ALL SELECT \"awayPlayer1\" AS playerid, \"awayScore\" AS ptsfor, \"homeScore\" AS ptsagainst, CASE WHEN \"homeScore\" < \"awayScore\" THEN 1 ELSE 0 END AS won FROM game WHERE fixture = ? AND (\"awayPlayer1\" !=0 AND \"awayPlayer2\" != 0 AND \"homePlayer2\" != 0 AND \"homePlayer1\" !=0) UNION ALL SELECT \"awayPlayer2\" AS playerid, \"awayScore\" AS ptsfor, \"homeScore\" AS ptsagainst, CASE WHEN \"homeScore\" < \"awayScore\" THEN 1 ELSE 0 END AS won FROM game WHERE fixture = ? AND (\"awayPlayer1\" !=0 AND \"awayPlayer2\" != 0 AND \"homePlayer2\" != 0 AND \"homePlayer1\" !=0) ) AS a GROUP BY playerId ) AS b JOIN player ON b.playerId = player.id JOIN team ON player.team = team.id ORDER BY \"teamName\", \"gamesWon\" DESC, \"avgPtsAgainst\" ASC",
    Array(4).fill(fixtureId * 1)
  )
  return result
}


exports.getNamesClubsTeams = async function(searchTerms) {
  var whereTerms = [];
  var whereValue = [];
  var nameMatch = ""

  let season = ""
  function checkSeason(season) {
    // Shape first. Without this the parseInt pair below waves payloads through:
    // parseInt("2026 AS team WHERE false --") is 2026, so a crafted season passed
    // every check and reached the team${season} interpolation as SQL.
    if (!seasonModel.isValidName(season)) return false
    let firstYear = parseInt(season.slice(0, 4))
    let secondYear = parseInt(season.slice(4))
    if (secondYear - firstYear != 1) return false
    if (firstYear < 2018 || season == seasonModel.current()) return false
    return true
  }

  if (searchTerms.season !== undefined && checkSeason(searchTerms.season)) {
    season = searchTerms.season;
  }

  if (searchTerms.name) {
    var letter = searchTerms.name.substr(0, 1);
    nameMatch = "AND (player.first_name LIKE '" + letter + "%' OR player.family_name LIKE '" + letter + "%')"
  }
  if (searchTerms.club) {
    whereTerms.push('"clubName" = ?');
    whereValue.push(searchTerms.club)
  }
  if (searchTerms.team) {
    whereTerms.push('"teamName" = ?');
    whereValue.push(searchTerms.team)
  }
  if (searchTerms.gender) {
    whereTerms.push('gender = ?');
    whereValue.push(searchTerms.gender)
  }

  if (whereTerms.length > 0) {
    var conditions = ' WHERE ' + whereTerms.join(' AND ');
    const [result] = await (await db.otherConnect()).query(
      'SELECT * FROM (SELECT a."playerID", a.name, gender, date_of_registration, a.rank, club.id AS "clubId", club.name AS "clubName", a."teamName", a."teamId" FROM (SELECT player.id AS "playerID", CONCAT(first_name,\' \',family_name) AS name, gender, date_of_registration, player.rank, team.id AS "teamId", team.name AS "teamName", player.club AS "clubId" FROM player' + season + ' player JOIN team' + season + ' team ON team.id = player.team ' + nameMatch + ') AS a JOIN club' + season + ' club ON a."clubId" = club.id) AS b' + conditions + ' ORDER BY "teamName", gender, rank',
      whereValue
    )
    return result
  } else {
    const [result] = await (await db.otherConnect()).query(
      'SELECT a."playerID", a.name, gender, date_of_registration, a.rank, club.id AS "clubId", club.name AS "clubName", a."teamName", a."teamId" FROM (SELECT player.id AS "playerID", CONCAT(first_name,\' \',family_name) AS name, gender, date_of_registration, player.rank, team.id AS "teamId", team.name AS "teamName", player.club AS "clubId" FROM player JOIN team ON team.id = player.team ' + nameMatch + ') AS a JOIN club ON a."clubId" = club.id ORDER BY "teamName", gender, rank'
    )
    return result
  }
}

exports.getPlayerGameData = async function(id) {
  // LEFT JOIN, not INNER, and this is not a style preference (HARD-11).
  //
  // There are no foreign keys on fixture."homeTeam"/"awayTeam", and 2,132 fixtures across
  // every season point at team ids that are no longer in `team`. An inner join here drops
  // those games from the player's history silently: **10,422 of 35,244 game rows, 30% of
  // everything ever recorded, affecting 677 of 904 players.** Measured 14 Sep 2026. Susan
  // Forbes played 716 rated games and this page showed her 256 of them.
  //
  // The team name falls back rather than the row vanishing. Note ~half of those names are
  // still recoverable from the season archives (team20212022 and friends — 9 of the 19
  // orphaned ids), but reading them would mean hardcoding a list of archive tables that
  // goes stale the moment a new season is archived, with nothing to catch it. Recorded as
  // a possible follow-up instead.
  //
  // `hometeamrank` stays NULL for a missing team, so `teamAdjustment` below is NULL and
  // the view's `teamAdjustment > 0` guard simply renders no bracket. Checked.
  let sql = `WITH playerGames AS (SELECT game.*, fixture.date,
COALESCE(homeTeam.name, 'Former team') AS hometeamname, homeTeam.rank AS hometeamrank,
COALESCE(awayTeam.name, 'Former team') AS awayteamname, awayTeam.rank AS awayteamrank FROM game
JOIN fixture ON game.fixture = fixture.id
LEFT JOIN team homeTeam ON fixture."homeTeam" = homeTeam.id
LEFT JOIN team awayTeam ON fixture."awayTeam" = awayTeam.id
WHERE
(? IN("homePlayer1","homePlayer2","awayPlayer1","awayPlayer2") AND (
  "homePlayer1End" IS NOT NULL AND
  "homePlayer2End" IS NOT NULL AND
  "awayPlayer1End" IS NOT NULL AND
  "awayPlayer2End" IS NOT NULL
))
ORDER BY date DESC, id),
allGames AS (
  SELECT
  id,
  date,
  CASE WHEN "homePlayer1" = ? THEN homeTeamName
  WHEN "homePlayer2" = ? THEN homeTeamName
  WHEN "awayPlayer1" = ? THEN awayTeamName
  WHEN "awayPlayer2" = ? THEN awayTeamName
  END AS teamname,
  CASE WHEN "homePlayer1" = ? THEN homeTeamRank
  WHEN "homePlayer2" = ? THEN homeTeamRank
  WHEN "awayPlayer1" = ? THEN awayTeamRank
  WHEN "awayPlayer2" = ? THEN awayTeamRank
  END AS teamrank,
  CASE WHEN "homePlayer1" = ? THEN "homePlayer1"
  WHEN "homePlayer2" = ? THEN "homePlayer2"
  WHEN "awayPlayer1" = ? THEN "awayPlayer1"
  WHEN "awayPlayer2" = ? THEN "awayPlayer2"
  END AS playername,
  CASE WHEN "homePlayer1" = ? THEN "homePlayer2"
  WHEN "homePlayer2" = ? THEN "homePlayer1"
  WHEN "awayPlayer1" = ? THEN "awayPlayer2"
  WHEN "awayPlayer2" = ? THEN "awayPlayer1"
  END AS partner,
  CASE WHEN "homePlayer1" = ? THEN "awayPlayer1"
  WHEN "homePlayer2" = ? THEN "awayPlayer1"
  WHEN "awayPlayer1" = ? THEN "homePlayer1"
  WHEN "awayPlayer2" = ? THEN "homePlayer1"
  END AS oppo1,
  CASE WHEN "homePlayer1" = ? THEN "awayPlayer2"
  WHEN "homePlayer2" = ? THEN "awayPlayer2"
  WHEN "awayPlayer1" = ? THEN "homePlayer2"
  WHEN "awayPlayer2" = ? THEN "homePlayer2"
  END AS oppo2,
  CASE WHEN "homePlayer1" = ? THEN "homeScore"
  WHEN "homePlayer2" = ? THEN "homeScore"
  WHEN "awayPlayer1" = ? THEN "awayScore"
  WHEN "awayPlayer2" = ? THEN "awayScore"
  END AS score,
  CASE WHEN "homePlayer1" = ? THEN "awayScore"
  WHEN "homePlayer2" = ? THEN "awayScore"
  WHEN "awayPlayer1" = ? THEN "homeScore"
  WHEN "awayPlayer2" = ? THEN "homeScore"
  END AS vsscore,
  "gameType",
  CASE WHEN "homePlayer1" = ? THEN "homePlayer1Start"
  WHEN "homePlayer2" = ? THEN "homePlayer2Start"
  WHEN "awayPlayer1" = ? THEN "awayPlayer1Start"
  WHEN "awayPlayer2" = ? THEN "awayPlayer2Start"
  END AS beforeval,
  CASE WHEN "homePlayer1" = ? THEN "homePlayer1End"
  WHEN "homePlayer2" = ? THEN "homePlayer2End"
  WHEN "awayPlayer1" = ? THEN "awayPlayer1End"
  WHEN "awayPlayer2" = ? THEN "awayPlayer2End"
  END AS after,
  CASE WHEN "homePlayer1" = ? THEN "homePlayer1End" - "homePlayer1Start"
  WHEN "homePlayer2" = ? THEN "homePlayer2End" - "homePlayer2Start"
  WHEN "awayPlayer1" = ? THEN "awayPlayer1End" - "awayPlayer1Start"
  WHEN "awayPlayer2" = ? THEN "awayPlayer2End" - "awayPlayer2Start"
  END AS adjustment
  FROM playerGames
)
SELECT
allGames.id,
date,
teamname AS "teamName",
team.rank - teamrank AS "teamAdjustment",
CONCAT(player.first_name,' ',player.family_name) AS "playerName",
CONCAT(partner.first_name,' ',partner.family_name) AS "partnerName",
CONCAT(oppo1.first_name,' ',oppo1.family_name) AS "oppName1",
CONCAT(oppo2.first_name,' ',oppo2.family_name) AS "oppName2",
score,
vsscore AS "vsScore",
"gameType",
beforeval AS "beforeVal",
after,
adjustment
FROM allGames JOIN
player ON player.id = allGames.playerName JOIN
player partner ON partner.id = allGames.partner JOIN
player oppo1 ON oppo1.id = allGames.oppo1 JOIN
player oppo2 ON oppo2.id = allGames.oppo2
JOIN team ON player.team = team.id`

  let idArray = Array(45).fill(id * 1)
  const [result] = await (await db.otherConnect()).query(sql, idArray)
  return result
}


exports.newGetPlayerStats = async function(searchObj) {
  let season = ""
  let seasonString = seasonModel.current()
  let whereValue = []

  function checkSeason(season) {
    // Shape first. Without this the parseInt pair below waves payloads through:
    // parseInt("2026 AS team WHERE false --") is 2026, so a crafted season passed
    // every check and reached the team${season} interpolation as SQL.
    if (!seasonModel.isValidName(season)) return false
    let firstYear = parseInt(season.slice(0, 4))
    let secondYear = parseInt(season.slice(4))
    if (secondYear - firstYear != 1) return false
    if (firstYear < 2012 || season == seasonModel.current()) return false
    return true
  }

  let seasonVal
  if (searchObj.season === undefined || !checkSeason(searchObj.season)) {
    seasonVal = seasonString
  } else {
    season = searchObj.season;
    seasonVal = searchObj.season;
  }
  whereValue.push(seasonVal);
  whereValue.push(searchObj.gender || '%');
  whereValue.push(searchObj.team || '%');
  if (searchObj.division) whereValue.push(searchObj.division)
  whereValue.push(searchObj.club || '%');
  whereValue.push(searchObj.gameType || '%');

  var sql = `WITH
  seasonFixture AS (
    SELECT
      fixture.id,
      fixture."homeTeam",
      fixture."awayTeam"
    FROM
      fixture
      JOIN season ON season.name LIKE ?
      AND fixture.date > season."startDate"
      AND fixture.date < season."endDate"
  ),
  seasonFixtureGame AS (
    SELECT
      game.id,
      game."homePlayer1",
      game."homePlayer2",
      game."awayPlayer1",
      game."awayPlayer2",
      game."homeScore",
      game."awayScore",
      game.fixture,
      seasonFixture."homeTeam",
      seasonFixture."awayTeam"
    FROM
      seasonFixture
      JOIN game ON game.fixture = seasonFixture.id
      AND (
        game."homePlayer1" != 0
        OR game."homePlayer2" != 0
        OR game."awayPlayer1" != 0
        OR game."awayPlayer2" != 0
      )
  ),
  gameTypeGender AS (
    SELECT
      seasonFixtureGame.*,
      CASE
        WHEN homePlayer1.gender = homePlayer2.gender
        AND homePlayer1.gender = 'Male' THEN 'Mens'
        WHEN homePlayer1.gender = homePlayer2.gender
        AND homePlayer1.gender = 'Female' THEN 'Ladies'
        ELSE 'Mixed'
      END AS "gameType"
    FROM
      seasonFixtureGame
      JOIN player${ season } homePlayer1 ON seasonFixtureGame."homePlayer1" = homePlayer1.id
      AND seasonFixtureGame."homePlayer1" != 0
      JOIN player${ season } homePlayer2 ON seasonFixtureGame."homePlayer2" = homePlayer2.id
      AND seasonFixtureGame."homePlayer2" != 0
  ),
  gameSummary AS (
    SELECT
      gameTypeGender.id,
      gameTypeGender."homePlayer1" AS "playerId",
      gameTypeGender."homeScore" AS forpoints,
      gameTypeGender."awayScore" AS againstpoints,
      CASE
        WHEN gameTypeGender."homeScore" > gameTypeGender."awayScore" THEN 1
        ELSE 0
      END AS gameswon,
      CASE
        WHEN gameTypeGender."homeScore" IS NOT NULL THEN 1
        ELSE 0
      END AS gamesplayed,
      gameTypeGender.fixture,
      gameTypeGender."homeTeam" AS team,
      gameTypeGender."awayTeam" AS opposition,
      gameTypeGender."gameType"
    FROM
      gameTypeGender
    UNION ALL
    SELECT
      gameTypeGender.id,
      gameTypeGender."homePlayer2" AS "playerId",
      gameTypeGender."homeScore" AS forpoints,
      gameTypeGender."awayScore" AS againstpoints,
      CASE
        WHEN gameTypeGender."homeScore" > gameTypeGender."awayScore" THEN 1
        ELSE 0
      END AS gameswon,
      CASE
        WHEN gameTypeGender."homeScore" IS NOT NULL THEN 1
        ELSE 0
      END AS gamesplayed,
      gameTypeGender.fixture,
      gameTypeGender."homeTeam" AS team,
      gameTypeGender."awayTeam" AS opposition,
      gameTypeGender."gameType"
    FROM
      gameTypeGender
    UNION ALL
    SELECT
      gameTypeGender.id,
      gameTypeGender."awayPlayer1" AS "playerId",
      gameTypeGender."awayScore" AS forpoints,
      gameTypeGender."homeScore" AS againstpoints,
      CASE
        WHEN gameTypeGender."awayScore" > gameTypeGender."homeScore" THEN 1
        ELSE 0
      END AS gameswon,
      CASE
        WHEN gameTypeGender."homeScore" IS NOT NULL THEN 1
        ELSE 0
      END AS gamesplayed,
      gameTypeGender.fixture,
      gameTypeGender."awayTeam" AS team,
      gameTypeGender."homeTeam" AS opposition,
      gameTypeGender."gameType"
    FROM
      gameTypeGender
    UNION ALL
    SELECT
      gameTypeGender.id,
      gameTypeGender."awayPlayer2" AS "playerId",
      gameTypeGender."awayScore" AS forpoints,
      gameTypeGender."homeScore" AS againstpoints,
      CASE
        WHEN gameTypeGender."awayScore" > gameTypeGender."homeScore" THEN 1
        ELSE 0
      END AS gameswon,
      CASE
        WHEN gameTypeGender."homeScore" IS NOT NULL THEN 1
        ELSE 0
      END AS gamesplayed,
      gameTypeGender.fixture,
      gameTypeGender."awayTeam" AS team,
      gameTypeGender."homeTeam" AS opposition,
      gameTypeGender."gameType"
    FROM
      gameTypeGender
  )
SELECT
  CONCAT(player.first_name,' ',player.family_name) AS playername,
  "playerId",
  player.gender AS playergender,
  STRING_AGG("gameType", ','),
  gameSummary.team AS "teamId",
  SUM(forPoints) AS "forPoints",
  SUM(againstPoints) AS "againstPoints",
  SUM(gamesWon) AS "gamesWon",
  SUM(gamesPlayed) AS "gamesPlayed",
  (SUM(gamesPlayed) + SUM(gamesWon)) - (SUM(gamesPlayed) - SUM(gamesWon)) AS "Points",
  club.name AS "clubName",
  gameTeam.name AS "teamName"
  ${ (searchObj.season === undefined || !checkSeason(searchObj.season)) ? ',player.rating' : ''}
FROM
  gameSummary
  JOIN player${ season } player ON "playerId" = player.id
  AND player.gender LIKE ?
  ${typeof searchObj.junior !== 'undefined' ? 'AND player.junior = 1' : ''}
  JOIN team${ season } gameTeam ON gameTeam.id = gameSummary.team
  AND gameTeam.name LIKE ? ${typeof searchObj.division !== 'undefined' ? 'AND gameTeam.division = ?' : ''}
  JOIN club${ season } club ON club.id = player.club
  AND club.name LIKE ?
WHERE
"gameType" LIKE ?

GROUP BY
  "playerId",
  playername,
  playergender,
  gameSummary.team,
  "clubName",
  "teamName"
  ${ (searchObj.season === undefined || !checkSeason(searchObj.season)) ? ',player.rating' : ''}
ORDER BY
  "Points" DESC;`

  const [result] = await (await db.otherConnect()).query(sql, whereValue)
  return result
}


exports.newGetPairStats = async function(searchObj) {
  let season = ""
  let seasonString = seasonModel.current()
  let divisionSql = ""
  let whereValue = []

  function checkSeason(season) {
    // Shape first. Without this the parseInt pair below waves payloads through:
    // parseInt("2026 AS team WHERE false --") is 2026, so a crafted season passed
    // every check and reached the team${season} interpolation as SQL.
    if (!seasonModel.isValidName(season)) return false
    let firstYear = parseInt(season.slice(0, 4))
    let secondYear = parseInt(season.slice(4))
    if (secondYear - firstYear != 1) return false
    if (firstYear < 2012 || season == seasonModel.current()) return false
    return true
  }

  let seasonVal
  if (searchObj.season === undefined || !checkSeason(searchObj.season)) {
    seasonVal = seasonString
  } else {
    season = searchObj.season;
    seasonVal = searchObj.season;
  }
  whereValue = [seasonVal]

  var sql = `WITH
  seasonFixture AS (
    SELECT
      fixture.id,
      fixture."homeTeam",
      fixture."awayTeam"
    FROM
      fixture
      JOIN season ON season.name LIKE ?
      AND fixture.date > season."startDate"
      AND fixture.date < season."endDate"
  ),
  seasonFixtureGame AS (
    SELECT
      game.id,
      game."homePlayer1",
      game."homePlayer2",
      game."awayPlayer1",
      game."awayPlayer2",
      game."homeScore",
      game."awayScore",
      game.fixture,
      seasonFixture."homeTeam",
      seasonFixture."awayTeam"
    FROM
      seasonFixture
      JOIN game ON game.fixture = seasonFixture.id
      AND (
        game."homePlayer1" != 0
        OR game."homePlayer2" != 0
        OR game."awayPlayer1" != 0
        OR game."awayPlayer2" != 0
      )
  ),
  gameTypeGender AS (
    SELECT
      seasonFixtureGame.*,
      CASE
        WHEN homePlayer1.gender = homePlayer2.gender
        AND homePlayer1.gender = 'Male' THEN 'Mens'
        WHEN homePlayer1.gender = homePlayer2.gender
        AND homePlayer1.gender = 'Female' THEN 'Ladies'
        ELSE 'Mixed'
      END AS "gameType",
      homePlayer1.gender AS playergender
    FROM
      seasonFixtureGame
      JOIN player${ season } homePlayer1 ON seasonFixtureGame."homePlayer1" = homePlayer1.id
      AND seasonFixtureGame."homePlayer1" != 0
      JOIN player${ season } homePlayer2 ON seasonFixtureGame."homePlayer2" = homePlayer2.id
      AND seasonFixtureGame."homePlayer2" != 0
  ),
  PairsgameSummary AS (
    SELECT
      gameTypeGender.id,
      LEAST(gameTypeGender."homePlayer1", gameTypeGender."homePlayer2") AS player1id,
      GREATEST(gameTypeGender."homePlayer1", gameTypeGender."homePlayer2") AS player2id,
      gameTypeGender."homeScore" AS forpoints,
      gameTypeGender."awayScore" AS againstpoints,
      CASE
        WHEN gameTypeGender."homeScore" > gameTypeGender."awayScore" THEN 1
        ELSE 0
      END AS gameswon,
      CASE
        WHEN gameTypeGender."homeScore" IS NOT NULL THEN 1
        ELSE 0
      END AS gamesplayed,
      gameTypeGender.fixture,
      gameTypeGender."homeTeam" AS team,
      gameTypeGender."awayTeam" AS opposition,
      gameTypeGender."gameType",
      team.division
    FROM
      gameTypeGender
      JOIN team${ season } team ON "homeTeam" = team.id
    UNION ALL
    SELECT
      gameTypeGender.id,
      LEAST(gameTypeGender."awayPlayer1", gameTypeGender."awayPlayer2") AS player1id,
      GREATEST(gameTypeGender."awayPlayer2", gameTypeGender."awayPlayer1") AS player2id,
      gameTypeGender."awayScore" AS forpoints,
      gameTypeGender."homeScore" AS againstpoints,
      CASE
        WHEN gameTypeGender."awayScore" > gameTypeGender."homeScore" THEN 1
        ELSE 0
      END AS gameswon,
      CASE
        WHEN gameTypeGender."homeScore" IS NOT NULL THEN 1
        ELSE 0
      END AS gamesplayed,
      gameTypeGender.fixture,
      gameTypeGender."awayTeam" AS team,
      gameTypeGender."homeTeam" AS opposition,
      gameTypeGender."gameType",
      team.division
    FROM
      gameTypeGender
      JOIN team${ season } team ON "homeTeam" = team.id
  )
SELECT
  CONCAT(Player1.first_name,' ',Player1.family_name,' & ',Player2.first_name,' ',Player2.family_name) AS "Pairing",
  player1Id,
  player2Id,
  ${ (searchObj.season === undefined || !checkSeason(searchObj.season)) ? '(Player1.rating + Player2.rating) / 2 AS "pairRating",' : ''}
  SUM(forPoints) AS "forPoints",
  SUM(againstPoints) AS "againstPoints",
  SUM(gamesWon) AS "gamesWon",
  SUM(gamesPlayed) AS "gamesPlayed",
  SUM(gamesWon) / SUM(gamesPlayed) AS "winRate",
  (SUM(gamesWon) + SUM(gamesPlayed)) - (SUM(gamesPlayed) - SUM(gamesWon)) AS "Points",
  club.name AS "clubName",
  MIN(team.name) AS "teamName",
  "gameType"
FROM
  (SELECT * FROM PairsgameSummary) AS a
  JOIN player${ season } Player1 ON Player1.id = a.player1Id
  JOIN player${ season } Player2 ON Player2.id = a.player2Id
  JOIN team${ season } team ON team.id = a.team
  ${ (searchObj.division !== undefined) ? 'AND team.division = ' + searchObj.division : ''}
  ${ (searchObj.team !== undefined) ? "AND team.name LIKE '" + searchObj.team + "'" : "AND team.name LIKE '%'"}
  JOIN club club ON club.id = Player1.club
  ${ (searchObj.club !== undefined) ? "AND club.name LIKE '" + searchObj.club + "'" : "AND club.name LIKE '%'"}
  ${ (searchObj.gameType !== undefined) ? "AND \"gameType\" LIKE '" + searchObj.gameType + "'" : "AND \"gameType\" LIKE '%'"}
GROUP BY
  "Pairing",
  player1Id,
  player2Id,
  "clubName",
  ${ (searchObj.season === undefined || !checkSeason(searchObj.season)) ? '"pairRating",' : ''}
  "gameType"
ORDER BY
  "winRate" DESC,
  "Points" DESC`

  const [result] = await (await db.otherConnect()).query(sql, whereValue)
  return result
}

// Site-wide role/messerAdmin lookup by login email, for the Auth0Strategy
// verify callback (app.js) to enrich req.user at login time. Scoped to only
// rows that could plausibly have a role so the decrypt stays cheap on every
// login — this is not a full-roster scan, it's bounded by how many admins
// the league ever has (currently ~150 of 1104 players). Matches against
// EITHER "authEmail" (the login identity, see migrations/009) or the older
// "playerEmail" (contact email) — a player's login email is often not their
// registered contact email, so relying on playerEmail alone misses most
// admins (confirmed live: 82 of 151 during the initial backfill).
exports.getAuthRoleByEmail = async function(email) {
  const [result] = await (await db.otherConnect()).query(
    `SELECT player.id, player.first_name, player.family_name, player.role, player."messerAdmin", club.name AS "clubName"
     FROM player JOIN club ON club.id = player.club
     WHERE (player.role IS NOT NULL OR player."messerAdmin" = 1)
       AND (
         (player."authEmail" IS NOT NULL AND LOWER(pgp_sym_decrypt(player."authEmail", ?)::text) = LOWER(?))
         OR (player."playerEmail" IS NOT NULL AND LOWER(pgp_sym_decrypt(player."playerEmail", ?)::text) = LOWER(?))
       )`,
    [process.env.DB_PI_KEY, email, process.env.DB_PI_KEY, email]
  )
  return result[0]
}

// Used by the superadmin-gated fields on the player edit form, and by the
// auth-role backfill script. authEmail is only touched when explicitly
// provided, so ordinary player-edit calls (which don't know about it) never
// clear an existing value.
//
// Approving a signup also seeds "playerEmail" **when the player has none**.
// The two columns are deliberately separate — authEmail is the login identity,
// playerEmail the contact address a player can edit — but a player added to a
// roster by their captain has no contact email at all, and nothing else ever
// fills it in. So a newly signed-up player could log in, hold a real address in
// authEmail, and still show a blank email on their own profile form and on their
// club's contact page, which read playerEmail (Chris Petty, Alderley Park B).
// A player who already has a contact email keeps it: the COALESCE/NULLIF guard
// makes this an initialisation, never an overwrite.
exports.setAuthRole = async function(playerId, { role, messerAdmin, authEmail }) {
  if (authEmail) {
    const [result] = await (await db.otherConnect()).query(
      `UPDATE player SET
         role = ?,
         "messerAdmin" = ?,
         "authEmail" = pgp_sym_encrypt(?, ?),
         "playerEmail" = CASE
           WHEN COALESCE(NULLIF(TRIM(pgp_sym_decrypt("playerEmail", ?)::text), ''), '') = ''
             THEN pgp_sym_encrypt(?, ?)
           ELSE "playerEmail"
         END
       WHERE id = ?`,
      [
        role || null, messerAdmin ? 1 : 0,
        authEmail, process.env.DB_PI_KEY,
        process.env.DB_PI_KEY,
        authEmail, process.env.DB_PI_KEY,
        playerId
      ]
    )
    return result
  }
  const [result] = await (await db.otherConnect()).query(
    'UPDATE player SET role = ?, "messerAdmin" = ? WHERE id = ?',
    [role || null, messerAdmin ? 1 : 0, playerId]
  )
  return result
}

exports.getEmails = async function(searchTerms) {
  const key = process.env.DB_PI_KEY
  var sql = "SELECT DISTINCT b.\"playerEmail\" FROM (SELECT a.*, pgp_sym_decrypt(player.\"playerEmail\", ?)::text AS \"playerEmail\" FROM (SELECT club.id, club.name AS clubname, team.id AS teamid, team.name AS teamname, club.\"matchSec\", club.\"clubSec\", team.captain, team.division, 'match Sec' AS role FROM club JOIN team ON team.club = club.id) AS a JOIN player ON a.\"matchSec\" = player.id OR (player.\"matchSecrertary\" = 1 AND a.id = player.club) UNION ALL SELECT a.*, pgp_sym_decrypt(player.\"playerEmail\", ?)::text AS \"playerEmail\" FROM (SELECT club.id, club.name AS clubname, team.id AS teamid, team.name AS teamname, club.\"matchSec\", club.\"clubSec\", team.captain, team.division, 'club Sec' AS role FROM club JOIN team ON team.club = club.id) AS a JOIN player ON a.\"clubSec\" = player.id OR (player.\"clubSecretary\" = 1 AND a.id = player.club) UNION ALL SELECT a.*, pgp_sym_decrypt(player.\"playerEmail\", ?)::text AS \"playerEmail\" FROM (SELECT club.id, club.name AS clubname, team.id AS teamid, team.name AS teamname, club.\"matchSec\", club.\"clubSec\", team.captain, team.division, 'team Captain' AS role FROM club JOIN team ON team.club = club.id) AS a JOIN player ON (player.\"teamCaptain\" = 1 AND a.teamId = player.team) OR a.captain = player.id UNION ALL SELECT a.*, pgp_sym_decrypt(player.\"playerEmail\", ?)::text AS \"playerEmail\" FROM (SELECT club.id, club.name AS clubname, team.id AS teamid, team.name AS teamname, club.\"matchSec\", club.\"clubSec\", team.captain, team.division, 'treasurer' AS role FROM club JOIN team ON team.club = club.id) AS a JOIN player ON (player.treasurer = 1 AND a.teamId = player.team) UNION ALL SELECT a.*, pgp_sym_decrypt(player.\"playerEmail\", ?)::text AS \"playerEmail\" FROM (SELECT club.id, club.name AS clubname, team.id AS teamid, team.name AS teamname, club.\"matchSec\", club.\"clubSec\", team.captain, team.division, 'otherComms' AS role FROM club JOIN team ON team.club = club.id) AS a JOIN player ON (player.\"otherComms\" = 1 AND a.teamId = player.team)) AS b"
  // One bind per UNION branch, in the order the placeholders appear, then one per WHERE
  // term. The key used to be pasted in as a string literal five times, which put it in the
  // query TEXT — and so into anything that writes a statement down: the console.log that
  // used to sit below this line (Cloud Logging, on every distribution-list send), a
  // slow-query log, the message of a failed query.
  const params = [key, key, key, key, key];

  var whereTerms = [];
  if (searchTerms.role) { whereTerms.push('b.role = ?'); params.push(searchTerms.role) }
  if (searchTerms.division) { whereTerms.push('b.division = ?'); params.push(searchTerms.division) }
  if (searchTerms.club) { whereTerms.push('b.id = ?'); params.push(searchTerms.club) }
  // b.teamname, not b.teamName. The subquery aliases `team.name AS teamname`, and an
  // unquoted camelCase reference folds to lowercase anyway — so this spelling is what
  // Postgres has always been given. CLAUDE.md's alias rule, applied to a reference.
  if (searchTerms.teamName) { whereTerms.push('b.teamname = ?'); params.push(searchTerms.teamName) }

  if (whereTerms.length > 0) {
    sql = sql + ' WHERE ' + whereTerms.join(' AND ')
  }
  // Logging `sql` would now be harmless — it carries placeholders where the key used to be.
  // It is still not logged: it is 1.5KB of five-way UNION and nothing reads it.
  const [result] = await (await db.otherConnect()).query(sql, params)
  var emailArray = result.map(row => row.playerEmail)
  emailArray = emailArray.filter(email => email && email.indexOf("@") != -1)
  return emailArray
}

exports.search = async function(searchTerms) {
  var sql = 'SELECT * FROM player';
  var whereTerms = [];
  if (searchTerms.teamid) whereTerms.push('team = ' + searchTerms.teamid)
  if (searchTerms.gender) whereTerms.push("gender = '" + searchTerms.gender + "'")
  if (searchTerms.clubid) whereTerms.push('club = ' + searchTerms.clubid)

  if (whereTerms.length > 0) {
    sql = sql + ' WHERE ' + whereTerms.join(' AND ') + ' ORDER BY gender, rank'
  }
  const [result] = await (await db.otherConnect()).query(sql)
  return result
}

exports.findElgiblePlayersFromTeamId = async function(id, gender) {
  const [result] = await (await db.otherConnect()).query(
    'SELECT player.id, player.first_name, player.family_name, b.rank AS teamrank, player.rank AS playerrank FROM (SELECT team.id, team.name, team.rank FROM (SELECT club.id, club.name, team.rank AS originalrank FROM team, club WHERE team.club = club.id AND team.id = ?) AS a JOIN team ON a.id = team.club AND team.rank >= originalRank) AS b JOIN player ON player.team = b.id AND player.gender = ? ORDER BY b.rank ASC, player.rank DESC, player.family_name',
    [id, gender]
  )
  return result
}

exports.findElgiblePlayersFromTeamIdAndSelected = async function(teamName, gender, first, second, third) {
  const [result] = await (await db.otherConnect()).query(
    "SELECT player.id, player.first_name, player.family_name, CASE WHEN LEVENSHTEIN(CONCAT(player.first_name,' ',player.family_name), ?) < 6 THEN TRUE ELSE FALSE END AS first, CASE WHEN LEVENSHTEIN(CONCAT(player.first_name,' ',player.family_name), ?) < 6 THEN TRUE ELSE FALSE END AS second, CASE WHEN LEVENSHTEIN(CONCAT(player.first_name,' ',player.family_name), ?) < 6 THEN TRUE ELSE FALSE END AS third FROM (SELECT team.id, team.name, team.rank FROM (SELECT club.id, club.name, team.rank AS originalrank FROM team, club WHERE team.club = club.id AND LEVENSHTEIN(team.name,?) < 1) AS a JOIN team ON a.id = team.club AND team.rank >= originalRank) AS b JOIN player ON player.team = b.id AND player.gender = ?",
    [first, second, third, teamName, gender]
  )
  return result
}

exports.getEligiblePlayersAndSelectedById = async function(first, second, third, teamId, gender) {
  const [result] = await (await db.otherConnect()).query(
    'SELECT player.id, player.first_name, player.family_name, CASE WHEN player.id = ? THEN 1 ELSE 0 END AS first, CASE WHEN player.id = ? THEN 1 ELSE 0 END AS second, CASE WHEN player.id = ? THEN 1 ELSE 0 END AS third FROM (SELECT team.id, team.name, team.rank FROM (SELECT club.id, club.name, team.rank AS originalrank FROM team, club WHERE team.club = club.id AND team.id = ?) AS a JOIN team ON a.id = team.club AND team.rank >= originalRank) AS b JOIN player ON player.team = b.id AND player.gender = ?',
    [first, second, third, teamId, gender]
  )
  return result
}

exports.findElgiblePlayersFromTeamNameAndSelectedSansLevenshtein = async function(teamName, gender, first, second, third) {
  const [rows] = await (await db.otherConnect()).query(
    'SELECT player.id, player.first_name, player.family_name FROM (SELECT team.id, team.name, team.rank FROM (SELECT club.id, club.name, team.rank AS originalrank FROM team, club WHERE team.club = club.id AND team.name LIKE ?) AS a JOIN team ON a.id = team.club AND team.rank >= originalRank) AS b JOIN player ON player.team = b.id AND player.gender = ?',
    [teamName, gender]
  )

  rows[0].first = 1;
  rows[0].second = 1;
  rows[0].third = 1;
  let lowestFirstIndex = [0, levenshtein(rows[0].first_name + " " + rows[0].family_name, first)];
  let lowestSecondIndex = [0, levenshtein(rows[0].first_name + " " + rows[0].family_name, second)];
  let lowestThirdIndex = [0, levenshtein(rows[0].first_name + " " + rows[0].family_name, third)]
  for (let i = 1; i < rows.length; i++) {
    rowFirstLevenshtein = levenshtein(rows[i].first_name + " " + rows[i].family_name, first);
    rowSecondLevenshtein = levenshtein(rows[i].first_name + " " + rows[i].family_name, second);
    rowThirdLevenshtein = levenshtein(rows[i].first_name + " " + rows[i].family_name, third);
    if (lowestFirstIndex[1] > rowFirstLevenshtein) {
      rows[lowestFirstIndex[0]].first = 0;
      rows[i].first = 1;
      lowestFirstIndex[0] = i;
      lowestFirstIndex[1] = rowFirstLevenshtein;
    } else {
      rows[i].first = 0;
    }
    if (lowestSecondIndex[1] > rowSecondLevenshtein) {
      rows[lowestSecondIndex[0]].second = 0;
      rows[i].second = 1;
      lowestSecondIndex[0] = i;
      lowestSecondIndex[1] = rowSecondLevenshtein;
    } else {
      rows[i].second = 0;
    }
    if (lowestThirdIndex[1] > rowThirdLevenshtein) {
      rows[lowestThirdIndex[0]].third = 0;
      rows[i].third = 1;
      lowestThirdIndex[0] = i;
      lowestThirdIndex[1] = rowThirdLevenshtein;
    } else {
      rows[i].third = 0;
    }
  }
  return rows
}

exports.findElgiblePlayersFromTeamIdAndSelectedNew = async function(teamName, gender, first, second, third) {
  const [result] = await (await db.otherConnect()).query(
    "SELECT player.id, player.first_name, player.family_name, LEVENSHTEIN(CONCAT(player.first_name,' ',player.family_name), ?) AS first, LEVENSHTEIN(CONCAT(player.first_name,' ',player.family_name), ?) AS second, LEVENSHTEIN(CONCAT(player.first_name,' ',player.family_name), ?) AS third, (LEVENSHTEIN(CONCAT(player.first_name,' ',player.family_name),?) + LEVENSHTEIN(CONCAT(player.first_name,' ',player.family_name),?) + LEVENSHTEIN(CONCAT(player.first_name,' ',player.family_name),?)) AS totallev FROM (SELECT team.id, team.name, team.rank FROM (SELECT club.id, club.name, team.rank AS originalrank FROM team, club WHERE team.club = club.id AND LEVENSHTEIN(team.name, ?) < 1) AS a JOIN team ON a.id = team.club AND team.rank >= originalRank) AS b JOIN player ON player.team = b.id AND player.gender = ? ORDER BY totalLev ASC, first ASC, second ASC, third ASC",
    [first, second, third, first, second, third, teamName, gender]
  )
  return result
}

exports.count = async function(searchTerm) {
  if (searchTerm == "") {
    const [result] = await (await db.otherConnect()).query('SELECT COUNT(*) AS players FROM player')
    return result
  } else {
    const [result] = await (await db.otherConnect()).query('SELECT COUNT(*) AS players FROM player WHERE gender = ?', searchTerm)
    return result
  }
}

exports.getByName = async function(playerName) {
  const [result] = await (await db.otherConnect()).query(
    "SELECT * FROM player WHERE LEVENSHTEIN(CONCAT(first_name,' ',family_name), ?) < 4",
    playerName
  )
  return result
}

exports.getByNameAndTeam = async function(playerName, teamId, distance) {
  const [result] = await (await db.otherConnect()).query(
    "SELECT * FROM (SELECT player.id AS playerid, CONCAT(first_name,' ',family_name) AS playername, team.id AS teamid, team.name AS teamname FROM player JOIN team ON player.team = team.id) AS playerclub WHERE teamId=? AND LEVENSHTEIN(playerName,?) < ?",
    [teamId, playerName, distance]
  )
  return result
}

exports.getById = async function(playerId) {
  const [result] = await (await db.otherConnect()).query(
    "SELECT id, first_name, family_name, gender, pgp_sym_decrypt(\"playerEmail\", ?)::text AS \"playerEmail\", pgp_sym_decrypt(\"playerTel\", ?)::text AS \"playerTel\", \"teamCaptain\", \"clubSecretary\", \"matchSecrertary\", treasurer, \"otherComms\", junior, role, \"messerAdmin\" FROM player WHERE id = ?",
    // Two binds: "playerEmail" then "playerTel", then the id.
    [process.env.DB_PI_KEY, process.env.DB_PI_KEY, playerId]
  )
  return result
}

exports.getPlayerClubandTeamById = async function(playerId) {
  const [result] = await (await db.otherConnect()).query(
    "SELECT playerId AS \"playerId\", playerName AS \"playerName\", clubName AS \"clubName\", team.name AS \"teamName\", date_of_registration FROM (SELECT playerId, playerName, club.name AS clubname, teamId, date_of_registration FROM (SELECT player.id AS playerid, CONCAT(player.first_name,' ',player.family_name) AS playername, player.club AS clubid, player.team AS teamid, player.date_of_registration FROM player WHERE id = ?) AS a JOIN club ON clubId = club.id) AS b JOIN team ON teamId = team.id",
    [playerId]
  )
  return result
}

exports.findByName = async function(searchObject) {
  const [result] = await (await db.otherConnect()).query(
    'SELECT * FROM player WHERE id = ?',
    searchObject
  )
  return result
}

exports.deleteById = async function(playerId) {
  const [result] = await (await db.otherConnect()).query(
    'DELETE FROM player WHERE id = ?',
    playerId
  )
  return result
}

// The ELO of the player in a given slot of a game row. Shared by the two queries below
// so the four-way CASE is written once.
const SLOT_END = (pid) => `CASE
    WHEN g."homePlayer1" = ${pid} THEN g."homePlayer1End"
    WHEN g."homePlayer2" = ${pid} THEN g."homePlayer2End"
    WHEN g."awayPlayer1" = ${pid} THEN g."awayPlayer1End"
    WHEN g."awayPlayer2" = ${pid} THEN g."awayPlayer2End"
  END`

// Each player's division rank IN A GIVEN SEASON: { [playerId]: rank }.
//
// This is the "registered division" the ELO reserving adjustment compares against the
// fixture's division, so it has to be the division the player was registered in THAT
// season. It used to be read from the live player/team/division tables, which meant a
// backfill applied today's teams to every season back to 2018 — 268 of the 387 players
// in 2021/22 are registered in a different division now. The season archives
// (player20212022 and friends) hold the answer.
//
// A player with no team that season is simply absent; callers fall back to the
// fixture's own rank, which makes the adjustment zero rather than inventing one.
// Seasons before 2018/19 have no player archive (and no game rows), so they return {}.
exports.getSeasonRanks = async function(season, playerIds) {
  const current = !season || season === seasonModel.current()
  const suffix = current ? '' : seasonModel.assertName(season)
  const conn = await db.otherConnect()
  if (!current) {
    const [exists] = await conn.query('SELECT to_regclass(?) AS t', [`player${suffix}`])
    if (!exists[0].t) return {}
  }
  let ids = null
  if (playerIds) {
    ids = playerIds.map(n => parseInt(n, 10)).filter(n => n > 0)
    if (ids.length === 0) return {}
  }
  const [rows] = await conn.query(
    `SELECT p.id, d.rank
     FROM player${suffix} p
     JOIN team${suffix} t ON t.id = p.team
     JOIN division${suffix} d ON d.id = t.division
     ${ids ? 'WHERE p.id = ANY(?::int[])' : ''}`,
    ids ? [ids] : []
  )
  return Object.fromEntries(rows.map(r => [r.id, r.rank]))
}

// Each player's rating going into a fixture on `endDate`: their latest rated game
// before it, else 1500. Fills in { rating, date, rank } on every entry of
// fixturePlayers and returns it.
//
// opts.season       whose registration decides `rank` (undefined = current season)
// opts.fallbackRank rank for a player with no team that season — pass the fixture's
//                   own rank so the reserving adjustment comes out as zero
//
// Two things this used to get wrong, both silently:
//  - rank came from the player's CURRENT team whatever the date (see getSeasonRanks),
//    and defaulted to 1 — Premier — for anyone without one;
//  - the latest game was chosen first and filtered on `rating > 0` second, so a player
//    whose most recent game was unrated (a void fixture, a walkover) went back to 1500.
//    The filter is inside the ordering now, so an unrated game is skipped, not fatal.
exports.getPrevRating = async function(endDate, fixturePlayers, opts = {}) {
  const playerArray = Object.entries(fixturePlayers)
  const ids = playerArray.map(([id]) => parseInt(id, 10)).filter(n => n > 0)

  const found = {}
  if (ids.length > 0) {
    const sql = ids.map(() => `(SELECT ?::int AS "playerId", rating, date FROM (
  SELECT ${SLOT_END('?')} AS rating, f.date, g.id AS gid
  FROM game g JOIN fixture f ON g.fixture = f.id
  WHERE ? IN (g."homePlayer1", g."homePlayer2", g."awayPlayer1", g."awayPlayer2")
    AND f.status = 'complete'
    AND f.date < ?
) a WHERE rating > 0 ORDER BY date DESC, gid DESC LIMIT 1)`).join(' UNION ALL ')
    const params = ids.flatMap(id => [id, id, id, id, id, id, endDate])
    const [rows] = await (await db.otherConnect()).query(sql, params)
    for (const r of rows) found[r.playerId] = r
  }

  const ranks = (await exports.getSeasonRanks(opts.season, ids)) || {}
  const fallbackRank = opts.fallbackRank !== undefined ? opts.fallbackRank : 1

  for (const [id, player] of playerArray) {
    const prev = found[id]
    player.rating = prev ? prev.rating : 1500
    player.date = prev ? prev.date : '2020-01-01 00:00:00'
    player.rank = ranks[id] !== undefined ? ranks[id] : fallbackRank
  }
  return Object.fromEntries(playerArray)
}

// Sets player.rating to each player's latest rated game, read back from `game`.
//
// The publish path computed every game's ELO and never wrote the player's rating, so
// `player.rating` — what /player-stats shows — was only ever as fresh as the last
// backfill: new players were blank and 118 others were out of date (Sep 2026). Reading
// it back from the games rather than carrying the in-memory value means a late
// scorecard for an older fixture cannot overwrite a newer rating. `conn` lets the
// caller do this inside the transaction that wrote the games.
exports.refreshRatings = async function(playerIds, conn) {
  const ids = (playerIds || []).map(n => parseInt(n, 10)).filter(n => n > 0)
  if (ids.length === 0) return
  const c = conn || await db.otherConnect()
  await c.query(
    `UPDATE player SET rating = COALESCE((
       SELECT ${SLOT_END('player.id')}
       FROM game g JOIN fixture f ON f.id = g.fixture
       WHERE player.id IN (g."homePlayer1", g."homePlayer2", g."awayPlayer1", g."awayPlayer2")
         AND f.status = 'complete'
         AND ${SLOT_END('player.id')} > 0
       ORDER BY f.date DESC, g.id DESC
       LIMIT 1
     ), rating)
     WHERE id = ANY(?::int[])`,
    [ids]
  )
}

// Returns ELO rating time-series for one or more player IDs.
// Crosses season boundaries — used by the ELO chart pages.
exports.getPlayerEloTimeSeries = async function(playerIds) {
  if (!playerIds || playerIds.length === 0) return []

  const numIds = playerIds.map(id => id * 1)

  // One batched query for every requested player instead of one query each —
  // the game table has no index on the player-id columns, so per-player
  // queries scale linearly with player count; a single ANY(?) scan doesn't.
  const [rows] = await (await db.otherConnect()).query(`
    SELECT
      fixture.date,
      game."homePlayer1", game."homePlayer2", game."awayPlayer1", game."awayPlayer2",
      game."homePlayer1End", game."homePlayer2End", game."awayPlayer1End", game."awayPlayer2End"
    FROM game
    JOIN fixture ON game.fixture = fixture.id
    WHERE (game."homePlayer1" = ANY(?) OR game."homePlayer2" = ANY(?) OR game."awayPlayer1" = ANY(?) OR game."awayPlayer2" = ANY(?))
      AND game."homePlayer1End" IS NOT NULL AND game."homePlayer1End" != 0
      AND game."homePlayer2End" IS NOT NULL AND game."homePlayer2End" != 0
      AND game."awayPlayer1End" IS NOT NULL AND game."awayPlayer1End" != 0
      AND game."awayPlayer2End" IS NOT NULL AND game."awayPlayer2End" != 0
    ORDER BY fixture.date ASC, game.id ASC
  `, [numIds, numIds, numIds, numIds])

  const [nameRows] = await (await db.otherConnect()).query(
    `SELECT id, CONCAT(first_name, ' ', family_name) AS name FROM player WHERE id = ANY(?)`, [numIds]
  )
  const nameById = {}
  nameRows.forEach(r => { nameById[r.id] = r.name })

  // One point per fixture date per player (rows ordered ASC by date, id — last game wins)
  const byDateByPlayer = {}
  numIds.forEach(id => { byDateByPlayer[id] = {} })
  const slots = [
    ['homePlayer1', 'homePlayer1End'],
    ['homePlayer2', 'homePlayer2End'],
    ['awayPlayer1', 'awayPlayer1End'],
    ['awayPlayer2', 'awayPlayer2End'],
  ]
  rows.forEach(row => {
    slots.forEach(([idKey, endKey]) => {
      const pid = row[idKey]
      if (pid != null && byDateByPlayer[pid] !== undefined && row[endKey] != null && row[endKey] > 0) {
        byDateByPlayer[pid][new Date(row.date).toISOString().slice(0, 10)] = parseInt(row[endKey])
      }
    })
  })

  return numIds.map(id => ({
    id,
    name: nameById[id] || `Player ${id}`,
    data: Object.entries(byDateByPlayer[id]).map(([x, y]) => ({ x, y }))
  }))
}

// Name-fragment search, optionally narrowed by the same division/club/team/
// gender filters used on /player-stats — used by the ELO comparison page.
// The stored names are not clean: 378 of 1107 player rows carry leading or
// trailing whitespace, nearly always a space in front of family_name (" Petty",
// " Roach", " Kainth"). Concatenating first and family straight out of the column
// therefore yields "Chris  Petty" with two spaces, and a LIKE for the "Chris
// Petty" a human types matches nothing — a third of the league was unfindable by
// full name while still being findable by surname alone, which is a maddening way
// for a search to fail. Both sides are whitespace-normalised so the comparison is
// about the name rather than about how it happened to be typed in.
const SEARCH_NAME = `regexp_replace(TRIM(COALESCE(player.first_name, '') || ' ' || COALESCE(player.family_name, '')), '\\s+', ' ', 'g')`

// The name is matched in JavaScript by utils/nameMatch.js, not with LIKE: a LIKE finds
// someone only if the text typed is a literal slice of the text stored, so "Mary
// Whitle" could not find "Marry Whitle" — and on the signup-approval page, a player who
// cannot be found gets a second record. The SQL applies only the filters; with no name
// the filtered list is returned as it was, alphabetically and capped.
exports.searchPlayers = async function(query, filters = {}) {
  const whereClauses = []
  const params = []
  // Collapse the caller's spacing too, so "Chris  Petty" and " chris petty " work.
  const term = (query || '').trim().replace(/\s+/g, ' ')

  if (filters.division) { whereClauses.push('division.name = ?'); params.push(filters.division) }
  if (filters.club) { whereClauses.push('club.name = ?'); params.push(filters.club) }
  if (filters.team) { whereClauses.push('team.name = ?'); params.push(filters.team) }
  if (filters.gender) { whereClauses.push('player.gender = ?'); params.push(filters.gender) }

  // LEFT JOINs. These were INNER, and club/division contribute nothing to the
  // output — they exist only so the optional filters have something to match — so
  // an unrelated gap in either silently removed a player from the results. It did:
  // team 52 "No Team", where released players are parked, has division 0, which is
  // not a division that exists, so the division join alone hid 490 players. A
  // returning member who had been released could not be found at all. The filters
  // still filter: an equality test in WHERE fails against a NULL from a LEFT JOIN.
  const [result] = await (await db.otherConnect()).query(
    `SELECT player.id,
            ${SEARCH_NAME} AS name,
            team.name AS "teamName"
     FROM player
     LEFT JOIN team ON team.id = player.team
     LEFT JOIN club ON club.id = team.club
     LEFT JOIN division ON division.id = team.division
     ${whereClauses.length ? 'WHERE ' + whereClauses.join(' AND ') : ''}
     ORDER BY TRIM(COALESCE(player.family_name, '')), TRIM(COALESCE(player.first_name, ''))
     ${term ? '' : 'LIMIT 20'}`,
    params
  )
  return term ? rankByName(result, term, r => r.name, 20) : result
}
