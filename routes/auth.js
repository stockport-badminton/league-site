// Logging in and out, and the signed-in user's profile page.
// Mounted by routes/index.js, in the order listed there (REARCH-04).
const config = require('../config');
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
        pageTitle: 'Access Denied',
        pageDescription: 'Access Denied',
        query: req.query,
        canonical: ('https://' + req.get('host') + req.originalUrl).replace('www.', '').replace('.com', '.co.uk').replace('-badders.herokuapp', '-badminton')
      });
    } else {
      var returnTo = req.session.returnTo || '/';
      delete req.session.returnTo;
      req.logIn(user, function(err) {
        if (err) return next(err);
        res.redirect(returnTo);
      });
    }
  })(req, res, next);
});

router.get('/logout', access.public, function(req, res, next) {
  req.logout(function(err) {
    if (err) { return next(err); }
    res.redirect('https://' + config.AUTH0_DOMAIN + '/v2/logout?clientid=' + config.AUTH0_CLIENTID + '&returnTo=https://' + req.headers.host);
  });
});

router.get('/user', access.member, async function(req, res) {
  const { _raw, _json, userProfile } = req.user;
  res.render('user', {
    userProfile: JSON.stringify(userProfile, null, 2),
    static_path: '/static',
    pageTitle: 'User Profile',
    pageDescription: 'User Profile',
    canonical: ('https://' + req.get('host') + req.originalUrl).replace('www.\'', '').replace('.com', '.co.uk').replace('-badders.herokuapp', '-badminton')
  });
});

// The monthly login cull (controllers/authCullController.js, docs/login-cull.md). The run is
// Cloud Scheduler's (X-Audit-Token) or a superadmin's; it warns and deletes nothing. Deleting
// is a superadmin pressing Delete on the review page.
const auth_cull_controller = require('../controllers/authCullController');
const { publicFormLimiter } = require('../middleware/rateLimit');
router.post('/admin/login-cull/run', access.cron(auth_cull_controller.requireCullCaller), auth_cull_controller.run);
router.get('/admin/login-cull', access.superadmin, auth_cull_controller.page);
router.post('/admin/login-cull/keep', access.superadmin, auth_cull_controller.adminKeep);
router.post('/admin/login-cull/delete', access.superadmin, auth_cull_controller.deleteDue);

// The keep link in the cull's warning. Public because the person may not be able to log in;
// the token is the credential. The GET only shows a button: mail scanners prefetch links.
router.get('/keep-login/:token', access.token('keep-login link'), publicFormLimiter, auth_cull_controller.keepGet);
router.post('/keep-login/:token', access.token('keep-login link'), publicFormLimiter, auth_cull_controller.keepPost);

module.exports = router;
