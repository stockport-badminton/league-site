// /club-officers: a club's club secretary and match secretary manage their own club's
// officers — who holds each office, and the officers' contact details. The superadmin can
// use it for any club. Writes are in models/clubOfficers.js; who may use it is
// middleware/requireClubSecretary.js (access.clubSecretary).
const ClubOfficers = require('../models/clubOfficers')
const Club = require('../models/club')
const { isSuperAdmin } = require('../middleware/requireClubAccess')
const { userEmail } = require('../utils/sessionUser')
const { canonicalFor } = require('../utils/canonical')
const log = require('../utils/log')

const ROLES = {
  clubSecretary: { column: 'clubSecretary', label: 'Club secretary' },
  matchSecretary: { column: 'matchSecrertary', label: 'Match secretary' },
}
const SAVED = {
  contact: 'Contact details saved.',
  secretary: 'Secretaries updated.',
  captain: 'Captain updated.',
}

const EMAIL = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/
const TEL = /^[0-9+()\-. ]{6,30}$/

function badRequest(message) {
  const err = new Error(message)
  err.status = 400
  return err
}
const intOrNull = v => (/^\d+$/.test(String(v)) ? Number(v) : null)
const by = req => (req.secretaryOf ? { byPlayer: req.secretaryOf.playerId } : { by: 'superadmin' })

// GET /club-officers — send a secretary to their club; tell anyone else what the page is.
exports.index = async function(req, res, next) {
  try {
    let clubs
    if (isSuperAdmin(req)) {
      clubs = (await Club.getAll()).map(c => ({ clubId: c.id, clubName: c.name }))
    } else {
      const email = req.user && req.user._json && req.user._json.email_verified === false ? null : userEmail(req.user)
      clubs = await ClubOfficers.secretaryClubs(email)
      if (clubs.length === 1) return res.redirect(`/club-officers/${clubs[0].clubId}`)
    }
    res.render('club-officers-index', {
      static_path: '/static',
      pageTitle: 'Club officers',
      pageDescription: 'Manage your club\'s officers and their contact details',
      canonical: canonicalFor(req),
      clubs: [...new Map(clubs.map(c => [c.clubId, c])).values()],
      superadmin: isSuperAdmin(req),
    })
  } catch (err) {
    next(err)
  }
}

async function render(req, res, clubId, extra = {}) {
  const data = await ClubOfficers.getClubOfficers(clubId)
  if (!data) {
    const err = new Error('No such club')
    err.status = 404
    throw err
  }
  const { club, teams, players } = data
  const atClub = players.filter(p => p.clubId === club.id)
  const teamIds = new Set(teams.map(t => t.id))
  const youId = req.secretaryOf ? req.secretaryOf.playerId : null

  // Each officer once, with every office they hold, you first.
  const officers = players.filter(p =>
    (p.clubId === club.id && (p.clubSecretary || p.matchSecretary)) || (p.teamCaptain && teamIds.has(p.teamId)))
    .map(p => ({
      ...p,
      you: p.id === youId,
      offices: [
        p.clubId === club.id && p.clubSecretary && 'Club secretary',
        p.clubId === club.id && p.matchSecretary && 'Match secretary',
        p.teamCaptain && teamIds.has(p.teamId) && `${(teams.find(t => t.id === p.teamId) || {}).name} captain`,
      ].filter(Boolean),
    }))
    .sort((a, b) => Number(b.you) - Number(a.you) || a.name.localeCompare(b.name))

  res.status(extra.error ? 400 : 200).render('club-officers', {
    static_path: '/static',
    pageTitle: `${club.name} officers`,
    pageDescription: `Officers and contact details for ${club.name}`,
    canonical: canonicalFor(req),
    club,
    youId,
    superadmin: isSuperAdmin(req),
    roles: Object.entries(ROLES).map(([key, r]) => ({
      key, label: r.label,
      holders: atClub.filter(p => p[key]),
      candidates: atClub.filter(p => !p[key]),
    })),
    teams: teams.map(t => ({
      ...t,
      captain: players.find(p => p.teamId === t.id && p.teamCaptain) || null,
      members: players.filter(p => p.teamId === t.id),
    })),
    officers,
    saved: SAVED[String(req.query.saved)] || null,
    error: extra.error || null,
    data: extra.data || {},
  })
}

// GET /club-officers/:clubId
exports.page = async function(req, res, next) {
  try {
    await render(req, res, Number(req.params.clubId))
  } catch (err) {
    next(err)
  }
}

// POST /club-officers/:clubId/contact { playerId, email, tel }
exports.contact = async function(req, res, next) {
  const clubId = Number(req.params.clubId)
  try {
    const playerId = intOrNull(req.body.playerId)
    const email = String(req.body.email || '').trim()
    const tel = String(req.body.tel || '').trim()
    if (playerId === null) throw badRequest('No player given')
    let error = null
    if (email && (email.length > 254 || !EMAIL.test(email))) error = `"${email.slice(0, 100)}" is not an email address.`
    else if (tel && !TEL.test(tel)) error = `"${tel.slice(0, 40)}" is not a phone number: digits, spaces and + ( ) - only.`
    if (error) return await render(req, res, clubId, { error, data: { playerId, email, tel } })
    const n = await ClubOfficers.setContact(clubId, playerId, { email: email || null, tel: tel || null })
    if (!n) throw badRequest("That player isn't one of this club's officers")
    log.info({ clubId, playerId, ...by(req) }, 'club-officers: contact details changed')
    res.redirect(`/club-officers/${clubId}?saved=contact#officer-${playerId}`)
  } catch (err) {
    next(err)
  }
}

// POST /club-officers/:clubId/secretary { role, playerId, action: add|remove }
exports.secretary = async function(req, res, next) {
  const clubId = Number(req.params.clubId)
  try {
    const role = ROLES[String(req.body.role)]
    const playerId = intOrNull(req.body.playerId)
    const action = String(req.body.action)
    if (!role || playerId === null || !['add', 'remove'].includes(action)) throw badRequest('Choose a role and a player')
    const n = await ClubOfficers.setSecretary(clubId, playerId, /** @type {any} */ (role.column), action === 'add')
    if (!n) throw badRequest("That player isn't at this club")
    log.info({ clubId, playerId, role: role.column, action, ...by(req) }, 'club-officers: secretary changed')
    // Someone who has just removed their own office can no longer see the page.
    if (action === 'remove' && req.secretaryOf && req.secretaryOf.playerId === playerId) {
      const still = (await ClubOfficers.secretaryClubs(userEmail(req.user))).some(c => c.clubId === clubId)
      if (!still) return res.redirect('/club-officers')
    }
    res.redirect(`/club-officers/${clubId}?saved=secretary#secretaries`)
  } catch (err) {
    next(err)
  }
}

// POST /club-officers/:clubId/captain { teamId, playerId } — playerId '' for no captain.
exports.captain = async function(req, res, next) {
  const clubId = Number(req.params.clubId)
  try {
    const teamId = intOrNull(req.body.teamId)
    const playerId = req.body.playerId === '' ? null : intOrNull(req.body.playerId)
    if (teamId === null || (req.body.playerId !== '' && playerId === null)) throw badRequest('Choose a team and a player')
    const ok = await ClubOfficers.setCaptain(clubId, teamId, playerId)
    if (!ok) throw badRequest("That team isn't this club's, or that player isn't on it")
    log.info({ clubId, teamId, playerId, ...by(req) }, 'club-officers: captain changed')
    res.redirect(`/club-officers/${clubId}?saved=captain#team-${teamId}`)
  } catch (err) {
    next(err)
  }
}
