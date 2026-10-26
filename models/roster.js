// @ts-check
// Roster reads and writes for the team-management pages.
//
// Everything a captain or the results secretary does to a club's registrations
// goes through here. It replaced /player/batch-update, which took a table name
// and a column list straight from the request body and interpolated both into an
// UPDATE — so any logged-in user could write any column of any table. These
// functions take intent instead ("this team's nominated men are, in order, these
// ids") and derive the SQL themselves.
//
// ## The rank convention
//
// player.rank is a within-team strength order and doubles as the nominated /
// reserve flag:
//
//   rank 1..N   nominated, in strength order, per team *and gender*
//   rank >= 99  reserve, in order (99 is the first reserve, 100 the second, ...)
//
// Reserves used to all be written rank = 99 flat, so their order could be dragged
// but never saved. Sequential-from-99 keeps every existing consumer correct: the
// three places that ask "is this a reserve" already compare with < 99 / >= 99
// (models/players.js:getEligibleByRank, controllers/documentsController.js,
// controllers/rosterController.js).
//
// Ranks are per (team, gender) because a fixture picks 3 men and 3 ladies
// independently — a team's number 1 man and number 1 lady both hold rank 1.

const config = require('../config')
const db = require('../db_connect.js')
const { sql } = require('kysely')
const { kysely, decrypt } = require('../db')
const { rankByName } = require('../utils/nameMatch')

// REARCH-01: on the typed query layer. The helpers that run inside a transaction take a
// query builder `q` — the module-wide `kysely` by default, or the `trx` db.withTransaction
// hands over, which is the same connection as the transaction. Passing the module-wide
// one inside a transaction would run that statement on another connection, outside it.

/** @typedef {import('kysely').Kysely<import('../db/schema').DB>} Q */

// The holding pen for a player with no club: club 63 is the row literally named
// 'No Club' and team 52 is 'No Team' (both confirmed against the live schema).
// `Remove from team` parks a player there rather than deleting the row, so their
// match history and ELO survive and any club can pick them up next season.
//
// These were bare literals in views/team-admin.ejs — `"data":[[id,63,52,99]]` —
// with nothing anywhere naming them.
const NO_CLUB_ID = config.NO_CLUB_ID
const NO_TEAM_ID = config.NO_TEAM_ID

const RESERVE_BASE = 99

// Nominated before reserve, always: a save settles the two together, and the
// nominated list gets first claim on a player named in both.
const SECTIONS = ['nominated', 'reserve']

// A player's display name, built the same way everywhere so a name matches between
// the roster, the search results and a toast.
//
// TRIM alone isn't enough: a number of rows carry a leading space in family_name, so
// a plain concat renders "Prem  Chandar-Anandan" and "Jenny  Chan". Collapsing runs
// of whitespace fixes the display and buys back the few pixels that were pushing the
// longest names into an ellipsis. Not a data migration — the stored values are left
// alone, since a captain may yet want to correct them on the player form.
/** @param {import('kysely').ExpressionBuilder<any, any>} eb */
const fullName = eb => eb.fn('regexp_replace', [
  eb.fn('trim', [eb.fn('concat', [eb.ref('player.first_name'), sql.lit(' '), eb.ref('player.family_name')])]),
  sql.lit('\\s+'), sql.lit(' '), sql.lit('g'),
])

exports.NO_CLUB_ID = NO_CLUB_ID
exports.NO_TEAM_ID = NO_TEAM_ID
exports.RESERVE_BASE = RESERVE_BASE

/** @param {unknown} rank */
exports.isReserve = function(rank) {
  return rank === null || rank === undefined ? false : Number(rank) >= RESERVE_BASE
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

// Every registration at a club, with the team, division and (decrypted) contact
// details the captain view shows. One query — the old page ran getNamesClubsTeams
// and then re-filtered it four times per team with jsonpath string-concat
// predicates, which broke on any team name containing a quote.
//
// Contact columns are pgp_sym_encrypt'd; pgp_sym_decrypt throws on a NULL key, so
// the DB_PI_KEY is bound as a parameter and rows with no stored value come back
// NULL rather than erroring.
/** @param {string} clubName */
exports.getClubRoster = async function(clubName) {
  /** pgp_sym_decrypt, but NULL for a NULL column rather than asking it to decrypt nothing. */
  const contact = (/** @type {any} */ eb, /** @type {'playerTel' | 'playerEmail'} */ col) =>
    eb.case().when(`player.${col}`, 'is', null).then(eb.lit(null)).else(decrypt(eb.ref(`player.${col}`))).end()
  return kysely.selectFrom('player')
    .innerJoin('team', 'team.id', 'player.team')
    .innerJoin('club', 'club.id', 'team.club')
    .leftJoin('division', 'division.id', 'team.division')
    .select(eb => ['player.id as playerId', 'player.first_name as firstName', 'player.family_name as familyName',
      fullName(eb).as('name'),
      'player.gender', 'player.rank', 'player.junior', 'player.teamCaptain', 'player.clubSecretary',
      'player.matchSecrertary', 'player.treasurer', 'player.date_of_registration as registered', 'player.rating',
      'team.id as teamId', 'team.name as teamName', 'team.rank as teamRank',
      'division.id as divisionId', 'division.name as divisionName',
      'club.id as clubId', 'club.name as clubName',
      contact(eb, 'playerTel').as('tel'),
      contact(eb, 'playerEmail').as('email')])
    .where('club.name', '=', clubName)
    .orderBy('team.rank', ob => ob.asc().nullsLast()).orderBy('team.name').orderBy('player.gender')
    .orderBy('player.rank', ob => ob.asc().nullsLast()).orderBy('player.family_name')
    .execute()
}

// Teams at a club, in the club's own pecking order — the destination list for
// "Move to…". Kept separate from the roster read so a club whose newest team has
// no players yet still offers it as a destination.
//
// **Withdrawn teams are excluded, and this is the one that matters.** HARD-10 added the
// `withdrawn` columns and the convention that such a team has a NULL division, which keeps
// it out of the league table — but nothing filtered it here, so a withdrawn (or, once
// HARD-11's orphans are reinstated, a long-defunct) team would be offered as a live
// destination and a captain could move a real player onto it. Filtering three queries is
// the precondition for reinstating those teams at all.
/** @param {string} clubName */
exports.getClubTeams = async function(clubName) {
  return kysely.selectFrom('team')
    .innerJoin('club', 'club.id', 'team.club')
    .leftJoin('division', 'division.id', 'team.division')
    .select(['team.id', 'team.name', 'team.rank as teamRank', 'division.name as divisionName'])
    .where('club.name', '=', clubName).where('team.withdrawn', 'is', null)
    .orderBy('team.rank', ob => ob.asc().nullsLast()).orderBy('team.name')
    .execute()
}

// Every club with its team and player counts — the superadmin's entry point to
// team management. The nav used to link straight to /manage-players/club-Aerospace:
// one club, alphabetically first, standing in for a picker.
//
// Counts come from separate subqueries rather than one join, because counting
// players and teams in the same GROUP BY multiplies them together.
exports.getClubSummaries = async function() {
  const rows = await kysely.selectFrom('club')
    .select(eb => ['club.id', 'club.name',
      eb.selectFrom('team').select(eb => eb.fn.countAll().as('n'))
        .whereRef('team.club', '=', 'club.id').where('team.withdrawn', 'is', null).as('teams'),
      eb.selectFrom('player').innerJoin('team as t2', 't2.id', 'player.team')
        .select(eb => eb.fn.countAll().as('n'))
        .whereRef('t2.club', '=', 'club.id').where('t2.withdrawn', 'is', null).as('players')])
    .where('club.id', '<>', NO_CLUB_ID)
    .orderBy('club.name')
    .execute()
  return rows.map(r => ({
    id: Number(r.id),
    name: r.name,
    teams: Number(r.teams),
    players: Number(r.players)
  }))
}

// The club a team belongs to. Every id-keyed write endpoint calls this before
// touching anything, so authorization is decided by the row's real owner rather
// than by whatever club the request claimed.
/** @param {number} teamId @param {Q} [q] */
exports.getTeamOwner = async function(teamId, q = kysely) {
  const row = await q.selectFrom('team').innerJoin('club', 'club.id', 'team.club')
    .select(['team.id', 'team.name', 'team.club as clubId', 'club.name as clubName'])
    .where('team.id', '=', teamId)
    .executeTakeFirst()
  return row || null
}

// Same, for a player: which club/team do they currently sit in.
/** @param {number} playerId @param {Q} [q] */
exports.getPlayerOwner = async function(playerId, q = kysely) {
  const row = await q.selectFrom('player')
    .leftJoin('team', 'team.id', 'player.team')
    .leftJoin('club', 'club.id', 'team.club')
    .select(eb => ['player.id', fullName(eb).as('name'), 'player.gender', 'player.rank',
      'player.team as teamId', 'team.name as teamName', 'team.club as teamClubId', 'club.name as clubName'])
    .where('player.id', '=', playerId)
    .executeTakeFirst()
  return row || null
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

// Write a settled list of ranks in one statement instead of one per player.
//
// Both renumber paths decide *which* rows to write first — the no-op skip above means an
// unchanged player is never in this list — so batching changes only how they are sent, not
// what is written or what is returned.
//
// It was a query per player inside the transaction, which Sentry flagged as an N+1 on
// `POST /api/teams/:id/order` (NODE-13, 9 occurrences 9–13 Sep 2026). A squad is 8–12
// players, so a single reorder was 8–12 sequential round trips to Supabase, each paying
// the pooler's latency, while holding a transaction open. Nobody reported it as slow; it
// is the holding-a-transaction-open part that makes it worth fixing rather than the
// milliseconds.
//
// `unnest` rather than a generated `VALUES` list: the placeholder count is fixed at two
// whatever the batch size, so there is no SQL built from a length — the ids and ranks are
// bound as arrays. The ?-to-$n wrapper passes JS arrays through unchanged.
//
// A raw statement, because the builder has no typed form of `FROM unnest(...) AS u(id,
// rank)`. It returns nothing, which the cast says.
/** @param {Q} q @param {{ id: number, rank: number }[]} updated */
async function applyRanks(q, updated) {
  if (!updated.length) return
  const ids = updated.map(u => Number(u.id))
  const ranks = updated.map(u => Number(u.rank))
  await /** @type {import('kysely').RawBuilder<never>} */ (sql`UPDATE player AS p SET rank = u.rank
    FROM unnest(${ids}::int[], ${ranks}::int[]) AS u(id, rank) WHERE p.id = u.id`).execute(q)
}

// A team-and-gender's players, in rank order. ORDER BY matters: renumbering with an empty
// order is how a move closes the gap it left, and the leftovers keep their relative order.
/** @param {Q} q @param {number} teamId @param {string} gender */
const currentRanks = (q, teamId, gender) => q.selectFrom('player').select(['id', 'rank'])
  .where('team', '=', teamId).where('gender', '=', gender)
  .orderBy('rank', ob => ob.asc().nullsLast()).orderBy('id')
  .execute()

// Renumbers one (team, gender, section) list to exactly `orderedIds`, taking
// section membership from the ranks already in the database.
//
// **This cannot move anyone between nominated and reserve** — by design. It exists
// for closing the gap a departing player leaves behind (movePlayer, releasePlayer),
// where the player has already been UPDATEd out of the section and the remaining
// members are exactly what their ranks say. A save that changes who is nominated
// has to go through renumberGender, which reads membership from the payload.
//
// Called inside a transaction. Only rows that already belong to this team and
// gender are touched — an id from anywhere else is ignored rather than being
// silently dragged into the team, so a stale page can't relocate a player by
// posting an order.
/** @param {Q} q @param {number} teamId @param {string} gender @param {string} section @param {Array<number | string>} orderedIds */
async function renumberSection(q, teamId, gender, section, orderedIds) {
  const current = await currentRanks(q, teamId, gender)
  const inSection = current.filter(r =>
    section === 'reserve' ? exports.isReserve(r.rank) : !exports.isReserve(r.rank)
  )
  const allowed = new Set(inSection.map(r => Number(r.id)))

  // Requested order first, then anything in the section the caller didn't
  // mention, so a player missing from a stale payload keeps a valid rank at the
  // bottom instead of being orphaned.
  const seen = new Set()
  /** @type {number[]} */
  const finalOrder = []
  for (const id of orderedIds) {
    const n = Number(id)
    if (allowed.has(n) && !seen.has(n)) {
      seen.add(n)
      finalOrder.push(n)
    }
  }
  for (const row of inSection) {
    const n = Number(row.id)
    if (!seen.has(n)) {
      seen.add(n)
      finalOrder.push(n)
    }
  }

  const base = section === 'reserve' ? RESERVE_BASE : 1
  /** @type {{ id: number, rank: number }[]} */
  const updated = []
  for (let i = 0; i < finalOrder.length; i++) {
    const rank = base + i
    const existing = inSection.find(r => Number(r.id) === finalOrder[i])
    if (existing && Number(existing.rank) === rank) continue // no-op, skip the write
    updated.push({ id: finalOrder[i], rank })
  }
  await applyRanks(q, updated)
  return updated
}

exports.renumberSection = renumberSection

// Renumbers both of a (team, gender) pair's lists from the order the caller asked
// for. `wanted` is { nominated: [...ids], reserve: [...ids] }; either may be absent.
//
// The two lists are settled together on purpose. Section membership is taken from
// the payload rather than from the rank each player currently holds, and that is
// the whole point: deriving it from the rank made promoting a reserve impossible to
// save. The id was dropped from the nominated list for not already being nominated,
// then re-appended to the reserve list as a member the payload hadn't mentioned — so
// the save wrote nothing, reported success, and the refresh put the player back.
// (Featherforce A: Dan Jennings, rank 99, would not stick at nominated 5.)
/** @param {Q} q @param {number} teamId @param {string} gender @param {Partial<Record<string, Array<number | string>>>} wanted */
async function renumberGender(q, teamId, gender, wanted) {
  const current = await currentRanks(q, teamId, gender)
  const byId = new Map(current.map(r => [Number(r.id), r]))

  const claimed = new Set()
  /** @type {Record<string, number[]>} */
  const order = { nominated: [], reserve: [] }
  for (const section of SECTIONS) {
    for (const id of wanted[section] || []) {
      const n = Number(id)
      // Only players already in this team and gender. An id from anywhere else is
      // ignored rather than dragged in, so a stale page can't relocate anyone.
      // Cross-team and cross-gender moves go through movePlayer.
      if (byId.has(n) && !claimed.has(n)) {
        claimed.add(n)
        order[section].push(n)
      }
    }
  }

  // Anyone the payload didn't mention keeps the section their rank puts them in,
  // at the bottom of it — a stale payload shouldn't orphan a player or silently
  // reclassify them.
  for (const row of current) {
    const n = Number(row.id)
    if (claimed.has(n)) continue
    claimed.add(n)
    order[exports.isReserve(row.rank) ? 'reserve' : 'nominated'].push(n)
  }

  /** @type {{ id: number, rank: number }[]} */
  const updated = []
  for (const section of SECTIONS) {
    const base = section === 'reserve' ? RESERVE_BASE : 1
    for (let i = 0; i < order[section].length; i++) {
      const id = order[section][i]
      const rank = base + i
      const existing = byId.get(id)
      if (existing && Number(existing.rank) === rank) continue // no-op, skip the write
      updated.push({ id, rank })
    }
  }
  // One statement for both sections of the gender — they are renumbered together on
  // purpose (see the note on renumberGender), so they are written together too.
  await applyRanks(q, updated)
  return updated
}

exports.renumberGender = renumberGender

// Saves a whole team card in one transaction: nominated men, nominated ladies,
// reserve men, reserve ladies.
//
// `sections` is [{ gender: 'Male', section: 'nominated', playerIds: [...] }, ...].
// The editor posts every list it displays. They are regrouped by gender and applied
// a gender at a time, because "who is nominated" is one decision about one list of
// people: settling a gender's two sections independently is what let a player be
// dropped from the one they were joining and re-appended to the one they were
// leaving. All-or-nothing matters too — a partial apply is what left teams ranked
// 1, 2, 4, 5 before.
/** @param {number} teamId @param {{ gender: string, section: string, playerIds?: Array<number | string> }[]} sections */
exports.saveTeamOrder = async function(teamId, sections) {
  /** @type {Map<string, Record<string, Array<number | string>>>} */
  const byGender = new Map()
  for (const s of sections) {
    if (!byGender.has(s.gender)) byGender.set(s.gender, {})
    const lists = /** @type {Record<string, Array<number | string>>} */ (byGender.get(s.gender))
    lists[s.section] = s.playerIds || []
  }

  return db.withTransaction(async (conn, trx) => {
    const updated = []
    for (const [gender, wanted] of byGender) {
      updated.push(...await renumberGender(trx, teamId, gender, wanted))
    }
    return updated
  })
}

// One past the highest rank in a team's list for a gender: the next nominated rank, or the
// next reserve, never below 99.
/** @param {Q} q @param {number} teamId @param {string} gender @param {string} section */
async function nextRank(q, teamId, gender, section) {
  const row = await q.selectFrom('player')
    .select(eb => eb.fn.coalesce(eb.fn.max('rank'), eb.lit(0)).as('max'))
    .where('team', '=', teamId).where('gender', '=', gender)
    .where('rank', section === 'reserve' ? '>=' : '<', RESERVE_BASE)
    .executeTakeFirstOrThrow()
  const currentMax = Number(row.max) || 0
  return section === 'reserve' ? Math.max(currentMax + 1, RESERVE_BASE) : currentMax + 1
}

/** A team's club, or a 404 when there is no such team. @param {Q} q @param {number} teamId */
async function teamClub(q, teamId) {
  const team = await q.selectFrom('team').select('club').where('id', '=', teamId).executeTakeFirst()
  if (!team) {
    const err = /** @type {Error & { status?: number }} */ (new Error('No such team'))
    err.status = 404
    throw err
  }
  return team.club
}

function noSuchPlayer() {
  const err = /** @type {Error & { status?: number }} */ (new Error('No such player'))
  err.status = 404
  return err
}

// Moves a player to another team and/or section, renumbering both ends.
//
// This is the operation the old UI did by dragging across the page and then
// renumbering only the destination — which is why the source team kept a hole
// where the player used to be.
/** @param {number} playerId @param {number} destTeamId @param {string} destSection */
exports.movePlayer = async function(playerId, destTeamId, destSection) {
  return db.withTransaction(async (conn, trx) => {
    const player = await exports.getPlayerOwner(playerId, trx)
    if (!player) throw noSuchPlayer()
    const sourceTeamId = player.teamId
    const sourceIsReserve = exports.isReserve(player.rank)

    // Append to the destination: one past whatever is already there.
    const newRank = await nextRank(trx, destTeamId, /** @type {string} */ (player.gender), destSection)

    // Destination club, so a move also re-homes the player. Cross-club moves are
    // transfers and are gated separately in the controller; within a club this
    // keeps player.club and team.club from drifting apart.
    const club = await teamClub(trx, destTeamId)

    await trx.updateTable('player').set({ team: destTeamId, club, rank: newRank }).where('id', '=', playerId).execute()

    // Close the gap left behind. Same team + section change still needs it, since
    // the player left one of that team's two lists.
    if (sourceTeamId) {
      await renumberSection(trx, sourceTeamId, /** @type {string} */ (player.gender),
        sourceIsReserve ? 'reserve' : 'nominated', [])
    }
    if (sourceTeamId !== destTeamId || sourceIsReserve !== (destSection === 'reserve')) {
      await renumberSection(trx, destTeamId, /** @type {string} */ (player.gender), destSection, [])
    }

    return { playerId: Number(playerId), name: player.name, teamId: destTeamId, rank: newRank }
  })
}

// Takes a player out of their team without deleting them: parked on the
// no-club/no-team sentinel rows so match history and ELO survive and they can be
// picked up by any club next season.
/** @param {number} playerId */
exports.releasePlayer = async function(playerId) {
  return db.withTransaction(async (conn, trx) => {
    const player = await exports.getPlayerOwner(playerId, trx)
    if (!player) throw noSuchPlayer()
    await trx.updateTable('player').set({ club: NO_CLUB_ID, team: NO_TEAM_ID, rank: RESERVE_BASE })
      .where('id', '=', playerId).execute()
    if (player.teamId) {
      await renumberSection(trx, player.teamId, /** @type {string} */ (player.gender),
        exports.isReserve(player.rank) ? 'reserve' : 'nominated', [])
    }
    return { playerId: Number(playerId), name: player.name, from: player.teamName }
  })
}

// Adds a player to a team as its next reserve — the shared tail of "create a new
// player" and "adopt an unattached one". Returns the rank assigned.
/** @param {number} playerId @param {number} teamId @param {string} section */
exports.addToTeam = async function(playerId, teamId, section) {
  return db.withTransaction((conn, trx) => placeOnTeam(trx, playerId, teamId, section))
}

/** @param {Q} q @param {number} playerId @param {number} teamId @param {string} section */
async function placeOnTeam(q, playerId, teamId, section) {
  const player = await q.selectFrom('player').select('gender').where('id', '=', playerId).executeTakeFirst()
  if (!player) throw noSuchPlayer()
  const club = await teamClub(q, teamId)
  const rank = await nextRank(q, teamId, /** @type {string} */ (player.gender), section)
  await q.updateTable('player').set({ team: teamId, club, rank }).where('id', '=', playerId).execute()
  return { playerId: Number(playerId), teamId, rank }
}

// Creates a player and places them in a team, in one transaction. Returns what
// addToTeam returns: { playerId, teamId, rank }.
//
// models/players.js:create issues a bare INSERT with no RETURNING, so the `result`
// it hands back is an empty rows array and `result.insertId` is undefined — which
// is why the old add-player modal set `dataset.id = undefined` and then posted
// parseInt(undefined) as the player id. The new player has to be placed in a team
// straight after being created, so the id is not optional here.
//
// The INSERT and the placement used to be two transactions, so a failure between
// them left a player on the team with a NULL rank while the captain was told the add
// had failed. Found by Tameside porting this (Oct 2026).
/**
 * @param {{ firstName: string, familyName: string, gender: string, clubId: number, teamId: number, section: string }} p
 */
exports.createPlayer = async function({ firstName, familyName, gender, clubId, teamId, section }) {
  return db.withTransaction(async (conn, trx) => {
    const row = await trx.insertInto('player')
      .values({ first_name: firstName, family_name: familyName, gender, club: clubId, team: teamId,
        date_of_registration: new Date() })
      .returning('id')
      .executeTakeFirst()
    if (!row) throw new Error('player insert returned no id')
    return placeOnTeam(trx, Number(row.id), teamId, section)
  })
}

// Everyone who could be the person being searched for, split the way the add flow
// offers them: registered to no club (adopt directly), at another club (needs a
// transfer), or already at this one (so nobody creates them a second time).
//
// These were two `FULL_NAME ILIKE '%term%'` queries, so a search found someone only
// if what was typed was a literal slice of what was stored — "Mary Whitle" could not
// find the "Marry Whitle" on file, the modal said "No existing player matches. Create
// a new one below", and that is how duplicates are made. Matching is now
// utils/nameMatch.js, which is order-, typo- and nickname-tolerant. The whole table is
// ~1,200 rows, so it is read once and ranked in JavaScript.
/** @param {string} term @param {string | null} clubName */
exports.findCandidates = async function(term, clubName) {
  return exports.splitCandidates(await exports.allForMatching(), term, clubName)
}

// The table findCandidates ranks, for a caller matching many names at once — the
// registration-request page matches every person an email names against one read.
exports.allForMatching = async function() {
  return kysely.selectFrom('player')
    .leftJoin('club', 'club.id', 'player.club')
    .leftJoin('team', 'team.id', 'player.team')
    .select(eb => ['player.id as playerId', fullName(eb).as('name'), 'player.gender',
      'club.name as clubName', 'club.id as clubId', 'team.name as teamName'])
    .orderBy(eb => eb.fn('trim', ['player.family_name'])).orderBy(eb => eb.fn('trim', ['player.first_name']))
    .execute()
}

/** @param {any[]} rows @param {string} term @param {string | null} clubName */
exports.splitCandidates = function(rows, term, clubName) {
  const ranked = rankByName(rows, term, (/** @type {any} */ r) => r.name)
  const isUnattached = (/** @type {any} */ r) => r.clubId === null || Number(r.clubId) === NO_CLUB_ID
  const isOwn = (/** @type {any} */ r) => !isUnattached(r) && !!clubName && r.clubName === clubName
  return {
    unattached: ranked.filter(isUnattached).slice(0, 20),
    otherClubs: ranked.filter((/** @type {any} */ r) => !isUnattached(r) && !isOwn(r)).slice(0, 20),
    ownClub: ranked.filter(isOwn).slice(0, 20)
  }
}
