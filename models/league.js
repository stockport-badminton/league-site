var db = require('../db_connect.js');
var seasonModel = require('./season');

// A withdrawn team is out of the live league table (HARD-10) — clearing its division
// already drops it, since every table query INNER JOINs division, but the filter is
// stated as well so a division re-entered on the edit form cannot quietly put a
// withdrawn team back in the standings.
//
// It applies to the *live* tables only. The archived `team<season>` snapshots have no
// `withdrawn` column, and a team that folds in February must still appear in the
// tables for the seasons it actually played — that is the whole reason the row is
// kept rather than deleted.
function WITHDRAWN_FILTER(alias, season) {
  return season ? '' : ` AND ${alias}.withdrawn IS NULL`
}

exports.create = async function(name, admin, url) {
  const [result] = await (await db.otherConnect()).query(
    'INSERT INTO league (name,admin,url) VALUES (?,?,?)',
    [name, admin, url]
  )
  return result
}

exports.getAll = async function() {
  const [result] = await (await db.otherConnect()).query('SELECT * FROM league')
  return result
}

exports.getById = async function(leagueId) {
  const [result] = await (await db.otherConnect()).query('SELECT * FROM league WHERE id = ?', leagueId)
  return result
}

exports.deleteById = async function(leagueId) {
  const [result] = await (await db.otherConnect()).query('DELETE FROM league WHERE id = ?', leagueId)
  return result
}

exports.updateById = async function(name, admin, url, leagueId) {
  const [result] = await (await db.otherConnect()).query(
    'UPDATE league SET name = ?, admin = ?, url = ? WHERE id = ?',
    [name, admin, url, leagueId]
  )
  return result
}

exports.getLeagueTable = async function(division, season) {
  // Throws unless the season is 8 digits. It is interpolated into the SQL below as
  // a table-name suffix, which cannot be a bind parameter — see the validation
  // notes in models/season.js. These /tables routes are public.
  seasonModel.assertName(season)
  const resolvedSeason = season || seasonModel.current()
  const teamTable = season ? `team${season} AS team` : 'team'
  const withdrawnFilter = WITHDRAWN_FILTER('team', season)
  division = division.replace('-', ' ')
  const [result] = await (await db.otherConnect()).query(
    `SELECT c.name, c.played, c.pointsfor AS "pointsFor", c.pointsagainst AS "pointsAgainst"
     FROM (
       SELECT team.name, b.played, b.pointsfor - team.penalties AS pointsfor, b.pointsagainst, team.division
       FROM (
         SELECT SUM(a.played) AS played, SUM(a.pointsfor) AS pointsfor, SUM(a.pointsagainst) AS pointsagainst, a.teamid
         FROM (
           SELECT fixture.date,
             CASE WHEN fixture."homeScore" IS NOT NULL THEN 1 ELSE 0 END AS played,
             CASE WHEN fixture."homeScore" > 9 THEN 1 ELSE 0 END AS gameswon,
             CASE WHEN fixture."homeScore" = 9 THEN 1 ELSE 0 END AS gamesdrawn,
             "homeScore" AS pointsfor, "awayScore" AS pointsagainst, fixture."homeTeam" AS teamid
           FROM fixture, season
           WHERE season.name = ? AND fixture.date > season."startDate" AND fixture.date < season."endDate"
           UNION ALL
           SELECT fixture.date,
             CASE WHEN fixture."awayScore" IS NOT NULL THEN 1 ELSE 0 END AS played,
             CASE WHEN fixture."awayScore" > 9 THEN 1 ELSE 0 END AS gameswon,
             CASE WHEN fixture."awayScore" = 9 THEN 1 ELSE 0 END AS gamesdrawn,
             "awayScore" AS pointsfor, "homeScore" AS pointsagainst, fixture."awayTeam" AS teamid
           FROM fixture, season
           WHERE season.name = ? AND fixture.date > season."startDate" AND fixture.date < season."endDate"
         ) AS a
         GROUP BY a.teamid
       ) AS b
       JOIN ${teamTable} ON team.id = b.teamid${withdrawnFilter}
     ) AS c
     JOIN division ON c.division = division.id
     WHERE division.name = ? AND division.league = 1
     ORDER BY "pointsFor" DESC`,
    [resolvedSeason, resolvedSeason, division]
  )
  return result
}

// A withdrawn team is no longer entered in the league, so it is not billable — see
// the withdrawal section at the foot of this file. The join condition rather than a
// WHERE clause because `clubFilter` may already own the WHERE, and because a club
// whose only team has withdrawn should drop out of the count rather than appear
// with a phantom one.
exports.getAnnualInvoices = async function(clubName) {
  const clubFilter = typeof clubName !== 'undefined' ? 'WHERE club.name = ?' : ''
  const params = [process.env.DB_PI_KEY, seasonModel.current(), seasonModel.previous(), seasonModel.current()]
  if (typeof clubName !== 'undefined') params.push(clubName)

  const sql = `SELECT club.id AS "clubId",
    club.name AS "clubName",
    count(team.id) AS "teamsCount",
    fines.id AS "fineId",
    fines.desc,
    fines.amount,
    "fineTeam".name AS "fineTeam",
    "fineClub".name AS "fineClub",
    fines.season,
    player.first_name AS secretary,
    pgp_sym_decrypt(player."playerEmail", ?)::text AS "playerEmail",
    season."clubFee"
    FROM
    club JOIN
    team ON team.club = club.id AND team.withdrawn IS NULL LEFT JOIN
    fines ON fines.club = club.id AND ((fines.season = ? AND fines.desc IN ('agm')) OR (fines.season = ? AND fines.desc IN ('rearrangement','card')) OR fines.season IS NULL) LEFT JOIN
    team "fineTeam" ON fines.team = "fineTeam".id LEFT JOIN
    club "fineClub" ON fines.club = "fineClub".id JOIN
    season on season.name = ? join
    player ON (player.club = club.id AND player."clubSecretary" = 1)
    ${clubFilter}
    GROUP BY club.id, club.name, fines.id, fines.desc, fines.amount, "fineTeam".name, "fineClub".name, fines.season, player.first_name, player."playerEmail",season."clubFee"`

  const [result] = await (await db.otherConnect()).query(sql, params)
  return result
}

exports.getAllLeagueTables = async function(season) {
  // Throws unless the season is 8 digits. It is interpolated into the SQL below as
  // a table-name suffix, which cannot be a bind parameter — see the validation
  // notes in models/season.js. These /tables routes are public.
  seasonModel.assertName(season)
  const resolvedSeason = season || seasonModel.current()
  const teamTable = season ? `team${season} AS team` : 'team'
  const divisionTable = season ? `division${season} AS division` : 'division'
  const withdrawnFilter = WITHDRAWN_FILTER('team', season)
  const [result] = await (await db.otherConnect()).query(
    `SELECT division.name AS "divisionName", division.id AS division, c.name, c.played, c.pointsfor AS "pointsFor", c.pointsagainst AS "pointsAgainst", c."divRank"
     FROM (
       SELECT team.name, b.played, b.pointsfor - team.penalties AS pointsfor, b.pointsagainst, team.division, team."divRank"
       FROM (
         SELECT SUM(a.played) AS played, SUM(a.pointsfor) AS pointsfor, SUM(a.pointsagainst) AS pointsagainst, a.teamid
         FROM (
           SELECT fixture.date,
             CASE WHEN fixture."homeScore" IS NOT NULL THEN 1 ELSE 0 END AS played,
             CASE WHEN fixture."homeScore" > 9 THEN 1 ELSE 0 END AS gameswon,
             CASE WHEN fixture."homeScore" = 9 THEN 1 ELSE 0 END AS gamesdrawn,
             "homeScore" AS pointsfor, "awayScore" AS pointsagainst, fixture."homeTeam" AS teamid
           FROM fixture, season
           WHERE season.name = ? AND fixture.date > season."startDate" AND fixture.date < season."endDate"
             AND fixture.status IN ('conceded','complete',NULL,'','outstanding')
           UNION ALL
           SELECT fixture.date,
             CASE WHEN fixture."awayScore" IS NOT NULL THEN 1 ELSE 0 END AS played,
             CASE WHEN fixture."awayScore" > 9 THEN 1 ELSE 0 END AS gameswon,
             CASE WHEN fixture."awayScore" = 9 THEN 1 ELSE 0 END AS gamesdrawn,
             "awayScore" AS pointsfor, "homeScore" AS pointsagainst, fixture."awayTeam" AS teamid
           FROM fixture, season
           WHERE season.name = ? AND fixture.date > season."startDate" AND fixture.date < season."endDate"
             AND fixture.status IN ('conceded','complete',NULL,'','outstanding')
         ) AS a
         GROUP BY a.teamid
       ) AS b
       JOIN ${teamTable} ON team.id = b.teamid${withdrawnFilter}
     ) AS c
     JOIN ${divisionTable} ON c.division = division.id
     WHERE division.league = 1
     ORDER BY division, "pointsFor" DESC, "divRank"`,
    [resolvedSeason, resolvedSeason]
  )
  return result
}

exports.getAllLeagueTablesWithTopBottomDetails = async function(season) {
  // Throws unless the season is 8 digits. It is interpolated into the SQL below as
  // a table-name suffix, which cannot be a bind parameter — see the validation
  // notes in models/season.js. These /tables routes are public.
  seasonModel.assertName(season)
  const resolvedSeason = season || seasonModel.current()
  const teamTable = season ? `team${season}` : 'team'
  const divisionTable = season ? `division${season}` : 'division'
  const withdrawnFilter = WITHDRAWN_FILTER('t', season)
  const [result] = await (await db.otherConnect()).query(`WITH standings AS (
    SELECT
        d.name AS divisionName,
        d.id AS division,
        t.id AS teamId,
        t.name AS teamName,
        t."divRank",
        s.played,
        s.remaining,
        (s.pointsFor - t.penalties) AS pointsFor,
        s.pointsAgainst,
        (s.pointsFor - t.penalties) + (18 * s.remaining) AS maxScore
    FROM (
        SELECT
            x.teamId,
            SUM(x.played) AS played,
            SUM(x.remaining) AS remaining,
            SUM(x.pointsFor) AS pointsFor,
            SUM(x.pointsAgainst) AS pointsAgainst
        FROM (
            SELECT
                f."homeTeam" AS teamId,
                CASE WHEN f."homeScore" IS NOT NULL THEN 1 ELSE 0 END AS played,
                CASE WHEN f."homeScore" IS NOT NULL THEN 0 ELSE 1 END AS remaining,
                f."homeScore" AS pointsFor,
                f."awayScore" AS pointsAgainst
            FROM fixture f
            JOIN season se
              ON f.date > se."startDate"
             AND f.date < se."endDate"
            WHERE se.name = ?
              AND (
                    f.status IN ('conceded', 'complete', '', 'outstanding')
                    OR f.status IS NULL
                  )

            UNION ALL

            SELECT
                f."awayTeam" AS teamId,
                CASE WHEN f."awayScore" IS NOT NULL THEN 1 ELSE 0 END AS played,
                CASE WHEN f."awayScore" IS NOT NULL THEN 0 ELSE 1 END AS remaining,
                f."awayScore" AS pointsFor,
                f."homeScore" AS pointsAgainst
            FROM fixture f
            JOIN season se
              ON f.date > se."startDate"
             AND f.date < se."endDate"
            WHERE se.name = ?
              AND (
                    f.status IN ('conceded', 'complete', '', 'outstanding')
                    OR f.status IS NULL
                  )
        ) x
        GROUP BY x.teamId
    ) s
    JOIN ${teamTable} t
      ON t.id = s.teamId${withdrawnFilter}
    JOIN ${divisionTable} d
      ON d.id = t.division
    WHERE d.league = 1
),

division_comparison AS (
    SELECT
        s1.division,
        s1.teamId,
        MAX(s2.maxScore) AS maxOtherMaxScore,
        MIN(s2.pointsFor) AS minOtherCurrentScore
    FROM standings s1
    LEFT JOIN standings s2
      ON s1.division = s2.division
     AND s1.teamId <> s2.teamId
    GROUP BY s1.division, s1.teamId
)
SELECT
    s.divisionName,
    s.division,
    s.teamName,
    s.remaining,
    s.played,
    s.pointsFor,
    s.pointsAgainst,
    s."divRank",
    s.maxScore,

    CASE
        WHEN s.pointsFor > dc.maxOtherMaxScore THEN 1
        ELSE 0
    END AS alreadyWonDivision,

    CASE
        WHEN s.maxScore < dc.minOtherCurrentScore THEN 1
        ELSE 0
    END AS alreadyBottom,

    CASE
        WHEN s.pointsFor > dc.maxOtherMaxScore THEN 0
        WHEN s.pointsFor + (18 * s.remaining) <= dc.maxOtherMaxScore THEN NULL
        ELSE FLOOR((dc.maxOtherMaxScore - s.pointsFor) / 18) + 1
    END AS winsNeededToFinishTop

FROM standings s
JOIN division_comparison dc
  ON dc.division = s.division
 AND dc.teamId = s.teamId
ORDER BY s.division, s.pointsFor DESC, s."divRank"
LIMIT 100
`, [resolvedSeason, resolvedSeason])
  return result
}

// ---------------------------------------------------------------------------
// Withdrawing a team mid-season (HARD-10)
//
// Before this, a team that folded had nowhere to go: /admin/teams could create, edit,
// promote and relegate, but not withdraw. So the team stayed in its division, showed in
// the league table as a row of zeros to every visitor, and stayed on the annual invoice.
// Parrswood C sat like that through August 2026 and was withdrawn by hand.
//
// Three decisions are baked in here, because each of the alternatives is worse:
//
// 1. **The team row is never deleted.** `fixture` has no foreign keys and 2,132 rows
//    already point at team ids that no longer exist (HARD-11). Deleting a team is how
//    that number got where it is; withdrawing must not add to it. The division is
//    cleared instead, and remembered in "withdrawnDivision" so it can be put back.
//
// 2. **Outstanding fixtures are VOIDED, not conceded and not deleted.**
//      - *Conceded* would award 18-0 to every opponent the team had not yet played,
//        while the opponents who did play it keep whatever they won on court. That
//        invents results nobody played and hands out points unevenly, which changes
//        promotion and relegation on the strength of the fixture-list order.
//      - *Deleted* destroys the record that the fixture was ever arranged, and any
//        row later found referring to it becomes unexplainable.
//      - *Void* is the one answer that adds nothing and removes nothing: the league
//        table's status filter (`IN ('conceded','complete','','outstanding')`) does not
//        include 'void', so a voided fixture simply stops counting for both teams. Each
//        of the withdrawn team's remaining opponents ends the season having played
//        fewer matches, with the points they actually earned. Their positions can still
//        move relative to each other, because the fixtures that disappear are not
//        spread evenly — unavoidable mid-season, and shown on the confirmation page
//        before anything is written.
//
// 3. **Results already recorded are never touched.** The predicate below requires both
//    scores to be NULL and the status to be one of the not-yet-played ones, and it is
//    repeated verbatim in the UPDATE's own WHERE clause, so a scorecard filed between
//    the preview and the write cannot be overwritten by this.
//
// The operation refuses to run twice (`withdrawn IS NULL` is both checked and repeated
// in the WHERE), and `reinstateTeam` is its inverse.
// ---------------------------------------------------------------------------

// "Not yet played": no score recorded, and a status that means the fixture is still
// pending. 'complete', 'conceded', 'rearranged', 'rearranging' and an existing 'void'
// are all excluded — a rearranged fixture has a replacement row which is itself
// outstanding and gets voided in its own right.
function outstandingFixture(alias) {
  return `(${alias}."homeScore" IS NULL AND ${alias}."awayScore" IS NULL
           AND (${alias}.status IS NULL OR ${alias}.status IN ('', 'outstanding')))`
}

// Read-only preview of what withdrawing a team would do. The confirmation page renders
// this; nothing is written. Returns null if there is no such team.
exports.getWithdrawalImpact = async function(teamId) {
  const conn = await db.otherConnect()
  const season = seasonModel.current()

  const [teamRows] = await conn.query(
    `SELECT t.id, t.name, t.division, t.withdrawn, t."withdrawnDivision" AS "withdrawnDivision",
            t."withdrawnReason" AS "withdrawnReason",
            d.name AS "divisionName", wd.name AS "withdrawnDivisionName",
            c.name AS "clubName", c.id AS "clubId"
     FROM team t
     LEFT JOIN division d ON t.division = d.id
     LEFT JOIN division wd ON t."withdrawnDivision" = wd.id
     LEFT JOIN club c ON t.club = c.id
     WHERE t.id = ?`,
    [teamId]
  )
  if (!teamRows.length) return null

  // LEFT JOIN to fixture, not a comma join, so a team with no fixtures at all still
  // returns zeroes instead of losing the whole preview — the same trap as gotcha 1c.
  const [countRows] = await conn.query(
    `SELECT
       COUNT(f.id) FILTER (WHERE ${outstandingFixture('f')}) AS outstanding,
       COUNT(f.id) FILTER (WHERE NOT ${outstandingFixture('f')}) AS recorded
     FROM season s
     LEFT JOIN fixture f
       ON (f."homeTeam" = ? OR f."awayTeam" = ?)
      AND f.date > s."startDate" AND f.date < s."endDate"
     WHERE s.name = ?`,
    [teamId, teamId, season]
  )

  const [playerRows] = await conn.query(
    'SELECT COUNT(*) AS players FROM player WHERE team = ?',
    [teamId]
  )

  const counts = countRows[0] || {}
  return {
    team: teamRows[0],
    season: season,
    outstandingFixtures: Number(counts.outstanding || 0),
    recordedFixtures: Number(counts.recorded || 0),
    players: Number((playerRows[0] || {}).players || 0)
  }
}

// Ids of the players still attached to a team, in list order. Only used by the opt-in
// "release the players too" step of a withdrawal; the release itself goes through
// Roster.releasePlayer so the rank renumbering stays in the one place that owns it.
exports.getTeamPlayerIds = async function(teamId) {
  const [rows] = await (await db.otherConnect()).query(
    'SELECT id FROM player WHERE team = ? ORDER BY rank NULLS LAST, id',
    [teamId]
  )
  return rows.map(r => Number(r.id))
}

// Teams currently withdrawn, newest first — the "Withdrawn" section of /admin/teams.
exports.getWithdrawnTeams = async function() {
  const [rows] = await (await db.otherConnect()).query(
    `SELECT t.id, t.name, t.withdrawn, t."withdrawnReason" AS "withdrawnReason",
            t."withdrawnDivision" AS "withdrawnDivision",
            t."withdrawnFixtures" AS "withdrawnFixtures",
            d.name AS "withdrawnDivisionName", c.name AS "clubName"
     FROM team t
     LEFT JOIN division d ON t."withdrawnDivision" = d.id
     LEFT JOIN club c ON t.club = c.id
     WHERE t.withdrawn IS NOT NULL
     ORDER BY t.withdrawn DESC, t.name`
  )
  return rows
}

function conflict(message) {
  const err = new Error(message)
  err.status = 409
  return err
}

// Withdraw a team. One transaction: void this season's outstanding fixtures, then clear
// the division and stamp the withdrawal, recording enough to undo it. Players are left
// alone — releasing them onto the No Club / No Team sentinels is a separate, opt-in step
// in the controller, because it is the one part that cannot be reversed.
exports.withdrawTeam = async function(teamId, options) {
  const opts = options || {}
  const season = seasonModel.current()
  const reason = (opts.reason || '').trim() || null

  return db.withTransaction(async conn => {
    const [teamRows] = await conn.query(
      'SELECT id, name, division, withdrawn FROM team WHERE id = ? FOR UPDATE',
      [teamId]
    )
    const team = teamRows[0]
    if (!team) {
      const err = new Error('No such team')
      err.status = 404
      throw err
    }
    // Refuses to run twice. Checked here so the message can name the team, and
    // repeated in the UPDATE below so a concurrent withdrawal cannot slip between.
    if (team.withdrawn) {
      throw conflict(team.name + ' was already withdrawn on '
        + new Date(team.withdrawn).toISOString().slice(0, 10) + '.')
    }

    const [voided] = await conn.query(
      `UPDATE fixture AS f SET status = 'void'
       WHERE (f."homeTeam" = ? OR f."awayTeam" = ?)
         AND EXISTS (
           SELECT 1 FROM season s
           WHERE s.name = ? AND f.date > s."startDate" AND f.date < s."endDate")
         AND ${outstandingFixture('f')}
       RETURNING f.id`,
      [teamId, teamId, season]
    )
    const voidedIds = voided.map(r => Number(r.id))

    const [updated] = await conn.query(
      `UPDATE team
       SET withdrawn = now(),
           "withdrawnDivision" = division,
           "withdrawnReason" = ?,
           "withdrawnFixtures" = ?::int[],
           division = NULL
       WHERE id = ? AND withdrawn IS NULL
       RETURNING id`,
      [reason, voidedIds, teamId]
    )
    if (!updated.length) throw conflict(team.name + ' is already withdrawn.')

    return {
      teamId: Number(teamId),
      name: team.name,
      division: team.division,
      voidedFixtures: voidedIds,
      season: season
    }
  })
}

// The inverse. Puts the team back in the division it left and un-voids exactly the
// fixtures this withdrawal voided — which is why the ids are stored rather than
// re-derived: 114 unrelated fixtures were voided during HARD-09, and a broad "un-void
// everything for this team" would resurrect those too.
//
// A restored fixture comes back as 'outstanding' rather than whatever it held before
// (NULL, '' and 'outstanding' were all in use); all three count the same way in the
// league table, and 'outstanding' is the only one that says so out loud.
exports.reinstateTeam = async function(teamId) {
  return db.withTransaction(async conn => {
    const [teamRows] = await conn.query(
      `SELECT id, name, withdrawn, division, "withdrawnDivision" AS "withdrawnDivision",
              "withdrawnFixtures" AS "withdrawnFixtures"
       FROM team WHERE id = ? FOR UPDATE`,
      [teamId]
    )
    const team = teamRows[0]
    if (!team) {
      const err = new Error('No such team')
      err.status = 404
      throw err
    }
    if (!team.withdrawn) throw conflict(team.name + ' is not withdrawn.')
    if (team.withdrawnDivision == null) {
      throw conflict(team.name + ' has no division recorded to return to — set one on '
        + 'the edit form instead.')
    }

    const [rankRows] = await conn.query(
      'SELECT COALESCE(MAX("divRank"), 0) + 1 AS next FROM team WHERE division = ?',
      [team.withdrawnDivision]
    )

    const fixtureIds = (team.withdrawnFixtures || []).map(Number)
    let restored = []
    if (fixtureIds.length) {
      // The guard is repeated here: a fixture that has since been given a result, or
      // voided again for another reason, is left as it is.
      const [rows] = await conn.query(
        `UPDATE fixture AS f SET status = 'outstanding'
         WHERE f.id = ANY(?::int[])
           AND f.status = 'void'
           AND f."homeScore" IS NULL AND f."awayScore" IS NULL
         RETURNING f.id`,
        [fixtureIds]
      )
      restored = rows.map(r => Number(r.id))
    }

    const [updated] = await conn.query(
      `UPDATE team
       SET division = "withdrawnDivision",
           "divRank" = ?,
           withdrawn = NULL,
           "withdrawnDivision" = NULL,
           "withdrawnReason" = NULL,
           "withdrawnFixtures" = NULL
       WHERE id = ? AND withdrawn IS NOT NULL
       RETURNING id`,
      [(rankRows[0] || {}).next || 1, teamId]
    )
    if (!updated.length) throw conflict(team.name + ' is not withdrawn.')

    return {
      teamId: Number(teamId),
      name: team.name,
      division: team.withdrawnDivision,
      restoredFixtures: restored
    }
  })
}
