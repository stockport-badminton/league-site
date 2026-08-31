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

const CHECKS = [
  {
    name: 'orphan-results',
    description: 'Complete fixtures with no game rows — a submission that committed halfway',
    severity: 'critical',
    sql: `
      SELECT f.id, to_char(f.date,'YYYY-MM-DD') AS played,
             ht.name AS home, f."homeScore", f."awayScore", at.name AS away
      FROM fixture f
      JOIN team ht ON f."homeTeam" = ht.id
      JOIN team at ON f."awayTeam" = at.id
      WHERE f.status = 'complete'
        AND f.date > now() - interval '3 years'
        AND NOT EXISTS (SELECT 1 FROM game g WHERE g.fixture = f.id)
      ORDER BY f.date DESC`
  },
  {
    name: 'orphan-drafts',
    description: 'Filed scorecards that match no fixture — the captain thinks it is reported',
    severity: 'high',
    sql: `
      SELECT s.id AS draft, to_char(s.date,'YYYY-MM-DD') AS dated,
             ht.name AS home, at.name AS away
      FROM scorecardstore s
      LEFT JOIN team ht ON s."homeTeam" = ht.id
      LEFT JOIN team at ON s."awayTeam" = at.id
      LEFT JOIN fixture f
        ON f.date = s.date AND f."homeTeam" = s."homeTeam" AND f."awayTeam" = s."awayTeam"
      WHERE s.date > now() - interval '18 months'
        AND (f.id IS NULL OR f.status <> 'complete')
      ORDER BY s.date DESC`
  },
  {
    name: 'unplayed-fixtures',
    description: 'Fixtures whose date has passed but which are still outstanding',
    severity: 'high',
    sql: `
      SELECT f.id, to_char(f.date,'YYYY-MM-DD') AS due,
             ht.name AS home, at.name AS away
      FROM fixture f
      JOIN team ht ON f."homeTeam" = ht.id
      JOIN team at ON f."awayTeam" = at.id
      WHERE f.status = 'outstanding'
        AND f.date < now() - interval '7 days'
        AND f.date > ${CURRENT_SEASON_START}
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
