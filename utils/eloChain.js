// Re-rates the ELO of a fixture and of every later fixture its result reaches.
//
// A game's rating depends on every game its four players played before it, so a result
// published out of date order leaves everything after it computed without it. The
// publish path rated the late fixture correctly and never looked forward, so its players'
// later games — and therefore their current rating — carried on as if it had not been
// played, until somebody ran a full backfill. Found 21 Oct 2026; it had happened once
// that season (7250, entered after 7259), and the 28 Sep backfill had hidden it.
//
// A full backfill is 39 minutes. What a late result can change is much smaller: its own
// players, and then anyone who later plays a game whose outcome moved. Measured over 274
// real fixtures, a result published a week late reaches 1 later fixture at the median and
// 5 at most. So this walks the season forward from the fixture and re-rates only a
// fixture containing a player whose history has changed ("dirty"), and it treats a
// player whose games came out identical as clean again from the database.
//
// It has to agree exactly with recalcSeasonElo, which is what a backfill produces: the
// same fixture order (Fixture.getFixtureDetails), the same per-game arithmetic
// (rateFixtureGames, which recalcSeasonElo also uses), and the same starting state
// (Player.getRatingStateBefore, which carries the games-played count the backfill holds
// in memory). The local-database proof in the commit that added this compared every game
// row against a full backfill.

const db = require('../db_connect')
const log = require('./log');
const Fixture = require('../models/fixture')
const Game = require('../models/game')
const Player = require('../models/players')

// Beyond this the walk stops and writes nothing: a result entered months late can reach
// most of the season, and that is a backfill's job, not a publish's. The error reaches
// Sentry through afterCommit, which is how somebody finds out a backfill is due.
const MAX_CHAIN_FIXTURES = 40

// Two results published at once can reach the same fixtures. One walk at a time.
const LOCK_KEY = 20261021

const SLOTS = [
  ['homePlayer1', 'homePlayer1End'],
  ['homePlayer2', 'homePlayer2End'],
  ['awayPlayer1', 'awayPlayer1End'],
  ['awayPlayer2', 'awayPlayer2End'],
]

const isPlayer = pid => pid != null && pid != 0

function playersIn(games) {
  const out = new Set()
  for (const g of games) for (const [slot] of SLOTS) if (isPlayer(g[slot])) out.add(Number(g[slot]))
  return [...out]
}

// Rates one fixture's games in order and returns [{ id, ...the eight ELO columns }].
// `fixturePlayers` is { [pid]: { rating, date, gamesCount, rank } } going in, and is
// advanced game by game. A game with no players at all is left unrated, as the backfill
// leaves it.
function rateFixtureGames(games, fixturePlayers, fixture) {
  const rated = []
  for (const game of games) {
    if (!SLOTS.some(([slot]) => game[slot] != 0)) continue
    const { updateObj } = Game.calculateRating(game, fixturePlayers, fixture.date, fixture.rank)
    for (const [slot, endKey] of SLOTS) {
      const pid = game[slot]
      if (!isPlayer(pid)) continue
      fixturePlayers[pid].rating = updateObj[endKey]
      fixturePlayers[pid].date = fixture.date
      fixturePlayers[pid].gamesCount = (fixturePlayers[pid].gamesCount || 0) + 1
    }
    rated.push({ id: game.id, ...updateObj })
  }
  return rated
}

// opts.dryRun computes everything and writes nothing, for checking what a re-rate of
// production would change before it does. maxShift is the largest move in any one
// game's End value.
//
// opts.everyFixture treats every player as dirty from the start, so every fixture from
// here to now is re-rated — a backfill of the rest of the season, with the lifetime
// games-played count recalcSeasonElo only has when run from 2018 (eloFullRecalc starts
// everyone at zero). For a fault that is in every fixture, not one that spreads from
// this one. opts.maxFixtures raises the cap for that.
async function rerateFrom(fixtureId, opts = {}) {
  return db.withTransaction(async conn => {
    await conn.query('SELECT pg_advisory_xact_lock(?::bigint)', [LOCK_KEY])

    const season = (await Fixture.getFixtureDetails({ status: 'complete' })).filter(f => f.id !== 99999)
    const start = season.findIndex(f => f.id == fixtureId)
    if (start < 0) return { fixtures: 0, games: 0, players: 0, skipped: 'not a complete fixture this season' }
    const chain = season.slice(start)

    const [rows] = await conn.query(
      'SELECT * FROM game WHERE fixture = ANY(?::int[]) ORDER BY id ASC',
      [chain.map(f => f.id)]
    )
    const gamesByFixture = {}
    const storedById = {}
    for (const g of rows) {
      (gamesByFixture[g.fixture] = gamesByFixture[g.fixture] || []).push(g)
      storedById[g.id] = g
    }

    const ranks = (await Player.getSeasonRanks()) || {}
    const dirty = new Set(playersIn(opts.everyFixture ? rows : (gamesByFixture[chain[0].id] || [])))
    const cap = opts.maxFixtures || MAX_CHAIN_FIXTURES
    const known = {}  // dirty players only: their state after the last fixture re-rated here
    const writes = []
    let rerated = 0

    for (const fixture of chain) {
      const games = gamesByFixture[fixture.id] || []
      const pids = playersIn(games)
      if (!pids.some(p => dirty.has(p))) continue
      if (++rerated > cap) {
        throw new Error(`ELO chain from fixture ${fixtureId} reaches more than ${cap} fixtures; nothing re-rated — run a full backfill`)
      }

      // A clean player's history up to here is unchanged, so the database is right
      // about them; a dirty one's is not, and only memory has it.
      const loaded = await Player.getRatingStateBefore(fixture.id, pids.filter(p => !(p in known)), conn)
      const fixturePlayers = {}
      for (const p of pids) {
        const base = known[p] || loaded[p] || { rating: 1500, date: null, gamesCount: 0 }
        fixturePlayers[p] = { ...base, rank: p in ranks ? ranks[p] : fixture.rank }
      }

      for (const row of rateFixtureGames(games, fixturePlayers, fixture)) {
        const stored = storedById[row.id]
        if (Object.keys(row).some(k => k !== 'id' && Number(stored[k]) !== row[k])) writes.push(row)
        for (const [slot, endKey] of SLOTS) {
          if (isPlayer(stored[slot]) && Number(stored[endKey]) !== row[endKey]) dirty.add(Number(stored[slot]))
        }
      }
      for (const p of pids) {
        if (dirty.has(p)) known[p] = { rating: fixturePlayers[p].rating, date: fixturePlayers[p].date, gamesCount: fixturePlayers[p].gamesCount }
      }
    }

    const maxShift = writes.reduce((m, row) => Math.max(m, ...SLOTS.map(([, e]) => Math.abs(row[e] - Number(storedById[row.id][e])))), 0)
    if (opts.dryRun) return { fixtures: rerated, games: writes.length, players: dirty.size, maxShift, dryRun: true }

    await Game.updateEloBatch(writes, conn)
    if (writes.length > 0) await Player.refreshRatings([...dirty], conn)
    if (rerated > 1) log.info(`[elo-chain] fixture ${fixtureId}: re-rated ${rerated} fixtures, ${writes.length} games, ${dirty.size} players`)
    return { fixtures: rerated, games: writes.length, players: dirty.size, maxShift }
  })
}

module.exports = { rerateFrom, rateFixtureGames, MAX_CHAIN_FIXTURES }
