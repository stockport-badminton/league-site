// @ts-check
var config = require('../config');
const log = require('../utils/log');
var db = require('../db_connect.js');
const { sql } = require('kysely');
const { kysely, decrypt } = require('../db');
const { absoluteUrl, resultImagePath, resultStoryImagePath } = require('../utils/canonical');
var seasonModel = require("./season");
const { NO_TEAM_ID } = require('./roster');
const SocialResultPost = require('./socialResultPost');

// REARCH-01 is converting this file in batches; see the brief for which functions are on
// the typed query layer and which wait for the off-season because the publish request
// calls them.

/** @typedef {import('kysely').RawBuilder<Date>} When */
// Fixed moments the queries below compare fixture.date against. Written as SQL, because
// they are computed by the database clock, as they always were.
const NOW = /** @type {When} */ (sql`NOW()`)
const WEEK_AGO = /** @type {When} */ (sql`NOW() - INTERVAL '7 days'`)
const YESTERDAY = /** @type {When} */ (sql`NOW() - INTERVAL '1 day'`)
const WEEK_AHEAD = /** @type {When} */ (sql`NOW() + INTERVAL '7 days'`)
// Today in the UK, not in the database's UTC: fixture.date holds UK local midnight as a
// naive timestamp, so the comparison is like for like (see getUpcomingWeek).
const UK_TODAY = /** @type {When} */ (sql`date_trunc('day', NOW() AT TIME ZONE 'Europe/London')`)
const SIX_DAYS_AGO = /** @type {When} */ (sql`NOW() - INTERVAL '6 days'`)
const UK_WEEK_END = /** @type {When} */ (sql`date_trunc('day', NOW() AT TIME ZONE 'Europe/London') + INTERVAL '7 days'`)

/** A copy with every `undefined` value replaced by null, which the string queries bound it as. @param {Record<string, unknown>} obj */
const definedOrNull = obj => Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, v === undefined ? null : v]))

/** `first_name family_name`, as CONCAT gives it. @param {any} eb @param {string} who */
const fullName = (eb, who) => eb.fn('concat', [eb.ref(`${who}.first_name`), sql.lit(' '), eb.ref(`${who}.family_name`)])


/** @param {any} fixtureId */
exports.getScorecardById = async function(fixtureId) {
  const [result] = await (await db.otherConnect()).query(
    'SELECT * FROM scorecardstore WHERE id = ?',
    fixtureId
  )
  return result
}

// Returns `[{ id }]` for the new draft — the caller needs it to build the
// confirmation link. RETURNING is not optional here: Postgres reports nothing about
// an inserted row unless asked, so the db wrapper's mysql2-shaped result has no
// insertId to read (it is a rows array, and rows.insertId is undefined). The caller
// did read `.insertId`, so every submitted scorecard redirected to
// /populated-scorecard-beta/undefined and emailed the results secretary that same
// dead link. Same shape as createMesserScorecard/createMesserResult below.
/** @param {any} fixtureObj */
exports.createScorecard = async function(fixtureObj) {
  if (!db.isObject(fixtureObj)) throw new Error('not object')
  const fields = Object.keys(fixtureObj).map(k => `"${k}"`).join(',')
  const placeholders = Object.keys(fixtureObj).map(() => '?').join(',')
  const sql = `INSERT INTO scorecardstore (${fields}) VALUES (${placeholders}) RETURNING id`
  const [result] = await (await db.otherConnect()).query(sql, Object.values(fixtureObj))
  return result
}

// Mark every other draft for the same match as replaced by this one (HARD-17).
//
// A captain who mistypes a score files the scorecard again — that is the correction route
// the site has always had. What was missing was any record that the second filing replaces
// the first, so 140 of 1,373 matches hold several drafts, all looking equally
// authoritative, and the confirmation link for a stale one would still publish it.
//
// Decided with the league secretary: the later submission wins. Nothing is deleted — the
// superseded rows are the record of what a captain actually filed and when.
//
// Every earlier draft is pointed at the NEWEST one rather than at its immediate successor,
// so finding the current record is one hop from anywhere in a chain rather than a walk.
// `supersededBy IS NULL` is therefore exactly "this is the current draft for its match".
//
// Matched on the exact pairing and date rather than on the ±3-day window the audit checks
// use, deliberately: superseding the WRONG draft would hide a real scorecard, so the safe
// direction to be wrong in is to supersede too few. A captain who also corrects the date
// leaves two current drafts, which is the state we already live with.
/** @param {any} newId @param {any} match @param {any} conn */
exports.supersedeEarlierDrafts = async function(newId, match, conn) {
  const c = conn || await db.otherConnect()
  const [result] = await c.query(
    `UPDATE scorecardstore SET "supersededBy" = ?
      WHERE "homeTeam" = ? AND "awayTeam" = ? AND date = ? AND id <> ?`,
    [newId, match.homeTeam, match.awayTeam, match.date, newId]
  )
  return result.affectedRows || 0
}

// Is this draft still the current one for its match, and if not, which replaced it?
/** @param {any} draftId */
exports.getDraftSupersession = async function(draftId) {
  const [rows] = await (await db.otherConnect()).query(
    'SELECT id, "supersededBy" FROM scorecardstore WHERE id = ?', [draftId]
  )
  return rows[0] || null
}

// Every player column on /fixture-players was blank, and so was Opposition.
//
// CLAUDE.md gotcha 1, in its `AS` form: an unquoted alias is folded to lowercase by
// Postgres, so `AS Man1` comes back as `man1` and `row['Man1']` in the view is undefined.
// It rendered as an empty cell rather than an error, which is why it survived — the page
// looked like a page, just an empty one, exactly as `AS teamCaptain` blanked the captain
// on every /event/ page for as long as that page existed.
//
// `teamName` and the six `Man1TeamName`-style aliases were already quoted, which is why
// those columns worked and made the failure look like missing DATA rather than a missing
// COLUMN.
//
// Only the aliases JAVASCRIPT reads are quoted. `teamId` and `clubId` are left folded on
// purpose: the wrapper above joins `club ON club.id = clubId`, and that reference is
// unquoted, so quoting the alias alone turns a blank column into `column "clubid" does
// not exist`. Which is exactly what happened on the first attempt at this fix.
//
// The quoting is added ONLY in this outer projection, deliberately. The inner subquery
// still says `AS Man1` and is still referenced as `playerNames.Man1` — both fold to
// `man1`, so they agree with each other and nothing there needs to change. Quoting the
// inner alias without quoting every reference to it is how this gets turned from a blank
// column into a 500.
//
/** @param {any} fixtureObj */
exports.getMatchPlayerOrderDetails = async function(fixtureObj) {
  const searchTerms = []
  const sqlArray = []
  if (fixtureObj.club) {
    searchTerms.push('c.name = ?')
    sqlArray.push(fixtureObj.club)
  }
  if (fixtureObj.team) {
    searchTerms.push('c."teamName" = ?')
    sqlArray.push(fixtureObj.team)
  }
  // The season's teams, clubs and players come from team_at / club_at / player_at, which
  // for the current season are the live tables.
  const seasonName = fixtureObj.season ? seasonModel.assertName(fixtureObj.season) : seasonModel.current()
  searchTerms.push('season.name = ? AND c.date > season."startDate" AND c.date < season."endDate"')
  sqlArray.push(seasonName)

  // Each player's rank and team as they were THAT season (HARD-48). The page flags a
  // player turning out for a team other than their own, and it used to compare against
  // the team they are on NOW: in 2024/25, 1,168 of 2,993 lineup slots had moved since, so
  // past seasons showed notes that were never true and missed ones that were. And when
  // today's team did not exist that season, the inner join dropped the whole fixture —
  // 60 of them in 2024/25.
  //
  // Read from the season's player history, falling back to the live row for a player it
  // does not hold (added or merged later). Seasons before 2018/19 have no player history
  // and fall back entirely, which is what they did before.
  //
  // Names stay live (REARCH-02 Part 2, Neil, 28 Oct 2026). Of the names history holds
  // that differ from today's, most are corrections: typos, initials ("M. Isaacs"), and
  // married names that today's record already carries as "(nee …)". A player with no
  // live row any more (deleted, merged) takes the name history has for them, so that
  // their fixtures still show; an inner join here used to drop them (gotcha 1c). A slot
  // with no player either way still leaves the fixture off, as a lineup not yet filed.
  //
  // The history is a copy of whatever columns `player` had that year: 2018/19 has no
  // rank at all, and 2019/20 has one that was mostly not filled in (587 of 876
  // registered players blank, against 11 of 998 in 2021/22). A blank rank renders red —
  // "not nominated" — so reading those would paint half of 2019/20 red for a record
  // nobody kept. A season whose history ranks fewer than half its registered players
  // keeps the live rank, as before, and still gets its team. History is frozen once its
  // season ends, so this cannot drift.
  const conn = await db.otherConnect()
  const [cover] = await conn.query(
    `SELECT COUNT(*) FILTER (WHERE team IS NOT NULL) AS registered,
            COUNT(*) FILTER (WHERE team IS NOT NULL AND rank IS NOT NULL) AS ranked
     FROM player_at WHERE season = ?`,
    [seasonName]
  )
  const ranked = Number(cover[0].ranked) * 2 > Number(cover[0].registered)
  const playerThen = ranked
    ? 'SELECT id, team, rank, first_name, family_name FROM player_at WHERE season = ?'
    : 'SELECT h.id, h.team, live.rank, h.first_name, h.family_name FROM player_at h LEFT JOIN player live ON live.id = h.id WHERE h.season = ?'

  const conditions = searchTerms.length > 0
    ? ', season WHERE ' + searchTerms.join(' AND ')
    : ''
  const limit = fixtureObj.limit ? ` LIMIT ${fixtureObj.limit}` : ''

  const [result] = await conn.query(
    `WITH playerThen AS (${playerThen}),
      teamThen AS (SELECT * FROM team_at WHERE season = ?),
      clubThen AS (SELECT * FROM club_at WHERE season = ?)
    SELECT c.* FROM (SELECT fixturePlayers.*, clubThen.name FROM (SELECT playerNames.id, playerNames.date, homeTeam.name as "teamName", homeTeam.id as teamId, homeTeam.club as clubId, awayTeam.name as "oppositionName", playerNames.Man1 AS "Man1", playerNames.Man1Rank AS "Man1Rank", Man1Team.name as "Man1TeamName", playerNames.Man2 AS "Man2", playerNames.Man2Rank AS "Man2Rank", Man2Team.name as "Man2TeamName", playerNames.Man3 AS "Man3", playerNames.Man3Rank AS "Man3Rank", Man3Team.name as "Man3TeamName", playerNames.Lady1 AS "Lady1", playerNames.Lady1Rank AS "Lady1Rank", Lady1Team.name as "Lady1TeamName", playerNames.Lady2 AS "Lady2", playerNames.Lady2Rank AS "Lady2Rank", Lady2Team.name as "Lady2TeamName", playerNames.Lady3 AS "Lady3", playerNames.Lady3Rank AS "Lady3Rank", Lady3Team.name as "Lady3TeamName" FROM (SELECT fixture.id, fixture.date, fixture."homeTeam" AS team, fixture."awayTeam" AS opposition, CASE WHEN homeMan1.id IS NULL THEN CONCAT(homeMan1Season.first_name, ' ', homeMan1Season.family_name) ELSE CONCAT(homeMan1.first_name, ' ', homeMan1.family_name) END AS man1, CASE WHEN homeMan1Season.id IS NULL THEN homeMan1.rank ELSE homeMan1Season.rank END AS man1rank, CASE WHEN homeMan1Season.id IS NULL THEN homeMan1.team ELSE homeMan1Season.team END AS man1teamid, CASE WHEN homeMan2.id IS NULL THEN CONCAT(homeMan2Season.first_name, ' ', homeMan2Season.family_name) ELSE CONCAT(homeMan2.first_name, ' ', homeMan2.family_name) END AS man2, CASE WHEN homeMan2Season.id IS NULL THEN homeMan2.rank ELSE homeMan2Season.rank END AS man2rank, CASE WHEN homeMan2Season.id IS NULL THEN homeMan2.team ELSE homeMan2Season.team END AS man2teamid, CASE WHEN homeMan3.id IS NULL THEN CONCAT(homeMan3Season.first_name, ' ', homeMan3Season.family_name) ELSE CONCAT(homeMan3.first_name, ' ', homeMan3.family_name) END AS man3, CASE WHEN homeMan3Season.id IS NULL THEN homeMan3.rank ELSE homeMan3Season.rank END AS man3rank, CASE WHEN homeMan3Season.id IS NULL THEN homeMan3.team ELSE homeMan3Season.team END AS man3teamid, CASE WHEN homeLady1.id IS NULL THEN CONCAT(homeLady1Season.first_name, ' ', homeLady1Season.family_name) ELSE CONCAT(homeLady1.first_name, ' ', homeLady1.family_name) END AS lady1, CASE WHEN homeLady1Season.id IS NULL THEN homeLady1.rank ELSE homeLady1Season.rank END AS lady1rank, CASE WHEN homeLady1Season.id IS NULL THEN homeLady1.team ELSE homeLady1Season.team END AS lady1teamid, CASE WHEN homeLady2.id IS NULL THEN CONCAT(homeLady2Season.first_name, ' ', homeLady2Season.family_name) ELSE CONCAT(homeLady2.first_name, ' ', homeLady2.family_name) END AS lady2, CASE WHEN homeLady2Season.id IS NULL THEN homeLady2.rank ELSE homeLady2Season.rank END AS lady2rank, CASE WHEN homeLady2Season.id IS NULL THEN homeLady2.team ELSE homeLady2Season.team END AS lady2teamid, CASE WHEN homeLady3.id IS NULL THEN CONCAT(homeLady3Season.first_name, ' ', homeLady3Season.family_name) ELSE CONCAT(homeLady3.first_name, ' ', homeLady3.family_name) END AS lady3, CASE WHEN homeLady3Season.id IS NULL THEN homeLady3.rank ELSE homeLady3Season.rank END AS lady3rank, CASE WHEN homeLady3Season.id IS NULL THEN homeLady3.team ELSE homeLady3Season.team END AS lady3teamid FROM fixture LEFT JOIN player homeMan1 ON fixture."homeMan1" = homeMan1.id LEFT JOIN playerThen homeMan1Season ON homeMan1Season.id = fixture."homeMan1" LEFT JOIN player homeMan2 ON fixture."homeMan2" = homeMan2.id LEFT JOIN playerThen homeMan2Season ON homeMan2Season.id = fixture."homeMan2" LEFT JOIN player homeMan3 ON fixture."homeMan3" = homeMan3.id LEFT JOIN playerThen homeMan3Season ON homeMan3Season.id = fixture."homeMan3" LEFT JOIN player homeLady1 ON fixture."homeLady1" = homeLady1.id LEFT JOIN playerThen homeLady1Season ON homeLady1Season.id = fixture."homeLady1" LEFT JOIN player homeLady2 ON fixture."homeLady2" = homeLady2.id LEFT JOIN playerThen homeLady2Season ON homeLady2Season.id = fixture."homeLady2" LEFT JOIN player homeLady3 ON fixture."homeLady3" = homeLady3.id LEFT JOIN playerThen homeLady3Season ON homeLady3Season.id = fixture."homeLady3" WHERE (homeMan1.id IS NOT NULL OR homeMan1Season.id IS NOT NULL) AND (homeMan2.id IS NOT NULL OR homeMan2Season.id IS NOT NULL) AND (homeMan3.id IS NOT NULL OR homeMan3Season.id IS NOT NULL) AND (homeLady1.id IS NOT NULL OR homeLady1Season.id IS NOT NULL) AND (homeLady2.id IS NOT NULL OR homeLady2Season.id IS NOT NULL) AND (homeLady3.id IS NOT NULL OR homeLady3Season.id IS NOT NULL) UNION ALL SELECT fixture.id, fixture.date, fixture."awayTeam" AS team, fixture."homeTeam" AS opposition, CASE WHEN awayMan1.id IS NULL THEN CONCAT(awayMan1Season.first_name, ' ', awayMan1Season.family_name) ELSE CONCAT(awayMan1.first_name, ' ', awayMan1.family_name) END AS man1, CASE WHEN awayMan1Season.id IS NULL THEN awayMan1.rank ELSE awayMan1Season.rank END AS man1rank, CASE WHEN awayMan1Season.id IS NULL THEN awayMan1.team ELSE awayMan1Season.team END AS man1teamid, CASE WHEN awayMan2.id IS NULL THEN CONCAT(awayMan2Season.first_name, ' ', awayMan2Season.family_name) ELSE CONCAT(awayMan2.first_name, ' ', awayMan2.family_name) END AS man2, CASE WHEN awayMan2Season.id IS NULL THEN awayMan2.rank ELSE awayMan2Season.rank END AS man2rank, CASE WHEN awayMan2Season.id IS NULL THEN awayMan2.team ELSE awayMan2Season.team END AS man2teamid, CASE WHEN awayMan3.id IS NULL THEN CONCAT(awayMan3Season.first_name, ' ', awayMan3Season.family_name) ELSE CONCAT(awayMan3.first_name, ' ', awayMan3.family_name) END AS man3, CASE WHEN awayMan3Season.id IS NULL THEN awayMan3.rank ELSE awayMan3Season.rank END AS man3rank, CASE WHEN awayMan3Season.id IS NULL THEN awayMan3.team ELSE awayMan3Season.team END AS man3teamid, CASE WHEN awayLady1.id IS NULL THEN CONCAT(awayLady1Season.first_name, ' ', awayLady1Season.family_name) ELSE CONCAT(awayLady1.first_name, ' ', awayLady1.family_name) END AS lady1, CASE WHEN awayLady1Season.id IS NULL THEN awayLady1.rank ELSE awayLady1Season.rank END AS lady1rank, CASE WHEN awayLady1Season.id IS NULL THEN awayLady1.team ELSE awayLady1Season.team END AS lady1teamid, CASE WHEN awayLady2.id IS NULL THEN CONCAT(awayLady2Season.first_name, ' ', awayLady2Season.family_name) ELSE CONCAT(awayLady2.first_name, ' ', awayLady2.family_name) END AS lady2, CASE WHEN awayLady2Season.id IS NULL THEN awayLady2.rank ELSE awayLady2Season.rank END AS lady2rank, CASE WHEN awayLady2Season.id IS NULL THEN awayLady2.team ELSE awayLady2Season.team END AS lady2teamid, CASE WHEN awayLady3.id IS NULL THEN CONCAT(awayLady3Season.first_name, ' ', awayLady3Season.family_name) ELSE CONCAT(awayLady3.first_name, ' ', awayLady3.family_name) END AS lady3, CASE WHEN awayLady3Season.id IS NULL THEN awayLady3.rank ELSE awayLady3Season.rank END AS lady3rank, CASE WHEN awayLady3Season.id IS NULL THEN awayLady3.team ELSE awayLady3Season.team END AS lady3teamid FROM fixture LEFT JOIN player awayMan1 ON fixture."awayMan1" = awayMan1.id LEFT JOIN playerThen awayMan1Season ON awayMan1Season.id = fixture."awayMan1" LEFT JOIN player awayMan2 ON fixture."awayMan2" = awayMan2.id LEFT JOIN playerThen awayMan2Season ON awayMan2Season.id = fixture."awayMan2" LEFT JOIN player awayMan3 ON fixture."awayMan3" = awayMan3.id LEFT JOIN playerThen awayMan3Season ON awayMan3Season.id = fixture."awayMan3" LEFT JOIN player awayLady1 ON fixture."awayLady1" = awayLady1.id LEFT JOIN playerThen awayLady1Season ON awayLady1Season.id = fixture."awayLady1" LEFT JOIN player awayLady2 ON fixture."awayLady2" = awayLady2.id LEFT JOIN playerThen awayLady2Season ON awayLady2Season.id = fixture."awayLady2" LEFT JOIN player awayLady3 ON fixture."awayLady3" = awayLady3.id LEFT JOIN playerThen awayLady3Season ON awayLady3Season.id = fixture."awayLady3" WHERE (awayMan1.id IS NOT NULL OR awayMan1Season.id IS NOT NULL) AND (awayMan2.id IS NOT NULL OR awayMan2Season.id IS NOT NULL) AND (awayMan3.id IS NOT NULL OR awayMan3Season.id IS NOT NULL) AND (awayLady1.id IS NOT NULL OR awayLady1Season.id IS NOT NULL) AND (awayLady2.id IS NOT NULL OR awayLady2Season.id IS NOT NULL) AND (awayLady3.id IS NOT NULL OR awayLady3Season.id IS NOT NULL)) AS playernames JOIN teamThen homeTeam ON playerNames.Team = homeTeam.id JOIN teamThen awayTeam ON playerNames.Opposition = awayTeam.id LEFT JOIN teamThen Man1Team ON playerNames.Man1TeamID = Man1Team.id LEFT JOIN teamThen Man2Team ON playerNames.Man2TeamID = Man2Team.id LEFT JOIN teamThen Man3Team ON playerNames.Man3TeamID = Man3Team.id LEFT JOIN teamThen Lady1Team ON playerNames.Lady1TeamID = Lady1Team.id LEFT JOIN teamThen Lady2Team ON playerNames.Lady2TeamID = Lady2Team.id LEFT JOIN teamThen Lady3Team ON playerNames.Lady3TeamID = Lady3Team.id) AS fixtureplayers JOIN clubThen ON clubThen.id = clubId) AS c ${conditions} ORDER BY "teamName", date DESC${limit}`,
    [seasonName, seasonName, seasonName, ...sqlArray]
  )
  return result
}

// `maplink` is lowercase because the string version's unquoted alias folded; it is what
// the page reads.
exports.getRecent = async function() {
  return kysely.selectFrom('fixture')
    .innerJoin('team', 'fixture.homeTeam', 'team.id')
    .innerJoin('venue', 'team.venue', 'venue.id')
    .innerJoin('team as awayTeam', 'fixture.awayTeam', 'awayTeam.id')
    .select(['fixture.date', 'team.name as homeTeam', 'awayTeam.name as awayTeam', 'venue.address as address',
      'venue.name as venueName', 'venue.gMapUrl as maplink', 'venue.Lat', 'venue.Lng',
      'fixture.homeScore', 'fixture.awayScore'])
    .where('fixture.homeScore', 'is not', null)
    .where(eb => eb.between('fixture.date', WEEK_AGO, NOW))
    .orderBy('fixture.date')
    .execute()
}

// The ORDER BY is inside the derived table, as it always was, so rows sharing a date come
// back in the order they did.
exports.getOutstandingScorecards = async function() {
  const inSeason = kysely.selectFrom('fixture')
    .innerJoin('season', join => join.onRef('fixture.date', '>', 'season.startDate').onRef('fixture.date', '<', 'season.endDate'))
    .innerJoin('team as homeTeam', 'fixture.homeTeam', 'homeTeam.id')
    .innerJoin('team as awayTeam', 'fixture.awayTeam', 'awayTeam.id')
    .leftJoin('scorecardstore', join => join
      .onRef('fixture.date', '=', 'scorecardstore.date')
      .onRef('fixture.homeTeam', '=', 'scorecardstore.homeTeam')
      .onRef('fixture.awayTeam', '=', 'scorecardstore.awayTeam'))
    .select(['homeTeam.name as homeTeam', 'homeTeam.id as homeId', 'awayTeam.name as awayTeam', 'awayTeam.id as awayId',
      'fixture.date', 'fixture.status', 'scorecardstore.id as scoreCardId'])
    .where('season.name', '=', seasonModel.current())
    .where('fixture.status', 'not in', ['rearranged', 'rearranging', 'conceded', 'void'])
    .orderBy('fixture.date')
  return kysely.selectFrom(inSeason.as('a')).selectAll()
    .where('a.date', '<', NOW).where('a.scoreCardId', 'is', null)
    .execute()
}

// The fixtures a scorecard being uploaded now could be for: this season's, not yet
// published, and due within the week — a match is sometimes played before its listed date. The scorecard reader matches the handwritten team
// names against these PAIRS rather than against every team in the league.
//
// Not getOutstandingScorecards: that drops any fixture that already has a draft, and
// captains re-file the same card often enough (2383/2384, 2405/2406) that it would remove
// the right answer.
exports.getScorecardCandidates = async function() {
  return kysely.selectFrom('fixture')
    .innerJoin('season', join => join.onRef('fixture.date', '>', 'season.startDate').onRef('fixture.date', '<', 'season.endDate'))
    .innerJoin('team as homeTeam', 'fixture.homeTeam', 'homeTeam.id')
    .innerJoin('team as awayTeam', 'fixture.awayTeam', 'awayTeam.id')
    .select(['fixture.id', 'fixture.date', 'fixture.homeTeam as homeId', 'homeTeam.name as homeName',
      'fixture.awayTeam as awayId', 'awayTeam.name as awayName', 'homeTeam.division as divisionId'])
    .where('season.name', '=', seasonModel.current())
    .where('fixture.status', '=', 'outstanding')
    .where('fixture.date', '<', WEEK_AHEAD)
    .execute()
}

// The daily missing-scorecard email. Only 'outstanding' is owed a scorecard: this used
// to exclude just 'rearranged'/'rearranging', so when Dome A withdrew (Oct 2026) and
// its fixtures were voided, every one of them was reported missing in turn. An allowlist,
// so a status added later is silent rather than nagging.
// `fixid` is lowercase because the string version's unquoted alias folded; the caller
// reads it that way.
exports.getCardsDueToday = async function() {
  const outstanding = kysely.selectFrom('fixture')
    .innerJoin('team', join => join.onRef('fixture.homeTeam', '=', 'team.id').on('fixture.status', '=', 'outstanding'))
    .select(['fixture.id as fixid', 'fixture.date', 'fixture.status', 'team.name as homeTeam',
      'fixture.homeScore', 'fixture.awayScore', 'fixture.awayTeam'])
  return kysely.selectFrom(outstanding.as('a'))
    .innerJoin('team', 'a.awayTeam', 'team.id')
    .select(['a.fixid', 'a.date', 'a.status', 'a.homeTeam', 'team.name as awayTeam', 'a.homeScore', 'a.awayScore'])
    .where('a.homeScore', 'is', null)
    .where(eb => eb.between('a.date', WEEK_AGO, SIX_DAYS_AGO))
    .orderBy('a.date')
    .execute()
}

// The homepage's "Upcoming Fixtures" list — and, because each row links to its
// /event/ page, the only place a crawler could reach those pages from before they
// went into the sitemap.
//
// It had the same three faults as getFixtureEventById, with a worse consequence
// here: an INNER JOIN to the home team's captain silently *omitted* the fixture, so
// the six captain-less teams' home matches never appeared on the homepage and never
// got a link. Doubly orphaned — invisible to visitors and to Google.
//
// The captain and match secretary are simply gone rather than made outer: nothing
// renders them (their aliases were unquoted, so `row.teamCaptain` was `undefined`
// anyway). Dropping them also removes the GROUP BY, which existed only to collapse
// the duplicate rows those joins produced for the four teams with two flagged
// captains. The season join went for the same reason as before — it filtered on a
// table the SELECT never touched.
exports.getupComing = async function() {
  return kysely.selectFrom('fixture')
    .innerJoin('team as homeTeam', 'fixture.homeTeam', 'homeTeam.id')
    .innerJoin('team as awayTeam', 'fixture.awayTeam', 'awayTeam.id')
    .leftJoin('club as homeClub', 'homeTeam.club', 'homeClub.id')
    .leftJoin('club as awayClub', 'awayTeam.club', 'awayClub.id')
    .leftJoin('venue', 'homeTeam.venue', 'venue.id')
    .leftJoin('division', 'homeTeam.division', 'division.id')
    .select(['fixture.id', 'fixture.date', 'homeTeam.name as homeTeam', 'homeTeam.starttime as startTime',
      'homeTeam.endtime as endTime', 'homeClub.name as homeClub', 'homeClub.clubWebsite',
      'awayTeam.name as awayTeam', 'awayClub.name as awayClub', 'division.name as divisionName',
      'venue.Lat', 'venue.Lng', 'venue.name as venueName', 'venue.address as venueAddress',
      'venue.gMapUrl as venueLink', 'fixture.status', 'fixture.homeScore', 'fixture.awayScore'])
    .where('fixture.homeScore', 'is', null)
    .where('fixture.status', 'not in', ['rearranged', 'rearranging'])
    .where(eb => eb.between('fixture.date', YESTERDAY, WEEK_AHEAD))
    .orderBy('fixture.date')
    .execute()
}

/** @param {any} searchObj */
exports.getFixtureDetails = async function(searchObj) {
  const filterArray = ['season', 'division', 'club', 'team', 'status', 'endDate', 'startDate', 'type']
  /** @type {Record<string, any>} */
  const fixtureObj = {}

  if (searchObj !== undefined) {
    for (const filter of filterArray) {
      const sqlParams = Object.entries(searchObj).filter(obj => obj[0] === filter)
      if (sqlParams.length > 0) {
        fixtureObj[filter] = sqlParams[0][1]
      }
    }
  }

  const checkSeason = function(/** @type {any} */ season) {
    // Shape first — the parseInt pair below is not a guard. parseInt stops at the
    // first non-digit, so "20252026 AS t --" yielded 2025/2026 and passed every
    // check. It used to be spliced into the query as a table name; it is bound now,
    // but a malformed season still means the current one here, not no rows.
    if (!seasonModel.isValidName(season)) return false
    const firstYear = parseInt(season.slice(0, 4))
    const secondYear = parseInt(season.slice(4))
    if (secondYear - firstYear != 1) return false
    if (firstYear < 2012 || season == seasonModel.current()) return false
    return true
  }

  let season = ''
  const sqlArray = []

  if (fixtureObj.season === undefined || !checkSeason(fixtureObj.season)) {
    sqlArray.push(seasonModel.current())
  } else {
    season = fixtureObj.season
    sqlArray.push(fixtureObj.season)
  }
  // Push params in the SAME order the ? placeholders appear in the WHERE clause
  // below (club, team, division, status, endDate, startDate). A mismatch here
  // sent e.g. a club name into the integer division placeholder -> 500 when
  // filtering by division AND club together.
  if (fixtureObj.club !== undefined) { sqlArray.push(fixtureObj.club); sqlArray.push(fixtureObj.club) }
  if (fixtureObj.team !== undefined) { sqlArray.push(fixtureObj.team); sqlArray.push(fixtureObj.team) }
  if (fixtureObj.division !== undefined) sqlArray.push(fixtureObj.division)
  if (fixtureObj.status !== undefined) sqlArray.push(fixtureObj.status)
  if (fixtureObj.endDate !== undefined) sqlArray.push(fixtureObj.endDate.replaceAll('|', '-') + ' 00:00:00')
  if (fixtureObj.startDate !== undefined) sqlArray.push(fixtureObj.startDate.replaceAll('|', '-') + ' 00:00:00')

  // The season's teams, clubs and divisions, from the history views (the live tables for
  // the current season). Venues are read live, as they always have been.
  const sql = `WITH teamThen AS (SELECT * FROM team_at WHERE season = ?),
    clubThen AS (SELECT * FROM club_at WHERE season = ?),
    divisionThen AS (SELECT * FROM division_at WHERE season = ?)
  SELECT
    fixture.id,
    fixture.date,
    fixture."homeMan1",
    fixture."homeMan2",
    fixture."homeMan3",
    fixture."homeLady1",
    fixture."homeLady2",
    fixture."homeLady3",
    fixture."awayMan1",
    fixture."awayMan2",
    fixture."awayMan3",
    fixture."awayLady1",
    fixture."awayLady2",
    fixture."awayLady3",
    homeTeam.name AS "homeTeam",
    homeClub.name AS "homeClub",
    homeClub.id AS "homeClubId",
    awayTeam.name AS "awayTeam",
    awayClub.name AS "awayClub",
    homeTeam.division AS division,
    division.rank,
    division.name AS "divisionName",
    venue.address AS "venueName",
    venue."gMapUrl" AS "venueLink",
    fixture.status,
    fixture."homeScore",
    fixture."awayScore",
    fixture."homeTeam" AS hometeamid,
    fixture."awayTeam" AS awayteamid
    ${fixtureObj.type == 'eloSetting' ? '' : `,
    -- Whether a captain has filed a draft for this pairing this season. Matched on the
    -- pair, not on the exact date as getOutstandingScorecards does: a match played
    -- early, or a card filed with the wrong day, is still a card filed, and a reminder
    -- for it reads as "we have lost your scorecard".
    EXISTS (
      SELECT 1 FROM scorecardstore s
      WHERE s."homeTeam" = fixture."homeTeam" AND s."awayTeam" = fixture."awayTeam"
        AND s.date > season."startDate" AND s.date < season."endDate"
    ) AS "hasDraft"`}
    -- (Not on the eloSetting path: its GROUP BY fixture.id would reject the season
    -- columns, and nothing there reads it.)
  FROM
    fixture
    ${fixtureObj.type == 'eloSetting' ? 'JOIN game ON game.fixture = fixture.id' : ''}
    JOIN teamThen homeTeam ON fixture."homeTeam" = homeTeam.id
    JOIN clubThen homeClub ON homeTeam.club = homeClub.id
    JOIN venue ON homeTeam.venue = venue.id
    JOIN teamThen awayTeam ON fixture."awayTeam" = awayTeam.id
    JOIN clubThen awayClub ON awayTeam.club = awayClub.id
    -- The season's divisions, like the team and club joins above. The live
    -- one has no Division 4 (id 11), so this inner join silently dropped every
    -- Division 4 fixture of 2018/19 and 2019/20 — about 2,500 games the ELO backfill
    -- never rated, and never used as the history of anyone who played in them.
    JOIN divisionThen division ON homeTeam.division = division.id
    JOIN season ON (
      fixture.date > season."startDate"
      AND fixture.date < season."endDate"
    )
  WHERE
    fixture.status IN (
      'complete',
      'outstanding',
      'rearranging',
      'rearranged',
      'conceded'
    )
    AND season.name = ?
    ${fixtureObj.type == 'eloSetting' ? 'AND ((("homePlayer1End" + "homePlayer2End" + "awayPlayer1End" + "awayPlayer2End") = 0) OR ("homePlayer1Start" < 700 OR "homePlayer2Start" < 700 OR "awayPlayer1Start" < 700 OR "awayPlayer2Start" < 700))' : ''}
    ${fixtureObj.club !== undefined ? 'AND (homeClub.name = ? OR awayClub.name = ?)' : ''}
    ${fixtureObj.team !== undefined ? 'AND (homeTeam.name = ? OR awayTeam.name = ?)' : ''}
    ${fixtureObj.division !== undefined ? 'AND homeTeam.division = ?' : ''}
    ${fixtureObj.status !== undefined ? 'AND fixture.status = ?' : ''}
    ${fixtureObj.endDate !== undefined ? 'AND fixture.date < ?' : ''}
    ${fixtureObj.startDate !== undefined ? 'AND fixture.date > ?' : ''}
    ${fixtureObj.type == 'eloSetting' ? 'GROUP BY fixture.id' : ''}
    -- fixture.id breaks ties: the ELO backfill rates in this order, and utils/eloChain
    -- has to agree with it about which of two fixtures on the same night came first.
    ORDER BY fixture.date ASC, fixture.id ASC`

  const seasonName = season || seasonModel.current()
  let [result] = await (await db.otherConnect()).query(sql, [seasonName, seasonName, seasonName, ...sqlArray])

  if (fixtureObj.type == undefined || fixtureObj.type != 'eloSetting') {
    result.push({ id: 99999, date: '2027-04-13T23:00:00.000Z', homeTeam: 'Messer A Section Final', homeClub: 'No Club', awayTeam: 'No Team', awayClub: 'No Club', division: 7, venueName: 'Ladybridge Park Residents Club, Edenbridge Rd, Cheadle Hulme, Cheadle SK8 5PX', venueLink: 'https://maps.app.goo.gl/svEEaaVQ8SERDrF6A', status: 'completed', homeScore: null, awayScore: null })
    result.push({ id: 99999, date: '2027-04-20T23:00:00.000Z', homeTeam: 'Messer B Section Final', homeClub: 'No Club', awayTeam: 'No Team', awayClub: 'No Club', division: 7, venueName: 'Ladybridge Park Residents Club, Edenbridge Rd, Cheadle Hulme, Cheadle SK8 5PX', venueLink: 'https://maps.app.goo.gl/svEEaaVQ8SERDrF6A', status: 'completed', homeScore: null, awayScore: null })
    result.push({ id: 99999, date: '2027-05-05T23:00:00.000Z', homeTeam: 'Messer Finals', homeClub: 'No Club', awayTeam: '@ Ladybridge Park Residents Club', awayClub: 'No Club', division: 7, venueName: 'Ladybridge Park Residents Club, Edenbridge Rd, Cheadle Hulme, Cheadle SK8 5PX', venueLink: 'https://maps.app.goo.gl/svEEaaVQ8SERDrF6A', status: 'outstanding', homeScore: null, awayScore: null })
  }

  return result
}

exports.getAllSeasons = async function() {
  return kysely.selectFrom('season').select(['name', 'startDate', 'endDate']).orderBy('startDate', 'asc').execute()
}

/** @param {any} fixtureId */
exports.getFixtureDetailsById = async function(fixtureId) {
  const [result] = await (await db.otherConnect()).query(
    'SELECT a.fixtureId, a.date, a."homeTeam", team.name AS "awayTeam", a.status, a."homeScore", a."awayScore" FROM (SELECT team.name AS "homeTeam", fixture.id AS fixtureid, fixture.date AS date, fixture."awayTeam", fixture.status, fixture."homeScore", fixture."awayScore" FROM fixture JOIN team ON team.id = fixture."homeTeam") AS a JOIN team ON team.id = a."awayTeam" AND fixtureId = ?',
    fixtureId
  )
  return result
}

// Fixture header: the date, the two team names and the final score, and nothing
// else. Deliberately LEFT JOINs, and deliberately separate from
// getFixtureEventById — that one INNER JOINs teamCaptain and matchSecretary, so it
// returns no rows for a fixture whose team has no captain flagged, which makes
// "fixture does not exist" indistinguishable from "captain unset". This one can
// only return zero rows when the fixture genuinely is not there.
/** @param {number} fixtureId */
exports.getFixtureSummaryById = async function(fixtureId) {
  return kysely.selectFrom('fixture as f')
    .leftJoin('team as homeTeam', 'f.homeTeam', 'homeTeam.id')
    .leftJoin('team as awayTeam', 'f.awayTeam', 'awayTeam.id')
    .select(['f.id', 'f.date', 'f.status', 'f.homeScore', 'f.awayScore',
      'homeTeam.name as homeTeam', 'awayTeam.name as awayTeam'])
    .where('f.id', '=', fixtureId)
    .execute()
}

// One row per game of the fixture, with the four players named and both scores: the
// game's own and the fixture's total. Inner joins throughout, as the nested version had,
// so a game with an empty player slot is not listed.
/** @param {number} fixtureId */
exports.getScorecardDataById = async function(fixtureId) {
  return kysely.selectFrom('game as g')
    .innerJoin('fixture', 'fixture.id', 'g.fixture')
    .innerJoin('team as homeTeam', 'fixture.homeTeam', 'homeTeam.id')
    .innerJoin('team as awayTeam', 'fixture.awayTeam', 'awayTeam.id')
    .innerJoin('player as homePlayer1', 'g.homePlayer1', 'homePlayer1.id')
    .innerJoin('player as homePlayer2', 'g.homePlayer2', 'homePlayer2.id')
    .innerJoin('player as awayPlayer1', 'g.awayPlayer1', 'awayPlayer1.id')
    .innerJoin('player as awayPlayer2', 'g.awayPlayer2', 'awayPlayer2.id')
    .select(eb => ['fixture.date', 'homeTeam.name as homeTeam', 'awayTeam.name as awayTeam',
      fullName(eb, 'homePlayer1').as('homePlayer1'), fullName(eb, 'homePlayer2').as('homePlayer2'),
      fullName(eb, 'awayPlayer1').as('awayPlayer1'), fullName(eb, 'awayPlayer2').as('awayPlayer2'),
      'g.homeScore', 'g.awayScore', 'fixture.homeScore as totalHomeScore', 'fixture.awayScore as totalAwayScore'])
    .where('g.fixture', '=', fixtureId)
    .execute()
}

// Everything /event/:id needs, in one row — and it must be one row, or none.
//
// This query used to lose 48 of the 272 fixtures in the 2026/27 season, and the
// controller turned that into `HTTP 200` with a two-byte body (`{}`), which is
// what Googlebot got for 18% of the event pages. Three separate causes, all of
// them the same mistake — an INNER JOIN to something optional:
//
//  - `JOIN player teamCaptain` dropped any fixture whose home team has nobody
//    flagged as captain. Six teams are in that state (Cheadle Hulme B,
//    Featherforce B, Manor B, Parrswood C, Racketeers A, Syddal Park A), so
//    every one of their home fixtures 200'd empty.
//  - `JOIN season ON fixture.date BETWEEN ...` filtered on a table the SELECT
//    list never touched, so an unseasoned date silently removed the fixture.
//    Dropped rather than made outer: joining it could only ever duplicate rows.
//  - venue/club/division are all NOT NULL in practice but nothing enforces it,
//    and a missing one should cost a field, not the page.
//
// The captain and secretary are also scalar subqueries rather than joins now,
// because four teams have *two* players flagged captain — which multiplied the
// result set and left `row[0]` an arbitrary pick that could change between
// deploys. `ORDER BY p.id LIMIT 1` makes it the same pick every time.
//
// Note the quoted aliases on those two. They were `AS teamCaptain` unquoted, so
// Postgres folded them to `teamcaptain` while viewEventDetails.ejs read
// `.teamCaptain` — meaning "Team Captain:" and "Match Secretary:" rendered blank
// on every event page that *did* render, for as long as the page has existed.
/** @param {number} fixtureId */
exports.getFixtureEventById = async function(fixtureId) {
  /** The first player (by id) at `where` holding `flag`, as a name or an id. */
  const officer = (/** @type {any} */ eb, /** @type {'team' | 'club'} */ on, /** @type {any} */ ref,
    /** @type {'teamCaptain' | 'matchSecrertary'} */ flag, /** @type {'name' | 'id'} */ what) =>
    eb.selectFrom('player as p')
      .select(what === 'name' ? fullName(eb, 'p').as('v') : 'p.id')
      .where(`p.${on}`, '=', eb.ref(ref)).where(`p.${flag}`, '=', 1)
      .orderBy('p.id').limit(1)
  return kysely.selectFrom('fixture')
    .innerJoin('team as homeTeam', 'fixture.homeTeam', 'homeTeam.id')
    .innerJoin('team as awayTeam', 'fixture.awayTeam', 'awayTeam.id')
    .leftJoin('club as homeClub', 'homeTeam.club', 'homeClub.id')
    .leftJoin('club as awayClub', 'awayTeam.club', 'awayClub.id')
    .leftJoin('venue', 'homeTeam.venue', 'venue.id')
    .leftJoin('division', 'homeTeam.division', 'division.id')
    .select(eb => ['fixture.id', 'fixture.date', 'homeTeam.name as homeTeam', 'homeTeam.starttime as startTime',
      'homeTeam.endtime as endTime', 'homeClub.name as homeClub', 'homeClub.clubWebsite',
      'awayTeam.name as awayTeam', 'awayClub.name as awayClub', 'division.name as divisionName',
      'venue.name as venueName', 'venue.address as venueAddress', 'venue.gMapUrl as venueLink',
      'venue.Lat', 'venue.Lng', 'venue.placeId', 'fixture.status', 'fixture.homeScore', 'fixture.awayScore',
      officer(eb, 'team', 'homeTeam.id', 'teamCaptain', 'name').as('teamCaptain'),
      officer(eb, 'team', 'homeTeam.id', 'teamCaptain', 'id').as('teamCaptainId'),
      officer(eb, 'club', 'homeClub.id', 'matchSecrertary', 'name').as('matchSecretary'),
      officer(eb, 'club', 'homeClub.id', 'matchSecrertary', 'id').as('matchSecretaryId')])
    .where('fixture.id', '=', fixtureId)
    // A reinstated team is a withdrawn row that exists only so historical fixtures
    // resolve (HARD-11). Its fixtures must not gain a public /event/ page: they would
    // render with no club, no division and no venue, all of which are reached through
    // the team, and the sitemap would then list ~14 of them. Owner's call, 14 Sep 2026.
    .where('homeTeam.withdrawn', 'is', null).where('awayTeam.withdrawn', 'is', null)
    .execute()
}

// Fixtures whose /event/ pages belong in the sitemap, newest first.
//
// Deliberately not all 5,214 of them. The archive goes back to 2012 and those
// pages are thin (two team names, a venue and a map), so submitting the lot
// would spend crawl budget on 4,600 near-duplicates to get the ~600 that are
// worth ranking. `monthsBack` covers the current season plus the one before it,
// which is what "matches this week" and "<team> vs <team> result" actually need.
//
// The cap is a judgement call, not a limit of the format — a sitemap holds 50,000
// URLs, so widening it is only a matter of changing the argument.
/** @param {number | string} [monthsBack] */
exports.getForSitemap = async function(monthsBack = 18) {
  const since = /** @type {When} */ (sql`NOW() - (${String(monthsBack)} || ' months')::interval`)
  return kysely.selectFrom('fixture')
    .innerJoin('team as homeTeam', 'fixture.homeTeam', 'homeTeam.id')
    .innerJoin('team as awayTeam', 'fixture.awayTeam', 'awayTeam.id')
    .select(['fixture.id', 'fixture.date', 'fixture.status', 'homeTeam.name as homeTeam', 'awayTeam.name as awayTeam'])
    .where('fixture.date', '>=', since)
    // Withdrawn teams are HARD-11's reinstated rows: they exist so historical fixtures
    // resolve, not so those fixtures gain public pages. getFixtureEventById excludes
    // them too, and the two must agree — a sitemap entry whose page does not render is
    // a soft 404, which the seo skill forbids in terms.
    .where('homeTeam.withdrawn', 'is', null).where('awayTeam.withdrawn', 'is', null)
    .orderBy('fixture.date', 'desc')
    .execute()
}

/** @param {{ homeTeam: number, awayTeam: number }} obj */
exports.getFixtureId = async function(obj) {
  if (!db.isObject(obj)) throw new Error('not object')
  return kysely.selectFrom(['fixture', 'season']).select('fixture.id')
    .where('season.name', '=', seasonModel.current())
    .whereRef('fixture.date', '>', 'season.startDate')
    .where('fixture.awayTeam', '=', obj.awayTeam).where('fixture.homeTeam', '=', obj.homeTeam)
    .execute()
}

// Who the reminder popup offers to nudge about a missing scorecard: the home club's
// secretary and match secretary and the home team's captain, each labelled, so the
// results secretary can see who is about to be emailed before editing the list.
//
// Read from the role FLAGS, the one record of an officer since REARCH-03 dropped the old
// pointer columns (club."clubSec" and friends), which could name someone who had left.
/** @param {number} fixtureId */
exports.getReminderContacts = async function(fixtureId) {
  const fixture = await kysely.selectFrom('fixture as f')
    .innerJoin('team as ht', 'f.homeTeam', 'ht.id')
    .innerJoin('team as at', 'f.awayTeam', 'at.id')
    .select(['f.id', 'f.date', 'ht.name as homeTeam', 'at.name as awayTeam'])
    .where('f.id', '=', fixtureId)
    .execute()
  if (!fixture.length) return null

  /** One labelled officer list: who holds `flag` at the home club, or on the home team. */
  const officers = (/** @type {string} */ role, /** @type {number} */ sort,
    /** @type {'clubSecretary' | 'matchSecrertary' | 'teamCaptain'} */ flag) => {
    const base = kysely.selectFrom('fixture as f')
    const joined = flag === 'teamCaptain'
      ? base.innerJoin('player as p', join => join.onRef('p.team', '=', 'f.homeTeam').on(`p.${flag}`, '=', 1))
      : base.innerJoin('team as ht', 'f.homeTeam', 'ht.id')
        .innerJoin('player as p', join => join.onRef('p.club', '=', 'ht.club').on(`p.${flag}`, '=', 1))
    return joined
      .select(eb => [sql.lit(role).as('role'), sql.lit(sort).as('sort'),
        eb(eb(eb.fn('trim', ['p.first_name']), '||', sql.lit(' ')), '||', eb.fn('trim', ['p.family_name'])).as('name'),
        eb.fn('nullif', [eb.fn('trim', [decrypt(eb.ref('p.playerEmail'))]), sql.lit('')]).as('email')])
      .where('f.id', '=', fixtureId)
  }
  const rows = await kysely.selectFrom(
    officers('Club secretary', 1, 'clubSecretary')
      .unionAll(officers('Match secretary', 2, 'matchSecrertary'))
      .unionAll(officers('Team captain', 3, 'teamCaptain'))
      .as('officers'))
    .select(['role', 'name', 'email'])
    .orderBy('sort').orderBy('name')
    .execute()

  return { fixture: fixture[0], contacts: rows }
}

// Every fixture this season between these two teams, whatever its status, newest
// first. The controller decides what to do with them.
//
// This replaced a query that filtered to status = 'outstanding' inside the SQL, had
// **no ORDER BY**, and whose caller took `result[0]`. Two things were wrong with that.
// Row order without ORDER BY is whatever the planner returns, so with two outstanding
// fixtures for one pairing the result landed on an arbitrary one — 15 pairings in the
// table already carry two outstanding rows, and a rearrangement that leaves the
// original open creates exactly that state. And filtering in SQL meant an
// already-recorded fixture came back as "no matching fixtures", a bare error that
// reached the 500 page and told a captain their result had not saved when it had.
//
// `date` is optional; when given, an exact match on the day is preferred over anything
// else, which is what makes the choice deterministic rather than lucky.
/** @param {any} obj */
exports.getFixturesForTeams = async function(obj) {
  if (!db.isObject(obj)) throw new Error('not object')
  const [result] = await (await db.otherConnect()).query(
    `SELECT f.id, f.status, f.date, f."homeScore", f."awayScore",
            division.name, division.rank
     FROM fixture f
     JOIN team ON f."homeTeam" = team.id
     JOIN division ON team.division = division.id
     WHERE f."homeTeam" = ? AND f."awayTeam" = ?
       AND f.date > (SELECT s."startDate" FROM season s WHERE s.name = ?)
     ORDER BY f.date DESC, f.id DESC`,
    [obj.homeTeam, obj.awayTeam, seasonModel.current()]
  )
  return result
}

// Which of those rows a submitted result belongs to.
//
// Returns { fixture, candidates } on success, or { conflict } describing why not, so
// the caller can say something useful instead of throwing a developer's error string
// at a captain. Never guesses between two equally plausible fixtures.
/** @param {any} rows @param {any} submittedDate */
exports.resolveFixtureForResult = function(rows, submittedDate) {
  const day = (/** @type {any} */ d) => (d instanceof Date ? d : new Date(d)).toISOString().slice(0, 10)
  const outstanding = rows.filter((/** @type {any} */ r) => r.status === 'outstanding')

  if (outstanding.length === 1) return { fixture: outstanding[0] }

  if (outstanding.length > 1) {
    // Prefer the one actually played on the submitted date. Only if that is
    // unambiguous — otherwise ask, rather than pick.
    if (submittedDate) {
      const exact = outstanding.filter((/** @type {any} */ r) => day(r.date) === day(submittedDate))
      if (exact.length === 1) return { fixture: exact[0] }
    }
    return { conflict: { reason: 'ambiguous', candidates: outstanding } }
  }

  const complete = rows.find((/** @type {any} */ r) => r.status === 'complete')
  if (complete) return { conflict: { reason: 'already-recorded', fixture: complete } }

  const rearranged = rows.find((/** @type {any} */ r) => r.status === 'rearranged' || r.status === 'rearranging')
  if (rearranged) return { conflict: { reason: 'rearranged', fixture: rearranged } }

  const conceded = rows.find((/** @type {any} */ r) => r.status === 'conceded')
  if (conceded) return { conflict: { reason: 'conceded', fixture: conceded } }

  return { conflict: { reason: 'not-found' } }
}

// Archive a fixture and, if a new date is known, insert its replacement.
//
// Three things this used to get wrong, all of which put junk in `fixture`:
//
//  - The INSERT resolved both teams with `(SELECT id FROM team WHERE name = ?)`
//    inline, so a name that matched nothing inserted a fixture with a NULL team
//    rather than failing. That is precisely what the `ghost-teams` and
//    `orphan-results` integrity checks in tools/audit/checks.js keep finding.
//  - The UPDATE and the INSERT were independent. A pairing that matched no fixture
//    archived nothing and still inserted the replacement, so a typo'd team name
//    silently created a duplicate fixture nobody had asked for.
//  - They were also two round trips with no transaction, so a failure between them
//    left a fixture marked 'rearranged' with no replacement — invisible until a
//    captain asked where their match had gone.
//
// Now: resolve both teams first, find the fixture explicitly, and do both writes in
// one transaction. Throws with a `status` the controller can pass straight through.
/** @param {any} message */
function badRequest(message) {
  const err = /** @type {Error & { status?: number }} */ (new Error(message));
  err.status = 400;
  return err;
}

// Resolving a team by NAME must only ever find a live one.
//
// `new Map(rows.map(...))` keeps the LAST row for a duplicated key, silently. Team names
// are reused: a club's team is deleted and re-created under the same name with a new id —
// four such pairs exist (Syddal Park B, Disley A, Manor B, Mellor B). Once HARD-11's
// orphaned teams are reinstated as withdrawn rows those names exist twice in `team`, and
// without this filter a rearrangement could resolve to the defunct one and write a fixture
// pointing at it. That is a NEW orphan, created by the very thing meant to stop them.
//
// This function writes, which is why it matters more than the other by-name lookups.
/** @param {import('kysely').Kysely<import('../db/schema').DB>} q @param {string} homeTeam @param {string} awayTeam */
async function findTeamIdsByName(q, homeTeam, awayTeam) {
  const rows = await q.selectFrom('team').select(['id', 'name'])
    .where('name', 'in', [homeTeam, awayTeam]).where('withdrawn', 'is', null)
    .execute();
  const byName = new Map(rows.map((/** @type {any} */ r) => [r.name, r.id]));
  const missing = [homeTeam, awayTeam].filter(n => !byName.has(n));
  if (missing.length) {
    throw badRequest(`no team by that name: ${missing.map(n => JSON.stringify(n)).join(', ')}`);
  }
  return { homeTeamId: byName.get(homeTeam), awayTeamId: byName.get(awayTeam) };
}

// The latest fixture between this pairing in the current season. Matching on the
// team *names* is the endpoint's contract (the JWT PATCH caller posts names), but
// the ids are resolved first so the join is on the key, not the string.
/** @param {import('kysely').Kysely<import('../db/schema').DB>} q @param {number} homeTeamId @param {number} awayTeamId */
async function findCurrentSeasonFixture(q, homeTeamId, awayTeamId) {
  const row = await q.selectFrom('fixture as f')
    .innerJoin('season as s', join => join.on('s.name', '=', seasonModel.current()))
    .select('f.id')
    .where('f.homeTeam', '=', homeTeamId).where('f.awayTeam', '=', awayTeamId)
    .whereRef('f.date', '>', 's.startDate')
    .orderBy('f.id', 'desc').limit(1)
    .executeTakeFirst();
  return row ? row.id : null;
}

/** @param {any} updateObj */
exports.rearrangeByTeamNames = async function(updateObj) {
  if (!db.isObject(updateObj)) throw badRequest('not object')

  const homeTeam = typeof updateObj.homeTeam === 'string' ? updateObj.homeTeam.trim() : ''
  const awayTeam = typeof updateObj.awayTeam === 'string' ? updateObj.awayTeam.trim() : ''
  if (!homeTeam || !awayTeam) throw badRequest('homeTeam and awayTeam are required')
  if (homeTeam === awayTeam) throw badRequest('a team cannot be rearranged against itself')

  const date = updateObj.date == null ? '' : String(updateObj.date).trim()
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw badRequest('invalid date — expected YYYY-MM-DD')
  }

  return db.withTransaction(async (conn, trx) => {
    const { homeTeamId, awayTeamId } = await findTeamIdsByName(trx, homeTeam, awayTeam)

    const fixtureId = await findCurrentSeasonFixture(trx, homeTeamId, awayTeamId)
    if (fixtureId == null) {
      const err = /** @type {Error & { status?: number }} */ (new Error(`no current-season fixture for ${homeTeam} v ${awayTeam}`))
      err.status = 404
      throw err
    }

    // No date yet: the captains have agreed to move it but not agreed when. The
    // fixture stays in place, flagged, and no replacement is created.
    if (!date) {
      await trx.updateTable('fixture').set({ status: 'rearranging' }).where('id', '=', fixtureId).execute()
      return { ok: true, action: 'rearranging', fixtureId, replacementId: null }
    }

    await trx.updateTable('fixture').set({ status: 'rearranged' }).where('id', '=', fixtureId).execute()

    // Wall-clock string, not a JS Date — a Date is converted through the server's
    // zone and lands a day early over BST (see admin_fixture_date_update).
    const inserted = await trx.insertInto('fixture')
      .values({ homeTeam: /** @type {number} */ (homeTeamId), awayTeam: /** @type {number} */ (awayTeamId),
        date: date + ' 00:00:00', status: 'outstanding' })
      .returning('id')
      .executeTakeFirst()

    return {
      ok: true,
      action: 'rearranged',
      fixtureId,
      replacementId: inserted ? inserted.id : null,
      date,
    }
  })
}

// Where a published result goes on Meta: the targets configured on this service, in the
// order they are posted.
//
// The Instagram story is a THIRD target, not part of the Instagram one, so a story that
// fails beside a feed post that worked is reported as exactly that. Off unless
// SOCIAL_POST_STORY is 'true'. The Facebook Page story is a fourth, on SOCIAL_POST_FB_STORY,
// and uses the same 9:16 card. Read when a result is queued, to decide which rows to write,
// and again when the job posts one, for the credentials.
function resultTargets() {
  const meta = require('../utils/metaPublisher')
  const t = meta.targets()
  const story = config.SOCIAL_POST_STORY && t.instagram
  return [
    t.stockportPage && { ...t.stockportPage, name: 'Stockport page', kind: 'page' },
    t.instagram && { ...t.instagram, name: 'Instagram', kind: 'instagram' },
    story && { ...t.instagram, name: 'Instagram story', kind: 'instagram-story' },
    meta.pageStoryTarget(t),
  ].filter(Boolean)
}
exports.resultTargets = resultTargets

/** @param {any} r */
function resultMessage(r) {
  return `Result: ${r.homeTeam} vs ${r.awayTeam} : ${r.homeScore}-${r.awayScore} #stockport #badminton #sdbl #result #bulutangkis #badminton🏸 #badmintonclub https://stockport-badminton.co.uk`
}

// What a result post carries, in the shape `metaPublisher.publishEverywhere` takes. Built
// through the URL helpers, and percent-encoded, because Meta fetches these from its own
// servers: interpolated raw, "Tatton A" put a literal space in the URL and Facebook answered
// `Missing or invalid image file (324, OAuthException)` — the endpoint was fine, the URL
// was not.
/** @param {any} r */
exports.resultPostContent = function(r) {
  return {
    imageUrls: absoluteUrl(resultImagePath(r)),
    message: resultMessage(r),
    storyImageUrl: absoluteUrl(resultStoryImagePath(r)),
  }
}

// The name is from when this posted a Make.com webhook. Make went in October 2026 (every
// scenario disabled from 15 Sep, the subscription down to the free tier), and with it the
// `SOCIAL_POST_DIRECT` switch that chose between the two; this now only queues.
/** @param {any} zapObject */
exports.sendResultZap = async function(zapObject) {
  if (!db.isObject(zapObject)) throw new Error("you've not supplied an object")
  if (zapObject.host == '127.0.0.1:8080') {
    log.info('zap not sent!')
    return 'test env'
  }

  // No `mentions`. Tagging the clubs in the post needs a Facebook app reviewed and
  // approved by Meta — paperwork, not development — so the handles we hold cannot
  // actually be turned into mentions on a page post. Fixture.getResultMentions and
  // getClubSocialHandlesByTeamName existed for it and were only ever called from the
  // quick-results-entry flow deleted in 74c52d1, so no post has ever carried one.

  // **Queued, not posted** (HARD-47). Posting here, inside the request that publishes the
  // result, took 26–33 s a publish and 52 s on 24 Oct 2026, against Firebase Hosting's 60 s
  // cut — the four Meta targets one after another were 92–95% of it. So this writes one row
  // per configured target and returns, and `sbl-results-meta` posts them
  // (controllers/metaResultsController.js). Nothing may be posted from here after the
  // response either: Cloud Run throttles the CPU once a response is sent.
  const configured = resultTargets()

  // **No targets is a failure, not a quiet success.** The credentials live in the Cloud
  // Run service config, not in the repo, so a service that lost them would find nothing to
  // post to, post nowhere — and report success, because an empty target list produces
  // neither a post nor a failure. That is the shape this codebase keeps getting caught by:
  // a rejection that looks like an acceptance.
  if (!configured.length) {
    throw new Error(
      'No Meta credentials are configured, so this result would have been posted nowhere. ' +
      'Set META_PAGE_ID, META_PAGE_TOKEN and META_IG_USER_ID on the service.')
  }
  if (!zapObject.fixtureId) throw new Error('sendResultZap needs the fixture id to queue the post')

  const queued = await SocialResultPost.enqueue(zapObject.fixtureId, configured.map((/** @type {any} */ t) => t.kind))
  log.info(`result for fixture ${zapObject.fixtureId} queued for ` + (queued.map((/** @type {any} */ q) => q.target).join(', ') || 'nothing new'))
  return { queued }
}

// `conn` is optional and exists so this can join a caller's transaction —
// otherConnect() takes a connection per query, so without it a result and its games
// cannot be written atomically. See scorecardController.full_fixture_post, where the
// gap between this and Game.createBatch left three fixtures last season holding a
// score with no games behind them.
/** @param {any} fixtureObj @param {any} fixtureId @param {any} conn */
exports.updateById = async function(fixtureObj, fixtureId, conn) {
  if (!db.isObject(fixtureObj)) throw new Error('not object')
  const setClauses = Object.keys(fixtureObj).map(k => `"${k}" = ?`).join(', ')
  const sql = `UPDATE fixture SET ${setClauses} WHERE id = ?`
  const c = conn || await db.otherConnect()
  const [result] = await c.query(sql, [...Object.values(fixtureObj), fixtureId])
  return result
}

// Attaches a photo to a draft that does not have one.
//
// The emptiness guard is repeated in the WHERE clause on purpose, the same way the
// backfill scripts do it: the caller checks the draft has no photo yet, and between
// that read and this write the row can change. `rows.affectedRows` is 0 when the guard
// bit, and the caller answers 409 rather than emailing the results secretary about a
// write that did not happen.
//
// Without it, this was an unconditional overwrite keyed on an id from the URL — so any
// fixture's photo could be replaced by anyone.
// Returns `{ affectedRows }`: add_scorecard_photo answers 409 when it is 0, because the
// draft gained a photo between its read and this write. The string version returned the
// wrapper's rows array with affectedRows hung off it; the count is what was read.
/** @param {number} id @param {string} imgurl */
exports.updateScorecardPhoto = async function(id, imgurl) {
  const res = await kysely.updateTable('scorecardstore').set({ 'scoresheet-url': imgurl })
    .where('id', '=', id)
    .where(eb => eb(eb.fn.coalesce(eb.fn('nullif', [eb.fn('trim', [eb.ref('scoresheet-url')]), sql.lit('')]), sql.lit('')), '=', ''))
    .executeTakeFirst()
  return { affectedRows: Number(res.numUpdatedRows) }
}

// The results secretary sees every draft in the season with no photo; anyone else sees
// their own, and only those not yet published.
/** @param {string} email */
exports.getMissingScorecardPhotos = async function(email) {
  const everyone = email == 'stockport.badders.results@gmail.com'
  return kysely.selectFrom('scorecardstore')
    .innerJoin('team as homeTeam', 'scorecardstore.homeTeam', 'homeTeam.id')
    .innerJoin('team as awayTeam', 'scorecardstore.awayTeam', 'awayTeam.id')
    .innerJoin('fixture', join => join
      .onRef('scorecardstore.date', '=', 'fixture.date')
      .onRef('fixture.homeTeam', '=', 'scorecardstore.homeTeam')
      .onRef('fixture.awayTeam', '=', 'scorecardstore.awayTeam'))
    .innerJoin('season', join => join.onRef('fixture.date', '>', 'season.startDate').onRef('fixture.date', '<', 'season.endDate'))
    .select(['fixture.id as fixtureid', 'fixture.status', 'scorecardstore.id', 'scorecardstore.date',
      'scorecardstore.scoresheet-url', 'scorecardstore.email',
      // The draft's confirmation token, so the page can post it back when attaching a photo
      // (POST /add-scorecard-photo/:id). NULL for a draft filed before migration 011.
      'scorecardstore.confirmToken',
      'homeTeam.name as homeTeam', 'awayTeam.name as awayTeam'])
    .where('season.name', '=', seasonModel.current())
    .where('scorecardstore.scoresheet-url', '=', '')
    .$if(!everyone, qb => qb.where('scorecardstore.email', '=', email).where('fixture.status', 'not like', 'complete'))
    .execute()
}

// ── Messer scorecard methods ─────────────────────────────────────────────

// Insert from a {column: value} object, only the keys given; an `undefined` value is
// written as NULL, as the string version did. Returns `[{ id }]`.
/** @param {Record<string, unknown>} messerObj */
exports.createMesserScorecard = async function(messerObj) {
  if (!db.isObject(messerObj)) throw new Error('not object')
  return kysely.insertInto('messer_scorecard').values(/** @type {any} */ (definedOrNull(messerObj)))
    .returning('id').execute()
}

// The twelve player slots, each joined to its player for a display name.
const MESSER_SLOTS = /** @type {const} */ ([
  ['hm1', 'homeMan1'], ['hm2', 'homeMan2'], ['hm3', 'homeMan3'], ['hl1', 'homeLady1'], ['hl2', 'homeLady2'], ['hl3', 'homeLady3'],
  ['am1', 'awayMan1'], ['am2', 'awayMan2'], ['am3', 'awayMan3'], ['al1', 'awayLady1'], ['al2', 'awayLady2'], ['al3', 'awayLady3'],
])

/** @param {number} scorecardId */
exports.getMesserScorecardById = async function(scorecardId) {
  /** @type {any} */
  let q = kysely.selectFrom('messer_scorecard as ms')
  for (const [alias, slot] of MESSER_SLOTS) q = q.leftJoin(`player as ${alias}`, `ms.${slot}`, `${alias}.id`)
  return q.selectAll('ms')
    .select((/** @type {any} */ eb) => MESSER_SLOTS.map(([alias, slot]) => fullName(eb, alias).as(`${slot}Name`)))
    .where('ms.id', '=', scorecardId)
    .execute()
}

exports.listMesserScorecardsForApproval = async function() {
  return kysely.selectFrom('messer_scorecard as ms')
    .innerJoin('team as ht', 'ms.homeTeam', 'ht.id')
    .innerJoin('team as at', 'ms.awayTeam', 'at.id')
    .select(['ms.id', 'ms.date', 'ht.name as homeTeam', 'at.name as awayTeam', 'ht.id as homeTeamId',
      'at.id as awayTeamId', 'ms.email', 'ms.status', 'ms.created_at'])
    .where('ms.status', '=', 'submitted')
    .orderBy('ms.created_at', 'desc')
    .execute()
}

// Returns nothing; the approval handler never read the old rows array.
/** @param {number} scorecardId @param {string} status */
exports.updateMesserScorecardStatus = async function(scorecardId, status) {
  await kysely.updateTable('messer_scorecard').set(eb => ({ status, updated_at: eb.fn('now') }))
    .where('id', '=', scorecardId).execute()
}

// Returns `[{ id }]`. Only the keys given are written; undefined is written as NULL.
/** @param {Record<string, unknown>} resultObj */
exports.createMesserResult = async function(resultObj) {
  if (!db.isObject(resultObj)) throw new Error('not object')
  return kysely.insertInto('messer_result').values(/** @type {any} */ (definedOrNull(resultObj)))
    .returning('id').execute()
}

// Returns nothing; the approval handler never read the old rows array.
/** @param {number} messerId @param {{ homeScore: number, awayScore: number, winningTeam: number }} scores */
exports.updateMesserTable = async function(messerId, scores) {
  const { homeScore, awayScore, winningTeam } = scores
  await kysely.updateTable('messer').set({ homeScore, awayScore, winningTeam }).where('id', '=', messerId).execute()
}

// ── Messer bracket wiring & auto-advance ─────────────────────────────────

// All draw slots for a section, with team names, ordered by drawPos.
// Used by the admin wire-up screen and to validate the bracket.
/** @param {string} section */
exports.getMesserBracket = async function(section) {
  return kysely.selectFrom('messer as m')
    .leftJoin('team as ht', 'm.homeTeam', 'ht.id')
    .leftJoin('team as at', 'm.awayTeam', 'at.id')
    .select(['m.id', 'm.section', 'm.drawPos', 'm.round', 'm.nextDrawPos', 'm.nextSlot',
      'm.homeTeam', 'm.awayTeam', 'm.homeScore', 'm.awayScore', 'm.winningTeam',
      'ht.name as homeTeamName', 'at.name as awayTeamName'])
    .where('m.section', '=', section)
    .orderBy('m.drawPos')
    .execute()
}

// Save the bracket links entered on the admin screen.
// `links` is an array of { id, round, nextDrawPos, nextSlot, was } where `was` holds
// the same three values as the page showed them; blank values are NULL (a section
// final has no nextDrawPos/nextSlot).
//
// Only rows the admin changed are written, and each write requires the row to still
// hold what the page showed. This used to write every row of the form blindly, so a
// wiring page opened before a swap on the draw — which flips its feeders' nextSlot —
// put the old sides back when it was saved, and the next winner would have been written
// over the team already in the slot (B-30, 19 Oct 2026). Any row that has moved on
// rolls the whole save back: half a rewiring is worse than none.
//
// Returns { saved, conflicts } — `conflicts` is the drawPos of each row that changed
// underneath the page, and when it is non-empty nothing was written.
/** @param {any} links */
exports.saveMesserBracketLinks = async function(links) {
  const same = (/** @type {any} */ a, /** @type {any} */ b) => (a == null ? null : a) === (b == null ? null : b)
  const changed = links.filter((/** @type {any} */ l) =>
    !same(l.round, l.was.round) || !same(l.nextDrawPos, l.was.nextDrawPos) || !same(l.nextSlot, l.was.nextSlot))
  if (!changed.length) return { saved: 0, conflicts: [] }

  /** @type {any[]} */
  const conflicts = []
  const rollback = new Error('messer bracket save conflict')
  try {
    await db.withTransaction(async (conn, trx) => {
      for (const l of changed) {
        const written = await trx.updateTable('messer')
          .set({ round: l.round, nextDrawPos: l.nextDrawPos, nextSlot: l.nextSlot })
          .where('id', '=', l.id)
          .where('round', 'is not distinct from', l.was.round)
          .where('nextDrawPos', 'is not distinct from', l.was.nextDrawPos)
          .where('nextSlot', 'is not distinct from', l.was.nextSlot)
          .returning('drawPos')
          .executeTakeFirst()
        if (!written) {
          const cur = await trx.selectFrom('messer').select('drawPos').where('id', '=', l.id).executeTakeFirst()
          conflicts.push(cur ? cur.drawPos : l.id)
        }
      }
      if (conflicts.length) throw rollback
    })
  } catch (err) {
    if (err !== rollback) throw err
    return { saved: 0, conflicts }
  }
  return { saved: changed.length, conflicts: [] }
}

// The draw match between two teams, whichever way round the draw has them. `reversed`
// is true when the draw has `awayTeamId` at home. The current draw only: archived
// seasons live in their own messer<season> tables.
/** @param {number} homeTeamId @param {number} awayTeamId */
exports.findMesserMatch = async function(homeTeamId, awayTeamId) {
  const rows = await kysely.selectFrom('messer')
    .select(eb => ['id', 'section', 'drawPos', 'nextDrawPos', 'nextSlot', eb('homeTeam', '=', homeTeamId).as('exact')])
    .where(eb => eb.or([
      eb.and([eb('homeTeam', '=', homeTeamId), eb('awayTeam', '=', awayTeamId)]),
      eb.and([eb('homeTeam', '=', awayTeamId), eb('awayTeam', '=', homeTeamId)]),
    ]))
    .orderBy('exact', 'desc')
    .execute()
  if (!rows.length) return null
  const { exact, ...match } = rows[0]
  return { ...match, reversed: !exact }
}

// Swap which team is at home in one draw slot, at the messer admin's request —
// she sometimes alternates home and away so the top of a bracket is not always
// the home side.
//
// Swapping the two teams is not enough on its own. The matches that FEED this
// slot carry a fixed `nextSlot`, so if slot 3 feeds 11:H and Syddal Park B is
// already sitting in 11's home side, swapping 11 moves Syddal Park B to away —
// and slot 4's winner, still wired to 11:A, would then be written over them on
// approval. So the feeders' sides are flipped in the same transaction, and each
// still delivers its winner to the team it is actually drawn against.
//
// Refused (err.status 409) when:
//   - neither side has a team yet (both are the 'No Team' placeholder), so there
//     is nothing to swap;
//   - the match has a result: home/away is moot once it is played, and the
//     scores and messer_result rows are recorded the way round it was played;
//   - a scorecard for it is awaiting approval in the CURRENT orientation:
//     approval finds the match by exact homeTeam/awayTeam, so swapping under it
//     would make the approval record the result and silently skip updating the
//     draw. (A draft filed the other way round is fine — the swap is what lets
//     it match.)
/** @param {any} section @param {any} id */
exports.swapMesserHomeAway = async function(section, id) {
  return db.withTransaction(async (conn, trx) => {
    const match = await trx.selectFrom('messer')
      .select(['id', 'section', 'drawPos', 'homeTeam', 'awayTeam', 'homeScore', 'awayScore'])
      .where('id', '=', id).where('section', '=', section)
      .forUpdate()
      .executeTakeFirst()
    if (!match) {
      throw Object.assign(new Error('No such draw slot in this section'), { status: 404, code: 'missing' })
    }
    if (match.homeTeam === NO_TEAM_ID && match.awayTeam === NO_TEAM_ID) {
      throw Object.assign(new Error('Neither side of that match has a team yet'), { status: 409, code: 'empty' })
    }
    if (match.homeScore != null || match.awayScore != null) {
      throw Object.assign(new Error('That match already has a result'), { status: 409, code: 'played' })
    }
    const pending = await trx.selectFrom('messer_scorecard').select('id')
      .where('homeTeam', '=', match.homeTeam).where('awayTeam', '=', match.awayTeam)
      .where('status', 'in', ['draft', 'submitted'])
      .execute()
    if (pending.length) {
      throw Object.assign(new Error('A scorecard for that match is awaiting approval'), { status: 409, code: 'pending' })
    }

    // Postgres evaluates every SET expression against the old row, so this swaps.
    await trx.updateTable('messer')
      .set(eb => ({ homeTeam: eb.ref('awayTeam'), awayTeam: eb.ref('homeTeam') }))
      .where('id', '=', match.id)
      .execute()
    const flipped = await trx.updateTable('messer')
      .set(eb => ({ nextSlot: eb.case('nextSlot').when('H').then('A').else('H').end() }))
      .where('section', '=', /** @type {string} */ (match.section))
      .where('nextDrawPos', '=', match.drawPos)
      .where('nextSlot', 'in', ['H', 'A'])
      .executeTakeFirst()
    return { id: match.id, drawPos: match.drawPos, feedersFlipped: Number(flipped.numUpdatedRows) }
  })
}

// Advance a winning team into its next-round slot.
// `match` is a messer row that has just been decided (needs section,
// nextDrawPos, nextSlot). Returns a small status object describing what happened
// so the caller can surface a warning without failing the approval.
/** @param {any} match @param {any} winningTeam */
exports.advanceMesserWinner = async function(match, winningTeam) {
  if (match.nextDrawPos == null || !match.nextSlot) {
    return { advanced: false, reason: 'no-next-slot' } // section final, nothing to do
  }
  const target = await kysely.selectFrom('messer').select(['id', 'homeScore', 'awayScore'])
    .where('section', '=', match.section).where('drawPos', '=', match.nextDrawPos)
    .executeTakeFirst()
  if (!target) {
    return { advanced: false, reason: 'target-missing' }
  }
  // Guard: don't clobber a next-round match that has already been played.
  if (target.homeScore != null || target.awayScore != null) {
    return { advanced: false, reason: 'target-already-played', targetId: target.id }
  }
  await kysely.updateTable('messer')
    .set(match.nextSlot === 'H' ? { homeTeam: winningTeam } : { awayTeam: winningTeam })
    .where('id', '=', target.id)
    .execute()
  return { advanced: true, targetId: target.id, slot: match.nextSlot }
}


// The coming week's fixtures, for the Sunday-evening social post.
//
// Deliberately NOT `getupComing`. That query starts at NOW() - 1 day so the homepage still
// shows a match being played tonight, which is right for a page somebody is reading and
// wrong for a post announcing what is still to come: a preview whose first line is a match
// played the day before it went out reads as stale, and there is no way for a reader to
// tell it from a fixture that has not happened.
//
// The two team joins are INNER on purpose, and that is a decision rather than a copy.
// `--check ghost-teams` keeps finding fixtures pointing at teams that no longer exist, and
// a card cannot draw one — "v Mellor B" with nothing on the left is worse than an absent
// row. So they are dropped here, silently, because the integrity check is where that
// belongs and it already reports them. The division join is LEFT for the opposite reason:
// it is only used to group, and the caller decides what to do with a fixture that has no
// division rather than having it vanish inside the SQL.
//
// The window is anchored to the start of the day, not to `NOW()`, and that is not
// tidiness. **Fixtures are stored at midnight** — every row in the table is `00:00:00`,
// the date is the playing day and the start time lives on the team. So a plain
// `date >= NOW()` drops TODAY'S fixtures, because today's midnight is already in the past,
// and whether it does so depends on the time of day the job happens to run. At the
// Sunday-18:00 schedule that is invisible and harmless; move the job to a morning — which
// is a scheduler edit, with no code change and no test to fail — and the post silently
// omits the matches being played that evening. Truncating to the day makes the window
// exactly seven calendar days from today whenever it is asked.
//
// And the day is **Europe/London's**, not the database's. Supabase runs UTC, so under BST
// `date_trunc('day', NOW())` is an hour behind the UK day: between 00:00 and 01:00 British
// time it truncates to *yesterday*, and the card then shows a night of fixtures that has
// already been played. Measured 17 Sep 2026 at 00:03 BST — `date_trunc('day', NOW())` gave
// 16 Sep where the UK day was the 17th. `fixture.date` holds UK local midnight as a naive
// timestamp, so converting NOW() to London and truncating compares like with like.
//
// `dayLabel` is formatted in SQL rather than in JavaScript. `fixture.date` is `timestamp
// without time zone`, so `to_char` prints exactly what is stored and no timezone is
// involved at any point. Formatting it from a JS `Date` would work today and depends on
// the container's TZ to do so, which is the shape of the BST off-by-one-day bug this
// codebase already has a helper (`localYmd`) and a comment apologising for.
exports.getUpcomingWeek = async function() {
  return kysely.selectFrom('fixture')
    .innerJoin('team as homeTeam', 'fixture.homeTeam', 'homeTeam.id')
    .innerJoin('team as awayTeam', 'fixture.awayTeam', 'awayTeam.id')
    .leftJoin('club as homeClub', 'homeTeam.club', 'homeClub.id')
    .leftJoin('club as awayClub', 'awayTeam.club', 'awayClub.id')
    .leftJoin('division', 'homeTeam.division', 'division.id')
    .select(eb => ['fixture.id', 'fixture.date',
      eb.fn('to_char', ['fixture.date', sql.lit('Dy FMDD Mon')]).as('dayLabel'),
      'homeTeam.name as homeTeam', 'awayTeam.name as awayTeam', 'homeClub.name as homeClub',
      'awayClub.name as awayClub', 'division.name as divisionName'])
    .where('fixture.homeScore', 'is', null)
    .where('fixture.status', 'not in', ['rearranged', 'rearranging'])
    .where('fixture.date', '>=', UK_TODAY)
    .where('fixture.date', '<', UK_WEEK_END)
    .orderBy('fixture.date').orderBy('homeTeam.name')
    .execute()
}
