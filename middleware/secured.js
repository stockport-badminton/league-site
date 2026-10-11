module.exports = function secured(req, res, next) {
  // Allow access if authenticated OR if dev mode is enabled (non-production only)
  const isDevMode = process.env.DEV_MODE === 'true' && process.env.NODE_ENV !== 'production';
  if (req.isAuthenticated() || isDevMode) { return next(); }

  // An /api/ caller is fetch() or $.ajax, not a person, so a redirect does nothing
  // useful for it. The fetch followed it to /login and on to Auth0, which is
  // cross-origin, and failed there with a bare network error — so the roster
  // editor's "session expired" message was unreachable and a lapsed login read as
  // "Save failed". It also left the API URL as returnTo, sending the user to a page
  // of JSON once they did log in. Answer the way routes/index.js answers every other
  // /api/ error. Found by Tameside porting the roster editor (Oct 2026).
  if (String(req.originalUrl || '').startsWith('/api/')) {
    res.set('Cache-Control', 'private, no-store');
    return res.status(401).json({ ok: false, error: 'Your login has expired. Reload the page to log in again.' });
  }

  const returnTo = req.query.state || req.originalUrl;
  req.session.returnTo = returnTo;
  res.redirect('/login?returnTo=' + encodeURIComponent(returnTo));
};
