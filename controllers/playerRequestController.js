// Player registration requests that arrived by email.
//
// Registrations come in as email, from club secretaries, captains and the players
// themselves, often several to a message, and they were handled by reading each name out
// and typing it into the roster editor. Now:
//
//   forward the email to registrations@stockport-badminton.co.uk
//     -> SES inbound -> POST /mail -> queueFromEmail() below
//     -> GET /admin/player-requests: the email beside the names read out of it, each
//        already matched against the players on file, one button per person
//
// Nothing is applied from the email itself. The page's buttons call the roster API the
// club pages use (/api/roster/club-:club/players and /transfer), so there is still one
// way to create or move a player, with one set of checks, and this file only records
// which button was pressed for whom.
//
//   GET  /admin/player-requests                     pending (or ?status=done|dismissed)
//   GET  /admin/player-requests/:id                 one email, worked through
//   GET  /admin/player-requests/match?q=&gender=    re-match an edited name
//   POST /admin/player-requests/:id/candidates/:i   record the outcome for one person
//   POST /admin/player-requests/:id/candidates      add a person the reading missed
//   POST /admin/player-requests/:id/status          done / dismissed / reopen

const Requests = require('../models/registrationRequest')
const Roster = require('../models/roster')
const { parseRegistrationEmail } = require('../utils/registrationEmail')
const { userLabel } = require('../utils/sessionUser')
const { canonicalFor } = require('../utils/canonical')

const ADDRESS = 'registrations@stockport-badminton.co.uk'
exports.ADDRESS = ADDRESS

function badRequest(message) {
  return Object.assign(new Error(message), { status: 400 })
}
function notFound(message) {
  return Object.assign(new Error(message), { status: 404 })
}
function parseIndex(value, label) {
  const s = String(value == null ? '' : value)
  if (!/^[0-9]{1,6}$/.test(s)) throw badRequest(label + ' must be a non-negative integer')
  return Number(s)
}

// ---------------------------------------------------------------------------
// Inbound
// ---------------------------------------------------------------------------

// Who may put an email in the queue: comma-separated addresses, compared lower-case.
// **Unset closes the path**, like every token in this app: mail to the address is then
// forwarded exactly as it was before this existed, so nothing is lost and nothing is
// queued. The queue is only ever read by a superadmin and nothing in it is applied
// automatically, so the risk this guards is noise rather than harm — but an address
// anyone can fill is an address somebody will.
function allowedSenders() {
  return String(process.env.REGISTRATION_INBOX_SENDERS || '')
    .split(',').map(s => s.trim().toLowerCase()).filter(s => s.includes('@'))
}

// The From header proves nothing by itself, so SES's own verdicts must agree that it is
// genuine. DKIM or SPF passing is what Gmail and Outlook both give a real forward; a
// DMARC FAIL means the From was forged, whatever else passed.
function authenticated(receipt) {
  const v = k => receipt && receipt[k] && receipt[k].status
  if (v('dmarcVerdict') === 'FAIL') return false
  return v('dkimVerdict') === 'PASS' || v('spfVerdict') === 'PASS'
}

// Called by contactusController.distribution_list for mail addressed to ADDRESS.
// Returns { queued: id|null, reason } and never throws for a refusal: the caller falls
// back to forwarding, so a message that cannot be queued still reaches a person.
exports.queueFromEmail = async function(parsedEmail, notification) {
  const from = (parsedEmail.from && parsedEmail.from.value && parsedEmail.from.value[0]) || {}
  const address = String(from.address || '').toLowerCase()
  const allowed = allowedSenders()
  if (!allowed.length) return { queued: null, reason: 'REGISTRATION_INBOX_SENDERS is unset' }
  if (!allowed.includes(address)) return { queued: null, reason: 'sender not allowed: ' + address }
  if (!authenticated(notification && notification.receipt)) {
    return { queued: null, reason: 'sender not authenticated (SPF/DKIM/DMARC)' }
  }

  const teams = await Requests.registrableTeams(Roster.NO_CLUB_ID)
  const text = parsedEmail.text || ''
  const parsed = parseRegistrationEmail({
    text: text,
    headerFrom: parsedEmail.from && parsedEmail.from.text,
    teamNames: teams.map(t => t.name)
  })
  const candidates = parsed.candidates.map(c => ({
    first: c.first, family: c.family, gender: c.gender, team: c.team, raw: c.raw,
    outcome: null, playerId: null
  }))

  // The mail's own Message-ID, falling back to SES's, so a redelivery is recognised.
  const messageId = parsedEmail.messageId || (notification && notification.mail && notification.mail.messageId)
  if (!messageId) return { queued: null, reason: 'no message id' }

  const id = await Requests.create({
    messageId: messageId,
    forwardedBy: parsedEmail.from && parsedEmail.from.text,
    originalFrom: parsed.originalFrom,
    subject: parsedEmail.subject || '',
    bodyText: text,
    // Names only. An attached spreadsheet or registration form is not read here — the
    // page says it exists, so it is opened from the original email rather than missed.
    attachments: (parsedEmail.attachments || [])
      .filter(a => a.contentDisposition !== 'inline')
      .map(a => a.filename || '(unnamed attachment)'),
    candidates: candidates
  })
  // Already queued is still success: SNS delivered the same message twice.
  return { queued: id, duplicate: id === null, reason: id === null ? 'already queued' : 'queued' }
}

// ---------------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------------

const STATUSES = ['pending', 'done', 'dismissed']

function summarise(candidates) {
  const list = Array.isArray(candidates) ? candidates : []
  return { total: list.length, handled: list.filter(c => c && c.outcome).length }
}

exports.list_page = async function(req, res, next) {
  try {
    const status = STATUSES.includes(req.query.status) ? req.query.status : 'pending'
    const rows = await Requests.list(status)
    res.render('admin/player-requests', {
      static_path: '/static',
      pageTitle: 'Player registration requests',
      pageDescription: 'Registration emails waiting to be processed',
      canonical: canonicalFor(req),
      status: status,
      requests: rows.map(r => Object.assign({}, r, summarise(r.candidates))),
      address: ADDRESS,
      configured: allowedSenders().length > 0
    })
  } catch (err) {
    next(err)
  }
}

exports.detail_page = async function(req, res, next) {
  try {
    const id = parseIndex(req.params.id, 'id')
    const request = await Requests.getById(id)
    if (!request) return next(notFound('No such request'))
    const [teams, table] = await Promise.all([
      Requests.registrableTeams(Roster.NO_CLUB_ID),
      Roster.allForMatching()
    ])
    // One read of the player table, matched per person, so the page arrives with every
    // "is this someone we already have?" answered.
    const candidates = (request.candidates || []).map(c => {
      const found = Roster.splitCandidates(table, c.first + ' ' + c.family, null)
      return Object.assign({}, c, { matches: flatten(found, c.gender) })
    })
    res.render('admin/player-request', {
      static_path: '/static',
      pageTitle: 'Registration request',
      pageDescription: 'Work through one registration email',
      canonical: canonicalFor(req),
      request: request,
      candidates: candidates,
      teams: teams,
      clubs: [...new Set(teams.map(t => t.clubName))]
    })
  } catch (err) {
    next(err)
  }
}

// Best matches first regardless of where the player is; `where` tells the page what
// the action means. Gender filters only when it is known — an email that did not say is
// exactly when the other-gender namesake is worth seeing.
function flatten(found, gender) {
  const tag = where => p => Object.assign({ where: where }, p)
  return [].concat(found.unattached.map(tag('unattached')), found.otherClubs.map(tag('club')))
    .filter(p => !gender || p.gender === gender)
    .sort((a, b) => rank(a.match) - rank(b.match))
    .slice(0, 6)
}
function rank(kind) {
  return kind === 'exact' ? 0 : kind === 'contains' ? 1 : 2
}

exports.api_match = async function(req, res, next) {
  try {
    const q = String(req.query.q || '').trim()
    if (q.length < 2) return res.json({ matches: [] })
    const gender = req.query.gender === 'Male' || req.query.gender === 'Female' ? req.query.gender : null
    const found = Roster.splitCandidates(await Roster.allForMatching(), q, null)
    res.json({ matches: flatten(found, gender) })
  } catch (err) {
    next(err)
  }
}

// The page sends the whole edited candidate, having already done the roster write.
function cleanCandidate(body) {
  const b = body || {}
  const str = (v, max) => String(v == null ? '' : v).trim().slice(0, max)
  const outcome = b.outcome == null || b.outcome === '' ? null : String(b.outcome)
  if (outcome !== null && !Requests.OUTCOMES.includes(outcome)) {
    throw badRequest('outcome must be one of ' + Requests.OUTCOMES.join(', '))
  }
  const playerId = b.playerId == null || b.playerId === '' ? null : Number(b.playerId)
  if (playerId !== null && !(Number.isInteger(playerId) && playerId > 0)) throw badRequest('playerId must be a positive integer')
  const first = str(b.first, 60)
  const family = str(b.family, 60)
  if (!first || !family) throw badRequest('Both a first name and a family name are needed')
  return {
    first: first,
    family: family,
    gender: b.gender === 'Male' || b.gender === 'Female' ? b.gender : null,
    team: str(b.team, 80) || null,
    raw: str(b.raw, 200),
    outcome: outcome,
    playerId: playerId
  }
}

exports.api_set_candidate = async function(req, res, next) {
  try {
    const id = parseIndex(req.params.id, 'id')
    const index = parseIndex(req.params.index, 'index')
    const candidates = await Requests.setCandidate(id, index, cleanCandidate(req.body))
    if (!candidates) return next(notFound('No such request or person'))
    res.json({ ok: true, candidates: candidates, summary: summarise(candidates) })
  } catch (err) {
    next(err)
  }
}

exports.api_add_candidate = async function(req, res, next) {
  try {
    const id = parseIndex(req.params.id, 'id')
    const candidate = cleanCandidate(Object.assign({}, req.body, { outcome: null, playerId: null, raw: 'added by hand' }))
    const candidates = await Requests.appendCandidate(id, candidate)
    if (!candidates) return next(notFound('No such request'))
    res.json({ ok: true, index: candidates.length - 1, candidates: candidates })
  } catch (err) {
    next(err)
  }
}

exports.set_status = async function(req, res, next) {
  try {
    const id = parseIndex(req.params.id, 'id')
    const status = String((req.body && req.body.status) || '')
    if (!STATUSES.includes(status)) throw badRequest('status must be one of ' + STATUSES.join(', '))
    const ok = await Requests.setStatus(id, status, userLabel(req.user))
    if (!ok) return next(notFound('No such request'))
    // Back to the queue once something is closed; back to the request when reopened.
    res.redirect(status === 'pending' ? '/admin/player-requests/' + id : '/admin/player-requests')
  } catch (err) {
    next(err)
  }
}
