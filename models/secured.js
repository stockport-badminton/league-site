module.exports = function() {
  return function secured (req, res, next) {
    console.log(req.user);
    if (req.user) { return next(); }
    req.session.returnTo = req.originalUrl;
    res.redirect('/login');
  };
};

module.exports = function() {
  return function restrictResults (req, res, next) {
    // console.log(req);
    if (req.user.app_metadata.betaAccess) { return next(); }
    req.session.returnTo = req.originalUrl;
    res.redirect('/login');
  };
};
