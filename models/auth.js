const config = require('../config');
const axios = require('axios');
const ses = require('../utils/ses');
const mailer = require('../utils/mailer');
const Player = require('./players');
const { isSuperAdmin } = require('../utils/authz');
const { canonicalFor, absoluteUrl } = require('../utils/canonical');

exports.getManagementAPIKey = async function() {
  const response = await axios.post(`https://${config.AUTH0_DOMAIN}/oauth/token`, {
    client_id: config.AUTH0_CLIENTID,
    client_secret: config.AUTH0_CLIENT_SECRET,
    audience: 'https://stockport-badminton.eu.auth0.com/api/v2/',
    grant_type: 'client_credentials'
  })
  if (!response.data.access_token) throw new Error('token fail')
  return response.data.access_token
}

exports.getAPIKey = async function() {
  const response = await axios.post(`https://${config.AUTH0_DOMAIN}/oauth/token`, {
    client_id: config.AUTH0_CLIENTID,
    client_secret: config.AUTH0_CLIENT_SECRET,
    audience: 'http://stockport-badminton.co.uk',
    grant_type: 'client_credentials'
  })
  if (!response.data.access_token) throw new Error('token fail')
  return response.data.access_token
}

// Read-only Auth0 Management API lookup by user_id — same proven pattern as
// controllers/scorecardController.js's email_scorecard (q=user_id:... as a
// query value, not a path segment, sidesteps needing to URL-encode the `|`
// in "auth0|..."/"google-oauth2|..." ids).
exports.getUserByAuthId = async function(userId) {
  const apiKey = await module.exports.getManagementAPIKey()
  const response = await axios.get(
    'https://' + config.AUTH0_DOMAIN + '/api/v2/users?q=user_id:' + userId + '&fields=email,nickname,name',
    { headers: { Authorization: 'Bearer ' + apiKey } }
  )
  return response.data[0]
}

// Every account in the tenant, for the monthly login cull (controllers/authCullController.js).
// The tenant is SHARED with the Tameside league site, so most of what comes back may be
// theirs; utils/authCull.js decides which accounts are ours. A page of the Management API is
// at most 100, and it serves at most 1000 in all, which is ten times what the tenant holds.
exports.listUsers = async function() {
  const apiKey = await module.exports.getManagementAPIKey()
  const out = []
  for (let page = 0; page < 10; page++) {
    const response = await axios.get(`https://${config.AUTH0_DOMAIN}/api/v2/users`, {
      params: { per_page: 100, page, include_fields: true,
        fields: 'user_id,email,name,app_metadata,last_login,created_at' },
      headers: { Authorization: 'Bearer ' + apiKey },
    })
    const batch = response.data
    if (!Array.isArray(batch)) throw new Error('Auth0 user list failed: ' + JSON.stringify(batch).slice(0, 300))
    out.push(...batch)
    if (batch.length < 100) return out
  }
  throw new Error('Auth0 user list has more than 1000 accounts; page it with the search API')
}

// Delete an account from the SHARED tenant: it is gone from Tameside's site too. Only the
// login cull calls this. The id goes in the path (DELETE has no query form), so
// encodeURIComponent covers the `|` in "auth0|...".
//
// The Management API rate-limits, so a 429 waits and tries again. 404 means already gone,
// which is the outcome wanted. Anything else throws.
exports.deleteUser = async function(userId, { apiKey, sleep = ms => new Promise(r => setTimeout(r, ms)) } = {}) {
  apiKey = apiKey || await module.exports.getManagementAPIKey()
  for (let attempt = 0; attempt < 4; attempt++) {
    const response = await axios.delete(`https://${config.AUTH0_DOMAIN}/api/v2/users/${encodeURIComponent(userId)}`, {
      headers: { Authorization: 'Bearer ' + apiKey },
      validateStatus: () => true,
    })
    if (response.status === 204 || response.status === 404) return response.status === 204 ? 'deleted' : 'already gone'
    if (response.status !== 429) {
      throw new Error(`Auth0 delete of ${userId} failed: HTTP ${response.status} ${JSON.stringify(response.data).slice(0, 200)}`)
    }
    await sleep(1000 * (attempt + 1))
  }
  throw new Error(`Auth0 delete of ${userId} still rate-limited after 4 attempts`)
}

// GET: pure display, no side effects (the old flow PATCHed Auth0 and sent an
// email on GET, which meant email-client link-prefetching could silently
// double-fire both). Shows who signed up and lets a superadmin search for the
// player row to link them to before anything is written.
exports.approve_signup_get = async function(req, res, next) {
  try {
    const user = await module.exports.getUserByAuthId(req.params.userId)
    if (!user) return next('No matching Auth0 user found')
    const existingLink = await Player.getAuthRoleByEmail(user.email)

    res.render('approve-signup', {
      static_path: '/static',
      pageTitle: 'Approve New Signup',
      pageDescription: 'Approve a new signup and assign them to a player',
      userId: req.params.userId,
      authUser: user,
      existingLink: existingLink || null,
      canonical: canonicalFor(req)
    })
  } catch (err) {
    next(err)
  }
}

// POST: everything happens here — re-fetches the Auth0 user server-side
// rather than trusting the form body for anything except which player/role
// was chosen.
exports.approve_signup_post = async function(req, res, next) {
  try {
    const user = await module.exports.getUserByAuthId(req.params.userId)
    if (!user) return next('No matching Auth0 user found')

    // Gates real login access via a separate Auth0 Action — keep as-is.
    const apiKey = await module.exports.getManagementAPIKey()
    await axios.patch(
      `https://${config.AUTH0_DOMAIN}/api/v2/users/${req.params.userId}`,
      { app_metadata: { betaAccess: true } },
      { headers: { Authorization: `Bearer ${apiKey}` } }
    )

    await Player.setAuthRole(req.body.playerId, {
      role: req.body.role || null,
      messerAdmin: req.body.messerAdmin === '1',
      authEmail: user.email
    })

    await mailer.send({
      template: 'access-approved',
      to: user.email,
      bcc: ['bigcoops@outlook.com', 'bigcoops@gmail.com', 'stockport.badders.results@gmail.com'],
      replyTo: mailer.RESULTS_MAILBOX,
      subject: 'Results Entry Access',
      whyReceiving: 'You asked for access to enter results for your team on the league website.',
      text: [
        'Thanks for registering — your access has been approved, so you can now enter',
        "your team's results on the league website.",
        '',
        absoluteUrl('/scorecard-beta'),
      ].join('\n'),
      data: { submitUrl: absoluteUrl('/scorecard-beta') },
    })

    res.render('contact-us-form-delivered', {
      static_path: '/static',
      pageTitle: 'Signup Approved',
      pageDescription: 'Signup Approved',
      message: `Approved ${user.email} — linked to player #${req.body.playerId} as ${req.body.role || 'no special role'}.`,
      canonical: canonicalFor(req)
    })
  } catch (err) {
    next(err)
  }
}
