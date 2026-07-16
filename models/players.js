var db = require('../db_connect.js');
var seasonModel = require("./season");
const levenshtein = require('js-levenshtein');


// POST
exports.create = async function(first_name, family_name, team, club, gender) {
  var date_of_registration = new Date();
  const [result] = await (await db.otherConnect()).query(
    'INSERT INTO player (first_name,family_name,date_of_registration,team,club,gender) VALUES (?,?,?,?,?,?)',
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

exports.updateBulk = async function(BatchObj) {
  if (!db.isObject(BatchObj)) throw new Error('not object')
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
        setClauses.push(`"${BatchObj.fields[y]}" = pgp_sym_encrypt(?, '${process.env.DB_PI_KEY}')`)
        params.push(String(row[y]))
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

exports.getMissedThreePlayers = async function() {
  const [result] = await (await db.otherConnect()).query(`WITH team_fixtures AS (
  SELECT
    f.id        AS fixture_id,
    f.date      AS fixture_date,
    f."homeTeam"  AS team_id,
    f."homeMan1"  AS p1, f."homeMan2" AS p2, f."homeMan3" AS p3,
    f."homeLady1" AS p4, f."homeLady2" AS p5, f."homeLady3" AS p6
  FROM fixture f
  WHERE f.status = 'complete'

  UNION ALL

  SELECT
    f.id,
    f.date,
    f."awayTeam",
    f."awayMan1",  f."awayMan2",  f."awayMan3",
    f."awayLady1", f."awayLady2", f."awayLady3"
  FROM fixture f
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
men_used AS (
  SELECT
    m.team_id,
    COUNT(DISTINCT m.player_id) AS menDistinctUsed
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
    COUNT(DISTINCT l.player_id) AS ladiesDistinctUsed
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
    COUNT(DISTINCT fixture_id) AS numPlayed
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
  WHERE p."rank" < 99
),
team_filtered AS (
  SELECT
    t.*,
    COUNT(*) OVER (PARTITION BY t.club) AS club_team_count,
    MAX(t."rank") OVER (PARTITION BY t.club) AS club_lowest_rank
  FROM team t
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
  COALESCE(a.numPlayed, 0) AS "numPlayed"
FROM team_filtered t
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
ORDER BY t.club, t."rank", np.family_name, np.first_name;`)
  return result
}

exports.getMatchStats = async function(fixtureId) {
  const [result] = await (await db.otherConnect()).query(
    "SELECT CONCAT(player.first_name,' ',player.family_name) AS name, team.name AS \"teamName\", b.\"avgPtsFor\", b.\"avgPtsAgainst\", \"gamesWon\" FROM ( SELECT playerId, AVG(ptsFor) AS \"avgPtsFor\", AVG(ptsAgainst) AS \"avgPtsAgainst\", SUM(won) AS \"gamesWon\" FROM ( SELECT \"homePlayer1\" AS playerId, \"homeScore\" AS ptsFor, \"awayScore\" AS ptsAgainst, CASE WHEN \"homeScore\" > \"awayScore\" THEN 1 ELSE 0 END AS won FROM game WHERE fixture = ? AND (\"awayPlayer1\" !=0 AND \"awayPlayer2\" != 0 AND \"homePlayer2\" != 0 AND \"homePlayer1\" !=0) UNION ALL SELECT \"homePlayer2\" AS playerId, \"homeScore\" AS ptsFor, \"awayScore\" AS ptsAgainst, CASE WHEN \"homeScore\" > \"awayScore\" THEN 1 ELSE 0 END AS won FROM game WHERE fixture = ? AND (\"awayPlayer1\" !=0 AND \"awayPlayer2\" != 0 AND \"homePlayer2\" != 0 AND \"homePlayer1\" !=0) UNION ALL SELECT \"awayPlayer1\" AS playerId, \"awayScore\" AS ptsFor, \"homeScore\" AS ptsAgainst, CASE WHEN \"homeScore\" < \"awayScore\" THEN 1 ELSE 0 END AS won FROM game WHERE fixture = ? AND (\"awayPlayer1\" !=0 AND \"awayPlayer2\" != 0 AND \"homePlayer2\" != 0 AND \"homePlayer1\" !=0) UNION ALL SELECT \"awayPlayer2\" AS playerId, \"awayScore\" AS ptsFor, \"homeScore\" AS ptsAgainst, CASE WHEN \"homeScore\" < \"awayScore\" THEN 1 ELSE 0 END AS won FROM game WHERE fixture = ? AND (\"awayPlayer1\" !=0 AND \"awayPlayer2\" != 0 AND \"homePlayer2\" != 0 AND \"homePlayer1\" !=0) ) AS a GROUP BY playerId ) AS b JOIN player ON b.playerId = player.id JOIN team ON player.team = team.id ORDER BY \"teamName\", \"gamesWon\" DESC, \"avgPtsAgainst\" ASC",
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
  let sql = `WITH playerGames AS (SELECT game.*, fixture.date, homeTeam.name AS homeTeamName, homeTeam.rank AS homeTeamRank, awayTeam.name AS awayTeamName, awayTeam.rank AS awayTeamRank FROM game
JOIN fixture ON game.fixture = fixture.id
JOIN team homeTeam ON fixture."homeTeam" = homeTeam.id
JOIN team awayTeam ON fixture."awayTeam" = awayTeam.id
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
  END AS teamName,
  CASE WHEN "homePlayer1" = ? THEN homeTeamRank
  WHEN "homePlayer2" = ? THEN homeTeamRank
  WHEN "awayPlayer1" = ? THEN awayTeamRank
  WHEN "awayPlayer2" = ? THEN awayTeamRank
  END AS teamRank,
  CASE WHEN "homePlayer1" = ? THEN "homePlayer1"
  WHEN "homePlayer2" = ? THEN "homePlayer2"
  WHEN "awayPlayer1" = ? THEN "awayPlayer1"
  WHEN "awayPlayer2" = ? THEN "awayPlayer2"
  END AS playerName,
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
  END AS vsScore,
  "gameType",
  CASE WHEN "homePlayer1" = ? THEN "homePlayer1Start"
  WHEN "homePlayer2" = ? THEN "homePlayer2Start"
  WHEN "awayPlayer1" = ? THEN "awayPlayer1Start"
  WHEN "awayPlayer2" = ? THEN "awayPlayer2Start"
  END AS beforeVal,
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
      gameTypeGender."homeScore" AS forPoints,
      gameTypeGender."awayScore" AS againstPoints,
      CASE
        WHEN gameTypeGender."homeScore" > gameTypeGender."awayScore" THEN 1
        ELSE 0
      END AS gamesWon,
      CASE
        WHEN gameTypeGender."homeScore" IS NOT NULL THEN 1
        ELSE 0
      END AS gamesPlayed,
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
      gameTypeGender."homeScore" AS forPoints,
      gameTypeGender."awayScore" AS againstPoints,
      CASE
        WHEN gameTypeGender."homeScore" > gameTypeGender."awayScore" THEN 1
        ELSE 0
      END AS gamesWon,
      CASE
        WHEN gameTypeGender."homeScore" IS NOT NULL THEN 1
        ELSE 0
      END AS gamesPlayed,
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
      gameTypeGender."awayScore" AS forPoints,
      gameTypeGender."homeScore" AS againstPoints,
      CASE
        WHEN gameTypeGender."awayScore" > gameTypeGender."homeScore" THEN 1
        ELSE 0
      END AS gamesWon,
      CASE
        WHEN gameTypeGender."homeScore" IS NOT NULL THEN 1
        ELSE 0
      END AS gamesPlayed,
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
      gameTypeGender."awayScore" AS forPoints,
      gameTypeGender."homeScore" AS againstPoints,
      CASE
        WHEN gameTypeGender."awayScore" > gameTypeGender."homeScore" THEN 1
        ELSE 0
      END AS gamesWon,
      CASE
        WHEN gameTypeGender."homeScore" IS NOT NULL THEN 1
        ELSE 0
      END AS gamesPlayed,
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
      LEAST(gameTypeGender."homePlayer1", gameTypeGender."homePlayer2") AS player1Id,
      GREATEST(gameTypeGender."homePlayer1", gameTypeGender."homePlayer2") AS player2Id,
      gameTypeGender."homeScore" AS forPoints,
      gameTypeGender."awayScore" AS againstPoints,
      CASE
        WHEN gameTypeGender."homeScore" > gameTypeGender."awayScore" THEN 1
        ELSE 0
      END AS gamesWon,
      CASE
        WHEN gameTypeGender."homeScore" IS NOT NULL THEN 1
        ELSE 0
      END AS gamesPlayed,
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
      LEAST(gameTypeGender."awayPlayer1", gameTypeGender."awayPlayer2") AS player1Id,
      GREATEST(gameTypeGender."awayPlayer2", gameTypeGender."awayPlayer1") AS player2Id,
      gameTypeGender."awayScore" AS forPoints,
      gameTypeGender."homeScore" AS againstPoints,
      CASE
        WHEN gameTypeGender."awayScore" > gameTypeGender."homeScore" THEN 1
        ELSE 0
      END AS gamesWon,
      CASE
        WHEN gameTypeGender."homeScore" IS NOT NULL THEN 1
        ELSE 0
      END AS gamesPlayed,
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

exports.getEmails = async function(searchTerms) {
  var sql = "SELECT DISTINCT b.\"playerEmail\" FROM (SELECT a.*, pgp_sym_decrypt(player.\"playerEmail\", '" + process.env.DB_PI_KEY + "')::text AS \"playerEmail\" FROM (SELECT club.id, club.name AS clubName, team.id AS teamId, team.name AS teamName, club.\"matchSec\", club.\"clubSec\", team.captain, team.division, 'match Sec' AS role FROM club JOIN team ON team.club = club.id) AS a JOIN player ON a.\"matchSec\" = player.id OR (player.\"matchSecrertary\" = 1 AND a.id = player.club) UNION ALL SELECT a.*, pgp_sym_decrypt(player.\"playerEmail\", '" + process.env.DB_PI_KEY + "')::text AS \"playerEmail\" FROM (SELECT club.id, club.name AS clubName, team.id AS teamId, team.name AS teamName, club.\"matchSec\", club.\"clubSec\", team.captain, team.division, 'club Sec' AS role FROM club JOIN team ON team.club = club.id) AS a JOIN player ON a.\"clubSec\" = player.id OR (player.\"clubSecretary\" = 1 AND a.id = player.club) UNION ALL SELECT a.*, pgp_sym_decrypt(player.\"playerEmail\", '" + process.env.DB_PI_KEY + "')::text AS \"playerEmail\" FROM (SELECT club.id, club.name AS clubName, team.id AS teamId, team.name AS teamName, club.\"matchSec\", club.\"clubSec\", team.captain, team.division, 'team Captain' AS role FROM club JOIN team ON team.club = club.id) AS a JOIN player ON (player.\"teamCaptain\" = 1 AND a.teamId = player.team) OR a.captain = player.id UNION ALL SELECT a.*, pgp_sym_decrypt(player.\"playerEmail\", '" + process.env.DB_PI_KEY + "')::text AS \"playerEmail\" FROM (SELECT club.id, club.name AS clubName, team.id AS teamId, team.name AS teamName, club.\"matchSec\", club.\"clubSec\", team.captain, team.division, 'treasurer' AS role FROM club JOIN team ON team.club = club.id) AS a JOIN player ON (player.treasurer = 1 AND a.teamId = player.team) UNION ALL SELECT a.*, pgp_sym_decrypt(player.\"playerEmail\", '" + process.env.DB_PI_KEY + "')::text AS \"playerEmail\" FROM (SELECT club.id, club.name AS clubName, team.id AS teamId, team.name AS teamName, club.\"matchSec\", club.\"clubSec\", team.captain, team.division, 'otherComms' AS role FROM club JOIN team ON team.club = club.id) AS a JOIN player ON (player.\"otherComms\" = 1 AND a.teamId = player.team)) AS b"
  var whereTerms = [];
  if (searchTerms.role) whereTerms.push("b.role = '" + searchTerms.role + "'")
  if (searchTerms.division) whereTerms.push('b.division = ' + searchTerms.division)
  if (searchTerms.club) whereTerms.push("b.id = '" + searchTerms.club + "'")
  if (searchTerms.teamName) whereTerms.push("b.teamName = '" + searchTerms.teamName + "'")

  if (whereTerms.length > 0) {
    sql = sql + ' WHERE ' + whereTerms.join(' AND ')
  }
  console.log(sql)
  const [result] = await (await db.otherConnect()).query(sql)
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
    'SELECT player.id, player.first_name, player.family_name, b.rank AS teamRank, player.rank AS playerRank FROM (SELECT team.id, team.name, team.rank FROM (SELECT club.id, club.name, team.rank AS originalRank FROM team, club WHERE team.club = club.id AND team.id = ?) AS a JOIN team ON a.id = team.club AND team.rank >= originalRank) AS b JOIN player ON player.team = b.id AND player.gender = ? ORDER BY b.rank ASC, player.rank DESC, player.family_name',
    [id, gender]
  )
  return result
}

exports.findElgiblePlayersFromTeamIdAndSelected = async function(teamName, gender, first, second, third) {
  const [result] = await (await db.otherConnect()).query(
    "SELECT player.id, player.first_name, player.family_name, CASE WHEN LEVENSHTEIN(CONCAT(player.first_name,' ',player.family_name), ?) < 6 THEN TRUE ELSE FALSE END AS first, CASE WHEN LEVENSHTEIN(CONCAT(player.first_name,' ',player.family_name), ?) < 6 THEN TRUE ELSE FALSE END AS second, CASE WHEN LEVENSHTEIN(CONCAT(player.first_name,' ',player.family_name), ?) < 6 THEN TRUE ELSE FALSE END AS third FROM (SELECT team.id, team.name, team.rank FROM (SELECT club.id, club.name, team.rank AS originalRank FROM team, club WHERE team.club = club.id AND LEVENSHTEIN(team.name,?) < 1) AS a JOIN team ON a.id = team.club AND team.rank >= originalRank) AS b JOIN player ON player.team = b.id AND player.gender = ?",
    [first, second, third, teamName, gender]
  )
  return result
}

exports.getEligiblePlayersAndSelectedById = async function(first, second, third, teamId, gender) {
  const [result] = await (await db.otherConnect()).query(
    'SELECT player.id, player.first_name, player.family_name, CASE WHEN player.id = ? THEN 1 ELSE 0 END AS first, CASE WHEN player.id = ? THEN 1 ELSE 0 END AS second, CASE WHEN player.id = ? THEN 1 ELSE 0 END AS third FROM (SELECT team.id, team.name, team.rank FROM (SELECT club.id, club.name, team.rank AS originalRank FROM team, club WHERE team.club = club.id AND team.id = ?) AS a JOIN team ON a.id = team.club AND team.rank >= originalRank) AS b JOIN player ON player.team = b.id AND player.gender = ?',
    [first, second, third, teamId, gender]
  )
  return result
}

exports.findElgiblePlayersFromTeamNameAndSelectedSansLevenshtein = async function(teamName, gender, first, second, third) {
  const [rows] = await (await db.otherConnect()).query(
    'SELECT player.id, player.first_name, player.family_name FROM (SELECT team.id, team.name, team.rank FROM (SELECT club.id, club.name, team.rank AS originalRank FROM team, club WHERE team.club = club.id AND team.name LIKE ?) AS a JOIN team ON a.id = team.club AND team.rank >= originalRank) AS b JOIN player ON player.team = b.id AND player.gender = ?',
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
    "SELECT player.id, player.first_name, player.family_name, LEVENSHTEIN(CONCAT(player.first_name,' ',player.family_name), ?) AS first, LEVENSHTEIN(CONCAT(player.first_name,' ',player.family_name), ?) AS second, LEVENSHTEIN(CONCAT(player.first_name,' ',player.family_name), ?) AS third, (LEVENSHTEIN(CONCAT(player.first_name,' ',player.family_name),?) + LEVENSHTEIN(CONCAT(player.first_name,' ',player.family_name),?) + LEVENSHTEIN(CONCAT(player.first_name,' ',player.family_name),?)) AS totalLev FROM (SELECT team.id, team.name, team.rank FROM (SELECT club.id, club.name, team.rank AS originalRank FROM team, club WHERE team.club = club.id AND LEVENSHTEIN(team.name, ?) < 1) AS a JOIN team ON a.id = team.club AND team.rank >= originalRank) AS b JOIN player ON player.team = b.id AND player.gender = ? ORDER BY totalLev ASC, first ASC, second ASC, third ASC",
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
    "SELECT * FROM (SELECT player.id AS playerId, CONCAT(first_name,' ',family_name) AS playerName, team.id AS teamId, team.name AS teamName FROM player JOIN team ON player.team = team.id) AS playerClub WHERE teamId=? AND LEVENSHTEIN(playerName,?) < ?",
    [teamId, playerName, distance]
  )
  return result
}

exports.getById = async function(playerId) {
  const [result] = await (await db.otherConnect()).query(
    "SELECT id, first_name, family_name, gender, pgp_sym_decrypt(\"playerEmail\", '" + process.env.DB_PI_KEY + "')::text AS playerEmail, pgp_sym_decrypt(\"playerTel\", '" + process.env.DB_PI_KEY + "')::text AS playerTel, \"teamCaptain\", \"clubSecretary\", \"matchSecrertary\", treasurer, junior FROM player WHERE id = ?",
    playerId
  )
  return result
}

exports.getPlayerClubandTeamById = async function(playerId) {
  const [result] = await (await db.otherConnect()).query(
    "SELECT playerId, playerName, clubName, team.name AS teamName, date_of_registration FROM (SELECT playerId, playerName, club.name AS clubName, teamId, date_of_registration FROM (SELECT player.id AS playerId, CONCAT(player.first_name,' ',player.family_name) AS playerName, player.club AS clubID, player.team AS teamId, player.date_of_registration FROM player WHERE id = ?) AS a JOIN club ON clubId = club.id) AS b JOIN team ON teamId = team.id",
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

exports.getPrevRating = async function(endDate, fixturePlayers) {
  let playerArray = Object.entries(fixturePlayers)
  let sqlArray = []
  let sqlValsArray = []

  for (row of playerArray) {
    let i = row[0]
    let sql = `(SELECT * FROM (SELECT * FROM (SELECT
CASE
    WHEN "homePlayer1" = ? THEN "homePlayer1"
    WHEN "homePlayer2" = ? THEN "homePlayer2"
    WHEN "awayPlayer1" = ? THEN "awayPlayer1"
    WHEN "awayPlayer2" = ? THEN "awayPlayer2"
    END AS playerId,
CASE
    WHEN "homePlayer1" = ? THEN "homePlayer1End"
    WHEN "homePlayer2" = ? THEN "homePlayer2End"
    WHEN "awayPlayer1" = ? THEN "awayPlayer1End"
    WHEN "awayPlayer2" = ? THEN "awayPlayer2End"
    END AS rating,
fixture.date,
division.rank
FROM game
    JOIN fixture ON game.fixture = fixture.id
    JOIN player ON (game."homePlayer1" = player.id OR game."homePlayer2" = player.id OR game."awayPlayer1" = player.id OR game."awayPlayer2" = player.id)
    JOIN team ON player.team = team.id
    JOIN division ON team.division = division.id
    WHERE
    ("homePlayer1" = ? OR
    "homePlayer2" = ? OR
    "awayPlayer1" = ? OR
    "awayPlayer2" = ?) AND (
    "homePlayer1End" IS NOT NULL AND
    "homePlayer2End" IS NOT NULL AND
    "awayPlayer1End" IS NOT NULL AND
    "awayPlayer2End" IS NOT NULL
    )
    AND date < ?
    ORDER BY date DESC, game.id DESC
    LIMIT 1) AS a
    UNION ALL
SELECT player.id AS playerId, 1500 AS rating, ? AS date, division.rank FROM player JOIN
team ON player.team = team.id JOIN
division ON team.division = division.id
WHERE player.id = ?) AS b
WHERE rating > 0
LIMIT 1)`
    sqlArray.push(sql)
    sqlValsArray = [...sqlValsArray, i * 1, i * 1, i * 1, i * 1, i * 1, i * 1, i * 1, i * 1, i * 1, i * 1, i * 1, i * 1, endDate, endDate, i * 1]
  }

  let rows = await (await db.otherConnect()).query(sqlArray.join(' UNION ALL '), sqlValsArray)

  if (rows[0].length > 0) {
    for (player of playerArray) {
      let filtered = rows[0].filter(i => i.playerId == player[0])
      if (filtered.length > 0) {
        player[1].rating = filtered[0].rating
        player[1].date = filtered[0].date
        player[1].rank = filtered[0].rank
      } else {
        player[1].rating = 1500
        player[1].date = "2020-01-01 00:00:00"
        player[1].rank = 1
      }
    }
  } else {
    for (player of playerArray) {
      player[1].rating = 1500
      player[1].date = "2020-01-01 00:00:00"
      player[1].rank = 1
    }
  }
  fixturePlayers = Object.fromEntries(playerArray)
  return fixturePlayers
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
exports.searchPlayers = async function(query, filters = {}) {
  const whereClauses = ['LOWER(CONCAT(player.first_name, \' \', player.family_name)) LIKE LOWER(?)']
  const params = [`%${query || ''}%`]

  if (filters.division) { whereClauses.push('division.name = ?'); params.push(filters.division) }
  if (filters.club) { whereClauses.push('club.name = ?'); params.push(filters.club) }
  if (filters.team) { whereClauses.push('team.name = ?'); params.push(filters.team) }
  if (filters.gender) { whereClauses.push('player.gender = ?'); params.push(filters.gender) }

  const [result] = await (await db.otherConnect()).query(
    `SELECT player.id,
            CONCAT(player.first_name, ' ', player.family_name) AS name,
            team.name AS "teamName"
     FROM player
     JOIN team ON team.id = player.team
     JOIN club ON club.id = team.club
     JOIN division ON division.id = team.division
     WHERE ${whereClauses.join(' AND ')}
     ORDER BY player.family_name, player.first_name
     LIMIT 20`,
    params
  )
  return result
}
