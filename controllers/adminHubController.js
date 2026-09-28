// GET /admin — every superadmin tool on one page, grouped (utils/adminTools.js).
//
// Exists because the Admin dropdown outgrew the window: see utils/adminTools.js. The
// counts on the cards are the reason to open this page rather than just a longer menu,
// and each is independent — a count that fails to load shows as nothing, never as a
// broken page, because the page's first job is to be a list of links.

const { GROUPS } = require('../utils/adminTools')
const Requests = require('../models/registrationRequest')
const Registration = require('../models/clubRegistration')
const seasonModel = require('../models/season')
const { canonicalFor } = require('../utils/canonical')
const Sentry = require('@sentry/node')

async function safely(label, fn) {
  try {
    return await fn()
  } catch (err) {
    Sentry.captureException(err, { tags: { step: 'admin hub count: ' + label } })
    return null
  }
}

exports.hub = async function(req, res, next) {
  try {
    const [pendingRequests, formsOutstanding] = await Promise.all([
      safely('pendingRequests', () => Requests.countPending()),
      safely('formsOutstanding', async () =>
        (await Registration.getStatus(seasonModel.current())).filter(c => !c.received).length),
    ])
    res.render('admin/hub', {
      static_path: '/static',
      pageTitle: 'Admin',
      pageDescription: 'Every league admin tool',
      canonical: canonicalFor(req),
      groups: GROUPS,
      counts: { pendingRequests, formsOutstanding },
    })
  } catch (err) {
    next(err)
  }
}
