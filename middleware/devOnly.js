// A route that exists for local development and nowhere else. Anywhere but a dev server
// it falls through to the ordinary 404, so production does not merely refuse the route —
// it does not have it.
//
// Same rule as secured.js and devMode.js: DEV_MODE set AND not production. Read per
// request rather than at require time, so a test can flip it.
//
// Why it exists (HARD-40): GET /messer-scorecard-beta/test renders a messer form
// prefilled with test data, with the dev debug panel forced on, and was reachable in
// production by any logged-in member — posting to the real messer submit.
module.exports = function devOnly(req, res, next) {
  const isDevMode = process.env.DEV_MODE === 'true' && process.env.NODE_ENV !== 'production';
  if (isDevMode) return next();
  return next('route');
};
