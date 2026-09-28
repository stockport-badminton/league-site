// res.locals.navPendingRequests — the badge on "Registration Requests" in a
// superadmin's Admin dropdown (views/nav.ejs).
//
// One indexed count per page a superadmin loads, and nobody else pays anything. Only for
// GETs, since nothing else renders the nav. A failure leaves the badge off: the nav is on
// every page, and a count is not worth an error page.
const Requests = require('../models/registrationRequest')

const ROLE_CLAIM = 'https://my-app.example.com/role'

module.exports = async function adminNavCounts(req, res, next) {
  const role = req.user && req.user._json && req.user._json[ROLE_CLAIM]
  if (role !== 'superadmin' || req.method !== 'GET' || req.path.startsWith('/api/')) return next()
  try {
    res.locals.navPendingRequests = await Requests.countPending()
  } catch (err) {
    res.locals.navPendingRequests = null
  }
  next()
}
