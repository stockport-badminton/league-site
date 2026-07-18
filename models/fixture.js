var db = require('../db_connect.js');
var seasonModel = require("./season");
const axios = require('axios');


exports.create = async function(fixtureObj) {
  if (!db.isObject(fixtureObj)) throw new Error('not object')
  const fields = Object.keys(fixtureObj).map(k => `"${k}"`).join(',')
  const placeholders = Object.keys(fixtureObj).map(() => '?').join(',')
  const sql = `INSERT INTO fixture (${fields}) VALUES (${placeholders})`
  const [result] = await (await db.otherConnect()).query(sql, Object.values(fixtureObj))
  return result
}

exports.getScorecardById = async function(fixtureId) {
  const [result] = await (await db.otherConnect()).query(
    'SELECT * FROM scorecardstore WHERE id = ?',
    fixtureId
  )
  return result
}

exports.deleteScorecardById = async function(fixtureId) {
  const [result] = await (await db.otherConnect()).query(
    'DELETE FROM scorecard WHERE id = ?',
    fixtureId
  )
  return result
}

exports.createScorecard = async function(fixtureObj) {
  if (!db.isObject(fixtureObj)) throw new Error('not object')
  const fields = Object.keys(fixtureObj).map(k => `"${k}"`).join(',')
  const placeholders = Object.keys(fixtureObj).map(() => '?').join(',')
  const sql = `INSERT INTO scorecardstore (${fields}) VALUES (${placeholders})`
  const [result] = await (await db.otherConnect()).query(sql, Object.values(fixtureObj))
  return result
}

exports.createBatch = async function(batchObj) {
  if (!db.isObject(batchObj)) throw new Error('not object')
  const fields = batchObj.fields.map(f => `"${f}"`).join(',')
  const rows = Object.values(batchObj.data).map(row => Object.values(row))
  const valueClauses = rows.map(row => '(' + row.map(() => '?').join(',') + ')').join(',')
  const sql = `INSERT INTO "${batchObj.tablename}" (${fields}) VALUES ${valueClauses}`
  const [result] = await (await db.otherConnect()).query(sql, rows.flat())
  return result
}

exports.getMatchPlayerOrderDetails = async function(fixtureObj) {
  const searchTerms = []
  const sqlArray = []
  let seasonName = ''

  if (fixtureObj.club) {
    searchTerms.push('c.name = ?')
    sqlArray.push(fixtureObj.club)
  }
  if (fixtureObj.team) {
    searchTerms.push('c.teamName = ?')
    sqlArray.push(fixtureObj.team)
  }
  if (!fixtureObj.season || fixtureObj.season == seasonModel.current()) {
    searchTerms.push('season.name = ? AND c.date > season."startDate" AND c.date < season."endDate"')
    sqlArray.push(seasonModel.current())
  } else {
    searchTerms.push('season.name = ? AND c.date > season."startDate" AND c.date < season."endDate"')
    sqlArray.push(fixtureObj.season)
    seasonName = fixtureObj.season
  }

  const conditions = searchTerms.length > 0
    ? ', season WHERE ' + searchTerms.join(' AND ')
    : ''
  const limit = fixtureObj.limit ? ` LIMIT ${fixtureObj.limit}` : ''

  const [result] = await (await db.otherConnect()).query(
    `SELECT c.* FROM (SELECT fixturePlayers.*, club${seasonName}.name FROM (SELECT playerNames.id, playerNames.date, homeTeam.name as teamName, homeTeam.id as teamId, homeTeam.club as clubId, awayTeam.name as oppositionName, playerNames.Man1, playerNames.Man1Rank, Man1Team.name as Man1TeamName, playerNames.Man2, playerNames.Man2Rank, Man2Team.name as Man2TeamName, playerNames.Man3, playerNames.Man3Rank, Man3Team.name as Man3TeamName, playerNames.Lady1, playerNames.Lady1Rank, Lady1Team.name as Lady1TeamName, playerNames.Lady2, playerNames.Lady2Rank, Lady2Team.name as Lady2TeamName, playerNames.Lady3, playerNames.Lady3Rank, Lady3Team.name as Lady3TeamName FROM (SELECT fixture.id, fixture.date, fixture."homeTeam" AS Team, fixture."awayTeam" AS Opposition, CONCAT(homeMan1.first_name, ' ', homeMan1.family_name) AS Man1, homeMan1.rank AS Man1Rank, homeMan1.team AS Man1TeamId, CONCAT(homeMan2.first_name, ' ', homeMan2.family_name) AS Man2, homeMan2.rank AS Man2Rank, homeMan2.team AS Man2TeamId, CONCAT(homeMan3.first_name, ' ', homeMan3.family_name) AS Man3, homeMan3.rank AS Man3Rank, homeMan3.team AS Man3TeamId, CONCAT(homeLady1.first_name, ' ', homeLady1.family_name) AS Lady1, homeLady1.rank AS Lady1Rank, homeLady1.team AS Lady1TeamId, CONCAT(homeLady2.first_name, ' ', homeLady2.family_name) AS Lady2, homeLady2.rank AS Lady2Rank, homeLady2.team AS Lady2TeamId, CONCAT(homeLady3.first_name, ' ', homeLady3.family_name) AS Lady3, homeLady3.rank AS Lady3Rank, homeLady3.team AS Lady3TeamId FROM fixture JOIN player homeMan1 ON fixture."homeMan1" = homeMan1.id JOIN player homeMan2 ON fixture."homeMan2" = homeMan2.id JOIN player homeMan3 ON fixture."homeMan3" = homeMan3.id JOIN player homeLady1 ON fixture."homeLady1" = homeLady1.id JOIN player homeLady2 ON fixture."homeLady2" = homeLady2.id JOIN player homeLady3 ON fixture."homeLady3" = homeLady3.id UNION ALL SELECT fixture.id, fixture.date, fixture."awayTeam" AS Team, fixture."homeTeam" AS Opposition, CONCAT(awayMan1.first_name, ' ', awayMan1.family_name) AS Man1, awayMan1.rank AS Man1Rank, awayMan1.team AS Man1TeamId, CONCAT(awayMan2.first_name, ' ', awayMan2.family_name) AS Man2, awayMan2.rank AS Man2Rank, awayMan2.team AS Man2TeamId, CONCAT(awayMan3.first_name, ' ', awayMan3.family_name) AS Man3, awayMan3.rank AS Man3Rank, awayMan3.team AS Man3TeamId, CONCAT(awayLady1.first_name, ' ', awayLady1.family_name) AS Lady1, awayLady1.rank AS Lady1Rank, awayLady1.team AS Lady1TeamId, CONCAT(awayLady2.first_name, ' ', awayLady2.family_name) AS Lady2, awayLady2.rank AS Lady2Rank, awayLady2.team AS Lady2TeamId, CONCAT(awayLady3.first_name, ' ', awayLady3.family_name) AS Lady3, awayLady3.rank AS Lady3Rank, awayLady3.team AS Lady3TeamId FROM fixture JOIN player awayMan1 ON fixture."awayMan1" = awayMan1.id JOIN player awayMan2 ON fixture."awayMan2" = awayMan2.id JOIN player awayMan3 ON fixture."awayMan3" = awayMan3.id JOIN player awayLady1 ON fixture."awayLady1" = awayLady1.id JOIN player awayLady2 ON fixture."awayLady2" = awayLady2.id JOIN player awayLady3 ON fixture."awayLady3" = awayLady3.id) AS playerNames JOIN team${seasonName} homeTeam ON playerNames.Team = homeTeam.id JOIN team${seasonName} awayTeam ON playerNames.Opposition = awayTeam.id JOIN team${seasonName} Man1Team ON playerNames.Man1TeamID = Man1Team.id JOIN team${seasonName} Man2Team ON playerNames.Man2TeamID = Man2Team.id JOIN team${seasonName} Man3Team ON playerNames.Man3TeamID = Man3Team.id JOIN team${seasonName} Lady1Team ON playerNames.Lady1TeamID = Lady1Team.id JOIN team${seasonName} Lady2Team ON playerNames.Lady2TeamID = Lady2Team.id JOIN team${seasonName} Lady3Team ON playerNames.Lady3TeamID = Lady3Team.id) AS fixturePlayers JOIN club${seasonName} ON club${seasonName}.id = clubId) AS c ${conditions} ORDER BY teamName, date DESC${limit}`,
    sqlArray
  )
  return result
}

exports.getAll = async function() {
  const [result] = await (await db.otherConnect()).query(
    'SELECT fixture.* FROM fixture, season WHERE season.id = 2 AND fixture.date > season."startDate" AND fixture.date < season."endDate"'
  )
  return result
}

exports.getRecent = async function() {
  const [result] = await (await db.otherConnect()).query(
    'SELECT a.date, a."homeTeam", team.name AS "awayTeam", a.address, a."venueName", a.mapLink, a."Lat", a."Lng", a."homeScore", a."awayScore" FROM (SELECT fixture.date, team.name AS "homeTeam", venue.address AS address, venue.name AS "venueName", venue."gMapUrl" AS mapLink, venue."Lat", venue."Lng", fixture."homeScore", fixture."awayScore", fixture."awayTeam" FROM fixture JOIN team ON fixture."homeTeam" = team.id JOIN venue ON team.venue = venue.id) AS a JOIN team ON a."awayTeam" = team.id WHERE a."homeScore" IS NOT NULL AND date BETWEEN NOW() - INTERVAL \'7 days\' AND NOW() ORDER BY date'
  )
  return result
}

exports.getOutstandingResults = async function() {
  const [result] = await (await db.otherConnect()).query(
    `SELECT a.id, a.date, a."homeTeam", a."homeTeamId", team.name AS "awayTeam", team.id AS "awayTeamId", a."homeScore", a."awayScore" FROM (SELECT fixture.id, fixture.date, team.name AS "homeTeam", team.id AS "homeTeamId", fixture."homeScore", fixture."awayScore", fixture."awayTeam" FROM fixture JOIN team ON fixture."homeTeam" = team.id WHERE fixture.status NOT IN ('rearranged','rearranging')) AS a JOIN team ON a."awayTeam" = team.id WHERE a."homeScore" IS NULL AND date BETWEEN NOW() - INTERVAL '7 days' AND NOW() + INTERVAL '1 day' ORDER BY date`
  )
  return result
}

exports.getOutstandingScorecards = async function() {
  const [result] = await (await db.otherConnect()).query(`SELECT * FROM
(SELECT homeTeam.name AS "homeTeam", homeTeam.id AS "homeId", awayTeam.name AS "awayTeam", awayTeam.id AS "awayId", fixture.date, fixture.status, scorecardstore.id AS "scoreCardId" FROM
fixture JOIN
season ON fixture.date > season."startDate" AND fixture.date < season."endDate" JOIN
team homeTeam ON fixture."homeTeam" = homeTeam.id JOIN
team awayTeam ON fixture."awayTeam" = awayTeam.id LEFT JOIN
scorecardstore ON (fixture.date = scorecardstore.date AND fixture."homeTeam" = scorecardstore."homeTeam" AND fixture."awayTeam" = scorecardstore."awayTeam")
WHERE season.name = ? AND fixture.status NOT IN ('rearranged','rearranging','conceded','void')
ORDER BY date) AS a
WHERE date < NOW() AND "scoreCardId" IS NULL`, [seasonModel.current()])
  return result
}

exports.getCardsDueToday = async function() {
  const [result] = await (await db.otherConnect()).query(
    `SELECT fixId, date, status, "homeTeam", team.name AS "awayTeam", a."homeScore", a."awayScore" FROM (SELECT fixture.id AS fixId, fixture.date, fixture.status, team.name AS "homeTeam", fixture."homeScore", fixture."awayScore", fixture."awayTeam" FROM fixture JOIN team ON fixture."homeTeam" = team.id AND fixture.status NOT IN ('rearranged','rearranging')) AS a JOIN team ON a."awayTeam" = team.id WHERE a."homeScore" IS NULL AND date BETWEEN NOW() - INTERVAL '7 days' AND NOW() - INTERVAL '6 days' ORDER BY date`
  )
  return result
}

exports.getupComing = async function() {
  const [result] = await (await db.otherConnect()).query(`SELECT
    fixture.id,
    fixture.date,
    homeTeam.name AS "homeTeam",
    homeTeam.starttime AS "startTime",
    homeTeam.endtime AS "endTime",
    homeClub.name AS "homeClub",
    homeClub."clubWebsite",
    awayTeam.name AS "awayTeam",
    awayClub.name AS "awayClub",
    division.name AS "divisionName",
    venue."Lat",
    venue."Lng",
    venue.name AS "venueName",
    venue.address AS "venueAddress",
    venue."gMapUrl" AS "venueLink",
    fixture.status,
    fixture."homeScore",
    fixture."awayScore",
    CONCAT(teamCaptain.first_name,' ',teamCaptain.family_name) AS teamCaptain,
    teamCaptain.id AS teamCaptainId,
    CONCAT(matchSecretary.first_name,' ',matchSecretary.family_name) AS matchSecretary,
    matchSecretary.id AS matchSecretaryId
FROM
    fixture
        JOIN
    team homeTeam ON fixture."homeTeam" = homeTeam.id
        JOIN
    club homeClub ON homeTeam.club = homeClub.id
        JOIN
    venue ON homeTeam.venue = venue.id
        JOIN
    team awayTeam ON fixture."awayTeam" = awayTeam.id
        JOIN
    club awayClub ON awayTeam.club = awayClub.id
        JOIN
    season ON (fixture.date > season."startDate"
        AND fixture.date < season."endDate")
    JOIN player teamCaptain ON (homeTeam.id = teamCaptain.team AND teamCaptain."teamCaptain" = 1)
    JOIN player matchSecretary ON (homeClub.id = matchSecretary.club AND matchSecretary."matchSecrertary" = 1)
    JOIN division ON homeTeam.division = division.id
WHERE
    fixture."homeScore" IS NULL
        AND fixture.status NOT IN ('rearranged','rearranging')
        AND fixture.date BETWEEN NOW() - INTERVAL '1 day' AND NOW() + INTERVAL '7 days'
GROUP BY fixture.id, fixture.date, homeTeam.name, homeTeam.starttime, homeTeam.endtime,
    homeClub.name, homeClub."clubWebsite", awayTeam.name, awayClub.name, division.name,
    venue."Lat", venue."Lng", venue.name, venue.address, venue."gMapUrl",
    fixture.status, fixture."homeScore", fixture."awayScore",
    teamCaptain.first_name, teamCaptain.family_name, teamCaptain.id,
    matchSecretary.first_name, matchSecretary.family_name, matchSecretary.id
ORDER BY date`)
  return result
}

exports.getClubFixtureDetails = async function(fixtureObj) {
  const searchTerms = []
  const sqlArray = []
  let teamTable = 'team'
  let clubTable = 'club'

  if (fixtureObj.club) {
    searchTerms.push('(e.homeClubName = ? OR e.awayClubName = ?)')
    sqlArray.push(fixtureObj.club, fixtureObj.club)
  }
  if (fixtureObj.team) {
    searchTerms.push('(e."homeTeam" = ? OR e."awayTeam" = ?)')
    sqlArray.push(fixtureObj.team, fixtureObj.team)
  }
  if (fixtureObj.division) {
    searchTerms.push('division = ?')
    sqlArray.push(fixtureObj.division)
  }
  if (!fixtureObj.season) {
    searchTerms.push('season.name = ? AND e.date > season."startDate" AND e.date < season."endDate"')
    sqlArray.push(seasonModel.current())
  } else {
    searchTerms.push('season.name = ? AND e.date > season."startDate" AND e.date < season."endDate"')
    sqlArray.push(fixtureObj.season)
    teamTable = `team${fixtureObj.season} AS team`
    clubTable = `club${fixtureObj.season} AS club`
  }

  const conditions = searchTerms.length > 0 ? ' WHERE ' + searchTerms.join(' AND ') : ''

  const [result] = await (await db.otherConnect()).query(
    `SELECT e.* FROM ( SELECT d.*, division.name AS "divisionName" FROM ( SELECT c.*, club.name AS awayClubName FROM (SELECT b.*, club.name AS homeClubName FROM (SELECT a.*, team.name AS "awayTeam", team.club AS "awayClub", team.division FROM (SELECT team.name AS "homeTeam", team.id AS "homeTeamId", team.club AS "homeClub", fixture.id AS fixtureId, fixture.date AS date, fixture."awayTeam" AS awayTeamId, fixture.status, fixture."homeScore", fixture."awayScore" FROM fixture JOIN ${teamTable} ON team.id = fixture."homeTeam") AS a JOIN ${teamTable} ON team.id = a.awayTeamId) AS b JOIN ${clubTable} ON club.id = b."homeClub") AS c JOIN ${clubTable} ON club.id = c."awayClub") AS d JOIN division ON division.id = d.division) AS e, season${conditions} ORDER BY e.date`,
    sqlArray
  )
  return result
}

exports.getFixtureDetails = async function(searchObj) {
  const filterArray = ['season', 'division', 'club', 'team', 'status', 'endDate', 'startDate', 'type']
  const fixtureObj = {}

  if (searchObj !== undefined) {
    for (const filter of filterArray) {
      const sqlParams = Object.entries(searchObj).filter(obj => obj[0] === filter)
      if (sqlParams.length > 0) {
        fixtureObj[filter] = sqlParams[0][1]
      }
    }
  }

  const checkSeason = function(season) {
    const firstYear = parseInt(season.slice(0, 4))
    const secondYear = parseInt(season.slice(4))
    if (secondYear - firstYear != 1) return false
    if (firstYear < 2012 || season == seasonModel.current()) return false
    return true
  }

  let season = ''
  const sqlArray = []

  if (fixtureObj.season === undefined || !checkSeason(fixtureObj.season)) {
    sqlArray.push(seasonModel.current())
  } else {
    season = fixtureObj.season
    sqlArray.push(fixtureObj.season)
  }
  if (fixtureObj.division !== undefined) sqlArray.push(fixtureObj.division)
  if (fixtureObj.club !== undefined) { sqlArray.push(fixtureObj.club); sqlArray.push(fixtureObj.club) }
  if (fixtureObj.team !== undefined) { sqlArray.push(fixtureObj.team); sqlArray.push(fixtureObj.team) }
  if (fixtureObj.status !== undefined) sqlArray.push(fixtureObj.status)
  if (fixtureObj.startDate !== undefined) sqlArray.push(fixtureObj.startDate.replaceAll('|', '-') + ' 00:00:00')
  if (fixtureObj.endDate !== undefined) sqlArray.push(fixtureObj.endDate.replaceAll('|', '-') + ' 00:00:00')

  const sql = `SELECT
    fixture.id,
    fixture.date,
    fixture."homeMan1",
    fixture."homeMan2",
    fixture."homeMan3",
    fixture."homeLady1",
    fixture."homeLady2",
    fixture."homeLady3",
    fixture."awayMan1",
    fixture."awayMan2",
    fixture."awayMan3",
    fixture."awayLady1",
    fixture."awayLady2",
    fixture."awayLady3",
    homeTeam.name AS "homeTeam",
    homeClub.name AS "homeClub",
    homeClub.id AS "homeClubId",
    awayTeam.name AS "awayTeam",
    awayClub.name AS "awayClub",
    homeTeam.division AS division,
    division.rank,
    division.name AS "divisionName",
    venue.address AS "venueName",
    venue."gMapUrl" AS "venueLink",
    fixture.status,
    fixture."homeScore",
    fixture."awayScore",
    fixture."homeTeam" AS hometeamid,
    fixture."awayTeam" AS awayteamid
  FROM
    fixture
    ${fixtureObj.type == 'eloSetting' ? 'JOIN game ON game.fixture = fixture.id' : ''}
    JOIN ${'team' + season} homeTeam ON fixture."homeTeam" = homeTeam.id
    JOIN ${'club' + season} homeClub ON homeTeam.club = homeClub.id
    JOIN venue ON homeTeam.venue = venue.id
    JOIN ${'team' + season} awayTeam ON fixture."awayTeam" = awayTeam.id
    JOIN ${'club' + season} awayClub ON awayTeam.club = awayClub.id
    JOIN division ON homeTeam.division = division.id
    JOIN season ON (
      fixture.date > season."startDate"
      AND fixture.date < season."endDate"
    )
  WHERE
    fixture.status IN (
      'complete',
      'outstanding',
      'rearranging',
      'rearranged',
      'conceded'
    )
    AND season.name = ?
    ${fixtureObj.type == 'eloSetting' ? 'AND ((("homePlayer1End" + "homePlayer2End" + "awayPlayer1End" + "awayPlayer2End") = 0) OR ("homePlayer1Start" < 700 OR "homePlayer2Start" < 700 OR "awayPlayer1Start" < 700 OR "awayPlayer2Start" < 700))' : ''}
    ${fixtureObj.club !== undefined ? 'AND (homeClub.name = ? OR awayClub.name = ?)' : ''}
    ${fixtureObj.team !== undefined ? 'AND (homeTeam.name = ? OR awayTeam.name = ?)' : ''}
    ${fixtureObj.division !== undefined ? 'AND homeTeam.division = ?' : ''}
    ${fixtureObj.status !== undefined ? 'AND fixture.status = ?' : ''}
    ${fixtureObj.endDate !== undefined ? 'AND fixture.date < ?' : ''}
    ${fixtureObj.startDate !== undefined ? 'AND fixture.date > ?' : ''}
    ${fixtureObj.type == 'eloSetting' ? 'GROUP BY fixture.id' : ''}
    ORDER BY fixture.date ASC`

  let [result] = await (await db.otherConnect()).query(sql, sqlArray)

  if (fixtureObj.type == undefined || fixtureObj.type != 'eloSetting') {
    result.push({ id: 99999, date: '2027-04-13T23:00:00.000Z', homeTeam: 'Messer A Section Final', homeClub: 'No Club', awayTeam: 'No Team', awayClub: 'No Club', division: 7, venueName: 'Ladybridge Park Residents Club, Edenbridge Rd, Cheadle Hulme, Cheadle SK8 5PX', venueLink: 'https://maps.app.goo.gl/svEEaaVQ8SERDrF6A', status: 'completed', homeScore: null, awayScore: null })
    result.push({ id: 99999, date: '2027-04-20T23:00:00.000Z', homeTeam: 'Messer B Section Final', homeClub: 'No Club', awayTeam: 'No Team', awayClub: 'No Club', division: 7, venueName: 'Ladybridge Park Residents Club, Edenbridge Rd, Cheadle Hulme, Cheadle SK8 5PX', venueLink: 'https://maps.app.goo.gl/svEEaaVQ8SERDrF6A', status: 'completed', homeScore: null, awayScore: null })
    result.push({ id: 99999, date: '2027-05-05T23:00:00.000Z', homeTeam: 'Messer Finals', homeClub: 'No Club', awayTeam: '@ Ladybridge Park Residents Club', awayClub: 'No Club', division: 7, venueName: 'Ladybridge Park Residents Club, Edenbridge Rd, Cheadle Hulme, Cheadle SK8 5PX', venueLink: 'https://maps.app.goo.gl/svEEaaVQ8SERDrF6A', status: 'outstanding', homeScore: null, awayScore: null })
  }

  return result
}

exports.getAllSeasons = async function() {
  const [rows] = await (await db.otherConnect()).query(
    `SELECT name, "startDate", "endDate" FROM season ORDER BY "startDate" ASC`
  )
  return rows
}

exports.getFixtureDetailsById = async function(fixtureId) {
  const [result] = await (await db.otherConnect()).query(
    'SELECT a.fixtureId, a.date, a."homeTeam", team.name AS "awayTeam", a.status, a."homeScore", a."awayScore" FROM (SELECT team.name AS "homeTeam", fixture.id AS fixtureId, fixture.date AS date, fixture."awayTeam", fixture.status, fixture."homeScore", fixture."awayScore" FROM fixture JOIN team ON team.id = fixture."homeTeam") AS a JOIN team ON team.id = a."awayTeam" AND fixtureId = ?',
    fixtureId
  )
  return result
}

exports.getScorecardDataById = async function(fixtureId) {
  const [result] = await (await db.otherConnect()).query(
    `SELECT date, "homeTeam", "awayTeam", CONCAT(homePlayer1.first_name,' ',homePlayer1.family_name) AS homePlayer1, CONCAT(homePlayer2.first_name,' ',homePlayer2.family_name) AS homePlayer2, CONCAT(awayPlayer1.first_name,' ',awayPlayer1.family_name) AS awayPlayer1, CONCAT(awayPlayer2.first_name,' ',awayPlayer2.family_name) AS awayPlayer2, "homeScore", "awayScore", totalHomeScore, totalAwayScore FROM (SELECT date, homeTeam.name AS "homeTeam", awayTeam.name AS "awayTeam", thisFixture."homePlayer1", thisFixture."homePlayer2", thisFixture."awayPlayer1", thisFixture."awayPlayer2", thisFixture."homeScore", thisFixture."awayScore", totalHomeScore, totalAwayScore FROM (SELECT fixture.date, fixture."homeTeam", fixture."awayTeam", fixture."homeScore" AS totalHomeScore, fixture."awayScore" AS totalAwayScore, thisGame."homePlayer1", thisGame."homePlayer2", thisGame."awayPlayer1", thisGame."awayPlayer2", thisGame."homeScore", thisGame."awayScore" FROM (SELECT * FROM game WHERE fixture = ?) AS thisGame JOIN fixture ON fixture.id = thisGame.fixture) AS thisFixture JOIN team homeTeam ON thisFixture."homeTeam" = homeTeam.id JOIN team awayTeam ON thisFixture."awayTeam" = awayTeam.id) AS teamFixture JOIN player homePlayer1 ON teamFixture."homePlayer1" = homePlayer1.id JOIN player homePlayer2 ON teamFixture."homePlayer2" = homePlayer2.id JOIN player awayPlayer1 ON teamFixture."awayPlayer1" = awayPlayer1.id JOIN player awayPlayer2 ON teamFixture."awayPlayer2" = awayPlayer2.id`,
    fixtureId
  )
  return result
}

exports.getById = async function(fixtureId) {
  const [result] = await (await db.otherConnect()).query('SELECT * FROM fixture WHERE id = ?', fixtureId)
  return result
}

exports.getFixtureEventById = async function(fixtureId) {
  const [result] = await (await db.otherConnect()).query(`SELECT
    fixture.id,
    fixture.date,
    homeTeam.name AS "homeTeam",
    homeTeam.starttime AS "startTime",
    homeTeam.endtime AS "endTime",
    homeClub.name AS "homeClub",
    homeClub."clubWebsite",
    awayTeam.name AS "awayTeam",
    awayClub.name AS "awayClub",
    division.name AS "divisionName",
    venue.name AS "venueName",
    venue.address AS "venueAddress",
    venue."gMapUrl" AS "venueLink",
    venue."Lat",
    venue."Lng",
    venue."placeId",
    fixture.status,
    fixture."homeScore",
    fixture."awayScore",
    CONCAT(teamCaptain.first_name,' ',teamCaptain.family_name) AS teamCaptain,
    teamCaptain.id AS teamCaptainId,
    CONCAT(matchSecretary.first_name,' ',matchSecretary.family_name) AS matchSecretary,
    matchSecretary.id AS matchSecretaryId
FROM
    fixture
        JOIN
    team homeTeam ON fixture."homeTeam" = homeTeam.id
        JOIN
    club homeClub ON homeTeam.club = homeClub.id
        JOIN
    venue ON homeTeam.venue = venue.id
        JOIN
    team awayTeam ON fixture."awayTeam" = awayTeam.id
        JOIN
    club awayClub ON awayTeam.club = awayClub.id
        JOIN
    season ON (fixture.date > season."startDate"
        AND fixture.date < season."endDate")
    JOIN player teamCaptain ON (homeTeam.id = teamCaptain.team AND teamCaptain."teamCaptain" = 1)
    JOIN player matchSecretary ON (homeClub.id = matchSecretary.club AND matchSecretary."matchSecrertary" = 1)
    JOIN division ON homeTeam.division = division.id
WHERE
    fixture.id = ?`, fixtureId)
  return result
}

exports.deleteById = async function(fixtureId) {
  const [result] = await (await db.otherConnect()).query('DELETE FROM fixture WHERE id = ?', fixtureId)
  return result
}

exports.getFixtureIdFromTeamNames = async function(obj) {
  if (!db.isObject(obj)) throw new Error('not object')
  const [result] = await (await db.otherConnect()).query(
    `SELECT status, fixtureId, homeTeamName, team.name AS awayTeamName, homeTeamId, team.id AS awayTeamId FROM (SELECT status, fixtureId, team.name AS homeTeamName, team.id AS homeTeamId, "homeTeam", "awayTeam" FROM (SELECT fixture.status, fixture.id AS fixtureId, fixture."homeTeam", fixture."awayTeam" FROM fixture, season WHERE season.id = 2 AND fixture.date > season."startDate") AS a JOIN team ON team.id = a."homeTeam" AND team.name = ?) AS b JOIN team ON b."awayTeam" = team.id AND team.name = ? AND status != 'rearranged'`,
    [obj.homeTeam, obj.awayTeam]
  )
  return result
}

exports.getFixtureId = async function(obj) {
  if (!db.isObject(obj)) throw new Error('not object')
  const [result] = await (await db.otherConnect()).query(
    'SELECT id FROM (SELECT fixture.id, fixture."homeTeam", fixture."awayTeam" FROM fixture, season WHERE season.name=? AND fixture.date > season."startDate") AS a WHERE a."awayTeam" = ? AND a."homeTeam" = ?',
    [seasonModel.current(), obj.awayTeam, obj.homeTeam]
  )
  return result
}

exports.getOutstandingFixtureId = async function(obj) {
  if (!db.isObject(obj)) throw new Error('not object')
  const [result] = await (await db.otherConnect()).query(
    `SELECT a.id, division.name, division.rank FROM (SELECT id, "homeTeam" FROM (SELECT fixture.id, fixture."homeTeam", fixture."awayTeam", status FROM fixture, season WHERE season.name = ? AND fixture.date > season."startDate") AS a WHERE a."awayTeam" = ? AND a."homeTeam" = ? AND status = 'outstanding') AS a JOIN team ON a."homeTeam" = team.id JOIN division ON team.division = division.id`,
    [seasonModel.current(), obj.awayTeam, obj.homeTeam]
  )
  if (!result.length || !result[0].id) throw new Error('no matching fixtures')
  return result
}

exports.rearrangeByTeamNames = async function(updateObj) {
  if (!db.isObject(updateObj)) throw new Error('not object')

  const conn = await db.otherConnect()

  if (updateObj.date == null || updateObj.date == '') {
    const sql = `UPDATE fixture SET status = 'rearranging' WHERE id = (SELECT b.id FROM (SELECT a.id, a."homeTeam", a."awayTeam", a.awayTeamName, team.name AS HomeTeamName FROM (SELECT c.id, c."homeTeam", c."awayTeam", team.name AS awayTeamName FROM (SELECT fixture.id, fixture."homeTeam", fixture."awayTeam" FROM fixture, season WHERE season.name = '${seasonModel.current()}' AND fixture.date > season."startDate") AS c JOIN team ON c."awayTeam" = team.id) AS a JOIN team ON a."homeTeam" = team.id) AS b WHERE (b.awayTeamName = ? AND b.homeTeamName = ?) ORDER BY id DESC LIMIT 1)`
    const [result] = await conn.query(sql, [updateObj.awayTeam, updateObj.homeTeam])
    return result
  } else {
    const updateSql = `UPDATE fixture SET status = 'rearranged' WHERE id = (SELECT b.id FROM (SELECT a.id, a."homeTeam", a."awayTeam", a.awayTeamName, team.name AS HomeTeamName FROM (SELECT c.id, c."homeTeam", c."awayTeam", team.name AS awayTeamName FROM (SELECT fixture.id, fixture."homeTeam", fixture."awayTeam" FROM fixture, season WHERE season.name = '${seasonModel.current()}' AND fixture.date > season."startDate") AS c JOIN team ON c."awayTeam" = team.id) AS a JOIN team ON a."homeTeam" = team.id) AS b WHERE (b.awayTeamName = ? AND b.homeTeamName = ?) ORDER BY id DESC LIMIT 1)`
    await conn.query(updateSql, [updateObj.awayTeam, updateObj.homeTeam])

    const insertSql = `INSERT INTO fixture ("homeTeam", "awayTeam", date, status) VALUES ((SELECT id FROM team WHERE name = ?), (SELECT id FROM team WHERE name = ?), ?, 'outstanding')`
    const [result] = await conn.query(insertSql, [updateObj.homeTeam, updateObj.awayTeam, updateObj.date])
    return result
  }
}

exports.updateByTeamNames = async function(updateObj) {
  if (!db.isObject(updateObj)) throw new Error('updateObj is not an object')
  const [result] = await (await db.otherConnect()).query(
    'UPDATE fixture SET "homeScore" = ?, "awayScore" = ? WHERE id = (SELECT b.id FROM (SELECT a.id, a."homeTeam", a."awayTeam", a.awayTeamName, team.name AS HomeTeamName FROM (SELECT fixture.id, fixture."homeTeam", fixture."awayTeam", team.name AS awayTeamName FROM fixture JOIN team ON fixture."awayTeam" = team.id) AS a JOIN team ON a."homeTeam" = team.id) AS b WHERE (b.awayTeamName = ? AND b.homeTeamName = ?))',
    [updateObj.homeScore, updateObj.awayScore, updateObj.awayTeam, updateObj.homeTeam]
  )
  if (result.affectedRows != 1 || result.changedRows != 1) {
    throw new Error("nothing updated - teams probably didn't match up or the result was already entered")
  }
  await axios.post('https://hook.integromat.com/uihmc7g54i8xrvdvpsec2f6ejfqul70g', {
    message: `Result: ${updateObj.homeTeam} vs ${updateObj.awayTeam} : ${updateObj.homeScore}-${updateObj.awayScore} ##stockport #sdbl #result https://stockport-co.uk`
  })
  return result
}

exports.sendResultZap = async function(zapObject) {
  if (!db.isObject(zapObject)) throw new Error("you've not supplied an object")
  if (zapObject.host == '127.0.0.1:8080') {
    console.log('zap not sent!')
    return 'test env'
  }

  const webhookBody = {
    imgGen: `https://stockport-badminton.co.uk/resultImage/${zapObject.homeTeam}/${zapObject.awayTeam}/${zapObject.homeScore}/${zapObject.awayScore}/${zapObject.division}`,
    message: `Result: ${zapObject.homeTeam} vs ${zapObject.awayTeam} : ${zapObject.homeScore}-${zapObject.awayScore} #stockport #badminton #sdbl #result #bulutangkis #badminton🏸 #badmintonclub https://stockport-badminton.co.uk`,
    imgUrl: `http://stockport-badminton.co.uk/static/beta/images/generated/${zapObject.homeTeam.replace(/([\s]{1,})/g, '-')}${zapObject.awayTeam.replace(/([\s]{1,})/g, '-')}.jpg`
  }

  // Include social media mentions if available
  if (zapObject.mentions) {
    webhookBody.mentions = zapObject.mentions
  }

  const response = await axios.post('https://hook.integromat.com/uihmc7g54i8xrvdvpsec2f6ejfqul70g', webhookBody)

  // canvas image generation is fire-and-forget
  const { createCanvas, loadImage } = require('canvas')
  const fs = require('fs')
  const canvas = createCanvas(1080, 1350)
  const ctx = canvas.getContext('2d')
  loadImage(`static/beta/images/bg/social-${zapObject.division.replace(/([\s]{1,})/g, '-')}.png`).then((image) => {
    ctx.drawImage(image, 0, 0, 1080, 1350)
    ctx.font = 'bold 60px Arial'
    ctx.fillStyle = 'White'
    ctx.textAlign = 'right'
    const text = `Result: ${zapObject.homeTeam} vs <br> ${zapObject.awayTeam} <br> ${zapObject.homeScore}-${zapObject.awayScore} <br> #stockport #badminton #sdbl #result https://stockport-badminton.co.uk`
    const words = text.split(' ')
    let line = ''
    let y = canvas.height / 2 + canvas.width / 4
    const x = canvas.width - 100
    let lineHeight = 80
    for (let n = 0; n < words.length; n++) {
      if (line.indexOf('#') > -1 || line.indexOf('http') > -1) {
        ctx.font = 'normal 30px Arial'
        lineHeight = 40
      }
      if (words[n] == '<br>') {
        ctx.fillText(line, x, y)
        line = ''
        y += lineHeight
      } else {
        const testLine = line + words[n] + ' '
        const testWidth = ctx.measureText(testLine).width
        if (testWidth > 900 && n > 0) {
          ctx.fillText(line, x, y)
          line = words[n] + ' '
          y += lineHeight
        } else {
          line = testLine
        }
      }
    }
    ctx.fillText(line, x, y)
    const out = fs.createWriteStream(`static/beta/images/generated/${zapObject.homeTeam.replace(/([\s]{1,})/g, '-')}${zapObject.awayTeam.replace(/([\s]{1,})/g, '-')}.jpg`)
    canvas.createJPEGStream().pipe(out)
    out.on('finish', () => console.log('The Jpg file was created.'))
  })

  return response.data
}

exports.updateById = async function(fixtureObj, fixtureId) {
  if (!db.isObject(fixtureObj)) throw new Error('not object')
  const setClauses = Object.keys(fixtureObj).map(k => `"${k}" = ?`).join(', ')
  const sql = `UPDATE fixture SET ${setClauses} WHERE id = ?`
  const [result] = await (await db.otherConnect()).query(sql, [...Object.values(fixtureObj), fixtureId])
  return result
}

exports.updateScorecardPhoto = async function(id, imgurl) {
  const [result] = await (await db.otherConnect()).query(
    'UPDATE scorecardstore SET "scoresheet-url" = ? WHERE id = ?',
    [imgurl, id]
  )
  return result
}

exports.getMissingScorecardPhotos = async function(email) {
  const sql = `SELECT
fixture.id AS fixtureid,
fixture.status,
scorecardstore.id,
scorecardstore.date,
scorecardstore."scoresheet-url",
scorecardstore.email,
homeTeam.name AS "homeTeam",
awayTeam.name AS "awayTeam"
FROM
scorecardstore
JOIN team homeTeam ON scorecardstore."homeTeam" = homeTeam.id
JOIN team awayTeam ON scorecardstore."awayTeam" = awayTeam.id
JOIN fixture ON (
  scorecardstore.date = fixture.date
  AND fixture."homeTeam" = scorecardstore."homeTeam"
  AND fixture."awayTeam" = scorecardstore."awayTeam"
)
JOIN season ON fixture.date > season."startDate" AND fixture.date < season."endDate"
WHERE
season.name = ?
AND "scoresheet-url" = ''
${email == 'stockport.badders.results@gmail.com' ? '' : "AND email = ? \nAND status NOT LIKE 'complete'"}`

  const params = email == 'stockport.badders.results@gmail.com' ? [seasonModel.current()] : [seasonModel.current(), email]
  const [result] = await (await db.otherConnect()).query(sql, params)
  return result
}

// ── Messer scorecard methods ─────────────────────────────────────────────

exports.createMesserScorecard = async function(messerObj) {
  if (!db.isObject(messerObj)) throw new Error('not object')
  const fields = Object.keys(messerObj).map(k => `"${k}"`).join(',')
  const placeholders = Object.keys(messerObj).map(() => '?').join(',')
  const sql = `INSERT INTO messer_scorecard (${fields}) VALUES (${placeholders}) RETURNING id`
  const [result] = await (await db.otherConnect()).query(sql, Object.values(messerObj))
  return result
}

exports.getMesserScorecardById = async function(scorecardId) {
  const [result] = await (await db.otherConnect()).query(`
    SELECT
      ms.*,
      CONCAT(hm1.first_name, ' ', hm1.family_name) AS "homeMan1Name",
      CONCAT(hm2.first_name, ' ', hm2.family_name) AS "homeMan2Name",
      CONCAT(hm3.first_name, ' ', hm3.family_name) AS "homeMan3Name",
      CONCAT(hl1.first_name, ' ', hl1.family_name) AS "homeLady1Name",
      CONCAT(hl2.first_name, ' ', hl2.family_name) AS "homeLady2Name",
      CONCAT(hl3.first_name, ' ', hl3.family_name) AS "homeLady3Name",
      CONCAT(am1.first_name, ' ', am1.family_name) AS "awayMan1Name",
      CONCAT(am2.first_name, ' ', am2.family_name) AS "awayMan2Name",
      CONCAT(am3.first_name, ' ', am3.family_name) AS "awayMan3Name",
      CONCAT(al1.first_name, ' ', al1.family_name) AS "awayLady1Name",
      CONCAT(al2.first_name, ' ', al2.family_name) AS "awayLady2Name",
      CONCAT(al3.first_name, ' ', al3.family_name) AS "awayLady3Name"
    FROM messer_scorecard ms
    LEFT JOIN player hm1 ON ms."homeMan1" = hm1.id
    LEFT JOIN player hm2 ON ms."homeMan2" = hm2.id
    LEFT JOIN player hm3 ON ms."homeMan3" = hm3.id
    LEFT JOIN player hl1 ON ms."homeLady1" = hl1.id
    LEFT JOIN player hl2 ON ms."homeLady2" = hl2.id
    LEFT JOIN player hl3 ON ms."homeLady3" = hl3.id
    LEFT JOIN player am1 ON ms."awayMan1" = am1.id
    LEFT JOIN player am2 ON ms."awayMan2" = am2.id
    LEFT JOIN player am3 ON ms."awayMan3" = am3.id
    LEFT JOIN player al1 ON ms."awayLady1" = al1.id
    LEFT JOIN player al2 ON ms."awayLady2" = al2.id
    LEFT JOIN player al3 ON ms."awayLady3" = al3.id
    WHERE ms.id = ?
  `, scorecardId)
  return result
}

exports.listMesserScorecardsForApproval = async function() {
  const sql = `
    SELECT
      ms.id,
      ms.date,
      ht.name AS "homeTeam",
      at.name AS "awayTeam",
      ht.id AS "homeTeamId",
      at.id AS "awayTeamId",
      ms.email,
      ms.status,
      ms."created_at"
    FROM messer_scorecard ms
    JOIN team ht ON ms."homeTeam" = ht.id
    JOIN team at ON ms."awayTeam" = at.id
    WHERE ms.status = 'submitted'
    ORDER BY ms."created_at" DESC
  `
  const [result] = await (await db.otherConnect()).query(sql)
  return result
}

exports.updateMesserScorecardStatus = async function(scorecardId, status) {
  const sql = `UPDATE messer_scorecard SET status = ?, "updated_at" = NOW() WHERE id = ?`
  const [result] = await (await db.otherConnect()).query(sql, [status, scorecardId])
  return result
}

exports.createMesserResult = async function(resultObj) {
  if (!db.isObject(resultObj)) throw new Error('not object')
  const fields = Object.keys(resultObj).map(k => `"${k}"`).join(',')
  const placeholders = Object.keys(resultObj).map(() => '?').join(',')
  const sql = `INSERT INTO messer_result (${fields}) VALUES (${placeholders}) RETURNING id`
  const [result] = await (await db.otherConnect()).query(sql, Object.values(resultObj))
  return result
}

exports.getMesserResultByScorecard = async function(scorecardId) {
  const [result] = await (await db.otherConnect()).query(
    'SELECT * FROM messer_result WHERE id = ?',
    scorecardId
  )
  return result
}

exports.updateMesserTable = async function(messerId, scores) {
  const { homeScore, awayScore, winningTeam } = scores
  const sql = `
    UPDATE messer
    SET "homeScore" = ?, "awayScore" = ?, "winningTeam" = ?
    WHERE id = ?
  `
  const [result] = await (await db.otherConnect()).query(sql, [homeScore, awayScore, winningTeam, messerId])
  return result
}

// ── Messer bracket wiring & auto-advance ─────────────────────────────────

// All draw slots for a section, with team names, ordered by drawPos.
// Used by the admin wire-up screen and to validate the bracket.
exports.getMesserBracket = async function(section) {
  const [result] = await (await db.otherConnect()).query(`
    SELECT
      m.id, m.section, m."drawPos", m.round, m."nextDrawPos", m."nextSlot",
      m."homeTeam", m."awayTeam", m."homeScore", m."awayScore", m."winningTeam",
      ht.name AS "homeTeamName",
      at.name AS "awayTeamName"
    FROM messer m
    LEFT JOIN team ht ON m."homeTeam" = ht.id
    LEFT JOIN team at ON m."awayTeam" = at.id
    WHERE m.section = ?
    ORDER BY m."drawPos"
  `, [section])
  return result
}

// Bulk-save the bracket links entered on the admin screen.
// `links` is an array of { id, round, nextDrawPos, nextSlot }; blank values
// become NULL (e.g. a section final has no nextDrawPos/nextSlot).
exports.saveMesserBracketLinks = async function(links) {
  const conn = await db.otherConnect()
  for (const l of links) {
    await conn.query(
      `UPDATE messer SET "round" = ?, "nextDrawPos" = ?, "nextSlot" = ? WHERE id = ?`,
      [l.round, l.nextDrawPos, l.nextSlot, l.id]
    )
  }
  return links.length
}

// Advance a winning team into its next-round slot.
// `match` is a messer row that has just been decided (needs section,
// nextDrawPos, nextSlot). Returns a small status object describing what happened
// so the caller can surface a warning without failing the approval.
exports.advanceMesserWinner = async function(match, winningTeam) {
  if (match.nextDrawPos == null || !match.nextSlot) {
    return { advanced: false, reason: 'no-next-slot' } // section final, nothing to do
  }
  const conn = await db.otherConnect()
  const [targetRows] = await conn.query(
    `SELECT id, "homeScore", "awayScore" FROM messer WHERE section = ? AND "drawPos" = ?`,
    [match.section, match.nextDrawPos]
  )
  const target = targetRows && targetRows[0]
  if (!target) {
    return { advanced: false, reason: 'target-missing' }
  }
  // Guard: don't clobber a next-round match that has already been played.
  if (target.homeScore != null || target.awayScore != null) {
    return { advanced: false, reason: 'target-already-played', targetId: target.id }
  }
  const slotCol = match.nextSlot === 'H' ? 'homeTeam' : 'awayTeam'
  await conn.query(
    `UPDATE messer SET "${slotCol}" = ? WHERE id = ?`,
    [winningTeam, target.id]
  )
  return { advanced: true, targetId: target.id, slot: match.nextSlot }
}

// Get social media handles for a club by team name
exports.getClubSocialHandlesByTeamName = async function(teamName) {
  const sql = `
    SELECT c.id, c.name, c.facebook, c.instagram
    FROM club c
    INNER JOIN team t ON t.club = c.id
    WHERE t.name = ?
    LIMIT 1
  `
  const [result] = await (await db.otherConnect()).query(sql, [teamName])
  return result?.[0] || null
}

// Get all clubs with social media handles
exports.getAllClubsWithSocialHandles = async function() {
  const sql = `
    SELECT id, name, facebook, instagram
    FROM club
    WHERE facebook IS NOT NULL OR instagram IS NOT NULL
    ORDER BY name
  `
  const [result] = await (await db.otherConnect()).query(sql)
  return result
}

// Get formatted mentions for a result (given two team names)
exports.getResultMentions = async function(homeTeamName, awayTeamName) {
  const { formatMentionsForPlatforms } = require('../utils/socialMediaMentions')

  const [homeClub, awayClub] = await Promise.all([
    this.getClubSocialHandlesByTeamName(homeTeamName),
    this.getClubSocialHandlesByTeamName(awayTeamName),
  ])

  const clubsWithHandles = [homeClub, awayClub].filter(Boolean)
  return formatMentionsForPlatforms(clubsWithHandles)
}
