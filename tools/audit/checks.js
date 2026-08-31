// The league's data-integrity checks, in one place.
//
// Each of these was written by hand during the August 2026 audit and found
// something real. They exist as a module rather than as ad-hoc SQL so they can be
// run three ways from one definition:
//
//   node tools/dbq.js --check all          before and after any data work
//   node tools/dbq.js --check <name>       to see the offending rows
//   (planned) the weekly anomaly email     HARD-06 in docs/hardening
//
// Every failure these catch is silent in the UI — a half-applied result, an
// orphaned scorecard and an impossible score all render as a perfectly normal
// page. That is the whole point: these are the questions nobody thinks to ask.
//
// All read-only. Season-scoped checks resolve the current season from the season
// table rather than taking a parameter, so a check never needs arguments.

const CURRENT_SEASON_START =
  `(SELECT s."startDate" FROM season s WHERE s."startDate" <= now() ORDER BY s."startDate" DESC LIMIT 1)`;

// ---------------------------------------------------------------------------
// Rows that are known, investigated and accepted
// ---------------------------------------------------------------------------
//
// A check that reports the same accepted rows every week trains its reader to skim, and
// the whole value of the weekly email (HARD-07) is that a non-zero count means something.
// So an accepted row is excluded *by id*, with the reason next to it, rather than by a
// date floor — a floor would also hide the next problem of the same age, and it would not
// say why.
//
// Adding an id here is a decision to stop looking at something. It needs a reason
// somebody can disagree with later.

// Complete fixtures whose 18 game rows are gone for good.
//
// Their scores are corroborated exactly: each has a surviving draft whose 18 games total
// to the recorded result (7-11, 14-4, 10-8, 10-8), so the league tables are right and
// only the per-rubber detail is missing.
//
// They are not reconstructable from those drafts. `scorecardstore` stores the squad and
// the mixed pairings, and the level-doubles pairings are derived from the squad by a
// fixed pattern — but tested against 120 historical fixtures that have both a draft and
// game rows, the derivation reproduces only 99, and 98 of 110 even when restricted to
// fixtures with the same clean profile as these four. So roughly one rebuild in nine
// would credit the wrong players in the wrong rubbers, undetectably. Writing 72
// probably-right rows into league history was judged worse than leaving four gaps
// (Neil, 31 Aug 2026).
const ACCEPTED_ORPHAN_RESULTS = [6117, 6576, 6037, 6017];

// Complete fixtures whose scores do not total 18 and cannot be corrected.
//
// None has game rows or a surviving draft, so there is nothing to arbitrate what was
// really played: 2012, 2013, 2015 (x2), 2017, 2018, and a 3-3 from May 2023. Voiding them
// would delete results that did happen because somebody mistyped the score years ago
// (Neil, 31 Aug 2026 — leave them).
//
// Fixture 345 was the eighth member of this set and is *not* here: it still had all 18
// game rows, which said 4-14 against a recorded 2-14, so it was corrected rather than
// accepted.
const ACCEPTED_BAD_TOTALS = [4688, 1327, 1777, 2261, 2016, 3236, 3734];

// Renders an id list for a NOT IN (...) clause. Empty list has to be handled: `NOT IN ()`
// is a syntax error, and `NOT IN (NULL)` silently matches nothing at all — which would
// turn an emptied allowlist into a check that reports zero rows forever.
function excluding(column, ids) {
  return ids.length ? `AND ${column} NOT IN (${ids.join(', ')})` : '';
}

const CHECKS = [
  {
    name: 'orphan-results',
    description: 'Complete fixtures with no game rows — a submission that committed halfway',
    severity: 'critical',
    // LEFT JOIN, for the reason spelled out on bad-totals below: this check inner-joined
    // team, and 2,132 fixtures point at a team that no longer exists, so it could only
    // ever have reported the subset whose teams happen to survive.
    //
    // The four accepted rows are excluded — see ACCEPTED_ORPHAN_RESULTS. This is the
    // check HARD-01 was written to stop producing new rows, so a non-zero count here now
    // means the transaction failed and is worth waking up for.
    sql: `
      SELECT f.id, to_char(f.date,'YYYY-MM-DD') AS played,
             COALESCE(ht.name, '?#' || f."homeTeam") AS home,
             f."homeScore", f."awayScore",
             COALESCE(at.name, '?#' || f."awayTeam") AS away
      FROM fixture f
      LEFT JOIN team ht ON f."homeTeam" = ht.id
      LEFT JOIN team at ON f."awayTeam" = at.id
      WHERE f.status = 'complete'
        AND f.date > now() - interval '3 years'
        AND NOT EXISTS (SELECT 1 FROM game g WHERE g.fixture = f.id)
        ${excluding('f.id', ACCEPTED_ORPHAN_RESULTS)}
      ORDER BY f.date DESC`
  },
  {
    name: 'orphan-drafts',
    description: 'Filed scorecards that match no fixture — the captain thinks it is reported',
    severity: 'high',
    // The match was `f.date = s.date`: equality on a *timestamp*, not a date. So a draft
    // dated one day either side of its fixture — or the same day with a different time
    // component, which is most of them, since fixture dates carry a kick-off time and a
    // draft carries whatever the captain picked — counted as matching nothing.
    //
    // On 31 Aug 2026 every one of the four rows it reported was a false positive. All
    // four results were correctly recorded and complete with 18 game rows: 2275 and 2349
    // are the same match filed twice against fixture 6545, 2290 matches 6054, and 2404
    // matches 6578, a conceded 18-0 the draft also records as 18-0.
    //
    // That is worse than a cosmetic bug. HARD-09's brief says to "match them to their
    // fixtures by hand and publish", which against these rows would have published four
    // results that were already published, double-counting league points — and HARD-07
    // would have mailed them out weekly as outstanding problems.
    //
    // A window rather than equality, and it also stops caring which of several drafts
    // matched: a captain filing twice is not an orphan, it is a duplicate, and the
    // question this check asks is "is there a completed fixture for this scorecard".
    sql: `
      SELECT s.id AS draft, to_char(s.date,'YYYY-MM-DD') AS dated,
             COALESCE(ht.name, '?#' || s."homeTeam") AS home,
             COALESCE(at.name, '?#' || s."awayTeam") AS away
      FROM scorecardstore s
      LEFT JOIN team ht ON s."homeTeam" = ht.id
      LEFT JOIN team at ON s."awayTeam" = at.id
      WHERE s.date > now() - interval '18 months'
        AND NOT EXISTS (
          SELECT 1 FROM fixture f
          WHERE f."homeTeam" = s."homeTeam"
            AND f."awayTeam" = s."awayTeam"
            AND f.date::date BETWEEN s.date::date - 3 AND s.date::date + 3
            AND f.status IN ('complete', 'conceded')
        )
      ORDER BY s.date DESC`
  },
  {
    name: 'unplayed-fixtures',
    description: 'Fixtures whose date has passed but which are still outstanding',
    severity: 'high',
    // This check reported 0 while 114 fixtures sat past-dated and outstanding, for two
    // independent reasons, either of which was enough on its own:
    //
    //   1. `f.date > CURRENT_SEASON_START` floored it at the current season, so anything
    //      abandoned in an earlier one — 89 from 2020, 10 from 2019, 1 from 2018, and 14
    //      with their dates zeroed to 1900-01-01 — was out of scope by construction.
    //   2. It inner-joined team, and 73 of those 114 pointed at deleted team #41, so
    //      they would have been dropped even inside the window.
    //
    // The 114 were voided on 31 Aug 2026. The season floor is gone so that a fixture
    // abandoned in a *past* season is still a finding, and the joins are LEFT so a
    // withdrawn team cannot hide one.
    sql: `
      SELECT f.id, to_char(f.date,'YYYY-MM-DD') AS due,
             COALESCE(ht.name, '?#' || f."homeTeam") AS home,
             COALESCE(at.name, '?#' || f."awayTeam") AS away
      FROM fixture f
      LEFT JOIN team ht ON f."homeTeam" = ht.id
      LEFT JOIN team at ON f."awayTeam" = at.id
      WHERE f.status = 'outstanding'
        AND f.date < now() - interval '7 days'
      ORDER BY f.date`
  },
  {
    // LEFT JOIN deliberately. An inner join here reported 2 of the 8 offending
    // fixtures, because six of them point at teams that no longer exist — see
    // the orphan-team-refs check below. A data check must never hide a row by
    // requiring the rest of the data to be sound.
    name: 'bad-totals',
    description: 'Complete league fixtures whose scores do not total 18 games',
    severity: 'medium',
    sql: `
      SELECT f.id, to_char(f.date,'YYYY-MM-DD') AS played,
             f."homeScore", f."awayScore", f."homeScore" + f."awayScore" AS total,
             COALESCE(ht.name, '?#' || f."homeTeam") AS home,
             COALESCE(at.name, '?#' || f."awayTeam") AS away
      FROM fixture f
      LEFT JOIN team ht ON f."homeTeam" = ht.id
      LEFT JOIN team at ON f."awayTeam" = at.id
      WHERE f.status = 'complete'
        AND f."homeScore" IS NOT NULL AND f."awayScore" IS NOT NULL
        AND f."homeScore" + f."awayScore" <> 18
        ${excluding('f.id', ACCEPTED_BAD_TOTALS)}
      ORDER BY f.date DESC`
  },
  {
    name: 'orphan-team-refs',
    description: 'Fixtures pointing at a team id that no longer exists — there is no foreign key',
    severity: 'medium',
    sql: `
      SELECT f.id, to_char(f.date,'YYYY-MM-DD') AS played, f.status,
             f."homeTeam", f."awayTeam",
             COALESCE(ht.name, '— missing —') AS home,
             COALESCE(at.name, '— missing —') AS away
      FROM fixture f
      LEFT JOIN team ht ON f."homeTeam" = ht.id
      LEFT JOIN team at ON f."awayTeam" = at.id
      WHERE ht.id IS NULL OR at.id IS NULL
      ORDER BY f.date DESC`
  },
  {
    name: 'ambiguous-pairings',
    description: 'Team pairings with two outstanding fixtures — a result would land on an arbitrary one',
    severity: 'high',
    sql: `
      SELECT ht.name AS home, at.name AS away, COUNT(*) AS outstanding,
             string_agg(f.id || ' (' || to_char(f.date,'YYYY-MM-DD') || ')', ', ' ORDER BY f.date) AS fixtures
      FROM fixture f
      JOIN team ht ON f."homeTeam" = ht.id
      JOIN team at ON f."awayTeam" = at.id
      WHERE f.status = 'outstanding' AND f.date > ${CURRENT_SEASON_START}
      GROUP BY 1, 2
      HAVING COUNT(*) > 1`
  },
  {
    name: 'duplicate-ranks',
    description: 'Two nominated players sharing a rank in the same team and gender',
    severity: 'medium',
    sql: `
      SELECT t.name AS team, p.gender, p.rank, COUNT(*) AS players,
             string_agg(trim(p.first_name || ' ' || p.family_name), ', ') AS who
      FROM player p JOIN team t ON p.team = t.id
      WHERE p.rank IS NOT NULL AND p.rank < 99 AND p.team <> 52
      GROUP BY 1, 2, 3
      HAVING COUNT(*) > 1
      ORDER BY 1, 2, 3`
  },
  {
    name: 'unranked-players',
    description: 'Players on a live team with no rank — read as nominated by default',
    severity: 'low',
    sql: `
      SELECT p.id, trim(p.first_name || ' ' || p.family_name) AS name, p.gender, t.name AS team
      FROM player p JOIN team t ON p.team = t.id
      WHERE p.rank IS NULL AND p.team <> 52
      ORDER BY t.name, p.gender`
  },
  {
    name: 'short-squads',
    description: 'Teams that cannot field three men and three ladies',
    severity: 'medium',
    sql: `
      SELECT t.name AS team, d.name AS division,
             COUNT(*) FILTER (WHERE p.gender = 'Male') AS men,
             COUNT(*) FILTER (WHERE p.gender = 'Female') AS ladies
      FROM team t
      JOIN division d ON t.division = d.id
      LEFT JOIN player p ON p.team = t.id
      GROUP BY 1, 2
      HAVING COUNT(*) FILTER (WHERE p.gender = 'Male') < 3
          OR COUNT(*) FILTER (WHERE p.gender = 'Female') < 3
      ORDER BY 1`
  },
  {
    name: 'ghost-teams',
    description: 'Teams in a division with no fixtures this season — they show as an empty table row',
    severity: 'medium',
    sql: `
      SELECT t.id, t.name AS team, d.name AS division,
             (SELECT COUNT(*) FROM player p WHERE p.team = t.id) AS players
      FROM team t
      JOIN division d ON t.division = d.id
      WHERE NOT EXISTS (
        SELECT 1 FROM fixture f
        WHERE (f."homeTeam" = t.id OR f."awayTeam" = t.id)
          AND f.date > ${CURRENT_SEASON_START})
      ORDER BY t.name`
  },
  {
    name: 'missing-contact',
    description: 'Officers (captain, club or match secretary) with no contact email',
    severity: 'medium',
    sql: `
      SELECT t.name AS team, trim(p.first_name || ' ' || p.family_name) AS officer,
             CASE WHEN p."teamCaptain" = 1 THEN 'captain'
                  WHEN p."clubSecretary" = 1 THEN 'club sec'
                  ELSE 'match sec' END AS role
      FROM player p
      LEFT JOIN team t ON p.team = t.id
      WHERE (p."teamCaptain" = 1 OR p."clubSecretary" = 1 OR p."matchSecrertary" = 1)
        AND COALESCE(NULLIF(TRIM(pgp_sym_decrypt(p."playerEmail", current_setting('app.pi_key', true))::text), ''), '') = ''
      ORDER BY 1`,
    // Needs the PI key, which is an env var rather than a database setting — the
    // runner substitutes it. Kept declarative so the weekly email can reuse it.
    needsKey: true
  }
];

exports.all = () => CHECKS.map(({ name, description, severity }) => ({ name, description, severity }));

exports.get = name => {
  const c = CHECKS.find(x => x.name === name);
  if (!c) return null;
  return { ...c, sql: withKey(c) };
};

// pgp_sym_decrypt needs DB_PI_KEY, which lives in the environment. Bound as a
// literal here because these run as one-off diagnostics with no user input; a
// query that takes a parameter should use a placeholder instead.
function withKey(check) {
  if (!check.needsKey) return check.sql;
  const key = process.env.DB_PI_KEY;
  if (!key) throw new Error(`check "${check.name}" needs DB_PI_KEY in the environment`);
  return check.sql.replace(/current_setting\('app\.pi_key', true\)/g, `'${key.replace(/'/g, "''")}'`);
}

exports.runAll = async function(conn) {
  const out = [];
  for (const check of CHECKS) {
    try {
      const [rows] = await conn.query(withKey(check));
      out.push({ name: check.name, description: check.description, severity: check.severity, rows });
    } catch (err) {
      out.push({ name: check.name, description: check.description, severity: check.severity,
                 rows: [], error: err.message });
    }
  }
  return out;
};
