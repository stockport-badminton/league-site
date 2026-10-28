// 404 a season the site cannot serve, instead of letting it reach SQL.
//
// /tables/All/20252027 asked for a season that does not exist. When the season was a
// table-name suffix that came back as `relation "team20252027" does not exist` and the
// page 500'd (Sentry NODE-Q, 9 events); since REARCH-02 it would be an empty page. A
// season we have no data for is a missing page either way, not a server fault.
//
// The models validate the season too (season.assertName), because /results/*,
// /player-stats/* and /pair-stats/* carry it inside a path splat rather than a named
// param, so no route-level guard can see it. See models/season.js.

const seasonModel = require('../models/season');
const { canonicalFor } = require('../utils/canonical');

module.exports = function validateSeason(req, res, next) {
  if (seasonModel.isServable(req.params.season)) return next();

  return res.status(404).render('404-error', {
    static_path: '/static',
    pageTitle: "Can't find the page you're looking for",
    pageDescription: 'HTTP 404 Error',
    // Not from req.get('host'): on Cloud Run that is the run.app hostname, and it is
    // whatever the client sends (gotcha 1b).
    canonical: canonicalFor(req),
  });
};
