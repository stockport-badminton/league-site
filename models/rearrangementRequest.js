// @ts-check
// Fixture rearrangement emails forwarded to rearrangements@. See migrations/035 for what is
// stored; utils/rearrangementEmail.js reads the email and
// controllers/rearrangementRequestController.js is the page that confirms it.
//
// Also the reads that page needs about fixtures — the candidates an email points at, a
// team's usual home night, what else is on the new date — kept here rather than in
// models/fixture.js because nothing else asks these questions.

const { sql } = require('kysely')
const { kysely, decrypt } = require('../db')
const seasonModel = require('./season')

/** @typedef {import('kysely').RawBuilder<string>} StringExpr */
/** @param {string} col */
const day = col => /** @type {StringExpr} */ (sql`to_char(${sql.ref(col)}, 'YYYY-MM-DD')`)

// Queue one email. Returns its id, or null when this message is already queued — SNS
// delivers at least once.
/**
 * @param {{ messageId: string, forwardedBy?: string | null, originalFrom?: string | null,
 *   subject?: string | null, bodyText?: string | null, reading?: unknown }} email
 */
exports.create = async function({ messageId, forwardedBy, originalFrom, subject, bodyText, reading }) {
  const row = await kysely.insertInto('rearrangement_request')
    .values({
      message_id: messageId, forwarded_by: forwardedBy, original_from: originalFrom, subject,
      body_text: bodyText,
      // jsonb takes JSON.stringify(value), as registrationRequest.create explains.
      reading: JSON.stringify(reading || {}),
    })
    .onConflict(oc => oc.column('message_id').doNothing())
    .returning('id')
    .executeTakeFirst()
  return row ? Number(row.id) : null
}

/** @param {string} status */
exports.list = async function(status) {
  return kysely.selectFrom('rearrangement_request')
    .select(['id', 'received_at as receivedAt', 'forwarded_by as forwardedBy',
      'original_from as originalFrom', 'subject', 'outcome', 'status',
      'closed_at as closedAt', 'closed_by as closedBy'])
    .where('status', '=', status)
    .orderBy('received_at', 'desc')
    .limit(100)
    .execute()
}

exports.countPending = async function() {
  const row = await kysely.selectFrom('rearrangement_request')
    .select(eb => eb.cast(eb.fn.countAll(), 'integer').as('n'))
    .where('status', '=', 'pending')
    .executeTakeFirst()
  return row ? Number(row.n) : 0
}

/** @param {number} id */
exports.getById = async function(id) {
  const row = await kysely.selectFrom('rearrangement_request')
    .select(['id', 'received_at as receivedAt', 'forwarded_by as forwardedBy',
      'original_from as originalFrom', 'subject', 'body_text as bodyText', 'reading',
      'outcome', 'status', 'closed_at as closedAt', 'closed_by as closedBy'])
    .where('id', '=', id)
    .executeTakeFirst()
  return row || null
}

/** @param {number} id @param {string} status @param {string | null} by */
exports.setStatus = async function(id, status, by) {
  const closing = status !== 'pending'
  const row = await kysely.updateTable('rearrangement_request')
    .set(eb => ({ status, closed_at: closing ? eb.fn('now') : null, closed_by: closing ? by : null }))
    .where('id', '=', id)
    .returning('id')
    .executeTakeFirst()
  return !!row
}

// Record what was applied and close the request, inside the rearrangement's transaction
// (Fixture.rearrangeById's `withinTransaction`). Only a pending request: a request already
// closed returns false, and the caller throws so the fixture change rolls back with it.
/**
 * @param {import('kysely').Kysely<import('../db/schema').DB>} trx
 * @param {number} id @param {unknown} outcome @param {string | null} by
 */
exports.recordOutcome = async function(trx, id, outcome, by) {
  const row = await trx.updateTable('rearrangement_request')
    .set(eb => ({ outcome: JSON.stringify(outcome), status: 'done', closed_at: eb.fn('now'), closed_by: by }))
    .where('id', '=', id)
    .where('status', '=', 'pending')
    .returning('id')
    .executeTakeFirst()
  return !!row
}

// The clubs and live teams an email might name. No Club's teams are retired names
// ("Unknown team") and a withdrawn team cannot be rearranged.
/** @param {number} noClubId */
exports.clubsAndTeams = async function(noClubId) {
  const [clubs, teams] = await Promise.all([
    kysely.selectFrom('club').select(['id', 'name']).where('id', '<>', noClubId).orderBy('name').execute(),
    kysely.selectFrom('team').select(['id', 'name', 'club as clubId'])
      .where('club', '<>', noClubId).where('withdrawn', 'is', null).orderBy('name').execute(),
  ])
  return { clubs, teams }
}

// This season's fixtures, in the shape the page and utils/rearrangementEmail.propose use.
function seasonFixtures() {
  return kysely.selectFrom('fixture as f')
    .innerJoin('season as s', join => join.on('s.name', '=', seasonModel.current()))
    .innerJoin('team as h', 'h.id', 'f.homeTeam')
    .innerJoin('team as a', 'a.id', 'f.awayTeam')
    .leftJoin('division as d', 'd.id', 'h.division')
    .select(eb => ['f.id', day('f.date').as('date'),
      eb.fn('to_char', ['f.date', sql.lit('Dy FMDD Mon YYYY')]).as('dayLabel'),
      'f.status', 'f.homeScore', 'f.awayScore',
      'f.homeTeam as homeTeamId', 'f.awayTeam as awayTeamId',
      'h.name as homeTeam', 'a.name as awayTeam',
      'h.club as homeClubId', 'a.club as awayClubId', 'd.name as division'])
    .whereRef('f.date', '>=', 's.startDate')
    .whereRef('f.date', '<=', 's.endDate')
}

// The fixtures an email could be about:
//  - on a date it mentions, involving a club it names (or any club, when it names none);
//  - already 'rearranging' between two clubs it names, which is what the second email —
//    "the date is now agreed" — is about, and it need not repeat the original date;
//  - every remaining fixture of `teamId`, when the page asks ("not listed? pick a team").
/** @param {{ dates: string[], clubIds: number[], teamId?: number | null }} reading */
exports.candidateFixtures = async function({ dates, clubIds, teamId }) {
  if (!dates.length && clubIds.length < 2 && !teamId) return []
  return seasonFixtures()
    .where(eb => {
      const either = []
      if (dates.length) {
        const onDate = eb(day('f.date'), 'in', dates)
        either.push(clubIds.length
          ? eb.and([onDate, eb.or([eb('h.club', 'in', clubIds), eb('a.club', 'in', clubIds)])])
          : onDate)
      }
      if (clubIds.length >= 2) {
        either.push(eb.and([eb('f.status', '=', 'rearranging'),
          eb('h.club', 'in', clubIds), eb('a.club', 'in', clubIds)]))
      }
      if (teamId) {
        either.push(eb.and([
          eb.or([eb('f.homeTeam', '=', teamId), eb('f.awayTeam', '=', teamId)]),
          eb('f.homeScore', 'is', null),
          eb.or([eb('f.status', 'is', null), eb('f.status', 'in', ['outstanding', 'rearranging'])]),
        ]))
      }
      return eb.or(either)
    })
    .orderBy('f.date').orderBy('h.name')
    .limit(60)
    .execute()
}

/** @param {number} id */
exports.fixtureById = async function(id) {
  return (await seasonFixtures().where('f.id', '=', id).executeTakeFirst()) || null
}

// The weekdays a team plays its home fixtures on this season, most common first, as
// [{ dow, n }] with dow 0 = Sunday. The "usual home night" the secretary checks by eye; read
// from the fixtures rather than club.matchNightText, which is free text and often empty.
/** @param {number} teamId */
exports.homeWeekdays = async function(teamId) {
  const dow = /** @type {import('kysely').RawBuilder<number>} */ (sql`extract(dow from f.date)::int`)
  return kysely.selectFrom('fixture as f')
    .innerJoin('season as s', join => join.on('s.name', '=', seasonModel.current()))
    .select(eb => [dow.as('dow'), eb.cast(eb.fn.countAll(), 'integer').as('n')])
    .where('f.homeTeam', '=', teamId)
    .whereRef('f.date', '>=', 's.startDate')
    .whereRef('f.date', '<=', 's.endDate')
    .where(eb => eb.or([eb('f.status', 'is', null), eb('f.status', 'not in', ['rearranged', 'void'])]))
    .groupBy(dow)
    .orderBy('n', 'desc')
    .execute()
}

// Everything either team has on a date, other than the fixture being moved. A team with two
// matches on one night is the clash worth flagging.
/** @param {string} date YYYY-MM-DD @param {number[]} teamIds @param {number} exceptId */
exports.fixturesOn = async function(date, teamIds, exceptId) {
  return seasonFixtures()
    .where(day('f.date'), '=', date)
    .where('f.id', '<>', exceptId)
    .where(eb => eb.or([eb('f.homeTeam', 'in', teamIds), eb('f.awayTeam', 'in', teamIds)]))
    .where(eb => eb.or([eb('f.status', 'is', null), eb('f.status', 'not in', ['rearranged', 'void'])]))
    .execute()
}

// Where a rearranged fixture went: the next fixture between the same pairing this season.
/** @param {{ id: number, homeTeamId: number, awayTeamId: number }} fixture */
exports.replacementOf = async function(fixture) {
  return (await seasonFixtures()
    .where('f.homeTeam', '=', fixture.homeTeamId)
    .where('f.awayTeam', '=', fixture.awayTeamId)
    .where('f.id', '>', fixture.id)
    .orderBy('f.id')
    .executeTakeFirst()) || null
}

/** @returns {Promise<string | null>} */
exports.seasonEnd = async function() {
  const row = await kysely.selectFrom('season').select(day('endDate').as('end'))
    .where('name', '=', seasonModel.current()).executeTakeFirst()
  return row ? row.end : null
}

// Who on file has this email address, as contact or login, with their team and offices —
// so the page can say "Hannah Hernon, captain of Dome B" rather than just an address.
/** @param {string} address */
exports.playersByEmail = async function(address) {
  const wanted = String(address || '').trim().toLowerCase()
  if (!wanted.includes('@')) return []
  const lower = (/** @type {any} */ eb, /** @type {any} */ col) => eb.fn('lower', [eb.fn('trim', [decrypt(eb.ref(col))])])
  return kysely.selectFrom('player as p')
    .leftJoin('team as t', 't.id', 'p.team')
    .leftJoin('club as c', 'c.id', 'p.club')
    .select(['p.id', 'p.first_name as firstName', 'p.family_name as familyName',
      't.name as team', 'p.club as clubId', 'c.name as club',
      'p.teamCaptain', 'p.clubSecretary', 'p.matchSecrertary'])
    .where(eb => eb.or([eb(lower(eb, 'p.playerEmail'), '=', wanted), eb(lower(eb, 'p.authEmail'), '=', wanted)]))
    .limit(5)
    .execute()
}
