var db = require('../db_connect.js');

const year = new Date().getFullYear()
const SEASON = new Date().getMonth() < 7
  ? `${year - 1}${year}`
  : `${year}${year + 1}`

exports.create = async function(gameObj) {
  if (!db.isObject(gameObj)) throw new Error('not game object')
  const fields = Object.keys(gameObj).map(k => `"${k}"`).join(',')
  const placeholders = Object.keys(gameObj).map(() => '?').join(',')
  const sql = `INSERT INTO game (${fields}) VALUES (${placeholders})`
  const [result] = await (await db.otherConnect()).query(sql, Object.values(gameObj))
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

exports.getAll = async function() {
  const [result] = await (await db.otherConnect()).query('SELECT * FROM game')
  return result
}

exports.getById = async function(gameId) {
  const [result] = await (await db.otherConnect()).query('SELECT * FROM game WHERE id = ?', gameId)
  return result
}

exports.getByFixture = async function(fixtureId) {
  const [result] = await (await db.otherConnect()).query(
    'SELECT * FROM game WHERE fixture = ? ORDER BY id ASC',
    fixtureId
  )
  return result
}

exports.deleteById = async function(gameId) {
  const [result] = await (await db.otherConnect()).query('DELETE FROM game WHERE id = ?', gameId)
  return result
}

exports.updateById = async function(gameObj, gameId) {
  if (!db.isObject(gameObj)) throw new Error('not valid object')
  const setClauses = Object.keys(gameObj).map(k => `"${k}" = ?`).join(', ')
  const sql = `UPDATE game SET ${setClauses} WHERE id = ?`
  const [result] = await (await db.otherConnect()).query(sql, [...Object.values(gameObj), gameId])
  return result
}

exports.calculateRating = function(game, fixturePlayers, endDate, division) {
  let updateObj = {}
  let prevRatingDates = {}

  if (game.homePlayer1 == 0 || game.homePlayer2 == 0 || game.awayPlayer1 == 0 || game.awayPlayer2 == 0) {
    updateObj = {
      homePlayer1Start: (typeof fixturePlayers[game.homePlayer1] !== 'undefined' ? fixturePlayers[game.homePlayer1].rating : 1500),
      homePlayer2Start: (typeof fixturePlayers[game.homePlayer2] !== 'undefined' ? fixturePlayers[game.homePlayer2].rating : 1500),
      awayPlayer1Start: (typeof fixturePlayers[game.awayPlayer1] !== 'undefined' ? fixturePlayers[game.awayPlayer1].rating : 1500),
      awayPlayer2Start: (typeof fixturePlayers[game.awayPlayer2] !== 'undefined' ? fixturePlayers[game.awayPlayer2].rating : 1500),
      homePlayer1End: (typeof fixturePlayers[game.homePlayer1] !== 'undefined' ? fixturePlayers[game.homePlayer1].rating : 1500),
      homePlayer2End: (typeof fixturePlayers[game.homePlayer2] !== 'undefined' ? fixturePlayers[game.homePlayer2].rating : 1500),
      awayPlayer1End: (typeof fixturePlayers[game.awayPlayer1] !== 'undefined' ? fixturePlayers[game.awayPlayer1].rating : 1500),
      awayPlayer2End: (typeof fixturePlayers[game.awayPlayer2] !== 'undefined' ? fixturePlayers[game.awayPlayer2].rating : 1500),
    }
    prevRatingDates = {
      homePlayer1Start: (typeof fixturePlayers[game.homePlayer1] !== 'undefined' ? fixturePlayers[game.homePlayer1].date : '2020-01-01T00:00:00.000Z'),
      homePlayer2Start: (typeof fixturePlayers[game.homePlayer2] !== 'undefined' ? fixturePlayers[game.homePlayer2].date : '2020-01-01T00:00:00.000Z'),
      awayPlayer1Start: (typeof fixturePlayers[game.awayPlayer1] !== 'undefined' ? fixturePlayers[game.awayPlayer1].date : '2020-01-01T00:00:00.000Z'),
      awayPlayer2Start: (typeof fixturePlayers[game.awayPlayer2] !== 'undefined' ? fixturePlayers[game.awayPlayer2].date : '2020-01-01T00:00:00.000Z'),
    }
  } else {
    const homePairStart = ((1 * fixturePlayers[game.homePlayer1].rating + ((1 * fixturePlayers[game.awayPlayer1].rank - division) * 500)) + (1 * fixturePlayers[game.homePlayer2].rating + ((1 * fixturePlayers[game.awayPlayer2].rank - division) * 500))) / 2
    const awayPairStart = ((1 * fixturePlayers[game.awayPlayer1].rating + ((1 * fixturePlayers[game.homePlayer1].rank - division) * 500)) + (1 * fixturePlayers[game.awayPlayer2].rating + ((1 * fixturePlayers[game.homePlayer2].rank - division) * 500))) / 2
    const homeExpectOutcome = 1 / (1 + Math.pow(10, ((awayPairStart - homePairStart) / 400)))
    const awayExpectOutcome = 1 / (1 + Math.pow(10, ((homePairStart - awayPairStart) / 400)))

    let homeAdjustment = 0
    let awayAdjustment = 0
    if (1 * game.homeScore > 1 * game.awayScore) {
      homeAdjustment = Math.round(32 * (1 - homeExpectOutcome))
      awayAdjustment = Math.round(32 * (0 - awayExpectOutcome))
    } else {
      homeAdjustment = Math.round(32 * (0 - homeExpectOutcome))
      awayAdjustment = Math.round(32 * (1 - awayExpectOutcome))
    }

    updateObj = {
      homePlayer1Start: fixturePlayers[game.homePlayer1].rating,
      homePlayer2Start: fixturePlayers[game.homePlayer2].rating,
      awayPlayer1Start: fixturePlayers[game.awayPlayer1].rating,
      awayPlayer2Start: fixturePlayers[game.awayPlayer2].rating,
      homePlayer1End: 1 * fixturePlayers[game.homePlayer1].rating + 1 * homeAdjustment,
      homePlayer2End: 1 * fixturePlayers[game.homePlayer2].rating + 1 * homeAdjustment,
      awayPlayer1End: 1 * fixturePlayers[game.awayPlayer1].rating + 1 * awayAdjustment,
      awayPlayer2End: 1 * fixturePlayers[game.awayPlayer2].rating + 1 * awayAdjustment,
    }
    prevRatingDates = {
      homePlayer1Start: fixturePlayers[game.homePlayer1].date,
      homePlayer2Start: fixturePlayers[game.homePlayer2].date,
      awayPlayer1Start: fixturePlayers[game.awayPlayer1].date,
      awayPlayer2Start: fixturePlayers[game.awayPlayer2].date,
    }
  }

  return { updateObj, prevRatingDates }
}

// Returns all ELO-processed games for a season in chronological order.
// Used by the audit tool to check rating chain consistency.
exports.getSeasonGamesOrdered = async function(seasonName) {
  const sName = seasonName || SEASON
  const [result] = await (await db.otherConnect()).query(`
    SELECT
      game.id,
      game."homePlayer1", game."homePlayer2", game."awayPlayer1", game."awayPlayer2",
      game."homePlayer1Start"::int AS "homePlayer1Start",
      game."homePlayer1End"::int   AS "homePlayer1End",
      game."homePlayer2Start"::int AS "homePlayer2Start",
      game."homePlayer2End"::int   AS "homePlayer2End",
      game."awayPlayer1Start"::int AS "awayPlayer1Start",
      game."awayPlayer1End"::int   AS "awayPlayer1End",
      game."awayPlayer2Start"::int AS "awayPlayer2Start",
      game."awayPlayer2End"::int   AS "awayPlayer2End",
      fixture.date,
      fixture.id AS "fixtureId"
    FROM game
    JOIN fixture ON game.fixture = fixture.id
    JOIN season ON (fixture.date > season."startDate" AND fixture.date < season."endDate" AND season.name = ?)
    WHERE game."homePlayer1End" IS NOT NULL AND game."homePlayer1End" != 0
    ORDER BY fixture.date ASC, game.id ASC
  `, [sName])
  return result
}

// Zeros out ELO start/end values across every game in the DB. Used before a
// full backfill so no stale values from previous runs influence new calculations.
exports.resetAllElo = async function() {
  await (await db.otherConnect()).query(`
    UPDATE game SET
      "homePlayer1Start" = 0, "homePlayer2Start" = 0,
      "awayPlayer1Start" = 0, "awayPlayer2Start" = 0,
      "homePlayer1End"   = 0, "homePlayer2End"   = 0,
      "awayPlayer1End"   = 0, "awayPlayer2End"   = 0
  `)
}

// Zeros out all ELO start/end values for a season so it can be recalculated
// from scratch in date order.  Defaults to the current season.
exports.resetSeasonElo = async function(seasonName) {
  const sName = seasonName || SEASON
  await (await db.otherConnect()).query(`
    UPDATE game SET
      "homePlayer1Start" = 0, "homePlayer2Start" = 0,
      "awayPlayer1Start" = 0, "awayPlayer2Start" = 0,
      "homePlayer1End"   = 0, "homePlayer2End"   = 0,
      "awayPlayer1End"   = 0, "awayPlayer2End"   = 0
    WHERE fixture IN (
      SELECT fixture.id FROM fixture
      JOIN season ON (
        fixture.date > season."startDate"
        AND fixture.date < season."endDate"
        AND season.name = ?
      )
      WHERE fixture.status = 'complete'
    )
  `, [sName])
}
