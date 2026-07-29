// Development mode middleware - injects mock user locally
// SAFE: Only works if NODE_ENV is NOT production
module.exports = function devMode(req, res, next) {
  const isDevMode = process.env.DEV_MODE === 'true' && process.env.NODE_ENV !== 'production';

  if (isDevMode) {
    // Inject mock user for dev mode (LOCAL TESTING ONLY)
    req.user = req.user || {
      id: 'dev|local',
      displayName: 'Dev User',
      email: 'dev@local.test',
      _json: {
        'https://my-app.example.com/role': 'superadmin',
        // Mirrors what the Auth0 strategy in app.js actually sets for a superadmin:
        // the literal string 'All', not a club name. Without it the mock user was
        // missing a claim the real one always has, so nav links built from it looked
        // fine locally and were broken in production (Sentry NODE-S).
        'https://my-app.example.com/club': 'All',
        'https://my-app.example.com/messeradmin': true
      }
    };
  }
  next();
};
