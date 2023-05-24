const { session } = require("passport");

module.exports = function() {
  return function secured (req, res, next) {
    // console.log(session);
    req.session.returnTo = req.params.returnTo;
    if (req.user) { 
      // console.log(req.user);
      return next(); 
    }
    //req.session.returnTo = req.originalUrl;
    // console.log("middleware returnTo Value:" + req.session.returnTo);
    res.redirect('/login?returnTo='+req.session.returnTo);
  };
};
