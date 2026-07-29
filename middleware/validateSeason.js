// 404 a season the site cannot serve, instead of letting it reach SQL.
//
// /tables/All/20252027 asked for a season that does not exist. The season is
// interpolated into the query as a table-name suffix, so it came back as
// `relation "team20252027" does not exist` and the page 500'd (Sentry NODE-Q, 9
// events). A season we have no data for is a missing page, not a server fault.
//
// This is the user-facing half. The security half lives in the models —
// season.assertName() is called at every interpolation site, because /results/*,
// /player-stats/* and /pair-stats/* carry the season inside a path splat rather
// than a named param, so no route-level guard can see it. See models/season.js.

const seasonModel = require('../models/season');

module.exports = function validateSeason(req, res, next) {
  if (seasonModel.isServable(req.params.season)) return next();

  return res.status(404).render('404-error', {
    static_path: '/static',
    theme: process.env.THEME || 'flatly',
    pageTitle: "Can't find the page you're looking for",
    pageDescription: 'HTTP 404 Error',
    canonical: ('https://' + req.get('host') + req.originalUrl)
      .replace('www.', '').replace('.com', '.co.uk').replace('-badders.herokuapp', '-badminton'),
  });
};
