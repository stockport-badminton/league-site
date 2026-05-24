module.exports = function secured(req, res, next) {
  // Allow access if authenticated OR if dev mode is enabled (non-production only)
  const isDevMode = process.env.DEV_MODE === 'true' && process.env.NODE_ENV !== 'production';
  if (req.isAuthenticated() || isDevMode) { return next(); }
  const returnTo = req.query.state || req.originalUrl;
  req.session.returnTo = returnTo;
  res.redirect('/login?returnTo=' + encodeURIComponent(returnTo));
};
