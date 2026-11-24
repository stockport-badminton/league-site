// @ts-check
// Web push: who is subscribed to which teams, and the ledger of sends (migrations/039_push.sql).
// The sending itself is utils/push/; docs/claude/push.md has the design.

const { sql } = require('kysely');
const { kysely } = require('../db');

/** @typedef {'results' | 'reminders'} PushType */

/**
 * Save a browser's subscription, or update the teams and types of one already saved.
 * @param {{ id: string, endpoint: string, p256dh: string, auth: string, teams: number[], types: string[] }} s
 */
exports.upsertSubscription = async function(s) {
  await kysely.insertInto('push_subscription')
    .values({ id: s.id, endpoint: s.endpoint, p256dh: s.p256dh, auth: s.auth, teams: s.teams, types: s.types })
    .onConflict(oc => oc.column('id').doUpdateSet(eb => ({
      endpoint: eb.ref('excluded.endpoint'),
      p256dh: eb.ref('excluded.p256dh'),
      auth: eb.ref('excluded.auth'),
      teams: eb.ref('excluded.teams'),
      types: eb.ref('excluded.types'),
      updated_at: eb.fn('now'),
    })))
    .execute();
};

/** @param {string} id */
exports.getSubscription = async function(id) {
  const row = await kysely.selectFrom('push_subscription').select(['teams', 'types'])
    .where('id', '=', id).executeTakeFirst();
  return row || null;
};

/** @param {string[]} ids @returns {Promise<number>} rows deleted */
exports.removeSubscriptions = async function(ids) {
  if (!ids.length) return 0;
  const res = await kysely.deleteFrom('push_subscription').where('id', 'in', ids).executeTakeFirst();
  return Number(res.numDeletedRows);
};

/**
 * Subscriptions that want a notification about any of `teams` of kind `type`. No teams means
 * every subscription (a test send); a subscription with no types wants every type.
 * @param {{ teams?: number[], type?: PushType }} what
 */
exports.subscribersFor = async function({ teams, type }) {
  return kysely.selectFrom('push_subscription')
    .select(['id', 'endpoint', 'p256dh', 'auth'])
    // One array parameter: a bare JS array here is spread into a row, `integer[] && record`.
    .$if(!!(teams && teams.length), qb => qb.where('teams', '&&',
      /** @type {import('kysely').RawBuilder<number[]>} */ (sql`${sql.val(teams)}::int[]`)))
    .$if(!!type, qb => qb.where(eb => eb.or([
      eb(eb.fn('cardinality', ['types']), '=', 0),
      eb(eb.val(/** @type {string} */ (type)), '=', eb.fn.any('types')),
    ])))
    .orderBy('id')
    .execute();
};

/** @param {string[]} ids */
exports.markSent = async function(ids) {
  if (!ids.length) return;
  await kysely.updateTable('push_subscription').set(eb => ({ last_sent_at: eb.fn('now') }))
    .where('id', 'in', ids).execute();
};

/**
 * Claim a send before making it. True for the first caller with this key, false for every
 * later one, so a send happens at most once.
 * @param {string} key
 */
exports.claimSend = async function(key) {
  const row = await kysely.insertInto('push_send').values({ key })
    .onConflict(oc => oc.column('key').doNothing())
    .returning('key').executeTakeFirst();
  return !!row;
};

/** @param {string} key @param {object} summary */
exports.recordSummary = async function(key, summary) {
  await kysely.updateTable('push_send').set({ summary: JSON.stringify(summary) })
    .where('key', '=', key).execute();
};

/** @param {number} limit */
exports.recentSends = async function(limit) {
  return kysely.selectFrom('push_send').select(['key', 'sent_at as sentAt', 'summary'])
    .orderBy('sent_at', 'desc').limit(limit).execute();
};

/** How many subscriptions follow each team, most followed first. */
exports.teamCounts = async function() {
  const subs = await kysely.selectFrom('push_subscription').select('teams').execute();
  /** @type {Map<number, number>} */
  const counts = new Map();
  for (const s of subs) for (const t of s.teams) counts.set(t, (counts.get(t) || 0) + 1);
  if (!counts.size) return { subscriptions: subs.length, teams: [] };
  const names = await kysely.selectFrom('team').select(['id', 'name'])
    .where('id', 'in', [...counts.keys()]).execute();
  const nameOf = new Map(names.map(n => [n.id, n.name]));
  const teams = [...counts].map(([id, subscribers]) => ({ id, name: nameOf.get(id) || `team ${id}`, subscribers }))
    .sort((a, b) => b.subscribers - a.subscribers || a.name.localeCompare(b.name));
  return { subscriptions: subs.length, teams };
};

/**
 * The teams a subscriber can follow: league teams in a division that exists and not withdrawn,
 * with their club, in club order. Also the set a subscription's teams are checked against.
 * The division join is INNER on purpose: the "No Team" placeholder sits in division 0, which
 * has no row.
 */
exports.followableTeams = async function() {
  return kysely.selectFrom('team')
    .innerJoin('club', 'club.id', 'team.club')
    .innerJoin('division', 'division.id', 'team.division')
    .select(['team.id', 'team.name', 'club.id as clubId', 'club.name as clubName', 'division.name as divisionName'])
    .where('team.withdrawn', 'is', null)
    .orderBy('club.name').orderBy('team.rank').orderBy('team.name')
    .execute();
};

// The fixture a notification is built from. The venue is the home team's, as on the homepage.
function fixtureQuery() {
  return kysely.selectFrom('fixture')
    .innerJoin('team as home', 'home.id', 'fixture.homeTeam')
    .innerJoin('team as away', 'away.id', 'fixture.awayTeam')
    .leftJoin('division', 'division.id', 'home.division')
    .leftJoin('venue', 'venue.id', 'home.venue')
    .select(['fixture.id', 'fixture.date', 'fixture.status', 'fixture.homeScore', 'fixture.awayScore',
      'fixture.homeTeam as homeTeamId', 'fixture.awayTeam as awayTeamId',
      'home.name as homeTeam', 'away.name as awayTeam', 'home.starttime as startTime',
      'division.name as divisionName', 'venue.name as venueName']);
}

/** @typedef {Awaited<ReturnType<ReturnType<typeof fixtureQuery>['executeTakeFirstOrThrow']>>} PushFixture */

/** @param {number} fixtureId @returns {Promise<PushFixture | null>} */
exports.resultFor = async function(fixtureId) {
  const row = await fixtureQuery()
    .where('fixture.id', '=', fixtureId).executeTakeFirst();
  return row || null;
};

/**
 * Fixtures still to be played on one calendar day. `fixture.date` is a timestamp without time
 * zone holding the UK date at midnight, so its date part is the UK date, with no time zone
 * arithmetic (and no JS Date, which `pg` would serialise in the process's local zone).
 * @param {string} ymd  YYYY-MM-DD, a UK date
 * @returns {Promise<PushFixture[]>}
 */
exports.remindersFor = async function(ymd) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) throw new Error('remindersFor: not a date: ' + ymd);
  return fixtureQuery()
    .where(/** @type {import('kysely').RawBuilder<string>} */ (sql`fixture.date::date`), '=', ymd)
    .where('fixture.status', '=', 'outstanding')
    .orderBy('fixture.id')
    .execute();
};
