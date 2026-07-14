var db = require('../db_connect.js');

const year = new Date().getFullYear()
const SEASON = new Date().getMonth() < 7
  ? `${year - 1}${year}`
  : `${year}${year + 1}`

// ── ELO tuning constants ──────────────────────────────────────────────────
// Points added per division-rank of gap between a player's registered
// division and the division this fixture is actually being played in
// (i.e. how much a reserve-up/down player shifts their opponent's effective
// rating). Calibrated against the real rating stddev (~186) rather than the
// original 500, which was ~2.7x that spread and swamped genuine skill signal
// for any reserve spanning more than one division.
const DIVISION_RANK_POINTS = 150

// K-factor: higher while a player's rating is still converging, standard
// once established. gamesCount reflects games played BEFORE this one.
const PROVISIONAL_K = 40
const PROVISIONAL_GAMES_THRESHOLD = 15
const ESTABLISHED_K = 32

// Margin-of-victory scaling: a 21-2 blowout should move rating a bit more
// than a 22-20 nail-biter. Bounded so no single game swings wildly.
const MARGIN_MULTIPLIER_MIN = 0.85
const MARGIN_MULTIPLIER_MAX = 1.15
const MAX_GAME_MARGIN = 21

// Smooths how a pair's total rating change is split between two partners
// with different ratings — a gap of one stddev meaningfully skews the
// split toward the weaker partner; a near-zero gap barely skews it at all.
const PARTNER_SKEW_SCALE = 186

function perPlayerK(gamesCount) {
  const played = typeof gamesCount === 'number' ? gamesCount : Infinity
  return played < PROVISIONAL_GAMES_THRESHOLD ? PROVISIONAL_K : ESTABLISHED_K
}

// Splits a pair's rating change between two partners based on the rating
// gap between them. Both partners' baseline is pairDelta itself (matching
// the old behaviour where both got the identical full delta) — the weaker
// partner gets a bonus on top for a win (and a smaller loss), the stronger
// partner the reverse, bounded so neither share can flip past 0/2x pairDelta.
// Equal-rated partners (gapA = 0) still get the identical pairDelta each,
// exactly like before. deltaB is the exact complement of the rounded deltaA
// against a 2×pairDelta total, so nothing leaks.
function splitPairDelta(pairDelta, ratingA, ratingB) {
  const pairAvg = (ratingA + ratingB) / 2
  const gapA = pairAvg - ratingA
  const skewMagnitude = (Math.abs(pairDelta) / 2) * Math.tanh(Math.abs(gapA) / PARTNER_SKEW_SCALE)
  const skewA = Math.sign(gapA) * skewMagnitude
  const deltaA = Math.round(pairDelta + skewA)
  const deltaB = (2 * pairDelta) - deltaA
  return [deltaA, deltaB]
}

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
    const homeP1 = fixturePlayers[game.homePlayer1]
    const homeP2 = fixturePlayers[game.homePlayer2]
    const awayP1 = fixturePlayers[game.awayPlayer1]
    const awayP2 = fixturePlayers[game.awayPlayer2]

    const homePairStart = ((1 * homeP1.rating + ((1 * awayP1.rank - division) * DIVISION_RANK_POINTS)) + (1 * homeP2.rating + ((1 * awayP2.rank - division) * DIVISION_RANK_POINTS))) / 2
    const awayPairStart = ((1 * awayP1.rating + ((1 * homeP1.rank - division) * DIVISION_RANK_POINTS)) + (1 * awayP2.rating + ((1 * homeP2.rank - division) * DIVISION_RANK_POINTS))) / 2
    const homeExpectOutcome = 1 / (1 + Math.pow(10, ((awayPairStart - homePairStart) / 400)))

    const avgK = (perPlayerK(homeP1.gamesCount) + perPlayerK(homeP2.gamesCount) + perPlayerK(awayP1.gamesCount) + perPlayerK(awayP2.gamesCount)) / 4
    const marginRatio = Math.min(Math.abs((1 * game.homeScore) - (1 * game.awayScore)) / MAX_GAME_MARGIN, 1)
    const marginMultiplier = MARGIN_MULTIPLIER_MIN + (MARGIN_MULTIPLIER_MAX - MARGIN_MULTIPLIER_MIN) * marginRatio
    const effectiveK = avgK * marginMultiplier

    let homeAdjustment = 0
    if (1 * game.homeScore > 1 * game.awayScore) {
      homeAdjustment = Math.round(effectiveK * (1 - homeExpectOutcome))
    } else {
      homeAdjustment = Math.round(effectiveK * (0 - homeExpectOutcome))
    }
    const awayAdjustment = -homeAdjustment

    const [homeP1Delta, homeP2Delta] = splitPairDelta(homeAdjustment, homeP1.rating, homeP2.rating)
    const [awayP1Delta, awayP2Delta] = splitPairDelta(awayAdjustment, awayP1.rating, awayP2.rating)

    updateObj = {
      homePlayer1Start: homeP1.rating,
      homePlayer2Start: homeP2.rating,
      awayPlayer1Start: awayP1.rating,
      awayPlayer2Start: awayP2.rating,
      homePlayer1End: 1 * homeP1.rating + homeP1Delta,
      homePlayer2End: 1 * homeP2.rating + homeP2Delta,
      awayPlayer1End: 1 * awayP1.rating + awayP1Delta,
      awayPlayer2End: 1 * awayP2.rating + awayP2Delta,
    }
    prevRatingDates = {
      homePlayer1Start: homeP1.date,
      homePlayer2Start: homeP2.date,
      awayPlayer1Start: awayP1.date,
      awayPlayer2Start: awayP2.date,
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
