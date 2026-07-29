// Team management: the captain's roster page, the results secretary's editor, and
// the intent endpoints both write through.
//
// Replaces playerController.manage_player_list_clubs_teams, which rendered one
// template for both audiences behind a `superadmin` boolean, rebuilt the
// registration .docx as a side effect of every GET, and shipped a page whose only
// write path was an arbitrary UPDATE.

const Club = require('../models/club')
const Roster = require('../models/roster')
const sesUtil = require('../utils/ses')
const { assertClubAccess, isSuperAdmin } = require('../middleware/requireClubAccess')
const { canonicalFor } = require('../utils/canonical');

const RESULTS_SECRETARY = process.env.RESULTS_EMAIL || 'results@stockport-badminton.co.uk'
const MAIL_SOURCE = 'results@stockport-badminton.co.uk'

function unknownClub(club) {
  const err = new Error('no club by that name: ' + JSON.stringify(String(club)))
  err.status = 404
  return err
}

function badRequest(message) {
  const err = new Error(message)
  err.status = 400
  return err
}

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

// ---------------------------------------------------------------------------
// Shaping
// ---------------------------------------------------------------------------

// Groups a flat roster into the cards both views render. One pass, no jsonpath:
// the old version ran four jsonpath queries per team with team names concatenated
// into the filter expression, so a team called O'Brien's broke the page.
//
// Each team gets four lists, because a fixture picks 3 men and 3 ladies
// independently and the ranks are numbered per gender.
function groupByTeam(rows, teams) {
  const byId = new Map()

  // Seed from the team list so a team with no registrations still shows up — the
  // old page could only ever render teams that already had a player in them.
  for (const t of teams) {
    byId.set(Number(t.id), {
      id: Number(t.id),
      name: t.name,
      teamRank: t.teamRank,
      divisionName: t.divisionName || null,
      nominated: { Male: [], Female: [] },
      reserve: { Male: [], Female: [] },
      counts: { nominated: 0, reserve: 0, juniors: 0, noContact: 0 }
    })
  }

  for (const row of rows) {
    const team = byId.get(Number(row.teamId))
    if (!team) continue
    const section = Roster.isReserve(row.rank) ? 'reserve' : 'nominated'
    const gender = row.gender === 'Female' ? 'Female' : 'Male'
    const player = {
      playerId: row.playerId,
      name: row.name,
      gender: gender,
      rank: row.rank,
      junior: row.junior === 1 || row.junior === true,
      teamCaptain: row.teamCaptain === 1 || row.teamCaptain === true,
      clubSecretary: row.clubSecretary === 1 || row.clubSecretary === true,
      matchSecretary: row.matchSecrertary === 1 || row.matchSecrertary === true,
      tel: row.tel || null,
      email: row.email || null,
      rating: row.rating
    }
    team[section][gender].push(player)
    team.counts[section]++
    if (player.junior) team.counts.juniors++
    if (!player.tel && !player.email) team.counts.noContact++
  }

  // Display position within its list, so the view never has to count rows and the
  // reserve numbering (R1, R2) is independent of the stored 99, 100, 101.
  for (const team of byId.values()) {
    for (const section of ['nominated', 'reserve']) {
      for (const gender of ['Male', 'Female']) {
        team[section][gender].forEach((p, i) => { p.position = i + 1 })
      }
    }
  }

  return Array.from(byId.values())
}

function summarise(rows, teamCards) {
  return {
    players: rows.length,
    teams: teamCards.length,
    nominated: rows.filter(r => !Roster.isReserve(r.rank)).length,
    reserves: rows.filter(r => Roster.isReserve(r.rank)).length,
    juniors: rows.filter(r => r.junior === 1 || r.junior === true).length,
    noContact: rows.filter(r => !r.tel && !r.email).length
  }
}

async function loadClub(req) {
  const clubName = req.params.club
  assertClubAccess(req, clubName)
  const [rows, teams] = await Promise.all([
    Roster.getClubRoster(clubName),
    Roster.getClubTeams(clubName)
  ])
  if (!teams.length) throw unknownClub(clubName)
  const teamCards = groupByTeam(rows, teams)
  return { clubName, rows, teams, teamCards, summary: summarise(rows, teamCards) }
}

function viewBase(req, extra) {
  return Object.assign({
    static_path: '/static',
    theme: process.env.THEME || 'flatly',
    flask_debug: process.env.FLASK_DEBUG || 'false',
    canonical: canonicalFor(req)
  }, extra)
}

// ---------------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------------

// GET /manage-players — pick a club.
//
// A club admin has exactly one, so they get sent straight to it. A superadmin gets
// the list, which is what the nav's hardcoded /manage-players/club-Aerospace link
// was standing in for.
exports.club_picker = async function(req, res, next) {
  try {
    if (!isSuperAdmin(req)) {
      const own = req.user && req.user._json && req.user._json['https://my-app.example.com/club']
      if (own && own !== 'All') {
        return res.redirect('/manage-players/club-' + encodeURIComponent(own))
      }
      const err = new Error("You aren't attached to a club, so there's no roster to show")
      err.status = 403
      return next(err)
    }
    const clubs = await Roster.getClubSummaries()
    res.render('roster-clubs', viewBase(req, {
      pageTitle: 'Team Management',
      pageDescription: 'Pick a club to manage registrations for',
      clubs: clubs
    }))
  } catch (err) {
    next(err)
  }
}

// GET /manage-players/club-:club — the captain's read-only roster.
exports.club_roster = async function(req, res, next) {
  try {
    const data = await loadClub(req)
    res.render('roster', viewBase(req, {
      pageTitle: data.clubName + ' — Registered Players',
      pageDescription: 'Registered players and nominated order for ' + data.clubName,
      clubName: data.clubName,
      teamCards: data.teamCards,
      summary: data.summary,
      canEdit: isSuperAdmin(req)
    }))
  } catch (err) {
    next(err)
  }
}

// GET /manage-players/club-:club/edit — the editor.
exports.club_roster_edit = async function(req, res, next) {
  try {
    const data = await loadClub(req)
    const clubs = isSuperAdmin(req) ? (await Club.getAll()).map(c => c.name) : [data.clubName]
    res.render('roster-edit', viewBase(req, {
      pageTitle: 'Manage ' + data.clubName,
      pageDescription: 'Manage registrations for ' + data.clubName,
      clubName: data.clubName,
      teamCards: data.teamCards,
      summary: data.summary,
      clubs: clubs,
      isSuperAdmin: isSuperAdmin(req),
      // The editor posts these as move destinations; it needs every team at the
      // club, including ones with no players yet.
      moveTargets: data.teams.map(t => ({ id: Number(t.id), name: t.name }))
    }))
  } catch (err) {
    next(err)
  }
}

// GET /manage-players/club-:club/registration.docx
//
// The registration table used to be built during every GET of the team page —
// including every captain's — packed to a buffer in a promise nobody awaited, and
// written to static/beta/docs/generated under a filename derived by chopping the
// last two characters off the first team's name. The page then linked to that
// path, so a cold start could serve the link before the file existed.
//
// Same document, built on request and streamed. No disk, no race, no rebuild for
// readers who never click it.
exports.registration_docx = async function(req, res, next) {
  try {
    const data = await loadClub(req)
    const buffer = await buildRegistrationDoc(data.clubName, data.teamCards)
    res.setHeader('Content-Type',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
    res.setHeader('Content-Disposition',
      `attachment; filename="${data.clubName} Registrations.docx"`)
    res.send(buffer)
  } catch (err) {
    next(err)
  }
}

// Men and ladies side by side, nominated then reserves, one table per club — the
// layout the league's paper form uses. Rebuilt from the grouped team cards, so it
// agrees with the screen by construction rather than by running its own set of
// filters over the same rows.
async function buildRegistrationDoc(clubName, teamCards) {
  const docx = require('docx')

  const cell = (text, style, span, width) => new docx.TableCell({
    children: [new docx.Paragraph(style ? { text: String(text || ''), style: style } : String(text || ''))],
    columnSpan: span || 1,
    width: width ? { size: width, type: docx.PERCENTAGE } : undefined
  })

  const rows = [
    new docx.TableRow({ children: [cell(clubName + ' Registrations', 'docHeading', 4)] })
  ]

  for (const team of teamCards) {
    rows.push(new docx.TableRow({ children: [cell(team.name, 'teamHeading', 4)] }))
    rows.push(new docx.TableRow({ children: [cell('Men', 'gender', 2), cell('Ladies', 'gender', 2)] }))

    // Nominated first in rank order, then reserves — and the two genders are
    // independent lists, so pad the shorter one to keep the columns aligned.
    const men = team.nominated.Male.concat(team.reserve.Male)
    const ladies = team.nominated.Female.concat(team.reserve.Female)
    const nomMen = team.nominated.Male.length
    const nomLadies = team.nominated.Female.length
    // The team's own number, as the paper form marks it — 'Aerospace 3' → '3',
    // with 'R' for the reserves below the nominated block.
    const suffix = team.name.trim().slice(-1)

    for (let i = 0; i < Math.max(men.length, ladies.length); i++) {
      const man = men[i]
      const lady = ladies[i]
      rows.push(new docx.TableRow({
        children: [
          cell(man ? man.name : '', null, 1, 40),
          cell(man ? (i < nomMen ? suffix : 'R') : '', null, 1, 10),
          cell(lady ? lady.name : '', null, 1, 40),
          cell(lady ? (i < nomLadies ? suffix : 'R') : '', null, 1, 10)
        ]
      }))
    }
  }

  const doc = new docx.Document({
    title: clubName + ' Registrations',
    sections: [{
      children: [new docx.Table({
        rows: rows,
        margins: {
          top: docx.convertInchesToTwip(0.05),
          bottom: docx.convertInchesToTwip(0.05),
          right: docx.convertInchesToTwip(0.1),
          left: docx.convertInchesToTwip(0.1)
        },
        width: { size: 100, type: docx.PERCENTAGE }
      })]
    }],
    styles: {
      paragraphStyles: [
        { name: 'Normal', run: { font: 'Arial' } },
        { name: 'docHeading', basedOn: 'Normal', run: { bold: true, size: 30 } },
        { name: 'teamHeading', basedOn: 'Normal', run: { bold: true, size: 24 } },
        { name: 'gender', basedOn: 'Normal', run: { bold: true } }
      ]
    }
  })

  return docx.Packer.toBuffer(doc)
}

// ---------------------------------------------------------------------------
// Intent endpoints
// ---------------------------------------------------------------------------

// Validates the { sections: [...] } body of a save. Each section names a gender
// and a section and carries an ordered id list — no table names, no columns.
function parseSections(body) {
  if (!body || !Array.isArray(body.sections)) throw badRequest('sections must be an array')
  if (body.sections.length > 8) throw badRequest('too many sections')
  return body.sections.map(s => {
    const gender = s.gender === 'Female' ? 'Female' : s.gender === 'Male' ? 'Male' : null
    const section = s.section === 'reserve' ? 'reserve' : s.section === 'nominated' ? 'nominated' : null
    if (!gender) throw badRequest('gender must be Male or Female')
    if (!section) throw badRequest('section must be nominated or reserve')
    const ids = Array.isArray(s.playerIds) ? s.playerIds : []
    if (ids.length > 200) throw badRequest('too many players in one section')
    const playerIds = ids.map(id => parseId(id, 'playerIds'))
    return { gender, section, playerIds }
  })
}

// Strict: parseInt would take '1; DROP TABLE player' and hand back 1. The value is
// bound as a parameter either way so it was never an injection risk, but silently
// reordering player 1 because the payload was junk is its own kind of wrong — a
// malformed request should be refused, not guessed at.
function parseId(value, label) {
  if (typeof value === 'number') {
    if (!Number.isInteger(value) || value < 1) {
      throw badRequest(label + ' must be a positive integer')
    }
    return value
  }
  if (typeof value !== 'string' || !/^[0-9]+$/.test(value.trim())) {
    throw badRequest(label + ' must be a positive integer')
  }
  const n = parseInt(value.trim(), 10)
  if (!Number.isSafeInteger(n) || n < 1) {
    throw badRequest(label + ' must be a positive integer')
  }
  return n
}

// POST /api/teams/:id/order — save one team card's four lists.
exports.api_team_order = async function(req, res, next) {
  try {
    const teamId = parseId(req.params.id, 'team id')
    const sections = parseSections(req.body)
    const owner = await Roster.getTeamOwner(teamId)
    if (!owner) return next(Object.assign(new Error('No such team'), { status: 404 }))
    assertClubAccess(req, owner.clubName)

    const updated = await Roster.saveTeamOrder(teamId, sections)
    res.json({ ok: true, teamId: teamId, updated: updated.length, ranks: updated })
  } catch (err) {
    next(err)
  }
}

// POST /api/players/:id/move — relocate to another team and/or section.
exports.api_player_move = async function(req, res, next) {
  try {
    const playerId = parseId(req.params.id, 'player id')
    const teamId = parseId(req.body && req.body.teamId, 'teamId')
    const section = req.body.section === 'reserve' ? 'reserve'
      : req.body.section === 'nominated' ? 'nominated' : null
    if (!section) throw badRequest('section must be nominated or reserve')

    // Both ends have to be the caller's business, otherwise a club admin could
    // move one of their own players into another club's team.
    const [player, dest] = await Promise.all([
      Roster.getPlayerOwner(playerId),
      Roster.getTeamOwner(teamId)
    ])
    if (!player) return next(Object.assign(new Error('No such player'), { status: 404 }))
    if (!dest) return next(Object.assign(new Error('No such team'), { status: 404 }))
    if (player.clubName) assertClubAccess(req, player.clubName)
    assertClubAccess(req, dest.clubName)

    const result = await Roster.movePlayer(playerId, teamId, section)
    res.json({ ok: true, moved: result, team: dest.name })
  } catch (err) {
    next(err)
  }
}

// POST /api/players/:id/release — out of the team, still registered.
exports.api_player_release = async function(req, res, next) {
  try {
    const playerId = parseId(req.params.id, 'player id')
    const player = await Roster.getPlayerOwner(playerId)
    if (!player) return next(Object.assign(new Error('No such player'), { status: 404 }))
    if (player.clubName) assertClubAccess(req, player.clubName)

    const result = await Roster.releasePlayer(playerId)
    res.json({ ok: true, released: result })
  } catch (err) {
    next(err)
  }
}

// GET /api/roster/club-:club/candidates?term=... — search results for the add
// flow, split into the three outcomes the UI offers as separate labelled actions.
// The old modal collapsed all three into one Add button and decided between them
// by reading an undocumented property off an <option> element.
exports.api_candidates = async function(req, res, next) {
  try {
    const clubName = req.params.club
    assertClubAccess(req, clubName)
    const term = String((req.query.term || '')).trim()
    if (term.length < 2) return res.json({ unattached: [], otherClubs: [], term: term })

    const [unattached, otherClubs] = await Promise.all([
      Roster.findUnattached(term),
      Roster.findAtOtherClubs(term, clubName)
    ])
    res.json({ term: term, unattached: unattached, otherClubs: otherClubs })
  } catch (err) {
    next(err)
  }
}

// POST /api/roster/club-:club/players — create a brand new player straight into a
// team. Replaces POST /manage-players/create, which had no auth at all and took
// the club id from the request body.
exports.api_player_create = async function(req, res, next) {
  try {
    const clubName = req.params.club
    assertClubAccess(req, clubName)

    const firstName = String((req.body && req.body.firstName) || '').trim()
    const familyName = String((req.body && req.body.familyName) || '').trim()
    const gender = req.body.gender === 'Female' ? 'Female' : req.body.gender === 'Male' ? 'Male' : null
    const section = req.body.section === 'nominated' ? 'nominated' : 'reserve'
    const teamId = parseId(req.body && req.body.teamId, 'teamId')

    if (!firstName) throw badRequest('First name is required')
    if (!familyName) throw badRequest('Family name is required')
    if (firstName.length > 60 || familyName.length > 60) throw badRequest('Name is too long')
    if (!gender) throw badRequest('gender must be Male or Female')

    const dest = await Roster.getTeamOwner(teamId)
    if (!dest) return next(Object.assign(new Error('No such team'), { status: 404 }))
    assertClubAccess(req, dest.clubName)

    const playerId = await Roster.createPlayer({
      firstName: firstName,
      familyName: familyName,
      gender: gender,
      clubId: dest.clubId,
      teamId: teamId
    })

    const placed = await Roster.addToTeam(playerId, teamId, section)
    res.json({
      ok: true,
      created: { playerId: playerId, name: firstName + ' ' + familyName, gender: gender },
      placed: placed
    })
  } catch (err) {
    next(err)
  }
}

// POST /api/roster/club-:club/attach — adopt a player currently registered to no
// club. Their own club is the sentinel, so nobody loses a player to this.
exports.api_player_attach = async function(req, res, next) {
  try {
    const clubName = req.params.club
    assertClubAccess(req, clubName)
    const playerId = parseId(req.body && req.body.playerId, 'playerId')
    const teamId = parseId(req.body && req.body.teamId, 'teamId')
    const section = req.body.section === 'nominated' ? 'nominated' : 'reserve'

    const [player, dest] = await Promise.all([
      Roster.getPlayerOwner(playerId),
      Roster.getTeamOwner(teamId)
    ])
    if (!player) return next(Object.assign(new Error('No such player'), { status: 404 }))
    if (!dest) return next(Object.assign(new Error('No such team'), { status: 404 }))
    assertClubAccess(req, dest.clubName)

    // A player at a real club is a transfer, not an attach — refuse rather than
    // quietly taking them, which is what the old modal did for superadmins while
    // telling the user an email had been sent.
    if (player.teamClubId && Number(player.teamClubId) !== Roster.NO_CLUB_ID) {
      throw badRequest(
        player.name + ' is registered to ' + player.clubName +
        '. Request a transfer instead.'
      )
    }

    const placed = await Roster.addToTeam(playerId, teamId, section)
    res.json({ ok: true, attached: { playerId: playerId, name: player.name }, placed: placed })
  } catch (err) {
    next(err)
  }
}

// POST /api/transfers — ask the results secretary for a player at another club.
//
// The old UI claimed "an email has been sent to request a transfer" and sent
// nothing. This actually sends it, and reports honestly if the mail fails: the
// request either reached a human or it didn't, and the captain needs to know
// which.
exports.api_transfer_request = async function(req, res, next) {
  try {
    const clubName = req.params.club
    assertClubAccess(req, clubName)
    const playerId = parseId(req.body && req.body.playerId, 'playerId')
    const teamId = parseId(req.body && req.body.teamId, 'teamId')

    const [player, dest] = await Promise.all([
      Roster.getPlayerOwner(playerId),
      Roster.getTeamOwner(teamId)
    ])
    if (!player) return next(Object.assign(new Error('No such player'), { status: 404 }))
    if (!dest) return next(Object.assign(new Error('No such team'), { status: 404 }))
    assertClubAccess(req, dest.clubName)

    const requester = (req.user && (req.user.displayName || req.user.email)) || 'a club admin'
    const requesterEmail = req.user && req.user.email

    // A superadmin asking for a transfer is the person who approves them, so do it
    // rather than emailing themselves about it.
    if (isSuperAdmin(req)) {
      const moved = await Roster.movePlayer(playerId, teamId, 'reserve')
      return res.json({
        ok: true,
        applied: true,
        message: player.name + ' transferred from ' + (player.clubName || 'no club') +
          ' to ' + dest.name,
        moved: moved
      })
    }

    const html =
      '<p><strong>' + escapeHtml(requester) + '</strong> at <strong>' + escapeHtml(clubName) +
      '</strong> has requested a transfer.</p>' +
      '<ul>' +
      '<li>Player: <strong>' + escapeHtml(player.name) + '</strong> (id ' + player.id + ')</li>' +
      '<li>Currently at: ' + escapeHtml(player.clubName || 'no club') +
      (player.teamName ? ' — ' + escapeHtml(player.teamName) : '') + '</li>' +
      '<li>Requested for: ' + escapeHtml(dest.name) + ' (' + escapeHtml(dest.clubName) + ')</li>' +
      '</ul>' +
      '<p>Approve it on the club\'s team management page.</p>'

    await sesUtil.sendEmail({
      Destination: { ToAddresses: [RESULTS_SECRETARY] },
      Message: {
        Body: { Html: { Charset: 'UTF-8', Data: html } },
        Subject: {
          Charset: 'UTF-8',
          Data: 'Transfer request: ' + player.name + ' → ' + dest.name
        }
      },
      Source: MAIL_SOURCE,
      ReplyToAddresses: requesterEmail ? [MAIL_SOURCE, requesterEmail] : [MAIL_SOURCE]
    })

    res.json({
      ok: true,
      applied: false,
      message: 'Transfer request for ' + player.name + ' sent to the results secretary.'
    })
  } catch (err) {
    next(err)
  }
}
