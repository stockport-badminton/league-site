// Static pages, the crawler files (sitemap, robots.txt, llms.txt), the homepage and the gallery.
// Mounted by routes/index.js, in the order listed there (REARCH-04).
const express = require('express');
const router = express.Router();
const access = require('../middleware/access');
const fixture_controller = require('../controllers/fixtureController');
const static_controller = require('../controllers/staticPagesController');
const sitemap_controller = require('../controllers/sitemapController');
const crawler_controller = require('../controllers/crawlerController');

// Static pages
router.get('/privacy-policy', access.public, static_controller.privacy_policy);
router.get('/history', access.public, static_controller.history);

router.get('/rules', access.public, static_controller.rules);

// Generated from the database — see controllers/sitemapController.js. The stale
// hand-written rootfiles/sitemap.xml was deleted along with this, because
// `express.static('rootfiles')` is mounted in app.js well before the router and
// would have shadowed this route for as long as the file existed.
router.get('/sitemap.xml', access.public, sitemap_controller.sitemap);

// robots.txt from the route table (utils/robots.js) and llms.txt from the club data
// (controllers/crawlerController.js). rootfiles/robots.txt was deleted with this, for the
// same shadowing reason as the sitemap.
router.get('/robots.txt', access.public, crawler_controller.robots);
router.get('/llms.txt', access.public, crawler_controller.llms);

// Homepage and gallery
router.get('/', access.public, fixture_controller.fixture_get_summary);
router.get('/homepage-gallery', access.public, fixture_controller.fixture_get_homepage_gallery);
router.get('/offline-home', access.public, fixture_controller.fixture_get_offline_home);
router.get('/gallery', access.public, static_controller.get_gallery);

module.exports = router;
