// @ts-check
var db = require('../db_connect.js');
var seasonModel = require("./season");
const { kysely } = require('../db');

// REARCH-01: on the typed query layer except createBatch and updateEloBatch. Both run on the
// publish path — createBatch writes a result's games inside POST /scorecard-beta's
// transaction, updateEloBatch re-rates after it (utils/eloChain) — and take a `conn` from
// the old wrapper. The brief keeps the publish path for the off-season.


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

/** @param {number | undefined} gamesCount */
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
/** @param {number} pairDelta @param {number} ratingA @param {number} ratingB */
function splitPairDelta(pairDelta, ratingA, ratingB) {
  const pairAvg = (ratingA + ratingB) / 2
  const gapA = pairAvg - ratingA
  const skewMagnitude = (Math.abs(pairDelta) / 2) * Math.tanh(Math.abs(gapA) / PARTNER_SKEW_SCALE)
  const skewA = Math.sign(gapA) * skewMagnitude
  const deltaA = Math.round(pairDelta + skewA)
  const deltaB = (2 * pairDelta) - deltaA
  return [deltaA, deltaB]
}

// `conn` is optional, so a caller can write the games inside the same transaction as
// the fixture result they belong to. See Fixture.updateById for why that matters.
/** @param {any} batchObj @param {any} [conn] */
exports.createBatch = async function(batchObj, conn) {
  if (!db.isObject(batchObj)) throw new Error('not object')
  const fields = batchObj.fields.map((/** @type {string} */ f) => `"${f}"`).join(',')
  const rows = Object.values(batchObj.data).map(row => Object.values(row))
  const valueClauses = rows.map(row => '(' + row.map(() => '?').join(',') + ')').join(',')
  const sql = `INSERT INTO "${batchObj.tablename}" (${fields}) VALUES ${valueClauses}`
  const c = conn || await db.otherConnect()
  const [result] = await c.query(sql, rows.flat())
  return result
}

/** @param {number} fixtureId */
exports.getByFixture = async function(fixtureId) {
  return kysely.selectFrom('game').selectAll().where('fixture', '=', fixtureId).orderBy('id', 'asc').execute()
}

// Writes the columns given. An `undefined` value is written as NULL, as the string version
// did — Kysely would otherwise leave the column out, and the caller (the ELO backfill in
// playerController) passes calculateRating's output, whose values come from lookups.
// Returns nothing; that caller never read the old rows array.
/** @param {Record<string, unknown>} gameObj @param {number} gameId */
exports.updateById = async function(gameObj, gameId) {
  if (!db.isObject(gameObj)) throw new Error('not valid object')
  const values = Object.fromEntries(Object.entries(gameObj).map(([k, v]) => [k, v === undefined ? null : v]))
  await kysely.updateTable('game').set(/** @type {any} */ (values)).where('id', '=', gameId).execute()
}

const ELO_COLUMNS = [
  'homePlayer1Start', 'homePlayer2Start', 'awayPlayer1Start', 'awayPlayer2Start',
  'homePlayer1End', 'homePlayer2End', 'awayPlayer1End', 'awayPlayer2End',
]

// Writes the eight ELO columns for many games in one statement: rows are
// [{ id, homePlayer1Start, ..., awayPlayer2End }]. One round trip rather than one per
// game, because utils/eloChain runs this after a publish, in front of Firebase's 60s.
/** @param {any[]} rows @param {any} [conn] */
exports.updateEloBatch = async function(rows, conn) {
  if (!rows || rows.length === 0) return
  const values = rows.map(() => `(${['?::int', ...ELO_COLUMNS.map(() => '?::int')].join(',')})`).join(',')
  const params = rows.flatMap(r => [r.id, ...ELO_COLUMNS.map(k => r[k])])
  const c = conn || await db.otherConnect()
  await c.query(
    `UPDATE game g SET ${ELO_COLUMNS.map(k => `"${k}" = v."${k}"`).join(', ')}
     FROM (VALUES ${values}) AS v(id, ${ELO_COLUMNS.map(k => `"${k}"`).join(', ')})
     WHERE g.id = v.id`,
    params
  )
}

/** @param {any} game @param {Record<string, any>} fixturePlayers @param {unknown} endDate @param {number} division */
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

// The eight ELO columns cast to integers and keyed by their own names, in the order the
// audit tool has always received them.
const ELO_ORDER = /** @type {const} */ ([
  'homePlayer1Start', 'homePlayer1End', 'homePlayer2Start', 'homePlayer2End',
  'awayPlayer1Start', 'awayPlayer1End', 'awayPlayer2Start', 'awayPlayer2End',
])
/** @param {import('kysely').ExpressionBuilder<import('../db/schema').DB, 'game' | 'fixture' | 'season'>} eb */
const eloInts = eb => ELO_ORDER.map(k => eb.cast(eb.ref(`game.${k}`), 'integer').as(k))

/** Every ELO column set to 0, for the two resets. */
const ELO_ZERO = Object.fromEntries(ELO_COLUMNS.map(k => [k, 0]))

// A fixture in the named season: after its start and before its end, as every season
// window here is drawn.
/** @param {string} sName */
const fixturesInSeason = sName => kysely.selectFrom('fixture')
  .innerJoin('season', join => join
    .onRef('fixture.date', '>', 'season.startDate')
    .onRef('fixture.date', '<', 'season.endDate')
    .on('season.name', '=', sName))

// Returns all ELO-processed games for a season in chronological order.
// Used by the audit tool to check rating chain consistency.
/** @param {string} [seasonName] */
exports.getSeasonGamesOrdered = async function(seasonName) {
  const sName = seasonName || seasonModel.current()
  return kysely.selectFrom('game')
    .innerJoin('fixture', 'game.fixture', 'fixture.id')
    .innerJoin('season', join => join
      .onRef('fixture.date', '>', 'season.startDate')
      .onRef('fixture.date', '<', 'season.endDate')
      .on('season.name', '=', sName))
    .select(eb => ['game.id', 'game.homePlayer1', 'game.homePlayer2', 'game.awayPlayer1', 'game.awayPlayer2',
      ...eloInts(eb), 'fixture.date', 'fixture.id as fixtureId'])
    .where('game.homePlayer1End', 'is not', null).where('game.homePlayer1End', '!=', 0)
    .orderBy('fixture.date', 'asc').orderBy('game.id', 'asc')
    .execute()
}

// Zeros out ELO start/end values across every game in the DB. Used before a
// full backfill so no stale values from previous runs influence new calculations.
exports.resetAllElo = async function() {
  await kysely.updateTable('game').set(ELO_ZERO).execute()
}

// Zeros out all ELO start/end values for a season so it can be recalculated
// from scratch in date order.  Defaults to the current season.
/** @param {string} [seasonName] */
exports.resetSeasonElo = async function(seasonName) {
  const sName = seasonName || seasonModel.current()
  await kysely.updateTable('game').set(ELO_ZERO)
    .where('fixture', 'in', fixturesInSeason(sName).select('fixture.id').where('fixture.status', '=', 'complete'))
    .execute()
}
