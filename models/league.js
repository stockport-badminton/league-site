// @ts-check
var db = require('../db_connect.js');
var seasonModel = require('./season');
const { kysely, decrypt } = require('../db');

// REARCH-01: on the typed query layer except getLeagueTable, getAllLeagueTables and
// getAllLeagueTablesWithTopBottomDetails, which are season-switched and belong to
// REARCH-02. getAnnualInvoices waited on season."clubFee" being in a migration (026).

/** @typedef {import('kysely').Kysely<import('../db/schema').DB>} Q */

// A withdrawn team is out of the live league table (HARD-10) — clearing its division
// already drops it, since every table query INNER JOINs division, but the filter is
// stated as well so a division re-entered on the edit form cannot quietly put a
// withdrawn team back in the standings.
//
// It applies to the *live* tables only. The archived `team<season>` snapshots have no
// `withdrawn` column, and a team that folds in February must still appear in the
// tables for the seasons it actually played — that is the whole reason the row is
// kept rather than deleted.
/** @param {string} alias @param {string} [season] */
function WITHDRAWN_FILTER(alias, season) {
  return season ? '' : ` AND ${alias}.withdrawn IS NULL`
}

/** @param {number} leagueId */
exports.getById = async function(leagueId) {
  return kysely.selectFrom('league').selectAll().where('id', '=', leagueId).execute()
}

/** @param {string} division @param {string} [season] */
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
/** @param {string} [clubName] */
exports.getAnnualInvoices = async function(clubName) {
  // `No Club` (63) is the sentinel a released player is parked on — Roster.NO_CLUB_ID —
  // and it holds `No Team` (52), so it looks like a club with two teams and would be
  // invoiced. It was excluded only by ACCIDENT until now: it has nobody flagged as club
  // secretary, and the officer join below used to be INNER, which dropped it. Making that
  // join LEFT (correctly, so a real club missing a secretary is no longer silently
  // dropped) surfaced it. Excluded on purpose instead, which does not depend on its data
  // staying incomplete.
  const SENTINEL_CLUB = 63
  const current = seasonModel.current()
  const previous = seasonModel.previous()

  return kysely.selectFrom('club')
    .innerJoin('team', join => join.onRef('team.club', '=', 'club.id').on('team.withdrawn', 'is', null))
    .leftJoin('fines', join => join.onRef('fines.club', '=', 'club.id').on(eb => eb.or([
      eb.and([eb('fines.season', '=', current), eb('fines.desc', 'in', ['agm'])]),
      eb.and([eb('fines.season', '=', previous), eb('fines.desc', 'in', ['rearrangement', 'card'])]),
      eb('fines.season', 'is', null),
    ])))
    .leftJoin('team as fineTeam', 'fines.team', 'fineTeam.id')
    .leftJoin('club as fineClub', 'fines.club', 'fineClub.id')
    .innerJoin('season', join => join.on('season.name', '=', current))
    // LEFT, because a club secretary is OPTIONAL in the data and this was an inner join.
    // A club with nobody flagged as clubSecretary was dropped from the result entirely, so
    // it would silently never be invoiced — no error, no empty row, just absent from the
    // run. All 18 clubs happen to have one flagged today, which is the only reason this
    // has not already cost the league money. CLAUDE.md gotcha 1c: an INNER JOIN to
    // something optional loses the whole row.
    //
    // The club now appears with a NULL secretary and email, and the caller
    // (contactusController.send_invoices) reports that rather than handing SES a null
    // recipient.
    .leftJoin('player', join => join.onRef('player.club', '=', 'club.id').on('player.clubSecretary', '=', 1))
    .select(eb => ['club.id as clubId', 'club.name as clubName', eb.fn.count('team.id').as('teamsCount'),
      'fines.id as fineId', 'fines.desc', 'fines.amount', 'fineTeam.name as fineTeam', 'fineClub.name as fineClub',
      'fines.season', 'player.first_name as secretary', decrypt(eb.ref('player.playerEmail')).as('playerEmail'),
      'season.clubFee'])
    .where('club.id', '<>', SENTINEL_CLUB)
    .$if(typeof clubName !== 'undefined', qb => qb.where('club.name', '=', /** @type {string} */ (clubName)))
    .groupBy(['club.id', 'club.name', 'fines.id', 'fines.desc', 'fines.amount', 'fineTeam.name', 'fineClub.name',
      'fines.season', 'player.first_name', 'player.playerEmail', 'season.clubFee'])
    .execute()
}

/** @param {string} [season] */
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

/** @param {string} [season] */
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
        d.name AS divisionname,
        d.id AS division,
        t.id AS teamid,
        t.name AS teamname,
        t."divRank",
        s.played,
        s.remaining,
        (s.pointsFor - t.penalties) AS pointsfor,
        s.pointsAgainst,
        (s.pointsFor - t.penalties) + (18 * s.remaining) AS maxscore
    FROM (
        SELECT
            x.teamId,
            SUM(x.played) AS played,
            SUM(x.remaining) AS remaining,
            SUM(x.pointsFor) AS pointsfor,
            SUM(x.pointsAgainst) AS pointsagainst
        FROM (
            SELECT
                f."homeTeam" AS teamid,
                CASE WHEN f."homeScore" IS NOT NULL THEN 1 ELSE 0 END AS played,
                CASE WHEN f."homeScore" IS NOT NULL THEN 0 ELSE 1 END AS remaining,
                f."homeScore" AS pointsfor,
                f."awayScore" AS pointsagainst
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
                f."awayTeam" AS teamid,
                CASE WHEN f."awayScore" IS NOT NULL THEN 1 ELSE 0 END AS played,
                CASE WHEN f."awayScore" IS NOT NULL THEN 0 ELSE 1 END AS remaining,
                f."awayScore" AS pointsfor,
                f."homeScore" AS pointsagainst
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
        MAX(s2.maxScore) AS maxothermaxscore,
        MIN(s2.pointsFor) AS minothercurrentscore
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
    END AS alreadywondivision,

    CASE
        WHEN s.maxScore < dc.minOtherCurrentScore THEN 1
        ELSE 0
    END AS alreadybottom,

    CASE
        WHEN s.pointsFor > dc.maxOtherMaxScore THEN 0
        WHEN s.pointsFor + (18 * s.remaining) <= dc.maxOtherMaxScore THEN NULL
        ELSE FLOOR((dc.maxOtherMaxScore - s.pointsFor) / 18) + 1
    END AS winsneededtofinishtop

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
// outstanding and gets voided in its own right. (fixture_status_check no longer admits
// NULL or '', so those two are defensive.)
/** @param {import('kysely').ExpressionBuilder<any, any>} eb @param {string} f the fixture's alias */
const unplayed = (eb, f) => eb.and([
  eb(`${f}.homeScore`, 'is', null),
  eb(`${f}.awayScore`, 'is', null),
  eb.or([eb(`${f}.status`, 'is', null), eb(`${f}.status`, 'in', ['', 'outstanding'])]),
])

/** @param {string} message @param {number} status */
function httpError(message, status) {
  const err = /** @type {Error & { status?: number }} */ (new Error(message))
  err.status = status
  return err
}

// Read-only preview of what withdrawing a team would do. The confirmation page renders
// this; nothing is written. Returns null if there is no such team.
/** @param {number} teamId */
exports.getWithdrawalImpact = async function(teamId) {
  const season = seasonModel.current()

  const team = await kysely.selectFrom('team as t')
    .leftJoin('division as d', 't.division', 'd.id')
    .leftJoin('division as wd', 't.withdrawnDivision', 'wd.id')
    .leftJoin('club as c', 't.club', 'c.id')
    .select(['t.id', 't.name', 't.division', 't.withdrawn', 't.withdrawnDivision', 't.withdrawnReason',
      'd.name as divisionName', 'wd.name as withdrawnDivisionName', 'c.name as clubName', 'c.id as clubId'])
    .where('t.id', '=', teamId)
    .executeTakeFirst()
  if (!team) return null

  // LEFT JOIN to fixture, not a comma join, so a team with no fixtures at all still
  // returns zeroes instead of losing the whole preview — the same trap as gotcha 1c.
  const counts = await kysely.selectFrom('season as s')
    .leftJoin('fixture as f', join => join
      .on(eb => eb.or([eb('f.homeTeam', '=', teamId), eb('f.awayTeam', '=', teamId)]))
      .onRef('f.date', '>', 's.startDate')
      .onRef('f.date', '<', 's.endDate'))
    .select(eb => [
      eb.fn.count('f.id').filterWhere(unplayed(eb, 'f')).as('outstanding'),
      eb.fn.count('f.id').filterWhere(eb.not(unplayed(eb, 'f'))).as('recorded'),
    ])
    .where('s.name', '=', season)
    .executeTakeFirst()

  const players = await kysely.selectFrom('player').select(eb => eb.fn.countAll().as('players'))
    .where('team', '=', teamId).executeTakeFirst()

  return {
    team,
    season: season,
    outstandingFixtures: Number((counts && counts.outstanding) || 0),
    recordedFixtures: Number((counts && counts.recorded) || 0),
    players: Number((players && players.players) || 0)
  }
}

// Ids of the players still attached to a team, in list order. Only used by the opt-in
// "release the players too" step of a withdrawal; the release itself goes through
// Roster.releasePlayer so the rank renumbering stays in the one place that owns it.
/** @param {number} teamId */
exports.getTeamPlayerIds = async function(teamId) {
  const rows = await kysely.selectFrom('player').select('id').where('team', '=', teamId)
    .orderBy('rank', ob => ob.asc().nullsLast()).orderBy('id').execute()
  return rows.map(r => Number(r.id))
}

// Teams currently withdrawn, newest first — the "Withdrawn" section of /admin/teams.
exports.getWithdrawnTeams = async function() {
  return kysely.selectFrom('team as t')
    .leftJoin('division as d', 't.withdrawnDivision', 'd.id')
    .leftJoin('club as c', 't.club', 'c.id')
    .select(['t.id', 't.name', 't.withdrawn', 't.withdrawnReason', 't.withdrawnDivision', 't.withdrawnFixtures',
      'd.name as withdrawnDivisionName', 'c.name as clubName'])
    .where('t.withdrawn', 'is not', null)
    .orderBy('t.withdrawn', 'desc').orderBy('t.name')
    .execute()
}

/** @param {string} message */
function conflict(message) {
  return httpError(message, 409)
}

// Withdraw a team. One transaction: void this season's outstanding fixtures, then clear
// the division and stamp the withdrawal, recording enough to undo it. Players are left
// alone — releasing them onto the No Club / No Team sentinels is a separate, opt-in step
// in the controller, because it is the one part that cannot be reversed.
/** @param {number} teamId @param {{ reason?: string }} [options] */
exports.withdrawTeam = async function(teamId, options) {
  const opts = options || {}
  const season = seasonModel.current()
  const reason = (opts.reason || '').trim() || null

  return db.withTransaction(async (conn, trx) => {
    const team = await trx.selectFrom('team').select(['id', 'name', 'division', 'withdrawn'])
      .where('id', '=', teamId).forUpdate().executeTakeFirst()
    if (!team) throw httpError('No such team', 404)
    // Refuses to run twice. Checked here so the message can name the team, and
    // repeated in the UPDATE below so a concurrent withdrawal cannot slip between.
    if (team.withdrawn) {
      throw conflict(team.name + ' was already withdrawn on '
        + new Date(team.withdrawn).toISOString().slice(0, 10) + '.')
    }

    const voided = await trx.updateTable('fixture as f').set({ status: 'void' })
      .where(eb => eb.and([
        eb.or([eb('f.homeTeam', '=', teamId), eb('f.awayTeam', '=', teamId)]),
        eb.exists(eb.selectFrom('season as s').select(eb.lit(1).as('one'))
          .where('s.name', '=', season).whereRef('f.date', '>', 's.startDate').whereRef('f.date', '<', 's.endDate')),
        unplayed(eb, 'f'),
      ]))
      .returning('f.id')
      .execute()
    const voidedIds = voided.map(r => Number(r.id))

    const updated = await trx.updateTable('team')
      .set(eb => ({
        withdrawn: eb.fn('now'),
        withdrawnDivision: eb.ref('division'),
        withdrawnReason: reason,
        withdrawnFixtures: voidedIds,
        division: null,
      }))
      .where('id', '=', teamId).where('withdrawn', 'is', null)
      .returning('id')
      .executeTakeFirst()
    if (!updated) throw conflict(team.name + ' is already withdrawn.')

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
/** @param {number} teamId */
exports.reinstateTeam = async function(teamId) {
  return db.withTransaction(async (conn, trx) => {
    const team = await trx.selectFrom('team')
      .select(['id', 'name', 'withdrawn', 'division', 'withdrawnDivision', 'withdrawnFixtures'])
      .where('id', '=', teamId).forUpdate().executeTakeFirst()
    if (!team) throw httpError('No such team', 404)
    if (!team.withdrawn) throw conflict(team.name + ' is not withdrawn.')
    if (team.withdrawnDivision == null) {
      throw conflict(team.name + ' has no division recorded to return to — set one on '
        + 'the edit form instead.')
    }
    const division = team.withdrawnDivision

    const rank = await trx.selectFrom('team')
      .select(eb => eb(eb.fn.coalesce(eb.fn.max('divRank'), eb.lit(0)), '+', eb.lit(1)).as('next'))
      .where('division', '=', division)
      .executeTakeFirst()

    const fixtureIds = (team.withdrawnFixtures || []).map(Number)
    /** @type {number[]} */
    let restored = []
    if (fixtureIds.length) {
      // The guard is repeated here: a fixture that has since been given a result, or
      // voided again for another reason, is left as it is.
      const rows = await trx.updateTable('fixture as f').set({ status: 'outstanding' })
        .where('f.id', 'in', fixtureIds)
        .where('f.status', '=', 'void')
        .where('f.homeScore', 'is', null).where('f.awayScore', 'is', null)
        .returning('f.id')
        .execute()
      restored = rows.map(r => Number(r.id))
    }

    const updated = await trx.updateTable('team')
      .set(eb => ({
        division: eb.ref('withdrawnDivision'),
        divRank: (rank && rank.next) || 1,
        withdrawn: null,
        withdrawnDivision: null,
        withdrawnReason: null,
        withdrawnFixtures: null,
      }))
      .where('id', '=', teamId).where('withdrawn', 'is not', null)
      .returning('id')
      .executeTakeFirst()
    if (!updated) throw conflict(team.name + ' is not withdrawn.')

    return {
      teamId: Number(teamId),
      name: team.name,
      division: division,
      restoredFixtures: restored
    }
  })
}
