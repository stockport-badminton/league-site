// @ts-check
// A scorecard filled in live at the match — see migrations/022_live_scorecard.sql for the
// shape and utils/liveScorecard.js for the rules.
//
// Every write is ONE conditional UPDATE, because several phones write to the same row
// during a match. Each one bumps `rev` so the others' polls notice; content edits also bump
// `version` and clear both signatures in the same statement, so a signature can never
// outlive the scores it was given for. `status = 'live'` is in every edit's WHERE: once a
// card is filing or filed, an edit matches no row and the caller reports it as locked.

const { sql } = require('kysely');
const { kysely } = require('../db');
const { SLOTS, SIDES } = require('../utils/liveScorecard');

/** @typedef {import('kysely').RawBuilder<import('../db/schema').Json>} JsonExpr */

const COLUMNS = /** @type {const} */ ([
  'id', 'fixture_id', 'edit_token', 'home_token', 'away_token', 'players', 'games', 'version',
  'rev', 'status', 'home_signed_by', 'home_signed_at', 'away_signed_by', 'away_signed_at', 'draft_id',
  'created_by', 'created_email', 'created_at', 'updated_at',
]);

const CLEAR_SIGNATURES = {
  home_signed_by: null, home_signed_at: null, away_signed_by: null, away_signed_at: null,
};

// One card per fixture. ON CONFLICT rather than check-then-insert, so two captains pressing
// Start together get one card between them; the loser gets null and reads the winner's.
/**
 * @param {{ fixtureId: number, tokens: { edit: string, home: string, away: string },
 *   createdBy: string, createdEmail?: string | null }} card
 */
exports.create = async function({ fixtureId, tokens, createdBy, createdEmail }) {
  const row = await kysely.insertInto('live_scorecard')
    .values({ fixture_id: fixtureId, edit_token: tokens.edit, home_token: tokens.home, away_token: tokens.away,
      created_by: createdBy, created_email: createdEmail || null })
    .onConflict(oc => oc.column('fixture_id').doNothing())
    .returning(COLUMNS)
    .executeTakeFirst();
  return row || null;
};

/** @param {number} id */
exports.getById = async function(id) {
  const row = await kysely.selectFrom('live_scorecard').select(COLUMNS).where('id', '=', id).executeTakeFirst();
  return row || null;
};

/** @param {number} fixtureId */
exports.getByFixture = async function(fixtureId) {
  const row = await kysely.selectFrom('live_scorecard').select(COLUMNS).where('fixture_id', '=', fixtureId).executeTakeFirst();
  return row || null;
};

// Which of these fixtures already have a card, for the start page.
/** @param {number[]} fixtureIds */
exports.getForFixtures = async function(fixtureIds) {
  if (!fixtureIds.length) return [];
  return kysely.selectFrom('live_scorecard').select(['id', 'fixture_id', 'status', 'created_by'])
    .where('fixture_id', 'in', fixtureIds).execute();
};

// The fixture a card belongs to, with everything the page and the draft need.
// LEFT JOINs: a card must still open if a team or division row has gone missing.
// `datetext` is the stored timestamp as text — see toDraftRow for why it is not a Date.
/** @param {number} fixtureId */
exports.getContext = async function(fixtureId) {
  const r = await kysely.selectFrom('fixture as f')
    .leftJoin('team as ht', 'f.homeTeam', 'ht.id')
    .leftJoin('team as awt', 'f.awayTeam', 'awt.id')
    .leftJoin('division as d', 'ht.division', 'd.id')
    .select(eb => ['f.id as fixtureid', 'f.status as fixturestatus',
      eb.fn('to_char', ['f.date', sql.lit('YYYY-MM-DD HH24:MI:SS')]).as('datetext'),
      eb.fn('to_char', ['f.date', sql.lit('FMDay FMDD FMMonth YYYY')]).as('datelabel'),
      'f.homeTeam as hometeamid', 'ht.name as hometeamname',
      'f.awayTeam as awayteamid', 'awt.name as awayteamname',
      'ht.division as divisionid', 'd.name as divisionname'])
    .where('f.id', '=', fixtureId)
    .executeTakeFirst();
  if (!r) return null;
  return {
    fixtureId: r.fixtureid,
    fixtureStatus: r.fixturestatus,
    dateText: r.datetext,
    dateLabel: r.datelabel,
    homeTeamId: r.hometeamid,
    homeTeamName: r.hometeamname || 'Home',
    awayTeamId: r.awayteamid,
    awayTeamName: r.awayteamname || 'Away',
    divisionId: r.divisionid,
    divisionName: r.divisionname || '',
  };
};

// A content edit: the change, plus version and rev bumped and both signatures cleared, on
// a card that is still live. Null when no live card matched.
/** @param {number} id @param {{ players?: JsonExpr, games?: JsonExpr }} change */
async function edit(id, change) {
  const row = await kysely.updateTable('live_scorecard')
    .set(eb => ({ ...change, version: eb('version', '+', 1), rev: eb('rev', '+', 1),
      ...CLEAR_SIGNATURES, updated_at: eb.fn('now') }))
    .where('id', '=', id).where('status', '=', 'live')
    .returning(COLUMNS)
    .executeTakeFirst();
  return row || null;
}

// `playerId` null empties the slot. The slot is checked against SLOTS here as well as in the
// controller, because it becomes part of a jsonb path.
/** @param {number} id @param {string} slot @param {number | null} playerId */
exports.setPlayer = async function(id, slot, playerId) {
  if (SLOTS.indexOf(slot) === -1) throw new Error('unknown slot ' + slot);
  const players = playerId === null
    ? /** @type {JsonExpr} */ (sql`players - ${slot}::text`)
    : /** @type {JsonExpr} */ (sql`jsonb_set(players, ARRAY[${slot}::text], to_jsonb(${playerId}::int))`);
  return edit(id, { players });
};

// `score` null clears the game; otherwise {h, a, by}.
/** @param {number} id @param {number | string} n @param {{ h: number, a: number, by?: string } | null} score */
exports.setGame = async function(id, n, score) {
  const key = String(n);
  const games = score === null
    ? /** @type {JsonExpr} */ (sql`games - ${key}::text`)
    : /** @type {JsonExpr} */ (sql`jsonb_set(games, ARRAY[${key}::text], ${JSON.stringify(
      { h: score.h, a: score.a, by: score.by || '', at: new Date().toISOString() })}::jsonb)`);
  return edit(id, { games });
};

// A captain signs the version they were looking at. If anything changed since, no row
// matches and the caller tells them to look again — that is the whole point of `version`.
// Bumps `rev` only, so the other captain's view of the content stays signable.
/** @param {number} id @param {string} side @param {string} name @param {number} version */
exports.sign = async function(id, side, name, version) {
  if (SIDES.indexOf(side) === -1) throw new Error('unknown side ' + side);
  const row = await kysely.updateTable('live_scorecard')
    .set(eb => ({
      ...(side === 'home'
        ? { home_signed_by: name, home_signed_at: eb.fn('now') }
        : { away_signed_by: name, away_signed_at: eb.fn('now') }),
      rev: eb('rev', '+', 1), updated_at: eb.fn('now'),
    }))
    .where('id', '=', id).where('status', '=', 'live').where('version', '=', version)
    .returning(COLUMNS)
    .executeTakeFirst();
  return row || null;
};

// Both signed: exactly one request gets to file it.
/** @param {number} id */
exports.claimForFiling = async function(id) {
  const row = await kysely.updateTable('live_scorecard')
    .set(eb => ({ status: 'filing', rev: eb('rev', '+', 1), updated_at: eb.fn('now') }))
    .where('id', '=', id).where('status', '=', 'live')
    .where('home_signed_at', 'is not', null).where('away_signed_at', 'is not', null)
    .returning(COLUMNS)
    .executeTakeFirst();
  return row || null;
};

/** @param {number} id @param {number} draftId */
exports.markFiled = async function(id, draftId) {
  const row = await kysely.updateTable('live_scorecard')
    .set(eb => ({ status: 'filed', draft_id: draftId, rev: eb('rev', '+', 1), updated_at: eb.fn('now') }))
    .where('id', '=', id).where('status', '=', 'filing')
    .returning(COLUMNS)
    .executeTakeFirst();
  return row || null;
};

// Filing failed before a draft existed: put it back so the captains can sign again.
/** @param {number} id */
exports.releaseClaim = async function(id) {
  await kysely.updateTable('live_scorecard')
    .set(eb => ({ status: 'live', rev: eb('rev', '+', 1), updated_at: eb.fn('now') }))
    .where('id', '=', id).where('status', '=', 'filing')
    .execute();
};
