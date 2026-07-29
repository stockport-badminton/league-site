// Roster reads and writes for the team-management pages.
//
// Everything a captain or the results secretary does to a club's registrations
// goes through here. It replaced /player/batch-update, which took a table name
// and a column list straight from the request body and interpolated both into an
// UPDATE — so any logged-in user could write any column of any table. These
// functions take intent instead ("this team's nominated men are, in order, these
// ids") and derive the SQL themselves.
//
// ## The rank convention
//
// player.rank is a within-team strength order and doubles as the nominated /
// reserve flag:
//
//   rank 1..N   nominated, in strength order, per team *and gender*
//   rank >= 99  reserve, in order (99 is the first reserve, 100 the second, ...)
//
// Reserves used to all be written rank = 99 flat, so their order could be dragged
// but never saved. Sequential-from-99 keeps every existing consumer correct: the
// three places that ask "is this a reserve" already compare with < 99 / >= 99
// (models/players.js:getEligibleByRank, controllers/documentsController.js,
// controllers/rosterController.js).
//
// Ranks are per (team, gender) because a fixture picks 3 men and 3 ladies
// independently — a team's number 1 man and number 1 lady both hold rank 1.

const db = require('../db_connect.js')

// The holding pen for a player with no club: club 63 is the row literally named
// 'No Club' and team 52 is 'No Team' (both confirmed against the live schema).
// `Remove from team` parks a player there rather than deleting the row, so their
// match history and ELO survive and any club can pick them up next season.
//
// These were bare literals in views/team-admin.ejs — `"data":[[id,63,52,99]]` —
// with nothing anywhere naming them.
const NO_CLUB_ID = parseInt(process.env.NO_CLUB_ID, 10) || 63
const NO_TEAM_ID = parseInt(process.env.NO_TEAM_ID, 10) || 52

const RESERVE_BASE = 99

// A player's display name, built the same way everywhere so a name matches between
// the roster, the search results and a toast.
//
// TRIM alone isn't enough: a number of rows carry a leading space in family_name, so
// a plain concat renders "Prem  Chandar-Anandan" and "Jenny  Chan". Collapsing runs
// of whitespace fixes the display and buys back the few pixels that were pushing the
// longest names into an ellipsis. Not a data migration — the stored values are left
// alone, since a captain may yet want to correct them on the player form.
const FULL_NAME =
  `REGEXP_REPLACE(TRIM(CONCAT(player.first_name, ' ', player.family_name)), '\\s+', ' ', 'g')`

exports.NO_CLUB_ID = NO_CLUB_ID
exports.NO_TEAM_ID = NO_TEAM_ID
exports.RESERVE_BASE = RESERVE_BASE

exports.isReserve = function(rank) {
  return rank === null || rank === undefined ? false : Number(rank) >= RESERVE_BASE
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

// Every registration at a club, with the team, division and (decrypted) contact
// details the captain view shows. One query — the old page ran getNamesClubsTeams
// and then re-filtered it four times per team with jsonpath string-concat
// predicates, which broke on any team name containing a quote.
//
// Contact columns are pgp_sym_encrypt'd; pgp_sym_decrypt throws on a NULL key, so
// the DB_PI_KEY is bound as a parameter and rows with no stored value come back
// NULL rather than erroring.
exports.getClubRoster = async function(clubName) {
  const key = process.env.DB_PI_KEY
  const [rows] = await (await db.otherConnect()).query(
    `SELECT player.id AS "playerId",
            player.first_name AS "firstName",
            player.family_name AS "familyName",
            ${FULL_NAME} AS name,
            player.gender,
            player.rank,
            player.junior,
            player."teamCaptain",
            player."clubSecretary",
            player."matchSecrertary",
            player.treasurer,
            player.date_of_registration AS "registered",
            player.rating,
            team.id AS "teamId",
            team.name AS "teamName",
            team.rank AS "teamRank",
            division.id AS "divisionId",
            division.name AS "divisionName",
            club.id AS "clubId",
            club.name AS "clubName",
            CASE WHEN player."playerTel" IS NULL THEN NULL
                 ELSE pgp_sym_decrypt(player."playerTel", ?)::text END AS tel,
            CASE WHEN player."playerEmail" IS NULL THEN NULL
                 ELSE pgp_sym_decrypt(player."playerEmail", ?)::text END AS email
     FROM player
     JOIN team ON team.id = player.team
     JOIN club ON club.id = team.club
     LEFT JOIN division ON division.id = team.division
     WHERE club.name = ?
     ORDER BY team.rank NULLS LAST, team.name, player.gender, player.rank NULLS LAST, player.family_name`,
    [key, key, clubName]
  )
  return rows
}

// Teams at a club, in the club's own pecking order — the destination list for
// "Move to…". Kept separate from the roster read so a club whose newest team has
// no players yet still offers it as a destination.
exports.getClubTeams = async function(clubName) {
  const [rows] = await (await db.otherConnect()).query(
    `SELECT team.id, team.name, team.rank AS "teamRank",
            division.name AS "divisionName"
     FROM team
     JOIN club ON club.id = team.club
     LEFT JOIN division ON division.id = team.division
     WHERE club.name = ?
     ORDER BY team.rank NULLS LAST, team.name`,
    clubName
  )
  return rows
}

// Every club with its team and player counts — the superadmin's entry point to
// team management. The nav used to link straight to /manage-players/club-Aerospace:
// one club, alphabetically first, standing in for a picker.
//
// Counts come from separate subqueries rather than one join, because counting
// players and teams in the same GROUP BY multiplies them together.
exports.getClubSummaries = async function() {
  const [rows] = await (await db.otherConnect()).query(
    `SELECT club.id, club.name,
            (SELECT COUNT(*) FROM team WHERE team.club = club.id) AS teams,
            (SELECT COUNT(*) FROM player
             JOIN team t2 ON t2.id = player.team
             WHERE t2.club = club.id) AS players
     FROM club
     WHERE club.id <> ?
     ORDER BY club.name`,
    NO_CLUB_ID
  )
  return rows.map(r => ({
    id: Number(r.id),
    name: r.name,
    teams: Number(r.teams),
    players: Number(r.players)
  }))
}

// The club a team belongs to. Every id-keyed write endpoint calls this before
// touching anything, so authorization is decided by the row's real owner rather
// than by whatever club the request claimed.
exports.getTeamOwner = async function(teamId, conn) {
  const c = conn || (await db.otherConnect())
  const [rows] = await c.query(
    `SELECT team.id, team.name, team.club AS "clubId", club.name AS "clubName"
     FROM team JOIN club ON club.id = team.club
     WHERE team.id = ?`,
    teamId
  )
  return rows[0] || null
}

// Same, for a player: which club/team do they currently sit in.
exports.getPlayerOwner = async function(playerId, conn) {
  const c = conn || (await db.otherConnect())
  const [rows] = await c.query(
    `SELECT player.id,
            ${FULL_NAME} AS name,
            player.gender, player.rank,
            player.team AS "teamId", team.name AS "teamName",
            team.club AS "teamClubId", club.name AS "clubName"
     FROM player
     LEFT JOIN team ON team.id = player.team
     LEFT JOIN club ON club.id = team.club
     WHERE player.id = ?`,
    playerId
  )
  return rows[0] || null
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

// Renumbers one (team, gender, section) list to exactly `orderedIds`.
//
// Called inside a transaction. Only rows that already belong to this team and
// gender are touched — an id from anywhere else is ignored rather than being
// silently dragged into the team, so a stale page can't relocate a player by
// posting an order.
async function renumberSection(conn, teamId, gender, section, orderedIds) {
  // ORDER BY matters: calling this with an empty orderedIds is how a move closes
  // the gap it left behind, and the leftover players have to keep their relative
  // order. Without it Postgres is free to return them in any order at all.
  const [current] = await conn.query(
    'SELECT id, rank FROM player WHERE team = ? AND gender = ? ORDER BY rank NULLS LAST, id',
    [teamId, gender]
  )
  const inSection = current.filter(r =>
    section === 'reserve' ? exports.isReserve(r.rank) : !exports.isReserve(r.rank)
  )
  const allowed = new Set(inSection.map(r => Number(r.id)))

  // Requested order first, then anything in the section the caller didn't
  // mention, so a player missing from a stale payload keeps a valid rank at the
  // bottom instead of being orphaned.
  const seen = new Set()
  const finalOrder = []
  for (const id of orderedIds) {
    const n = Number(id)
    if (allowed.has(n) && !seen.has(n)) {
      seen.add(n)
      finalOrder.push(n)
    }
  }
  for (const row of inSection) {
    const n = Number(row.id)
    if (!seen.has(n)) {
      seen.add(n)
      finalOrder.push(n)
    }
  }

  const base = section === 'reserve' ? RESERVE_BASE : 1
  const updated = []
  for (let i = 0; i < finalOrder.length; i++) {
    const rank = base + i
    const existing = inSection.find(r => Number(r.id) === finalOrder[i])
    if (existing && Number(existing.rank) === rank) continue // no-op, skip the write
    await conn.query('UPDATE player SET rank = ? WHERE id = ?', [rank, finalOrder[i]])
    updated.push({ id: finalOrder[i], rank })
  }
  return updated
}

exports.renumberSection = renumberSection

// Saves a whole team card in one transaction: nominated men, nominated ladies,
// reserve men, reserve ladies.
//
// `sections` is [{ gender: 'Male', section: 'nominated', playerIds: [...] }, ...].
// The editor posts every list it displays, so a drag from nominated to reserves
// arrives as two lists and both ends stay consistent. All-or-nothing matters
// here: a partial apply is what left teams ranked 1, 2, 4, 5 before.
exports.saveTeamOrder = async function(teamId, sections) {
  return db.withTransaction(async conn => {
    const updated = []
    for (const s of sections) {
      const rows = await renumberSection(conn, teamId, s.gender, s.section, s.playerIds || [])
      updated.push(...rows)
    }
    return updated
  })
}

// Moves a player to another team and/or section, renumbering both ends.
//
// This is the operation the old UI did by dragging across the page and then
// renumbering only the destination — which is why the source team kept a hole
// where the player used to be.
exports.movePlayer = async function(playerId, destTeamId, destSection) {
  return db.withTransaction(async conn => {
    const player = await exports.getPlayerOwner(playerId, conn)
    if (!player) {
      const err = new Error('No such player')
      err.status = 404
      throw err
    }
    const sourceTeamId = player.teamId
    const sourceIsReserve = exports.isReserve(player.rank)

    // Append to the destination: one past whatever is already there.
    const [maxRows] = await conn.query(
      `SELECT COALESCE(MAX(rank), 0) AS max FROM player
       WHERE team = ? AND gender = ? AND rank ${destSection === 'reserve' ? '>=' : '<'} ?`,
      [destTeamId, player.gender, RESERVE_BASE]
    )
    const currentMax = Number(maxRows[0].max) || 0
    const newRank = destSection === 'reserve'
      ? Math.max(currentMax + 1, RESERVE_BASE)
      : currentMax + 1

    // Destination club, so a move also re-homes the player. Cross-club moves are
    // transfers and are gated separately in the controller; within a club this
    // keeps player.club and team.club from drifting apart.
    const [teamRows] = await conn.query('SELECT club FROM team WHERE id = ?', destTeamId)
    if (!teamRows.length) {
      const err = new Error('No such team')
      err.status = 404
      throw err
    }

    await conn.query('UPDATE player SET team = ?, club = ?, rank = ? WHERE id = ?',
      [destTeamId, teamRows[0].club, newRank, playerId])

    // Close the gap left behind. Same team + section change still needs it, since
    // the player left one of that team's two lists.
    if (sourceTeamId) {
      await renumberSection(conn, sourceTeamId, player.gender,
        sourceIsReserve ? 'reserve' : 'nominated', [])
    }
    if (sourceTeamId !== destTeamId || sourceIsReserve !== (destSection === 'reserve')) {
      await renumberSection(conn, destTeamId, player.gender, destSection, [])
    }

    return { playerId: Number(playerId), name: player.name, teamId: destTeamId, rank: newRank }
  })
}

// Takes a player out of their team without deleting them: parked on the
// no-club/no-team sentinel rows so match history and ELO survive and they can be
// picked up by any club next season.
exports.releasePlayer = async function(playerId) {
  return db.withTransaction(async conn => {
    const player = await exports.getPlayerOwner(playerId, conn)
    if (!player) {
      const err = new Error('No such player')
      err.status = 404
      throw err
    }
    await conn.query(
      'UPDATE player SET club = ?, team = ?, rank = ? WHERE id = ?',
      [NO_CLUB_ID, NO_TEAM_ID, RESERVE_BASE, playerId]
    )
    if (player.teamId) {
      await renumberSection(conn, player.teamId, player.gender,
        exports.isReserve(player.rank) ? 'reserve' : 'nominated', [])
    }
    return { playerId: Number(playerId), name: player.name, from: player.teamName }
  })
}

// Adds a player to a team as its next reserve — the shared tail of "create a new
// player" and "adopt an unattached one". Returns the rank assigned.
exports.addToTeam = async function(playerId, teamId, section) {
  return db.withTransaction(async conn => {
    const [rows] = await conn.query('SELECT gender FROM player WHERE id = ?', playerId)
    if (!rows.length) {
      const err = new Error('No such player')
      err.status = 404
      throw err
    }
    const [teamRows] = await conn.query('SELECT club FROM team WHERE id = ?', teamId)
    if (!teamRows.length) {
      const err = new Error('No such team')
      err.status = 404
      throw err
    }
    const [maxRows] = await conn.query(
      `SELECT COALESCE(MAX(rank), 0) AS max FROM player
       WHERE team = ? AND gender = ? AND rank ${section === 'reserve' ? '>=' : '<'} ?`,
      [teamId, rows[0].gender, RESERVE_BASE]
    )
    const currentMax = Number(maxRows[0].max) || 0
    const rank = section === 'reserve'
      ? Math.max(currentMax + 1, RESERVE_BASE)
      : currentMax + 1

    await conn.query('UPDATE player SET team = ?, club = ?, rank = ? WHERE id = ?',
      [teamId, teamRows[0].club, rank, playerId])
    return { playerId: Number(playerId), teamId, rank }
  })
}

// Creates a player and returns their new id.
//
// models/players.js:create issues a bare INSERT with no RETURNING, so the `result`
// it hands back is an empty rows array and `result.insertId` is undefined — which
// is why the old add-player modal set `dataset.id = undefined` and then posted
// parseInt(undefined) as the player id. The new player has to be placed in a team
// straight after being created, so the id is not optional here.
exports.createPlayer = async function({ firstName, familyName, gender, clubId, teamId }) {
  const [rows] = await (await db.otherConnect()).query(
    `INSERT INTO player (first_name, family_name, gender, club, team, date_of_registration)
     VALUES (?, ?, ?, ?, ?, ?) RETURNING id`,
    [firstName, familyName, gender, clubId, teamId, new Date()]
  )
  if (!rows.length) throw new Error('player insert returned no id')
  return Number(rows[0].id)
}

// Players registered to no club — the pool "Add an unattached player" draws from.
// Matched on a name fragment rather than the old first-letter LIKE, which missed
// anyone whose surname you searched by.
exports.findUnattached = async function(term) {
  const [rows] = await (await db.otherConnect()).query(
    `SELECT player.id AS "playerId",
            ${FULL_NAME} AS name,
            player.gender, club.name AS "clubName", club.id AS "clubId"
     FROM player
     LEFT JOIN club ON club.id = player.club
     WHERE player.club = ?
       AND ${FULL_NAME} ILIKE ?
     ORDER BY player.family_name, player.first_name
     LIMIT 20`,
    [NO_CLUB_ID, `%${term}%`]
  )
  return rows
}

// Anyone at another club matching the term — the transfer candidates. Excluded
// from findUnattached deliberately: adopting an unattached player is the club's
// own business, taking one off another club needs the results secretary.
exports.findAtOtherClubs = async function(term, excludeClubName) {
  const [rows] = await (await db.otherConnect()).query(
    `SELECT player.id AS "playerId",
            ${FULL_NAME} AS name,
            player.gender, club.name AS "clubName", club.id AS "clubId",
            team.name AS "teamName"
     FROM player
     JOIN club ON club.id = player.club
     LEFT JOIN team ON team.id = player.team
     WHERE player.club <> ?
       AND club.name <> ?
       AND ${FULL_NAME} ILIKE ?
     ORDER BY club.name, player.family_name
     LIMIT 20`,
    [NO_CLUB_ID, excludeClubName || '', `%${term}%`]
  )
  return rows
}
