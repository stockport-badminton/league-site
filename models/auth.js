const axios = require('axios');
const ses = require('../utils/ses');
const Player = require('./players');
const { isSuperAdmin } = require('../utils/authz');

exports.getManagementAPIKey = async function() {
  const response = await axios.post(`https://${process.env.AUTH0_DOMAIN}/oauth/token`, {
    client_id: process.env.AUTH0_CLIENTID,
    client_secret: process.env.AUTH0_CLIENT_SECRET,
    audience: 'https://stockport-badminton.eu.auth0.com/api/v2/',
    grant_type: 'client_credentials'
  })
  if (!response.data.access_token) throw new Error('token fail')
  return response.data.access_token
}

exports.getAPIKey = async function() {
  const response = await axios.post(`https://${process.env.AUTH0_DOMAIN}/oauth/token`, {
    client_id: process.env.AUTH0_CLIENTID,
    client_secret: process.env.AUTH0_CLIENT_SECRET,
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
    'https://' + process.env.AUTH0_DOMAIN + '/api/v2/users?q=user_id:' + userId + '&fields=email,nickname,name',
    { headers: { Authorization: 'Bearer ' + apiKey } }
  )
  return response.data[0]
}

function canonicalFor(req) {
  return ('https://' + req.get('host') + req.originalUrl).replace("www.'", '').replace('.com', '.co.uk').replace('-badders.herokuapp', '-badminton')
}

// GET: pure display, no side effects (the old flow PATCHed Auth0 and sent an
// email on GET, which meant email-client link-prefetching could silently
// double-fire both). Shows who signed up and lets a superadmin search for the
// player row to link them to before anything is written.
exports.approve_signup_get = async function(req, res, next) {
  try {
    if (!isSuperAdmin(req)) return res.status(403).send('Forbidden')
    const user = await module.exports.getUserByAuthId(req.params.userId)
    if (!user) return next('No matching Auth0 user found')
    const existingLink = await Player.getAuthRoleByEmail(user.email)

    res.render('approve-signup', {
      static_path: '/static',
      theme: process.env.THEME || 'flatly',
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
    if (!isSuperAdmin(req)) return res.status(403).send('Forbidden')
    const user = await module.exports.getUserByAuthId(req.params.userId)
    if (!user) return next('No matching Auth0 user found')

    // Gates real login access via a separate Auth0 Action — keep as-is.
    const apiKey = await module.exports.getManagementAPIKey()
    await axios.patch(
      `https://${process.env.AUTH0_DOMAIN}/api/v2/users/${req.params.userId}`,
      { app_metadata: { betaAccess: true } },
      { headers: { Authorization: `Bearer ${apiKey}` } }
    )

    await Player.setAuthRole(req.body.playerId, {
      role: req.body.role || null,
      messerAdmin: req.body.messerAdmin === '1',
      authEmail: user.email
    })

    await ses.sendEmail({
      Destination: {
        ToAddresses: [user.email],
        BccAddresses: ['bigcoops@outlook.com', 'bigcoops@gmail.com', 'stockport.badders.results@gmail.com']
      },
      Message: {
        Body: {
          Html: {
            Charset: 'UTF-8',
            Data: '<p>Thanks for registering - i\'ve approved your access</p>'
          }
        },
        Subject: {
          Charset: 'UTF-8',
          Data: 'Results Entry Access'
        }
      },
      Source: 'results@stockport-badminton.co.uk',
      ReplyToAddresses: ['stockport.badders.results@gmail.com']
    })

    res.render('contact-us-form-delivered', {
      static_path: '/static',
      theme: process.env.THEME || 'flatly',
      flask_debug: process.env.FLASK_DEBUG || 'false',
      pageTitle: 'Signup Approved',
      pageDescription: 'Signup Approved',
      message: `Approved ${user.email} — linked to player #${req.body.playerId} as ${req.body.role || 'no special role'}.`,
      canonical: canonicalFor(req)
    })
  } catch (err) {
    next(err)
  }
}
