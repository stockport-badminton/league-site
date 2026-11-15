// @ts-check
// Club officers, as their own club's secretaries manage them (/club-officers/:clubId).
//
// An officer is recorded one way: the flag on the player (docs/claude/database.md). The
// readers that turn flags into contacts — the club contact page, the distribution lists —
// find a club's secretaries by `player.club` and a team's captain by `player.team`, so the
// writes here keep to exactly those columns: a secretary flag is only set on a player whose
// `club` is this club, and a captain flag only on a player whose `team` is the team.
//
// Who may use this: a club secretary or match secretary of the club (by flag), or the
// superadmin. Club admins (player.role = 'admin') keep the roster's "Edit details" as
// before; this is not a replacement for it (Neil, 15 Nov 2026).
const db = require('../db_connect')
const { kysely, encrypt, decrypt } = require('../db')
const { sql } = require('kysely')

/** @typedef {import('../db/kysely').Db} Db */
/** @typedef {'clubSecretary' | 'matchSecrertary'} SecretaryColumn */

const SECRETARY_COLUMNS = /** @type {const} */ (['clubSecretary', 'matchSecrertary'])

/** @param {any} eb */
const fullName = eb => eb.fn('concat', [eb.ref('player.first_name'), sql.lit(' '), eb.ref('player.family_name')])

/** pgp_sym_decrypt, but NULL for a NULL column. */
const contact = (/** @type {any} */ eb, /** @type {'playerTel' | 'playerEmail'} */ col) =>
  eb.case().when(`player.${col}`, 'is', null).then(eb.lit(null)).else(decrypt(eb.ref(`player.${col}`))).end()

/**
 * The clubs a login is a secretary of: players flagged club or match secretary whose
 * login address (`authEmail`) or contact address (`playerEmail`) is `email`, ignoring case
 * — the same two columns getAuthRoleByEmail accepts.
 * @param {string | null | undefined} email
 * @returns {Promise<{ playerId: number, clubId: number, clubName: string }[]>}
 */
exports.secretaryClubs = async function(email) {
  if (!email) return []
  const matches = (/** @type {any} */ eb, /** @type {'authEmail' | 'playerEmail'} */ column) => eb.and([
    eb(`player.${column}`, 'is not', null),
    eb(eb.fn('lower', [decrypt(eb.ref(`player.${column}`))]), '=', String(email).toLowerCase()),
  ])
  return kysely.selectFrom('player')
    .innerJoin('club', 'club.id', 'player.club')
    .select(['player.id as playerId', 'club.id as clubId', 'club.name as clubName'])
    .where(eb => eb.and([
      eb.or([eb('player.clubSecretary', '=', 1), eb('player.matchSecrertary', '=', 1)]),
      eb.or([matches(eb, 'authEmail'), matches(eb, 'playerEmail')]),
    ]))
    .orderBy('club.name').orderBy('player.id')
    .execute()
}

/**
 * Everything the officers page shows for one club: its teams still playing, and every
 * player who is at the club or on one of its teams, with their flags and contacts.
 * Undefined for a club that does not exist.
 * @param {number} clubId
 */
exports.getClubOfficers = async function(clubId) {
  const club = await kysely.selectFrom('club').select(['club.id', 'club.name'])
    .where('club.id', '=', clubId).executeTakeFirst()
  if (!club) return undefined
  const teams = await kysely.selectFrom('team').select(['team.id', 'team.name'])
    .where('team.club', '=', clubId).where('team.withdrawn', 'is', null)
    .orderBy('team.rank', ob => ob.asc().nullsLast()).orderBy('team.name')
    .execute()
  const players = await kysely.selectFrom('player')
    .leftJoin('team', 'team.id', 'player.team')
    .select(eb => ['player.id', fullName(eb).as('name'), 'player.club as clubId', 'player.team as teamId',
      'team.club as teamClubId', 'player.clubSecretary', 'player.matchSecrertary', 'player.teamCaptain',
      contact(eb, 'playerEmail').as('email'), contact(eb, 'playerTel').as('tel')])
    .where(eb => eb.or([eb('player.club', '=', clubId), eb('team.club', '=', clubId)]))
    .orderBy('player.first_name').orderBy('player.family_name').orderBy('player.id')
    .execute()
  return {
    club,
    teams,
    players: players.map(p => ({
      id: p.id, name: /** @type {string} */ (p.name).replace(/\s+/g, ' ').trim(),
      clubId: p.clubId, teamId: p.teamId, teamClubId: p.teamClubId,
      clubSecretary: p.clubSecretary === 1, matchSecretary: p.matchSecrertary === 1, teamCaptain: p.teamCaptain === 1,
      email: /** @type {string | null} */ (p.email) || null, tel: /** @type {string | null} */ (p.tel) || null,
    })),
  }
}

/**
 * Sets an officer's contact email and phone. Blank clears to NULL. Only a player who
 * holds an office at this club — a secretary flag with `club` here, or a captain flag on
 * one of its teams — is written; anyone else is 0 rows.
 * @param {number} clubId
 * @param {number} playerId
 * @param {{ email: string | null, tel: string | null }} values
 * @returns {Promise<number>} rows written
 */
exports.setContact = async function(clubId, playerId, values) {
  const r = await kysely.updateTable('player')
    .set({
      playerEmail: values.email ? encrypt(values.email) : null,
      playerTel: values.tel ? encrypt(values.tel) : null,
    })
    .where('player.id', '=', playerId)
    .where(eb => eb.or([
      eb.and([eb('player.club', '=', clubId),
        eb.or([eb('player.clubSecretary', '=', 1), eb('player.matchSecrertary', '=', 1)])]),
      eb.and([eb('player.teamCaptain', '=', 1),
        eb('player.team', 'in', eb.selectFrom('team').select('team.id').where('team.club', '=', clubId))]),
    ]))
    .executeTakeFirst()
  return Number(r.numUpdatedRows)
}

/**
 * Gives or takes a club or match secretary flag. Only a player whose `club` is this club.
 * @param {number} clubId
 * @param {number} playerId
 * @param {SecretaryColumn} column
 * @param {boolean} on
 * @returns {Promise<number>} rows written
 */
exports.setSecretary = async function(clubId, playerId, column, on) {
  if (!SECRETARY_COLUMNS.includes(column)) throw new Error(`Not a secretary column: ${column}`)
  const r = await kysely.updateTable('player')
    .set({ [column]: on ? 1 : 0 })
    .where('player.id', '=', playerId)
    .where('player.club', '=', clubId)
    .executeTakeFirst()
  return Number(r.numUpdatedRows)
}

/**
 * Makes `playerId` the team's one captain, or leaves it with none (`playerId` null). The
 * team must be this club's and the player must be on it; otherwise nothing changes and
 * this returns false. One transaction, so a team is never left with two captains or,
 * on a refused change, none.
 * @param {number} clubId
 * @param {number} teamId
 * @param {number | null} playerId
 * @returns {Promise<boolean>}
 */
exports.setCaptain = async function(clubId, teamId, playerId) {
  return db.withTransaction(async (/** @type {any} */ conn, /** @type {Db} */ trx) => {
    const team = await trx.selectFrom('team').select('team.id')
      .where('team.id', '=', teamId).where('team.club', '=', clubId).executeTakeFirst()
    if (!team) return false
    if (playerId !== null) {
      const onTeam = await trx.selectFrom('player').select('player.id')
        .where('player.id', '=', playerId).where('player.team', '=', teamId).executeTakeFirst()
      if (!onTeam) return false
    }
    await trx.updateTable('player').set({ teamCaptain: 0 })
      .where('player.team', '=', teamId).where('player.teamCaptain', '=', 1).execute()
    if (playerId !== null) {
      await trx.updateTable('player').set({ teamCaptain: 1 }).where('player.id', '=', playerId).execute()
    }
    return true
  })
}

exports.SECRETARY_COLUMNS = SECRETARY_COLUMNS
