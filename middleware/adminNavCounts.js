// res.locals.navPendingRequests — the badge on "Registration Requests" in a
// superadmin's Admin dropdown (views/nav.ejs).
//
// One indexed count per page a superadmin loads, and nobody else pays anything. Only for
// GETs, since nothing else renders the nav. A failure leaves the badge off: the nav is on
// every page, and a count is not worth an error page.
const Requests = require('../models/registrationRequest')
const { isSuperAdmin } = require('./requireClubAccess')

module.exports = async function adminNavCounts(req, res, next) {
  if (!isSuperAdmin(req) || req.method !== 'GET' || req.path.startsWith('/api/')) return next()
  try {
    res.locals.navPendingRequests = await Requests.countPending()
  } catch (err) {
    res.locals.navPendingRequests = null
  }
  next()
}
