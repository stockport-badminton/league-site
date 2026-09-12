// Read-only DB lookups for tests that need a real row id.
//
// /populated-scorecard-beta/:id is only ever reached from a link emailed to the
// away captain (see the confirmation flow in controllers/scorecardController.js),
// so there is no page a test can discover an id from, and hardcoding one would
// break as soon as that draft is processed.
//
// SELECT only, the same rule as e2e/helpers/read-only.js. The reason is no longer that
// dev.env points at production — since HARD-13 it points at the local Postgres, and
// e2e/server-env.js refuses to start otherwise — but that a helper which can write is how
// a suite ends up depending on rows it put there itself. A spec that writes does so
// through the app, in the open (see e2e/scorecard-submit.spec.js).

require('dotenv').config({ path: 'dev.env' });
const db = require('../../db_connect.js');

let connected = false;

async function query(sql, params) {
  if (!connected) { db.connect(); connected = true; }
  const [rows] = await (await db.otherConnect()).query(sql, params || []);
  return rows;
}

/** Newest scorecard draft id, or null if there are none. */
async function latestScorecardDraftId() {
  const rows = await query('SELECT id FROM scorecardstore ORDER BY id DESC LIMIT 1');
  return rows.length ? rows[0].id : null;
}

/**
 * The path a captain would follow from their email for the newest draft: the id plus
 * the confirmation token, which /populated-scorecard-beta/:id now requires (HARD-03).
 * Returns null when there are no drafts.
 *
 * The token is read through to_jsonb rather than as a column so that this works both
 * before and after migrations/011_scorecard_confirm_token.sql is applied — `->>` on a
 * key that isn't there is NULL, where a missing column is an error. A draft with no
 * token is grandfathered by the app and opens without one.
 */
async function latestScorecardDraftPath() {
  const rows = await query(
    `SELECT id, to_jsonb(s) ->> 'confirmToken' AS token
       FROM scorecardstore s ORDER BY id DESC LIMIT 1`);
  if (!rows.length) return null;
  const { id, token } = rows[0];
  return '/populated-scorecard-beta/' + id + (token ? '?t=' + encodeURIComponent(token) : '');
}

/** Newest messer draft id, or null if there are none. */
async function latestMesserDraftId() {
  const rows = await query('SELECT id FROM messer_scorecard ORDER BY id DESC LIMIT 1');
  return rows.length ? rows[0].id : null;
}

/**
 * Whether a draft actually holds scores. The one messer draft currently in the
 * database is a partial row with almost every score null, so asserting that the
 * populated view prefills would be asserting against the data rather than the
 * view. Tests use this to skip the prefill check while keeping the structural ones.
 */
async function draftHasScores(table, id) {
  if (!id) return false;
  // Whitelisted, not interpolated from anything a caller could vary at runtime.
  const allowed = { scorecardstore: true, messer_scorecard: true };
  if (!allowed[table]) throw new Error('unexpected table: ' + table);
  const rows = await query(
    `SELECT "Game1homeScore", "Game1awayScore" FROM "${table}" WHERE id = ?`, [id]);
  if (!rows.length) return false;
  return rows[0].Game1homeScore !== null || rows[0].Game1awayScore !== null;
}

/**
 * The newest season that is NOT the current one — i.e. one the archive actually serves,
 * and which appears in the season dropdown with a real value.
 *
 * Tests used to hardcode '20252026'. That is a past season in production and the CURRENT
 * season in the local development database, where it is therefore the empty-value option
 * — so the same assertion passed against one and failed against the other. Which season
 * is current is a property of the data, not of the page under test.
 */
async function pastSeasonName() {
  const rows = await query(
    'SELECT name FROM season ORDER BY "startDate" DESC LIMIT 2');
  return rows.length > 1 ? String(rows[1].name) : null;
}

/**
 * An outstanding fixture in the current season, as {fixtureId, division, homeTeam,
 * awayTeam, date} with ids as strings — the shape the form's dropdowns use.
 *
 * A submission spec files its draft against a REAL fixture rather than an invented
 * pairing, for two reasons. It is what a captain does, so the draft is one the results
 * secretary could actually confirm; and `dbq --check orphan-drafts` looks for exactly the
 * other thing — "filed scorecards that match no fixture", which is a real failure worth
 * reporting. A test that manufactures eight of them locally turns that check into noise on
 * the machine most likely to be the one running it.
 *
 * These fixtures come from tools/local-db/dev-fixtures.sql, which is why a caller skips
 * rather than fails when there are none: the seed in migrations/data/002_data.sql stops at
 * 2024/25 and has no outstanding fixture to file against.
 *
 * `to_char` on the date deliberately: fixture.date is a timestamp holding local midnight,
 * and reading it through a JS Date shifts it an hour (CLAUDE.md records tools/dbq.js
 * printing these an hour early for the same reason).
 */
async function outstandingFixture() {
  const rows = await query(
    `SELECT f.id, to_char(f.date, 'YYYY-MM-DD') AS date,
            f."homeTeam" AS "homeTeam", f."awayTeam" AS "awayTeam", ht.division AS division
       FROM fixture f
       JOIN team ht ON ht.id = f."homeTeam"
       JOIN team at ON at.id = f."awayTeam"
      WHERE (f.status IS NULL OR f.status = 'outstanding')
        AND f.date >= CURRENT_DATE - INTERVAL '60 days'
        AND ht.division = at.division
      ORDER BY f.date
      LIMIT 1`);
  if (!rows.length) return null;
  const row = rows[0];
  return {
    fixtureId: row.id,
    date: row.date,
    division: String(row.division),
    homeTeam: String(row.homeTeam),
    awayTeam: String(row.awayTeam),
  };
}

module.exports = {
  outstandingFixture,
  pastSeasonName,
  query, latestScorecardDraftId, latestScorecardDraftPath, latestMesserDraftId, draftHasScores
};
