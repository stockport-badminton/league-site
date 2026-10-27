// @ts-check
var db = require('../db_connect.js');
var seasonModel = require("./season");
const { sql } = require('kysely');
const { kysely, encrypt, decrypt } = require('../db');
const levenshtein = require('js-levenshtein');
const { rankByName } = require('../utils/nameMatch');


// REARCH-01 is converting this file in batches. On the typed query layer so far: the
// searches and lookups (getClubRoster, search, the eligibility lookups, count, getById,
// getPlayerClubandTeamById, searchPlayers), and the writes and the role and email reads
// (create, updateBulk, getAuthRoleByEmail, setAuthRole, getEmails, setRatings).
//
// `first_name family_name`, as CONCAT gives it.
/** @param {import('kysely').ExpressionBuilder<any, any>} eb */
const concatName = eb => eb.fn('concat', [eb.ref('player.first_name'), sql.lit(' '), eb.ref('player.family_name')])

// The teams a player in the given team may also play for: that team and every team at the
// same club ranked below it (team.rank >= its own). The team is named by id, or by a LIKE
// pattern on its name.
/** @param {{ teamId?: number, nameLike?: string }} which */
const eligibleTeams = which => kysely
  .selectFrom(eb => eb.selectFrom('team').innerJoin('club', 'team.club', 'club.id')
    .select(['club.id', 'club.name', 'team.rank as originalrank'])
    .$if(which.teamId !== undefined, qb => qb.where('team.id', '=', /** @type {number} */ (which.teamId)))
    .$if(which.nameLike !== undefined, qb => qb.where('team.name', 'like', /** @type {string} */ (which.nameLike)))
    .as('a'))
  .innerJoin('team', join => join.onRef('a.id', '=', 'team.club').onRef('team.rank', '>=', 'a.originalrank'))
  .select(['team.id', 'team.name', 'team.rank'])

// POST
// Returns `[{ id }]`. Without RETURNING the result is an empty rows array, so the
// `row.insertId` its caller read was always undefined — see the note on
// Fixture.createScorecard for the same bug in the scorecard flow. Prefer
// models/roster.js:createPlayer for the roster pages; this one stays for the
// standalone /player/create form.
/** @param {string} first_name @param {string} family_name @param {number} team @param {number} club @param {string} gender */
exports.create = async function(first_name, family_name, team, club, gender) {
  return kysely.insertInto('player')
    .values({ first_name, family_name, date_of_registration: new Date(), team, club, gender })
    .returning('id')
    .execute()
}

// PATCH
// Columns updateBulk is allowed to write. It builds its SET clause from
// caller-supplied field names, which was safe enough while every caller was
// server-side — but it was also reachable as POST /player/batch-update, where the
// table name and field list came from the request body. That route is gone (see
// controllers/rosterController.js for what replaced it); the allowlist is here so
// a future caller can't reintroduce the same hole by passing `role` or `authEmail`
// through from user input.
const BULK_WRITABLE = new Set([
  'id', 'first_name', 'family_name', 'gender', 'team', 'club', 'rank', 'rating',
  'playerTel', 'playerEmail', 'teamCaptain', 'clubSecretary', 'matchSecrertary',
  'treasurer', 'otherComms', 'junior', 'date_of_registration'
])

/** @param {{ tablename?: string, fields: string[], data: unknown[][] }} BatchObj */
exports.updateBulk = async function(BatchObj) {
  if (!db.isObject(BatchObj)) throw new Error('not object')
  // Authorization-bearing columns (role, messerAdmin, authEmail) are deliberately
  // absent from the allowlist — they go through setAuthRole, which only ever runs
  // for a superadmin.
  if (BatchObj.tablename && BatchObj.tablename !== 'player') {
    throw new Error(`updateBulk only writes the player table, got ${JSON.stringify(BatchObj.tablename)}`)
  }
  const rejected = (BatchObj.fields || []).filter(f => !BULK_WRITABLE.has(f))
  if (rejected.length) {
    throw new Error(`updateBulk cannot write these columns: ${rejected.join(', ')}`)
  }
  for (const x in BatchObj.data) {
    const row = BatchObj.data[x]
    /** @type {Record<string, unknown>} */
    const values = {}
    /** @type {any} */
    let whereId
    for (const y in row) {
      const field = BatchObj.fields[Number(y)]
      if (field === 'id') {
        whereId = row[y]
      } else if (field === 'playerTel' || field === 'playerEmail') {
        values[field] = encrypt(String(row[y]))
      } else {
        // undefined is written as NULL, as the string version bound it; Kysely would
        // otherwise leave the column out.
        values[field] = row[y] === undefined ? null : row[y]
      }
    }
    await kysely.updateTable('player').set(/** @type {any} */ (values)).where('id', '=', whereId).execute()
  }
}

// GET
/** @param {any} teamName */
exports.getNominatedPlayers = async function(teamName) {
  const [result] = await (await db.otherConnect()).query(
    "SELECT CONCAT(first_name,' ',family_name) AS name, gender FROM player JOIN team ON team.id = player.team WHERE team.name = ? AND player.rank IS NOT NULL ORDER BY gender, player.rank",
    teamName
  )
  return result
}

// All players registered to any team at a club, for the team-registration-form
// PDF. rank == 99 marks a reserve (see manage_player_list_clubs_teams); everything
// else is a nominated player. player.rank is only a within-team strength order,
// so team.rank (the team's own pecking order at the club) has to sort first, or
// e.g. every team's #1 player clusters together ahead of any team's #2.
/** @param {string} clubName */
exports.getClubRoster = async function(clubName) {
  return kysely.selectFrom('player')
    .innerJoin('team', 'team.id', 'player.team')
    .innerJoin('club', 'club.id', 'team.club')
    .select(eb => ['player.id', concatName(eb).as('name'), 'player.gender', 'player.rank', 'player.junior',
      'team.name as teamName'])
    .where('club.name', '=', clubName)
    .orderBy('player.gender').orderBy('team.rank').orderBy('player.rank').orderBy('player.family_name')
    .execute()
}

// Nominated players who have not appeared in any of their team's last three
// completed matches (rule: "If a player misses 3 consecutive matches...").
//
// `fixture` holds every season back to 2012, so the window must be bounded to
// the current one: without that, a team that had not yet played this season was
// judged on last April's matches, and every player nominated since was listed.
// A team with fewer than three results this season cannot have a player who has
// missed three, so it is left out rather than judged on the matches it has.
// No Club's teams are the holding pen for released players, not a club.
// A typed `sql` template rather than the builder: seven CTEs, window functions and a
// five-way UNION read better as the SQL they are, and the row type below says what comes
// back. The statement is the one the string version sent; the three `?` are now template
// parameters, bound as before.
/**
 * @typedef {{ team_id: number, team_name: string, club: number, team_rank: number,
 *   playerID: number, first_name: string, family_name: string, gender: string,
 *   numPlayed: string | number, next_team_name: string | null }} MissedThreeRow
 */
exports.getMissedThreePlayers = async function() {
  const Roster = require('./roster');
  const { rows } = await /** @type {import('kysely').RawBuilder<MissedThreeRow>} */ (sql`WITH season_window AS (
  SELECT "startDate", "endDate" FROM season WHERE name = ${seasonModel.current()}
),
team_fixtures AS (
  SELECT
    f.id        AS fixture_id,
    f.date      AS fixture_date,
    f."homeTeam"  AS team_id,
    f."homeMan1"  AS p1, f."homeMan2" AS p2, f."homeMan3" AS p3,
    f."homeLady1" AS p4, f."homeLady2" AS p5, f."homeLady3" AS p6
  FROM fixture f
  JOIN season_window w ON f.date >= w."startDate" AND f.date <= w."endDate"
  WHERE f.status = 'complete'

  UNION ALL

  SELECT
    f.id,
    f.date,
    f."awayTeam",
    f."awayMan1",  f."awayMan2",  f."awayMan3",
    f."awayLady1", f."awayLady2", f."awayLady3"
  FROM fixture f
  JOIN season_window w ON f.date >= w."startDate" AND f.date <= w."endDate"
  WHERE f.status = 'complete'
),
ranked AS (
  SELECT
    tf.*,
    ROW_NUMBER() OVER (
      PARTITION BY tf.team_id
      ORDER BY tf.fixture_date DESC, tf.fixture_id DESC
    ) AS rn
  FROM team_fixtures tf
),
last3 AS (
  SELECT *
  FROM ranked
  WHERE rn <= 3
),
teams_with_three AS (
  SELECT team_id FROM ranked GROUP BY team_id HAVING COUNT(*) >= 3
),
men_used AS (
  SELECT
    m.team_id,
    COUNT(DISTINCT m.player_id) AS mendistinctused
  FROM (
    SELECT team_id, p1 AS player_id FROM last3
    UNION ALL SELECT team_id, p2 FROM last3
    UNION ALL SELECT team_id, p3 FROM last3
  ) m
  JOIN player p
    ON p.id = m.player_id
   AND p.team = m.team_id
  WHERE m.player_id <> 0
  GROUP BY m.team_id
),
ladies_used AS (
  SELECT
    l.team_id,
    COUNT(DISTINCT l.player_id) AS ladiesdistinctused
  FROM (
    SELECT team_id, p4 AS player_id FROM last3
    UNION ALL SELECT team_id, p5 FROM last3
    UNION ALL SELECT team_id, p6 FROM last3
  ) l
  JOIN player p
    ON p.id = l.player_id
   AND p.team = l.team_id
  WHERE l.player_id <> 0
  GROUP BY l.team_id
),

fixture_players AS (
  SELECT team_id, fixture_id, p1 AS player_id FROM last3
  UNION ALL SELECT team_id, fixture_id, p2 FROM last3
  UNION ALL SELECT team_id, fixture_id, p3 FROM last3
  UNION ALL SELECT team_id, fixture_id, p4 FROM last3
  UNION ALL SELECT team_id, fixture_id, p5 FROM last3
  UNION ALL SELECT team_id, fixture_id, p6 FROM last3
),
appearances AS (
  SELECT
    team_id,
    player_id,
    COUNT(DISTINCT fixture_id) AS numplayed
  FROM fixture_players
  WHERE player_id <> 0
  GROUP BY team_id, player_id
),
nom_players AS (
  SELECT
    p.team AS team_id,
    p.id   AS player_id,
    p.first_name,
    p.family_name,
    p.gender
  FROM player p
  WHERE p."rank" IS NULL OR p."rank" < ${Roster.RESERVE_BASE}
),
team_filtered AS (
  SELECT
    t.*,
    COUNT(*) OVER (PARTITION BY t.club) AS club_team_count,
    MAX(t."rank") OVER (PARTITION BY t.club) AS club_lowest_rank
  FROM team t
  WHERE t.club <> ${Roster.NO_CLUB_ID}
)
SELECT
  t.id   AS team_id,
  t.name AS team_name,
  t.club AS club,
  t."rank" AS team_rank,
  np.player_id AS "playerID",
  np.first_name,
  np.family_name,
  np.gender,
  COALESCE(a.numPlayed, 0) AS "numPlayed",
  -- The team a replacement would be promoted from. Never NULL here: the club's
  -- lowest team is filtered out below, so there is always one beneath.
  (SELECT n.name FROM team n
    WHERE n.club = t.club AND n."rank" > t."rank"
    ORDER BY n."rank", n.id LIMIT 1) AS next_team_name
FROM team_filtered t
JOIN teams_with_three twt
  ON twt.team_id = t.id
JOIN nom_players np
  ON np.team_id = t.id
LEFT JOIN appearances a
  ON a.team_id = t.id AND a.player_id = np.player_id
LEFT JOIN men_used mu
  ON mu.team_id = t.id
LEFT JOIN ladies_used lu
  ON lu.team_id = t.id
WHERE
  t.club_team_count > 1
  AND t."rank" < t.club_lowest_rank
  AND COALESCE(a.numPlayed, 0) = 0
  AND NOT (
    COALESCE(mu.menDistinctUsed, 0) >= 3
    AND COALESCE(lu.ladiesDistinctUsed, 0) >= 3
  )
ORDER BY t.club, t."rank", np.family_name, np.first_name;`).execute(kysely)
  return rows
}

/** @param {any} fixtureId */
exports.getMatchStats = async function(fixtureId) {
  const [result] = await (await db.otherConnect()).query(
    "SELECT CONCAT(player.first_name,' ',player.family_name) AS name, team.name AS \"teamName\", b.\"avgPtsFor\", b.\"avgPtsAgainst\", \"gamesWon\" FROM ( SELECT playerId, AVG(ptsFor) AS \"avgPtsFor\", AVG(ptsAgainst) AS \"avgPtsAgainst\", SUM(won) AS \"gamesWon\" FROM ( SELECT \"homePlayer1\" AS playerid, \"homeScore\" AS ptsfor, \"awayScore\" AS ptsagainst, CASE WHEN \"homeScore\" > \"awayScore\" THEN 1 ELSE 0 END AS won FROM game WHERE fixture = ? AND (\"awayPlayer1\" !=0 AND \"awayPlayer2\" != 0 AND \"homePlayer2\" != 0 AND \"homePlayer1\" !=0) UNION ALL SELECT \"homePlayer2\" AS playerid, \"homeScore\" AS ptsfor, \"awayScore\" AS ptsagainst, CASE WHEN \"homeScore\" > \"awayScore\" THEN 1 ELSE 0 END AS won FROM game WHERE fixture = ? AND (\"awayPlayer1\" !=0 AND \"awayPlayer2\" != 0 AND \"homePlayer2\" != 0 AND \"homePlayer1\" !=0) UNION ALL SELECT \"awayPlayer1\" AS playerid, \"awayScore\" AS ptsfor, \"homeScore\" AS ptsagainst, CASE WHEN \"homeScore\" < \"awayScore\" THEN 1 ELSE 0 END AS won FROM game WHERE fixture = ? AND (\"awayPlayer1\" !=0 AND \"awayPlayer2\" != 0 AND \"homePlayer2\" != 0 AND \"homePlayer1\" !=0) UNION ALL SELECT \"awayPlayer2\" AS playerid, \"awayScore\" AS ptsfor, \"homeScore\" AS ptsagainst, CASE WHEN \"homeScore\" < \"awayScore\" THEN 1 ELSE 0 END AS won FROM game WHERE fixture = ? AND (\"awayPlayer1\" !=0 AND \"awayPlayer2\" != 0 AND \"homePlayer2\" != 0 AND \"homePlayer1\" !=0) ) AS a GROUP BY playerId ) AS b JOIN player ON b.playerId = player.id JOIN team ON player.team = team.id ORDER BY \"teamName\", \"gamesWon\" DESC, \"avgPtsAgainst\" ASC",
    Array(4).fill(fixtureId * 1)
  )
  return result
}


/** @param {any} searchTerms */
exports.getNamesClubsTeams = async function(searchTerms) {
  var whereTerms = [];
  var whereValue = [];
  var nameMatch = ""

  let season = ""
  /** @param {any} season */
  function checkSeason(season) {
    // Shape first. Without this the parseInt pair below waves payloads through:
    // parseInt("2026 AS team WHERE false --") is 2026, so a crafted season passed
    // every check and reached the team${season} interpolation as SQL.
    if (!seasonModel.isValidName(season)) return false
    let firstYear = parseInt(season.slice(0, 4))
    let secondYear = parseInt(season.slice(4))
    if (secondYear - firstYear != 1) return false
    if (firstYear < 2018 || season == seasonModel.current()) return false
    return true
  }

  if (searchTerms.season !== undefined && checkSeason(searchTerms.season)) {
    season = searchTerms.season;
  }

  if (searchTerms.name) {
    var letter = searchTerms.name.substr(0, 1);
    nameMatch = "AND (player.first_name LIKE '" + letter + "%' OR player.family_name LIKE '" + letter + "%')"
  }
  if (searchTerms.club) {
    whereTerms.push('"clubName" = ?');
    whereValue.push(searchTerms.club)
  }
  if (searchTerms.team) {
    whereTerms.push('"teamName" = ?');
    whereValue.push(searchTerms.team)
  }
  if (searchTerms.gender) {
    whereTerms.push('gender = ?');
    whereValue.push(searchTerms.gender)
  }

  if (whereTerms.length > 0) {
    var conditions = ' WHERE ' + whereTerms.join(' AND ');
    const [result] = await (await db.otherConnect()).query(
      'SELECT * FROM (SELECT a."playerID", a.name, gender, date_of_registration, a.rank, club.id AS "clubId", club.name AS "clubName", a."teamName", a."teamId" FROM (SELECT player.id AS "playerID", CONCAT(first_name,\' \',family_name) AS name, gender, date_of_registration, player.rank, team.id AS "teamId", team.name AS "teamName", player.club AS "clubId" FROM player' + season + ' player JOIN team' + season + ' team ON team.id = player.team ' + nameMatch + ') AS a JOIN club' + season + ' club ON a."clubId" = club.id) AS b' + conditions + ' ORDER BY "teamName", gender, rank',
      whereValue
    )
    return result
  } else {
    const [result] = await (await db.otherConnect()).query(
      'SELECT a."playerID", a.name, gender, date_of_registration, a.rank, club.id AS "clubId", club.name AS "clubName", a."teamName", a."teamId" FROM (SELECT player.id AS "playerID", CONCAT(first_name,\' \',family_name) AS name, gender, date_of_registration, player.rank, team.id AS "teamId", team.name AS "teamName", player.club AS "clubId" FROM player JOIN team ON team.id = player.team ' + nameMatch + ') AS a JOIN club ON a."clubId" = club.id ORDER BY "teamName", gender, rank'
    )
    return result
  }
}

// The season snapshots this database holds, as two relations keyed by season, for a query
// that spans every season and so cannot name one archive table. Discovered from the
// schema rather than listed, so a season archived at the next rollover is read without
// anyone remembering to add it, and a season never played (2020/21) simply has no rows.
//
// The current season is left out even if a snapshot of it exists: until it ends, the
// live tables are the record of it.
/** @param {any} conn */
async function seasonSnapshots(conn) {
  const [tables] = await conn.query(
    'SELECT table_name FROM information_schema.tables WHERE table_schema = ? AND table_name ~ ?',
    ['public', '^(team|player)20[0-9]{6}$']
  )
  const current = seasonModel.current()
  const seasonsOf = (/** @type {any} */ kind) => tables
    .map((/** @type {any} */ t) => t.table_name)
    .filter((/** @type {any} */ name) => name.startsWith(kind))
    .map((/** @type {any} */ name) => seasonModel.assertName(name.slice(kind.length)))
    .filter((/** @type {any} */ season) => season !== current)
    .sort()
  const union = (/** @type {string[]} */ rows, /** @type {string} */ empty) => rows.length ? rows.join(' UNION ALL ') : empty
  return {
    teamThen: union(
      seasonsOf('team').map((/** @type {any} */ s) => `SELECT '${s}'::text AS season, id, name, rank FROM team${s}`),
      'SELECT NULL::text AS season, NULL::integer AS id, NULL::varchar AS name, NULL::integer AS rank WHERE false'
    ),
    playerThen: union(
      seasonsOf('player').map((/** @type {any} */ s) => `SELECT '${s}'::text AS season, id, team FROM player${s}`),
      'SELECT NULL::text AS season, NULL::integer AS id, NULL::integer AS team WHERE false'
    ),
  }
}

/** @param {any} id */
exports.getPlayerGameData = async function(id) {
  // LEFT JOIN, not INNER, and this is not a style preference (HARD-11).
  //
  // There are no foreign keys on fixture."homeTeam"/"awayTeam", and 2,132 fixtures across
  // every season point at team ids that are no longer in `team`. An inner join here drops
  // those games from the player's history silently: **10,422 of 35,244 game rows, 30% of
  // everything ever recorded, affecting 677 of 904 players.** Measured 14 Sep 2026. Susan
  // Forbes played 716 rated games and this page showed her 256 of them.
  //
  // Each game shows its teams AS THEY WERE THAT SEASON (25 Oct 2026). Team ids are reused
  // (HARD-39: 51, 54–57) and teams are renamed, so reading the live `team` showed whichever
  // team holds the id today: 7,704 of 71,748 game sides on production. The season comes
  // from the fixture's date, the team from that season's snapshot, falling back to the live
  // row and then to 'Former team' — the current season, and the 14 fixtures dated outside
  // every season, read live as before.
  //
  // The "(+N)" playing-up bracket compares the player's OWN team that season (the season's
  // player snapshot, from 2018/19) with the team they played for. Before 2018/19 there is
  // no player snapshot and their own team falls back to today's, as it always did.
  //
  // A rank stays NULL when its team is missing, so `teamAdjustment` below is NULL and the
  // view's `teamAdjustment > 0` guard simply renders no bracket. Checked.
  const conn = await db.otherConnect()
  const { teamThen, playerThen } = await seasonSnapshots(conn)
  let sql = `WITH teamThen AS (${teamThen}),
playerThen AS (${playerThen}),
playerGames AS (SELECT game.*, fixture.date, fixtureSeason.name AS fixtureseason,
COALESCE(homeThen.name, homeTeam.name, 'Former team') AS hometeamname,
CASE WHEN homeThen.id IS NULL THEN homeTeam.rank ELSE homeThen.rank END AS hometeamrank,
COALESCE(awayThen.name, awayTeam.name, 'Former team') AS awayteamname,
CASE WHEN awayThen.id IS NULL THEN awayTeam.rank ELSE awayThen.rank END AS awayteamrank FROM game
JOIN fixture ON game.fixture = fixture.id
LEFT JOIN LATERAL (SELECT s.name FROM season s WHERE fixture.date > s."startDate" AND fixture.date < s."endDate" ORDER BY s."startDate" DESC LIMIT 1) fixtureSeason ON true
LEFT JOIN teamThen homeThen ON homeThen.season = fixtureSeason.name AND homeThen.id = fixture."homeTeam"
LEFT JOIN teamThen awayThen ON awayThen.season = fixtureSeason.name AND awayThen.id = fixture."awayTeam"
LEFT JOIN team homeTeam ON fixture."homeTeam" = homeTeam.id
LEFT JOIN team awayTeam ON fixture."awayTeam" = awayTeam.id
WHERE
(? IN("homePlayer1","homePlayer2","awayPlayer1","awayPlayer2") AND (
  "homePlayer1End" IS NOT NULL AND
  "homePlayer2End" IS NOT NULL AND
  "awayPlayer1End" IS NOT NULL AND
  "awayPlayer2End" IS NOT NULL
))
),
allGames AS (
  SELECT
  id,
  date,
  fixtureseason,
  CASE WHEN "homePlayer1" = ? THEN homeTeamName
  WHEN "homePlayer2" = ? THEN homeTeamName
  WHEN "awayPlayer1" = ? THEN awayTeamName
  WHEN "awayPlayer2" = ? THEN awayTeamName
  END AS teamname,
  CASE WHEN "homePlayer1" = ? THEN homeTeamRank
  WHEN "homePlayer2" = ? THEN homeTeamRank
  WHEN "awayPlayer1" = ? THEN awayTeamRank
  WHEN "awayPlayer2" = ? THEN awayTeamRank
  END AS teamrank,
  CASE WHEN "homePlayer1" = ? THEN "homePlayer1"
  WHEN "homePlayer2" = ? THEN "homePlayer2"
  WHEN "awayPlayer1" = ? THEN "awayPlayer1"
  WHEN "awayPlayer2" = ? THEN "awayPlayer2"
  END AS playername,
  CASE WHEN "homePlayer1" = ? THEN "homePlayer2"
  WHEN "homePlayer2" = ? THEN "homePlayer1"
  WHEN "awayPlayer1" = ? THEN "awayPlayer2"
  WHEN "awayPlayer2" = ? THEN "awayPlayer1"
  END AS partner,
  CASE WHEN "homePlayer1" = ? THEN "awayPlayer1"
  WHEN "homePlayer2" = ? THEN "awayPlayer1"
  WHEN "awayPlayer1" = ? THEN "homePlayer1"
  WHEN "awayPlayer2" = ? THEN "homePlayer1"
  END AS oppo1,
  CASE WHEN "homePlayer1" = ? THEN "awayPlayer2"
  WHEN "homePlayer2" = ? THEN "awayPlayer2"
  WHEN "awayPlayer1" = ? THEN "homePlayer2"
  WHEN "awayPlayer2" = ? THEN "homePlayer2"
  END AS oppo2,
  CASE WHEN "homePlayer1" = ? THEN "homeScore"
  WHEN "homePlayer2" = ? THEN "homeScore"
  WHEN "awayPlayer1" = ? THEN "awayScore"
  WHEN "awayPlayer2" = ? THEN "awayScore"
  END AS score,
  CASE WHEN "homePlayer1" = ? THEN "awayScore"
  WHEN "homePlayer2" = ? THEN "awayScore"
  WHEN "awayPlayer1" = ? THEN "homeScore"
  WHEN "awayPlayer2" = ? THEN "homeScore"
  END AS vsscore,
  "gameType",
  CASE WHEN "homePlayer1" = ? THEN "homePlayer1Start"
  WHEN "homePlayer2" = ? THEN "homePlayer2Start"
  WHEN "awayPlayer1" = ? THEN "awayPlayer1Start"
  WHEN "awayPlayer2" = ? THEN "awayPlayer2Start"
  END AS beforeval,
  CASE WHEN "homePlayer1" = ? THEN "homePlayer1End"
  WHEN "homePlayer2" = ? THEN "homePlayer2End"
  WHEN "awayPlayer1" = ? THEN "awayPlayer1End"
  WHEN "awayPlayer2" = ? THEN "awayPlayer2End"
  END AS after,
  CASE WHEN "homePlayer1" = ? THEN "homePlayer1End" - "homePlayer1Start"
  WHEN "homePlayer2" = ? THEN "homePlayer2End" - "homePlayer2Start"
  WHEN "awayPlayer1" = ? THEN "awayPlayer1End" - "awayPlayer1Start"
  WHEN "awayPlayer2" = ? THEN "awayPlayer2End" - "awayPlayer2Start"
  END AS adjustment
  FROM playerGames
)
SELECT
allGames.id,
date,
teamname AS "teamName",
CASE WHEN ownThen.id IS NULL THEN team.rank ELSE ownTeamThen.rank END - teamrank AS "teamAdjustment",
CONCAT(player.first_name,' ',player.family_name) AS "playerName",
CONCAT(partner.first_name,' ',partner.family_name) AS "partnerName",
CONCAT(oppo1.first_name,' ',oppo1.family_name) AS "oppName1",
CONCAT(oppo2.first_name,' ',oppo2.family_name) AS "oppName2",
score,
vsscore AS "vsScore",
"gameType",
beforeval AS "beforeVal",
after,
adjustment
FROM allGames JOIN
player ON player.id = allGames.playerName JOIN
player partner ON partner.id = allGames.partner JOIN
player oppo1 ON oppo1.id = allGames.oppo1 JOIN
player oppo2 ON oppo2.id = allGames.oppo2
LEFT JOIN playerThen ownThen ON ownThen.season = allGames.fixtureseason AND ownThen.id = player.id
LEFT JOIN teamThen ownTeamThen ON ownTeamThen.season = allGames.fixtureseason AND ownTeamThen.id = ownThen.team
LEFT JOIN team ON player.team = team.id
ORDER BY date DESC, allGames.id DESC`
  // The order is the page's contract, so it is on the outer query. It used to sit inside
  // the first CTE, where Postgres is free to ignore it, and on 25 Oct 2026 only 320 of 915
  // players' histories came back in date order at all. The chart reverses these rows and
  // keeps the last game it sees for each night, so newest first, and within a night the
  // highest game id first — eloChain rates a fixture's games in id order, so reversed, the
  // night's point is the rating after its last game.

  let idArray = Array(45).fill(id * 1)
  const [result] = await conn.query(sql, idArray)
  return result
}


/** @param {any} searchObj */
exports.newGetPlayerStats = async function(searchObj) {
  let season = ""
  let seasonString = seasonModel.current()
  let whereValue = []

  /** @param {any} season */
  function checkSeason(season) {
    // Shape first. Without this the parseInt pair below waves payloads through:
    // parseInt("2026 AS team WHERE false --") is 2026, so a crafted season passed
    // every check and reached the team${season} interpolation as SQL.
    if (!seasonModel.isValidName(season)) return false
    let firstYear = parseInt(season.slice(0, 4))
    let secondYear = parseInt(season.slice(4))
    if (secondYear - firstYear != 1) return false
    if (firstYear < 2012 || season == seasonModel.current()) return false
    return true
  }

  let seasonVal
  if (searchObj.season === undefined || !checkSeason(searchObj.season)) {
    seasonVal = seasonString
  } else {
    season = searchObj.season;
    seasonVal = searchObj.season;
  }
  whereValue.push(seasonVal);
  whereValue.push(searchObj.gender || '%');
  whereValue.push(searchObj.team || '%');
  if (searchObj.division) whereValue.push(searchObj.division)
  whereValue.push(searchObj.club || '%');
  whereValue.push(searchObj.gameType || '%');

  var sql = `WITH
  seasonFixture AS (
    SELECT
      fixture.id,
      fixture."homeTeam",
      fixture."awayTeam"
    FROM
      fixture
      JOIN season ON season.name LIKE ?
      AND fixture.date > season."startDate"
      AND fixture.date < season."endDate"
  ),
  seasonFixtureGame AS (
    SELECT
      game.id,
      game."homePlayer1",
      game."homePlayer2",
      game."awayPlayer1",
      game."awayPlayer2",
      game."homeScore",
      game."awayScore",
      game.fixture,
      seasonFixture."homeTeam",
      seasonFixture."awayTeam"
    FROM
      seasonFixture
      JOIN game ON game.fixture = seasonFixture.id
      AND (
        game."homePlayer1" != 0
        OR game."homePlayer2" != 0
        OR game."awayPlayer1" != 0
        OR game."awayPlayer2" != 0
      )
  ),
  gameTypeGender AS (
    SELECT
      seasonFixtureGame.*,
      CASE
        WHEN homePlayer1.gender = homePlayer2.gender
        AND homePlayer1.gender = 'Male' THEN 'Mens'
        WHEN homePlayer1.gender = homePlayer2.gender
        AND homePlayer1.gender = 'Female' THEN 'Ladies'
        ELSE 'Mixed'
      END AS "gameType"
    FROM
      seasonFixtureGame
      JOIN player${ season } homePlayer1 ON seasonFixtureGame."homePlayer1" = homePlayer1.id
      AND seasonFixtureGame."homePlayer1" != 0
      JOIN player${ season } homePlayer2 ON seasonFixtureGame."homePlayer2" = homePlayer2.id
      AND seasonFixtureGame."homePlayer2" != 0
  ),
  gameSummary AS (
    SELECT
      gameTypeGender.id,
      gameTypeGender."homePlayer1" AS "playerId",
      gameTypeGender."homeScore" AS forpoints,
      gameTypeGender."awayScore" AS againstpoints,
      CASE
        WHEN gameTypeGender."homeScore" > gameTypeGender."awayScore" THEN 1
        ELSE 0
      END AS gameswon,
      CASE
        WHEN gameTypeGender."homeScore" IS NOT NULL THEN 1
        ELSE 0
      END AS gamesplayed,
      gameTypeGender.fixture,
      gameTypeGender."homeTeam" AS team,
      gameTypeGender."awayTeam" AS opposition,
      gameTypeGender."gameType"
    FROM
      gameTypeGender
    UNION ALL
    SELECT
      gameTypeGender.id,
      gameTypeGender."homePlayer2" AS "playerId",
      gameTypeGender."homeScore" AS forpoints,
      gameTypeGender."awayScore" AS againstpoints,
      CASE
        WHEN gameTypeGender."homeScore" > gameTypeGender."awayScore" THEN 1
        ELSE 0
      END AS gameswon,
      CASE
        WHEN gameTypeGender."homeScore" IS NOT NULL THEN 1
        ELSE 0
      END AS gamesplayed,
      gameTypeGender.fixture,
      gameTypeGender."homeTeam" AS team,
      gameTypeGender."awayTeam" AS opposition,
      gameTypeGender."gameType"
    FROM
      gameTypeGender
    UNION ALL
    SELECT
      gameTypeGender.id,
      gameTypeGender."awayPlayer1" AS "playerId",
      gameTypeGender."awayScore" AS forpoints,
      gameTypeGender."homeScore" AS againstpoints,
      CASE
        WHEN gameTypeGender."awayScore" > gameTypeGender."homeScore" THEN 1
        ELSE 0
      END AS gameswon,
      CASE
        WHEN gameTypeGender."homeScore" IS NOT NULL THEN 1
        ELSE 0
      END AS gamesplayed,
      gameTypeGender.fixture,
      gameTypeGender."awayTeam" AS team,
      gameTypeGender."homeTeam" AS opposition,
      gameTypeGender."gameType"
    FROM
      gameTypeGender
    UNION ALL
    SELECT
      gameTypeGender.id,
      gameTypeGender."awayPlayer2" AS "playerId",
      gameTypeGender."awayScore" AS forpoints,
      gameTypeGender."homeScore" AS againstpoints,
      CASE
        WHEN gameTypeGender."awayScore" > gameTypeGender."homeScore" THEN 1
        ELSE 0
      END AS gameswon,
      CASE
        WHEN gameTypeGender."homeScore" IS NOT NULL THEN 1
        ELSE 0
      END AS gamesplayed,
      gameTypeGender.fixture,
      gameTypeGender."awayTeam" AS team,
      gameTypeGender."homeTeam" AS opposition,
      gameTypeGender."gameType"
    FROM
      gameTypeGender
  )
SELECT
  CONCAT(player.first_name,' ',player.family_name) AS playername,
  "playerId",
  player.gender AS playergender,
  STRING_AGG("gameType", ','),
  gameSummary.team AS "teamId",
  SUM(forPoints) AS "forPoints",
  SUM(againstPoints) AS "againstPoints",
  SUM(gamesWon) AS "gamesWon",
  SUM(gamesPlayed) AS "gamesPlayed",
  (SUM(gamesPlayed) + SUM(gamesWon)) - (SUM(gamesPlayed) - SUM(gamesWon)) AS "Points",
  club.name AS "clubName",
  gameTeam.name AS "teamName"
  ${ (searchObj.season === undefined || !checkSeason(searchObj.season)) ? ',player.rating' : ''}
FROM
  gameSummary
  JOIN player${ season } player ON "playerId" = player.id
  AND player.gender LIKE ?
  ${typeof searchObj.junior !== 'undefined' ? 'AND player.junior = 1' : ''}
  JOIN team${ season } gameTeam ON gameTeam.id = gameSummary.team
  AND gameTeam.name LIKE ? ${typeof searchObj.division !== 'undefined' ? 'AND gameTeam.division = ?' : ''}
  JOIN club${ season } club ON club.id = player.club
  AND club.name LIKE ?
WHERE
"gameType" LIKE ?

GROUP BY
  "playerId",
  playername,
  playergender,
  gameSummary.team,
  "clubName",
  "teamName"
  ${ (searchObj.season === undefined || !checkSeason(searchObj.season)) ? ',player.rating' : ''}
ORDER BY
  "Points" DESC;`

  const [result] = await (await db.otherConnect()).query(sql, whereValue)
  return result
}


/** @param {any} searchObj */
exports.newGetPairStats = async function(searchObj) {
  let season = ""
  let seasonString = seasonModel.current()
  let divisionSql = ""
  let whereValue = []

  /** @param {any} season */
  function checkSeason(season) {
    // Shape first. Without this the parseInt pair below waves payloads through:
    // parseInt("2026 AS team WHERE false --") is 2026, so a crafted season passed
    // every check and reached the team${season} interpolation as SQL.
    if (!seasonModel.isValidName(season)) return false
    let firstYear = parseInt(season.slice(0, 4))
    let secondYear = parseInt(season.slice(4))
    if (secondYear - firstYear != 1) return false
    if (firstYear < 2012 || season == seasonModel.current()) return false
    return true
  }

  let seasonVal
  if (searchObj.season === undefined || !checkSeason(searchObj.season)) {
    seasonVal = seasonString
  } else {
    season = searchObj.season;
    seasonVal = searchObj.season;
  }
  // In placeholder order. These used to be pasted into the statement from the URL.
  whereValue = [seasonVal]
  if (searchObj.division !== undefined) whereValue.push(searchObj.division)
  whereValue.push(searchObj.team || '%')
  whereValue.push(searchObj.club || '%')
  whereValue.push(searchObj.gameType || '%')

  var sql = `WITH
  seasonFixture AS (
    SELECT
      fixture.id,
      fixture."homeTeam",
      fixture."awayTeam"
    FROM
      fixture
      JOIN season ON season.name LIKE ?
      AND fixture.date > season."startDate"
      AND fixture.date < season."endDate"
  ),
  seasonFixtureGame AS (
    SELECT
      game.id,
      game."homePlayer1",
      game."homePlayer2",
      game."awayPlayer1",
      game."awayPlayer2",
      game."homeScore",
      game."awayScore",
      game.fixture,
      seasonFixture."homeTeam",
      seasonFixture."awayTeam"
    FROM
      seasonFixture
      JOIN game ON game.fixture = seasonFixture.id
      AND (
        game."homePlayer1" != 0
        OR game."homePlayer2" != 0
        OR game."awayPlayer1" != 0
        OR game."awayPlayer2" != 0
      )
  ),
  gameTypeGender AS (
    SELECT
      seasonFixtureGame.*,
      CASE
        WHEN homePlayer1.gender = homePlayer2.gender
        AND homePlayer1.gender = 'Male' THEN 'Mens'
        WHEN homePlayer1.gender = homePlayer2.gender
        AND homePlayer1.gender = 'Female' THEN 'Ladies'
        ELSE 'Mixed'
      END AS "gameType",
      homePlayer1.gender AS playergender
    FROM
      seasonFixtureGame
      JOIN player${ season } homePlayer1 ON seasonFixtureGame."homePlayer1" = homePlayer1.id
      AND seasonFixtureGame."homePlayer1" != 0
      JOIN player${ season } homePlayer2 ON seasonFixtureGame."homePlayer2" = homePlayer2.id
      AND seasonFixtureGame."homePlayer2" != 0
  ),
  PairsgameSummary AS (
    SELECT
      gameTypeGender.id,
      LEAST(gameTypeGender."homePlayer1", gameTypeGender."homePlayer2") AS player1id,
      GREATEST(gameTypeGender."homePlayer1", gameTypeGender."homePlayer2") AS player2id,
      gameTypeGender."homeScore" AS forpoints,
      gameTypeGender."awayScore" AS againstpoints,
      CASE
        WHEN gameTypeGender."homeScore" > gameTypeGender."awayScore" THEN 1
        ELSE 0
      END AS gameswon,
      CASE
        WHEN gameTypeGender."homeScore" IS NOT NULL THEN 1
        ELSE 0
      END AS gamesplayed,
      gameTypeGender.fixture,
      gameTypeGender."homeTeam" AS team,
      gameTypeGender."awayTeam" AS opposition,
      gameTypeGender."gameType",
      team.division
    FROM
      gameTypeGender
      JOIN team${ season } team ON "homeTeam" = team.id
    UNION ALL
    SELECT
      gameTypeGender.id,
      LEAST(gameTypeGender."awayPlayer1", gameTypeGender."awayPlayer2") AS player1id,
      GREATEST(gameTypeGender."awayPlayer2", gameTypeGender."awayPlayer1") AS player2id,
      gameTypeGender."awayScore" AS forpoints,
      gameTypeGender."homeScore" AS againstpoints,
      CASE
        WHEN gameTypeGender."awayScore" > gameTypeGender."homeScore" THEN 1
        ELSE 0
      END AS gameswon,
      CASE
        WHEN gameTypeGender."homeScore" IS NOT NULL THEN 1
        ELSE 0
      END AS gamesplayed,
      gameTypeGender.fixture,
      gameTypeGender."awayTeam" AS team,
      gameTypeGender."homeTeam" AS opposition,
      gameTypeGender."gameType",
      team.division
    FROM
      gameTypeGender
      JOIN team${ season } team ON "homeTeam" = team.id
  )
SELECT
  CONCAT(Player1.first_name,' ',Player1.family_name,' & ',Player2.first_name,' ',Player2.family_name) AS "Pairing",
  player1Id,
  player2Id,
  ${ (searchObj.season === undefined || !checkSeason(searchObj.season)) ? '(Player1.rating + Player2.rating) / 2 AS "pairRating",' : ''}
  SUM(forPoints) AS "forPoints",
  SUM(againstPoints) AS "againstPoints",
  SUM(gamesWon) AS "gamesWon",
  SUM(gamesPlayed) AS "gamesPlayed",
  SUM(gamesWon) / SUM(gamesPlayed) AS "winRate",
  (SUM(gamesWon) + SUM(gamesPlayed)) - (SUM(gamesPlayed) - SUM(gamesWon)) AS "Points",
  club.name AS "clubName",
  MIN(team.name) AS "teamName",
  "gameType"
FROM
  (SELECT * FROM PairsgameSummary) AS a
  JOIN player${ season } Player1 ON Player1.id = a.player1Id
  JOIN player${ season } Player2 ON Player2.id = a.player2Id
  JOIN team${ season } team ON team.id = a.team
  ${ (searchObj.division !== undefined) ? 'AND team.division = ?' : ''}
  AND team.name LIKE ?
  JOIN club${ season } club ON club.id = Player1.club
  AND club.name LIKE ?
  AND "gameType" LIKE ?
GROUP BY
  "Pairing",
  player1Id,
  player2Id,
  "clubName",
  ${ (searchObj.season === undefined || !checkSeason(searchObj.season)) ? '"pairRating",' : ''}
  "gameType"
ORDER BY
  "winRate" DESC,
  "Points" DESC`

  const [result] = await (await db.otherConnect()).query(sql, whereValue)
  return result
}

// Site-wide role/messerAdmin lookup by login email, for the Auth0Strategy
// verify callback (app.js) to enrich req.user at login time. Scoped to only
// rows that could plausibly have a role so the decrypt stays cheap on every
// login — this is not a full-roster scan, it's bounded by how many admins
// the league ever has (currently ~150 of 1104 players). Matches against
// EITHER "authEmail" (the login identity, see migrations/009) or the older
// "playerEmail" (contact email) — a player's login email is often not their
// registered contact email, so relying on playerEmail alone misses most
// admins (confirmed live: 82 of 151 during the initial backfill).
/** @param {string} email */
exports.getAuthRoleByEmail = async function(email) {
  /** `column` is set and decrypts to `email`, ignoring case. */
  const matches = (/** @type {any} */ eb, /** @type {'authEmail' | 'playerEmail'} */ column) => eb.and([
    eb(`player.${column}`, 'is not', null),
    eb(eb.fn('lower', [decrypt(eb.ref(`player.${column}`))]), '=', eb.fn('lower', [eb.val(email)])),
  ])
  return kysely.selectFrom('player')
    .innerJoin('club', 'club.id', 'player.club')
    .select(['player.id', 'player.first_name', 'player.family_name', 'player.role', 'player.messerAdmin',
      'club.name as clubName'])
    .where(eb => eb.and([
      eb.or([eb('player.role', 'is not', null), eb('player.messerAdmin', '=', 1)]),
      eb.or([matches(eb, 'authEmail'), matches(eb, 'playerEmail')]),
    ]))
    .executeTakeFirst()
}

// Used by the superadmin-gated fields on the player edit form, and by the
// auth-role backfill script. authEmail is only touched when explicitly
// provided, so ordinary player-edit calls (which don't know about it) never
// clear an existing value.
//
// Approving a signup also seeds "playerEmail" **when the player has none**.
// The two columns are deliberately separate — authEmail is the login identity,
// playerEmail the contact address a player can edit — but a player added to a
// roster by their captain has no contact email at all, and nothing else ever
// fills it in. So a newly signed-up player could log in, hold a real address in
// authEmail, and still show a blank email on their own profile form and on their
// club's contact page, which read playerEmail (Chris Petty, Alderley Park B).
// A player who already has a contact email keeps it: the COALESCE/NULLIF guard
// makes this an initialisation, never an overwrite.
/**
 * Returns nothing; neither caller (playerController, models/auth) read the old rows array.
 * @param {number} playerId
 * @param {{ role?: string | null, messerAdmin?: boolean, authEmail?: string }} opts
 */
exports.setAuthRole = async function(playerId, { role, messerAdmin, authEmail }) {
  if (authEmail) {
    await kysely.updateTable('player')
      .set(eb => ({
        role: role || null,
        messerAdmin: messerAdmin ? 1 : 0,
        authEmail: encrypt(authEmail),
        playerEmail: eb.case()
          .when(eb(eb.fn.coalesce(eb.fn('nullif', [eb.fn('trim', [decrypt(eb.ref('playerEmail'))]), sql.lit('')]), sql.lit('')), '=', ''))
          .then(encrypt(authEmail))
          .else(eb.ref('playerEmail'))
          .end(),
      }))
      .where('id', '=', playerId)
      .execute()
    return
  }
  await kysely.updateTable('player').set({ role: role || null, messerAdmin: messerAdmin ? 1 : 0 })
    .where('id', '=', playerId).execute()
}

/** @param {{ role?: string, division?: number | string, club?: number | string, teamName?: string }} searchTerms */
exports.getEmails = async function(searchTerms) {
  // Every (club, team) pair, tagged with the role a branch collects. The five branches
  // below join it to the players who hold that role; a club-level role (match or club
  // secretary) lands on every team of the club.
  //
  // An officer is the role flag on the player, read against the player's own club or
  // team. There used to be a second record, a pointer on the club or team
  // (club."matchSec", club."clubSec", team.captain), which never checked where the player
  // now was: it kept someone who had left a club on its division's list until her mailbox
  // bounced (18 Sep 2026). REARCH-03 cleared the pointers (25 Oct 2026) and then dropped them.
  /** @param {string} role */
  const clubTeams = role => kysely.selectFrom('club').innerJoin('team', 'team.club', 'club.id')
    .select(['club.id', 'club.name as clubname', 'team.id as teamid', 'team.name as teamname',
      'team.division', sql.lit(role).as('role')])
  /** @param {string} role @param {(eb: any) => any} holds */
  const branch = (role, holds) => kysely.selectFrom(clubTeams(role).as('a'))
    .innerJoin('player', join => join.on(holds))
    .selectAll('a')
    .select(eb => decrypt(eb.ref('player.playerEmail')).as('playerEmail'))

  const everyone = branch('match Sec', eb => eb.and([eb('player.matchSecrertary', '=', 1), eb('a.id', '=', eb.ref('player.club'))]))
    .unionAll(branch('club Sec', eb => eb.and([eb('player.clubSecretary', '=', 1), eb('a.id', '=', eb.ref('player.club'))])))
    .unionAll(branch('team Captain', eb => eb.and([eb('player.teamCaptain', '=', 1), eb('a.teamid', '=', eb.ref('player.team'))])))
    .unionAll(branch('treasurer', eb => eb.and([eb('player.treasurer', '=', 1), eb('a.teamid', '=', eb.ref('player.team'))])))
    .unionAll(branch('otherComms', eb => eb.and([eb('player.otherComms', '=', 1), eb('a.teamid', '=', eb.ref('player.team'))])))

  const result = await kysely.selectFrom(everyone.as('b'))
    .select('b.playerEmail').distinct()
    .$if(!!searchTerms.role, qb => qb.where('b.role', '=', /** @type {string} */ (searchTerms.role)))
    .$if(!!searchTerms.division, qb => qb.where('b.division', '=', /** @type {any} */ (searchTerms.division)))
    .$if(!!searchTerms.club, qb => qb.where('b.id', '=', /** @type {any} */ (searchTerms.club)))
    .$if(!!searchTerms.teamName, qb => qb.where('b.teamname', '=', /** @type {string} */ (searchTerms.teamName)))
    .execute()
  return result.map(row => row.playerEmail).filter(email => email && email.indexOf("@") != -1)
}

// Filters only on the keys it knows, when truthy. Ordered by gender and rank only when a
// filter applies, as it always was.
/** @param {{ teamid?: number, gender?: string, clubid?: number }} searchTerms */
exports.search = async function(searchTerms) {
  const filtered = !!(searchTerms.teamid || searchTerms.gender || searchTerms.clubid)
  return kysely.selectFrom('player').selectAll()
    .$if(!!searchTerms.teamid, qb => qb.where('team', '=', /** @type {number} */ (searchTerms.teamid)))
    .$if(!!searchTerms.gender, qb => qb.where('gender', '=', /** @type {string} */ (searchTerms.gender)))
    .$if(!!searchTerms.clubid, qb => qb.where('club', '=', /** @type {number} */ (searchTerms.clubid)))
    .$if(filtered, qb => qb.orderBy('gender').orderBy('rank'))
    .execute()
}

/** @param {number} id @param {string} gender */
exports.findElgiblePlayersFromTeamId = async function(id, gender) {
  return kysely.selectFrom(eligibleTeams({ teamId: id }).as('b'))
    .innerJoin('player', join => join.onRef('player.team', '=', 'b.id').on('player.gender', '=', gender))
    .select(['player.id', 'player.first_name', 'player.family_name', 'b.rank as teamrank', 'player.rank as playerrank'])
    .orderBy('b.rank', 'asc').orderBy('player.rank', 'desc').orderBy('player.family_name')
    .execute()
}

/**
 * @param {number | null} first @param {number | null} second @param {number | null} third
 * @param {number} teamId @param {string} gender
 */
exports.getEligiblePlayersAndSelectedById = async function(first, second, third, teamId, gender) {
  /** 1 when the row is the player picked for that slot, else 0. */
  const picked = (/** @type {any} */ eb, /** @type {number | null} */ id) =>
    eb.case().when('player.id', '=', id).then(eb.lit(1)).else(eb.lit(0)).end()
  return kysely.selectFrom(eligibleTeams({ teamId }).as('b'))
    .innerJoin('player', join => join.onRef('player.team', '=', 'b.id').on('player.gender', '=', gender))
    .select(eb => ['player.id', 'player.first_name', 'player.family_name',
      picked(eb, first).as('first'), picked(eb, second).as('second'), picked(eb, third).as('third')])
    .execute()
}

/**
 * @param {string} teamName a LIKE pattern @param {string} gender
 * @param {string} first @param {string} second @param {string} third
 */
exports.findElgiblePlayersFromTeamNameAndSelectedSansLevenshtein = async function(teamName, gender, first, second, third) {
  /** @type {any[]} */
  const rows = await kysely.selectFrom(eligibleTeams({ nameLike: teamName }).as('b'))
    .innerJoin('player', join => join.onRef('player.team', '=', 'b.id').on('player.gender', '=', gender))
    .select(['player.id', 'player.first_name', 'player.family_name'])
    .execute()

  rows[0].first = 1;
  rows[0].second = 1;
  rows[0].third = 1;
  let lowestFirstIndex = [0, levenshtein(rows[0].first_name + " " + rows[0].family_name, first)];
  let lowestSecondIndex = [0, levenshtein(rows[0].first_name + " " + rows[0].family_name, second)];
  let lowestThirdIndex = [0, levenshtein(rows[0].first_name + " " + rows[0].family_name, third)]
  for (let i = 1; i < rows.length; i++) {
    const rowFirstLevenshtein = levenshtein(rows[i].first_name + " " + rows[i].family_name, first);
    const rowSecondLevenshtein = levenshtein(rows[i].first_name + " " + rows[i].family_name, second);
    const rowThirdLevenshtein = levenshtein(rows[i].first_name + " " + rows[i].family_name, third);
    if (lowestFirstIndex[1] > rowFirstLevenshtein) {
      rows[lowestFirstIndex[0]].first = 0;
      rows[i].first = 1;
      lowestFirstIndex[0] = i;
      lowestFirstIndex[1] = rowFirstLevenshtein;
    } else {
      rows[i].first = 0;
    }
    if (lowestSecondIndex[1] > rowSecondLevenshtein) {
      rows[lowestSecondIndex[0]].second = 0;
      rows[i].second = 1;
      lowestSecondIndex[0] = i;
      lowestSecondIndex[1] = rowSecondLevenshtein;
    } else {
      rows[i].second = 0;
    }
    if (lowestThirdIndex[1] > rowThirdLevenshtein) {
      rows[lowestThirdIndex[0]].third = 0;
      rows[i].third = 1;
      lowestThirdIndex[0] = i;
      lowestThirdIndex[1] = rowThirdLevenshtein;
    } else {
      rows[i].third = 0;
    }
  }
  return rows
}

/** @param {string} searchTerm a gender, or '' for everyone */
exports.count = async function(searchTerm) {
  return kysely.selectFrom('player').select(eb => eb.fn.countAll().as('players'))
    .$if(searchTerm != "", qb => qb.where('gender', '=', searchTerm))
    .execute()
}

/** @param {number} playerId */
exports.getById = async function(playerId) {
  return kysely.selectFrom('player')
    .select(eb => ['id', 'first_name', 'family_name', 'gender',
      decrypt(eb.ref('playerEmail')).as('playerEmail'), decrypt(eb.ref('playerTel')).as('playerTel'),
      'teamCaptain', 'clubSecretary', 'matchSecrertary', 'treasurer', 'otherComms', 'junior', 'role', 'messerAdmin'])
    .where('id', '=', playerId)
    .execute()
}

// Inner joins, as the nested version had: a player with no club or team returns nothing.
/** @param {number} playerId */
exports.getPlayerClubandTeamById = async function(playerId) {
  return kysely.selectFrom('player')
    .innerJoin('club', 'player.club', 'club.id')
    .innerJoin('team', 'player.team', 'team.id')
    .select(eb => ['player.id as playerId', concatName(eb).as('playerName'), 'club.name as clubName',
      'team.name as teamName', 'player.date_of_registration'])
    .where('player.id', '=', playerId)
    .execute()
}

// The ELO of the player in a given slot of a game row. Shared by the two queries below
// so the four-way CASE is written once.
const SLOT_END = (/** @type {any} */ pid) => `CASE
    WHEN g."homePlayer1" = ${pid} THEN g."homePlayer1End"
    WHEN g."homePlayer2" = ${pid} THEN g."homePlayer2End"
    WHEN g."awayPlayer1" = ${pid} THEN g."awayPlayer1End"
    WHEN g."awayPlayer2" = ${pid} THEN g."awayPlayer2End"
  END`

// Each player's division rank IN A GIVEN SEASON: { [playerId]: rank }.
//
// This is the "registered division" the ELO reserving adjustment compares against the
// fixture's division, so it has to be the division the player was registered in THAT
// season. It used to be read from the live player/team/division tables, which meant a
// backfill applied today's teams to every season back to 2018 — 268 of the 387 players
// in 2021/22 are registered in a different division now. The season archives
// (player20212022 and friends) hold the answer.
//
// A player with no team that season is simply absent; callers fall back to the
// fixture's own rank, which makes the adjustment zero rather than inventing one.
// Seasons before 2018/19 have no player archive (and no game rows), so they return {}.
/** @param {any} season @param {any} playerIds */
exports.getSeasonRanks = async function(season, playerIds) {
  const current = !season || season === seasonModel.current()
  const suffix = current ? '' : seasonModel.assertName(season)
  const conn = await db.otherConnect()
  if (!current) {
    const [exists] = await conn.query('SELECT to_regclass(?) AS t', [`player${suffix}`])
    if (!exists[0].t) return {}
  }
  let ids = null
  if (playerIds) {
    ids = playerIds.map((/** @type {any} */ n) => parseInt(n, 10)).filter((/** @type {any} */ n) => n > 0)
    if (ids.length === 0) return {}
  }
  const [rows] = await conn.query(
    `SELECT p.id, d.rank
     FROM player${suffix} p
     JOIN team${suffix} t ON t.id = p.team
     JOIN division${suffix} d ON d.id = t.division
     ${ids ? 'WHERE p.id = ANY(?::int[])' : ''}`,
    ids ? [ids] : []
  )
  return Object.fromEntries(rows.map((/** @type {any} */ r) => [r.id, r.rank]))
}

// Each player's rating going into a fixture on `endDate`: their latest rated game
// before it, else 1500. Fills in { rating, date, rank } on every entry of
// fixturePlayers and returns it.
//
// opts.season       whose registration decides `rank` (undefined = current season)
// opts.fallbackRank rank for a player with no team that season — pass the fixture's
//                   own rank so the reserving adjustment comes out as zero
//
// Two things this used to get wrong, both silently:
//  - rank came from the player's CURRENT team whatever the date (see getSeasonRanks),
//    and defaulted to 1 — Premier — for anyone without one;
//  - the latest game was chosen first and filtered on `rating > 0` second, so a player
//    whose most recent game was unrated (a void fixture, a walkover) went back to 1500.
//    The filter is inside the ordering now, so an unrated game is skipped, not fatal.
/** @param {any} endDate @param {any} fixturePlayers @param {any} [opts] */
exports.getPrevRating = async function(endDate, fixturePlayers, opts = {}) {
  const playerArray = Object.entries(fixturePlayers)
  const ids = playerArray.map(([id]) => parseInt(id, 10)).filter(n => n > 0)

  /** @type {Record<string, any>} */

  const found = {}
  if (ids.length > 0) {
    const sql = ids.map(() => `(SELECT ?::int AS "playerId", rating, date FROM (
  SELECT ${SLOT_END('?')} AS rating, f.date, g.id AS gid
  FROM game g JOIN fixture f ON g.fixture = f.id
  WHERE ? IN (g."homePlayer1", g."homePlayer2", g."awayPlayer1", g."awayPlayer2")
    AND f.status = 'complete'
    AND f.date < ?
) a WHERE rating > 0 ORDER BY date DESC, gid DESC LIMIT 1)`).join(' UNION ALL ')
    const params = ids.flatMap(id => [id, id, id, id, id, id, endDate])
    const [rows] = await (await db.otherConnect()).query(sql, params)
    for (const r of rows) found[r.playerId] = r
  }

  const ranks = (await exports.getSeasonRanks(opts.season, ids)) || {}
  const fallbackRank = opts.fallbackRank !== undefined ? opts.fallbackRank : 1

  for (const [id, player] of playerArray) {
    const prev = found[id]
    player.rating = prev ? prev.rating : 1500
    player.date = prev ? prev.date : '2020-01-01 00:00:00'
    player.rank = ranks[id] !== undefined ? ranks[id] : fallbackRank
  }
  return Object.fromEntries(playerArray)
}

// Each player's ELO state going into a fixture: { [playerId]: { rating, date, gamesCount } }.
//
// "Before" is the backfill's processing order — fixture date, then fixture id, then game
// id — not just an earlier date, so two fixtures on the same night are ordered the same
// way here as in eloBackfillAll. gamesCount is every rated game before it, which is what
// the backfill carries in memory for the provisional K; getPrevRating has no count, so
// the publish path used to rate everybody as established. A player with no rated game
// is absent, and the caller starts them at 1500 with nothing played. `conn` lets
// utils/eloChain read inside its own transaction.
/** @param {any} fixtureId @param {any} playerIds @param {any} conn */
exports.getRatingStateBefore = async function(fixtureId, playerIds, conn) {
  const ids = (playerIds || []).map((/** @type {any} */ n) => parseInt(n, 10)).filter((/** @type {any} */ n) => n > 0)
  if (ids.length === 0) return {}
  const c = conn || await db.otherConnect()
  const [rows] = await c.query(
    `SELECT s.pid AS "playerId",
            (array_agg(s.rating ORDER BY f.date DESC, f.id DESC, g.id DESC, s.slot DESC))[1] AS rating,
            MAX(f.date) AS date,
            COUNT(*)::int AS "gamesCount"
     FROM game g
     JOIN fixture f ON f.id = g.fixture
     -- slot: if one id fills two slots of a game, the backfill keeps the last one's End.
     CROSS JOIN LATERAL (VALUES
       (1, g."homePlayer1", g."homePlayer1End"), (2, g."homePlayer2", g."homePlayer2End"),
       (3, g."awayPlayer1", g."awayPlayer1End"), (4, g."awayPlayer2", g."awayPlayer2End")
     ) AS s(slot, pid, rating)
     WHERE s.pid = ANY(?::int[])
       AND s.rating > 0
       AND f.status = 'complete'
       AND (f.date, f.id) < (SELECT date, id FROM fixture WHERE id = ?)
     GROUP BY s.pid`,
    [ids, fixtureId]
  )
  return Object.fromEntries(rows.map((/** @type {any} */ r) => [r.playerId, { rating: r.rating, date: r.date, gamesCount: r.gamesCount }]))
}

// Sets player.rating to each player's latest rated game, read back from `game`.
//
// The publish path computed every game's ELO and never wrote the player's rating, so
// `player.rating` — what /player-stats shows — was only ever as fresh as the last
// backfill: new players were blank and 118 others were out of date (Sep 2026). Reading
// it back from the games rather than carrying the in-memory value means a late
// scorecard for an older fixture cannot overwrite a newer rating. `conn` lets the
// caller do this inside the transaction that wrote the games.
/** @param {any} playerIds @param {any} conn */
exports.refreshRatings = async function(playerIds, conn) {
  const ids = (playerIds || []).map((/** @type {any} */ n) => parseInt(n, 10)).filter((/** @type {any} */ n) => n > 0)
  if (ids.length === 0) return
  const c = conn || await db.otherConnect()
  await c.query(
    `UPDATE player SET rating = COALESCE((
       SELECT ${SLOT_END('player.id')}
       FROM game g JOIN fixture f ON f.id = g.fixture
       WHERE player.id IN (g."homePlayer1", g."homePlayer2", g."awayPlayer1", g."awayPlayer2")
         AND f.status = 'complete'
         AND ${SLOT_END('player.id')} > 0
       ORDER BY f.date DESC, g.id DESC
       LIMIT 1
     ), rating)
     WHERE id = ANY(?::int[])`,
    [ids]
  )
}

// Writes [id, rating] pairs in one statement. The backfill's per-fixture rating write
// went through updateBulk, which is one UPDATE per player — ~12 round trips a fixture
// against production, once the game writes were batched.
// One statement for every pair, as two bound arrays: the placeholder count does not depend
// on how many players there are. A raw statement, because the builder has no typed form of
// `FROM unnest(...) AS v(id, rating)`; it returns nothing, which the cast says.
/** @param {Array<[number, number]>} pairs [id, rating] @param {import('kysely').Kysely<import('../db/schema').DB>} [q] */
exports.setRatings = async function(pairs, q = kysely) {
  if (!pairs || pairs.length === 0) return
  const ids = pairs.map(p => Number(p[0]))
  const ratings = pairs.map(p => Number(p[1]))
  await /** @type {import('kysely').RawBuilder<never>} */ (sql`UPDATE player p SET rating = v.rating
    FROM unnest(${ids}::int[], ${ratings}::int[]) AS v(id, rating) WHERE p.id = v.id`).execute(q)
}

// Returns ELO rating time-series for one or more player IDs.
// Crosses season boundaries — used by the ELO chart pages.
/** @param {any} playerIds */
exports.getPlayerEloTimeSeries = async function(playerIds) {
  if (!playerIds || playerIds.length === 0) return []

  const numIds = playerIds.map((/** @type {any} */ id) => id * 1)

  // One batched query for every requested player instead of one query each —
  // the game table has no index on the player-id columns, so per-player
  // queries scale linearly with player count; a single scan doesn't.
  const rows = await kysely.selectFrom('game')
    .innerJoin('fixture', 'game.fixture', 'fixture.id')
    .select(['fixture.date', 'game.homePlayer1', 'game.homePlayer2', 'game.awayPlayer1', 'game.awayPlayer2',
      'game.homePlayer1End', 'game.homePlayer2End', 'game.awayPlayer1End', 'game.awayPlayer2End'])
    .where(eb => eb.and([
      eb.or([eb('game.homePlayer1', 'in', numIds), eb('game.homePlayer2', 'in', numIds),
        eb('game.awayPlayer1', 'in', numIds), eb('game.awayPlayer2', 'in', numIds)]),
      ...(/** @type {const} */ (['game.homePlayer1End', 'game.homePlayer2End', 'game.awayPlayer1End', 'game.awayPlayer2End']))
        .flatMap(col => [eb(col, 'is not', null), eb(col, '!=', 0)]),
    ]))
    .orderBy('fixture.date', 'asc').orderBy('game.id', 'asc')
    .execute()

  const nameRows = await kysely.selectFrom('player')
    .select(eb => ['id', eb.fn('concat', [eb.ref('first_name'), sql.lit(' '), eb.ref('family_name')]).as('name')])
    .where('id', 'in', numIds)
    .execute()
  /** @type {Record<string, any>} */
  const nameById = {}
  nameRows.forEach((/** @type {any} */ r) => { nameById[r.id] = r.name })

  // One point per fixture date per player (rows ordered ASC by date, id — last game wins)
  /** @type {Record<string, any>} */
  const byDateByPlayer = {}
  numIds.forEach((/** @type {any} */ id) => { byDateByPlayer[id] = {} })
  const slots = [
    ['homePlayer1', 'homePlayer1End'],
    ['homePlayer2', 'homePlayer2End'],
    ['awayPlayer1', 'awayPlayer1End'],
    ['awayPlayer2', 'awayPlayer2End'],
  ]
  rows.forEach((/** @type {any} */ row) => {
    slots.forEach(([idKey, endKey]) => {
      const pid = row[idKey]
      if (pid != null && byDateByPlayer[pid] !== undefined && row[endKey] != null && row[endKey] > 0) {
        byDateByPlayer[pid][new Date(row.date).toISOString().slice(0, 10)] = parseInt(row[endKey])
      }
    })
  })

  return numIds.map((/** @type {any} */ id) => ({
    id,
    name: nameById[id] || `Player ${id}`,
    data: Object.entries(byDateByPlayer[id]).map(([x, y]) => ({ x, y }))
  }))
}

// Name-fragment search, optionally narrowed by the same division/club/team/
// gender filters used on /player-stats — used by the ELO comparison page.
// The stored names are not clean: 378 of 1107 player rows carry leading or
// trailing whitespace, nearly always a space in front of family_name (" Petty",
// " Roach", " Kainth"). Concatenating first and family straight out of the column
// therefore yields "Chris  Petty" with two spaces, and a LIKE for the "Chris
// Petty" a human types matches nothing — a third of the league was unfindable by
// full name while still being findable by surname alone, which is a maddening way
// for a search to fail. Both sides are whitespace-normalised so the comparison is
// about the name rather than about how it happened to be typed in.
/** The name tidied of stray whitespace, null-safe. @param {import('kysely').ExpressionBuilder<any, any>} eb */
const searchName = eb => eb.fn('regexp_replace', [
  eb.fn('trim', [eb(eb(eb.fn.coalesce('player.first_name', sql.lit('')), '||', sql.lit(' ')), '||',
    eb.fn.coalesce('player.family_name', sql.lit('')))]),
  sql.lit('\\s+'), sql.lit(' '), sql.lit('g'),
])

// The name is matched in JavaScript by utils/nameMatch.js, not with LIKE: a LIKE finds
// someone only if the text typed is a literal slice of the text stored, so "Mary
// Whitle" could not find "Marry Whitle" — and on the signup-approval page, a player who
// cannot be found gets a second record. The SQL applies only the filters; with no name
// the filtered list is returned as it was, alphabetically and capped.
/** @param {string} query @param {{ division?: string, club?: string, team?: string, gender?: string }} [filters] */
exports.searchPlayers = async function(query, filters = {}) {
  // Collapse the caller's spacing too, so "Chris  Petty" and " chris petty " work.
  const term = (query || '').trim().replace(/\s+/g, ' ')

  // LEFT JOINs. These were INNER, and club/division contribute nothing to the
  // output — they exist only so the optional filters have something to match — so
  // an unrelated gap in either silently removed a player from the results. It did:
  // team 52 "No Team", where released players are parked, has division 0, which is
  // not a division that exists, so the division join alone hid 490 players. A
  // returning member who had been released could not be found at all. The filters
  // still filter: an equality test in WHERE fails against a NULL from a LEFT JOIN.
  const result = await kysely.selectFrom('player')
    .leftJoin('team', 'team.id', 'player.team')
    .leftJoin('club', 'club.id', 'team.club')
    .leftJoin('division', 'division.id', 'team.division')
    .select(eb => ['player.id', searchName(eb).as('name'), 'team.name as teamName'])
    .$if(!!filters.division, qb => qb.where('division.name', '=', /** @type {string} */ (filters.division)))
    .$if(!!filters.club, qb => qb.where('club.name', '=', /** @type {string} */ (filters.club)))
    .$if(!!filters.team, qb => qb.where('team.name', '=', /** @type {string} */ (filters.team)))
    .$if(!!filters.gender, qb => qb.where('player.gender', '=', /** @type {string} */ (filters.gender)))
    .orderBy(eb => eb.fn('trim', [eb.fn.coalesce('player.family_name', sql.lit(''))]))
    .orderBy(eb => eb.fn('trim', [eb.fn.coalesce('player.first_name', sql.lit(''))]))
    .$if(!term, qb => qb.limit(20))
    .execute()
  return term ? rankByName(result, term, (/** @type {any} */ r) => r.name, 20) : result
}
