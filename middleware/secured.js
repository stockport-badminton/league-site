module.exports = function secured(req, res, next) {
  if (req.isAuthenticated()) { return next(); }
  const returnTo = req.query.state || req.originalUrl;
  req.session.returnTo = returnTo;
  res.redirect('/login?returnTo=' + encodeURIComponent(returnTo));
};
