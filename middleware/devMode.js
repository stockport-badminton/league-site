// Development mode middleware - bypasses auth gates locally
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
        'https://my-app.example.com/messeradmin': true
      }
    };
  }
  next();
};
