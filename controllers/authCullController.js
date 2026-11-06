// The monthly login cull (Nov 2026). Logins nobody uses are attack surface and noise.
// docs/login-cull.md is the whole story; in short:
//
//   1. POST /admin/login-cull/run (Cloud Scheduler, monthly) warns every Stockport login
//      unused for a year, and sends the results mailbox a summary. It deletes nothing.
//   2. The warned person keeps the login by logging in to either league's site, or with the
//      link in the warning: GET /keep-login/:token shows a button, the POST does it. A GET
//      that did it would be done by every mail scanner that prefetches links.
//   3. A month on, with no sign of life, the login is listed on /admin/login-cull. A
//      superadmin deletes it there: from Auth0, which is SHARED with Tameside's site, and as
//      any player's authEmail here. Nothing is deleted automatically, by decision (as on
//      Tameside): a club admin could otherwise vanish mid-season with nobody having looked.
//
// Which accounts are ours, and why, is in utils/authCull.js.
const crypto = require('crypto')
const config = require('../config')
const Auth = require('../models/auth')
const Player = require('../models/players')
const AuthCull = require('../models/authCull')
const mailer = require('../utils/mailer')
const requireCronCaller = require('../middleware/requireCronCaller')
const { tamesideLinkedAccounts } = require('../utils/externalLeagues')
const { classify, GRACE_DAYS } = require('../utils/authCull')
const { absoluteUrl, canonicalFor } = require('../utils/canonical')
const log = require('../utils/log')

// The audit's secret, as the team-strength jobs use: another of the league office's own
// scheduled jobs, and a second secret would be a second thing to rotate.
const requireCullCaller = requireCronCaller({
  envVar: 'AUDIT_CRON_TOKEN',
  header: 'x-audit-token',
  describe: 'the login cull',
  callerProp: 'cullCaller',
})

// Comfortably inside the 60s Firebase gives a request (gotcha 1bc), with a second between
// sends: Gmail objects to a burst from our domain (27 Aug 2026, the emails skill). The rest
// go next month.
const MAX_WARNINGS_PER_RUN = 40
const SEND_GAP_MS = 1000

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
// By hand, not toLocaleDateString: its answer depends on the ICU data in the running Node.
const ukDate = ms => { const d = new Date(ms); return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}` }

// A local server's mock superadmin (DEV_MODE) reaches the real, shared tenant through
// dev.env's Auth0 credentials. It must not email real people or delete their logins.
function refuseInDevMode() {
  if (config.DEV_MODE && config.NODE_ENV !== 'production') {
    throw new Error('The login cull does not run under DEV_MODE: the Auth0 tenant is the real one')
  }
}

async function buildCull({ now = Date.now() } = {}) {
  const [users, playersByEmail, tamesideLinked, notices] = await Promise.all([
    Auth.listUsers(),
    Player.getAuthEmailIndex(),
    tamesideLinkedAccounts(),
    AuthCull.getAll(),
  ])
  return classify(users, { playersByEmail, tamesideLinked }, notices, now)
}

const playerName = p => p ? `${p.first_name} ${p.family_name}`.replace(/\s+/g, ' ').trim() : null

async function warn(entry, now) {
  const token = crypto.randomBytes(24).toString('base64url')
  const firstName = entry.player ? String(entry.player.first_name).trim() : ''
  const lastActive = ukDate(Date.parse(entry.lastActive))
  const deadline = ukDate(now + GRACE_DAYS * 864e5)
  const keepUrl = absoluteUrl('/keep-login/' + token)
  await mailer.send({
    template: 'login-inactive',
    to: entry.account.email,
    replyTo: mailer.RESULTS_MAILBOX,
    subject: 'Do you still use your Stockport Badminton League login?',
    text: [
      `Hello${firstName ? ' ' + firstName : ''}.`,
      '',
      `Your login to the Stockport & District Badminton League website (${entry.account.email}) has not been used since ${lastActive}.`,
      `To keep it, log in to the site, or open this link and press the button, before ${deadline}:`,
      '',
      keepUrl,
      '',
      `If you do nothing, the login will be deleted after ${deadline}, from this site and from the Tameside league's (it is the same login). Your results stay: they are the league's record. You can sign up again at any time.`,
    ].join('\n'),
    whyReceiving: 'You are receiving this because you have a login to the Stockport & District Badminton League website.',
    data: { firstName, email: entry.account.email, lastActive, deadline, keepUrl },
  })
  // After the send, never before: a login recorded as warned that never got the email
  // would be listed for deletion a month later with nobody having told them.
  await AuthCull.recordNotice(entry.account.user_id, token)
}

exports.runCull = async function({ now = Date.now(), sleep = ms => new Promise(r => setTimeout(r, ms)) } = {}) {
  refuseInDevMode()
  const cull = await buildCull({ now })
  const warned = []
  const failed = []
  for (const [i, entry] of cull.notify.slice(0, MAX_WARNINGS_PER_RUN).entries()) {
    if (i) await sleep(SEND_GAP_MS)
    try {
      await warn(entry, now)
      warned.push({ name: playerName(entry.player) || '(no player)', email: entry.account.email })
    } catch (err) {
      log.error({ err, userId: entry.account.user_id }, '[login-cull] warning failed')
      failed.push(entry.account.user_id)
    }
  }
  const due = cull.due.length
  const deferred = Math.max(0, cull.notify.length - MAX_WARNINGS_PER_RUN)
  const reviewUrl = absoluteUrl('/admin/login-cull')

  // A quiet month sends nothing to the results mailbox.
  if (warned.length || failed.length || due) {
    await mailer.send({
      template: 'login-cull-digest',
      to: mailer.RESULTS_MAILBOX,
      subject: `Login cull: ${warned.length} warned, ${due} due for deletion`,
      text: [
        `${warned.length} login(s) unused for a year were warned today. ${due} are due for deletion.`,
        ...warned.map(w => `  ${w.name}: ${w.email}`),
        ...(failed.length ? ['', `${failed.length} warning(s) could not be sent; they will be tried again next month.`] : []),
        ...(deferred ? ['', `${deferred} more will be warned next month.`] : []),
        '',
        `Review: ${reviewUrl}`,
        'Nothing is deleted until you press Delete. Deleting removes the login from Tameside\'s site as well.',
      ].join('\n'),
      whyReceiving: "You are receiving this because you are the league's results secretary and the monthly login cull ran.",
      data: { warned, failed: failed.length, deferred, due, reviewUrl },
    })
  }
  const result = { warned: warned.length, failed: failed.length, deferred, waiting: cull.waiting.length, due }
  log.info(result, '[login-cull] run')
  return result
}

// POST /admin/login-cull/run — Cloud Scheduler monthly, or a superadmin.
exports.run = async function(req, res, next) {
  try {
    res.json(await exports.runCull())
  } catch (err) { next(err) }
}

// ---- The keep link. Public: the token is the credential. ----

function renderKeep(req, res, status, state) {
  // The page is per-token; never let the CDN hold it.
  res.set('Cache-Control', 'no-store')
  res.status(status).render('keep-login', {
    static_path: '/static',
    pageTitle: 'Keep your login',
    pageDescription: 'Keep your Stockport & District Badminton League login',
    state,
    canonical: canonicalFor(req),
  })
}

const tokenParam = req => String(req.params.token || '').slice(0, 100)

exports.keepGet = async function(req, res, next) {
  try {
    const row = await AuthCull.findByToken(tokenParam(req))
    renderKeep(req, res, row ? 200 : 404, row ? 'confirm' : 'invalid')
  } catch (err) { next(err) }
}

exports.keepPost = async function(req, res, next) {
  try {
    const row = await AuthCull.keepByToken(tokenParam(req))
    if (row) log.info({ userId: row.user_id }, '[login-cull] kept by link')
    renderKeep(req, res, row ? 200 : 404, row ? 'kept' : 'invalid')
  } catch (err) { next(err) }
}

// ---- Superadmin: /admin/login-cull. ----

exports.page = async function(req, res, next) {
  try {
    // The page says why it cannot list anything rather than failing: the commonest cause is
    // TAMESIDE_DATABASE_URL being unset, and that is worth reading, not a 500.
    let cull = null
    let cullError = null
    try {
      refuseInDevMode()
      cull = await buildCull()
    } catch (err) {
      log.error({ err }, '[login-cull] could not build the review list')
      cullError = err.message
    }
    res.render('admin/login-cull', {
      static_path: '/static',
      pageTitle: 'Login Cull',
      pageDescription: 'Logins unused for a year: warned, waiting, and due for deletion',
      cull,
      cullError,
      flash: req.query.done ? String(req.query.done).slice(0, 300) : null,
      canonical: canonicalFor(req),
    })
  } catch (err) { next(err) }
}

function back(res, message) {
  res.redirect(303, '/admin/login-cull?done=' + encodeURIComponent(message))
}

// Someone the results secretary knows is still about.
exports.adminKeep = async function(req, res, next) {
  try {
    refuseInDevMode()
    const users = await Auth.listUsers()
    const user = users.find(u => u.user_id === req.body.userId)
    if (!user) return res.status(404).send('No Auth0 account with that id')
    await AuthCull.keep(user.user_id)
    back(res, `Kept ${user.email || user.user_id} for another year.`)
  } catch (err) { next(err) }
}

// Deletes the accounts the page showed AND a fresh classification still says are due, so
// a login used since the page loaded, or one that became due without being looked at, is
// left alone. Each deletion goes Auth0 first: a login unlinked here but still in the tenant
// would be a login with no player, and the next run lists it again anyway.
exports.deleteDue = async function(req, res, next) {
  try {
    refuseInDevMode()
    const shown = new Set([].concat(req.body.userId || []).map(String))
    const cull = await buildCull()
    const targets = cull.due.filter(e => shown.has(e.account.user_id))
    const apiKey = targets.length ? await Auth.getManagementAPIKey() : null
    let deleted = 0
    for (const e of targets) {
      try {
        await Auth.deleteUser(e.account.user_id, { apiKey })
        if (e.account.email) await Player.clearAuthEmail(e.account.email)
        await AuthCull.remove(e.account.user_id)
        log.info({ userId: e.account.user_id }, '[login-cull] deleted')
        deleted++
      } catch (err) {
        log.error({ err, userId: e.account.user_id }, '[login-cull] delete failed')
        return back(res, `Deleted ${deleted}; stopped at ${e.account.email || e.account.user_id}: ${err.message}`)
      }
    }
    const skipped = shown.size - targets.length
    back(res, `Deleted ${deleted} ${deleted === 1 ? 'login' : 'logins'}.`
      + (skipped ? ` ${skipped} no longer due and left alone.` : ''))
  } catch (err) { next(err) }
}

exports.requireCullCaller = requireCullCaller
exports.buildCull = buildCull
exports.MAX_WARNINGS_PER_RUN = MAX_WARNINGS_PER_RUN
