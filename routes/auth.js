// Logging in and out, and the signed-in user's profile page.
// Mounted by routes/index.js, in the order listed there (REARCH-04).
const express = require('express');
const router = express.Router();
const access = require('../middleware/access');

// Auth routes
router.get('/login', access.public, function(req, res, next) {
  var passport = require('passport');
  passport.authenticate('auth0', { scope: 'openid email profile' })(req, res, next);
});

router.get('/callback', access.public, function(req, res, next) {
  var passport = require('passport');
  passport.authenticate('auth0', function(err, user, info) {
    if (err) { return next(err); }
    if (!user) {
      res.render('failed-login', {
        static_path: '/static',
        theme: process.env.THEME || 'flatly',
        pageTitle: 'Access Denied',
        pageDescription: 'Access Denied',
        query: req.query,
        canonical: ('https://' + req.get('host') + req.originalUrl).replace('www.', '').replace('.com', '.co.uk').replace('-badders.herokuapp', '-badminton')
      });
    } else {
      var returnTo = req.session.returnTo || '/';
      delete req.session.returnTo;
      req.logIn(user, function(err) {
        if (err) { console.log(err); return next(err); }
        res.redirect(returnTo);
      });
    }
  })(req, res, next);
});

router.get('/logout', access.public, function(req, res, next) {
  req.logout(function(err) {
    if (err) { return next(err); }
    res.redirect('https://' + process.env.AUTH0_DOMAIN + '/v2/logout?clientid=' + process.env.AUTH0_CLIENTID + '&returnTo=https://' + req.headers.host);
  });
});

router.get('/user', access.member, async function(req, res) {
  const { _raw, _json, userProfile } = req.user;
  res.render('user', {
    userProfile: JSON.stringify(userProfile, null, 2),
    static_path: '/static',
    theme: process.env.THEME || 'flatly',
    pageTitle: 'User Profile',
    pageDescription: 'User Profile',
    canonical: ('https://' + req.get('host') + req.originalUrl).replace('www.\'', '').replace('.com', '.co.uk').replace('-badders.herokuapp', '-badminton')
  });
});

module.exports = router;
