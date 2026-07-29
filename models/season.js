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

// ---------------------------------------------------------------------------
// Season name validation
//
// A season is not a bind parameter — it is a table-name *suffix*, interpolated
// straight into SQL as `team${season}` / `club${season}` in eight model functions
// across four models. A table name cannot be parameterised, so the only defence is
// validating the value before it gets near a query.
//
// It arrives from the URL, and not always as a named :season param — /results/*,
// /player-stats/* and /pair-stats/* have their controllers pick it out of a path
// splat. So this is enforced at the model boundary, where every path converges.
//
// Confirmed reachable before this existed: requesting
// /tables/All/20252026%20AS%20team%20WHERE%20false%20-- came back
// `syntax error at or near "WHERE"` — i.e. the URL text was being parsed as SQL.
// The payload failed on the surrounding query's shape, which is luck, not a defence.
// ---------------------------------------------------------------------------

// Every real season name is 8 digits, `20YY20YY`. Anchored, digits only, so nothing
// that passes can carry a quote, space, comment marker or semicolon.
const NAME_PATTERN = /^20\d{6}$/;

let _servable = null;   // null until init() succeeds; see isServable()

exports.isValidName = function(season) {
  return NAME_PATTERN.test(String(season));
};

// Throw rather than return false: a model reached with a bad season should fail
// loudly, not quietly query the wrong table. Callers pass an empty/undefined season
// to mean "the live tables", which is always allowed.
exports.assertName = function(season) {
  if (season === undefined || season === null || season === '') return '';
  if (!exports.isValidName(season)) {
    const err = new Error('invalid season name: ' + JSON.stringify(String(season)));
    // A junk season in the URL is a bad request, not a server fault. The central
    // handler in routes/index.js renders a 404 for a 4xx status and skips Sentry,
    // so this does not refill the issue list the way NODE-Q did. Matters for
    // /results/*, /player-stats/* and /pair-stats/*, whose season is inside a path
    // splat and so never reaches the route-level guard.
    err.status = 404;
    throw err;
  }
  return String(season);
};

// Whether a season can actually be served: correct shape AND either the current
// season or one with an archived snapshot. Used by the route guard to answer 404
// instead of letting a well-formed but non-existent season reach SQL and come back
// as `relation "team20252027" does not exist` (Sentry NODE-Q).
//
// Falls back to shape-only when the allowlist could not be loaded, so a DB hiccup
// at boot degrades to "some 500s" rather than "every archive page 404s". Injection
// is blocked by the pattern either way.
exports.isServable = function(season) {
  if (season === undefined || season === null || season === '') return true;
  if (!exports.isValidName(season)) return false;
  if (!_servable) return true;
  return _servable.has(String(season));
};

// Load the servable set. Call after init(); safe to call again to refresh.
exports.loadServable = async function() {
  try {
    const rows = await exports.getAll();
    const set = new Set(rows.map(function(r) { return r.name; }));
    set.add(exports.current());
    _servable = set;
    return set.size;
  } catch (err) {
    console.error('season.loadServable failed; falling back to format-only checks:', err.message);
    _servable = null;
    return 0;
  }
};
