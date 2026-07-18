var db = require('../db_connect.js');

// Fallback season derivation, used only until init() runs or if the DB lookup
// fails. Matches the historical rule (rolls over on 1 August). offset 0 =
// current, 1 = previous.
function dateBasedSeason(offset) {
  var year = new Date().getFullYear();
  var startYear = (new Date().getMonth() < 7 ? year - 1 : year) - offset;
  return `${startYear}${startYear + 1}`;
}

var _current = null;
var _previous = null;

// Determine the current/previous season from the season table, picking the
// season whose startDate has most recently passed. This is robust to
// overlapping season windows (unlike a "today between start and end" check)
// and doesn't depend on end dates being correct.
//
// Cached for the process lifetime (same freshness as the old module-load
// constant it replaces); Cloud Run refreshes it whenever an instance restarts
// on deploy/scaling. Call once at startup after db.connect().
exports.init = async function() {
  try {
    const [rows] = await (await db.otherConnect()).query(
      'SELECT name FROM season WHERE "startDate" <= now() ORDER BY "startDate" DESC LIMIT 2'
    );
    if (rows && rows.length) {
      _current = rows[0].name;
      _previous = rows[1] ? rows[1].name : dateBasedSeason(1);
    }
  } catch (err) {
    console.error('season.init failed; using date-based fallback:', err.message);
  }
  return { current: exports.current(), previous: exports.previous() };
};

exports.current = function() { return _current || dateBasedSeason(0); };
exports.previous = function() { return _previous || dateBasedSeason(1); };

// Seasons that have an archived data snapshot (a team<season> table), newest
// first — used to build the History nav / archive. Seasons in the season table
// without a snapshot (e.g. 2020-21 COVID, or the current season) are excluded,
// since /results and /tables would 500 on a missing table.
exports.getAll = async function() {
  const [rows] = await (await db.otherConnect()).query(
    `SELECT s.name, s.label
     FROM season s
     WHERE EXISTS (
       SELECT 1 FROM information_schema.tables t
       WHERE t.table_name = 'team' || s.name
     )
     ORDER BY s."startDate" DESC`
  );
  return rows;
};
