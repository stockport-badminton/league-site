var db = require('../db_connect.js');

const year = new Date().getFullYear()
const SEASON = new Date().getMonth() < 7
  ? `${year - 1}${year}`
  : `${year}${year + 1}`
const PREVSEASON = new Date().getMonth() < 7
  ? `${year - 2}${year - 1}`
  : `${year - 1}${year}`

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
  const resolvedSeason = season || SEASON
  const teamTable = season ? `team${season} AS team` : 'team'
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
       JOIN ${teamTable} ON team.id = b.teamid
     ) AS c
     JOIN division ON c.division = division.id
     WHERE division.name = ? AND division.league = 1
     ORDER BY "pointsFor" DESC`,
    [resolvedSeason, resolvedSeason, division]
  )
  return result
}

exports.getAnnualInvoices = async function(clubName) {
  const clubFilter = typeof clubName !== 'undefined' ? 'WHERE club.name = ?' : ''
  const params = [process.env.DB_PI_KEY, SEASON, PREVSEASON, SEASON]
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
    team ON team.club = club.id LEFT JOIN
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
  const resolvedSeason = season || SEASON
  const teamTable = season ? `team${season} AS team` : 'team'
  const divisionTable = season ? `division${season} AS division` : 'division'
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
       JOIN ${teamTable} ON team.id = b.teamid
     ) AS c
     JOIN ${divisionTable} ON c.division = division.id
     WHERE division.league = 1
     ORDER BY division, "pointsFor" DESC, "divRank"`,
    [resolvedSeason, resolvedSeason]
  )
  return result
}

exports.getAllLeagueTablesWithTopBottomDetails = async function(season) {
  const resolvedSeason = season || SEASON
  const teamTable = season ? `team${season}` : 'team'
  const divisionTable = season ? `division${season}` : 'division'
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
      ON t.id = s.teamId
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
