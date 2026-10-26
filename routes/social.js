// Social media: the generated images and video Meta fetches, and the weekly posts.
// Mounted by routes/index.js, in the order listed there (REARCH-04).
const express = require('express');
const router = express.Router();
const access = require('../middleware/access');
const social_controller = require('../controllers/socialController');
const social_video_controller = require('../controllers/socialVideoController');
const { mediaLimiter } = require('../middleware/rateLimit');
const requireCronCaller = require('../middleware/requireCronCaller');
// The weekly league-tables post (Sep 2026), replacing the Stockport half of the Make.com
// "League Tables" scenario. Fifth caller of the same gate.
const requireSocialCaller = requireCronCaller({
  envVar: 'SOCIAL_CRON_TOKEN',
  header: 'x-social-token',
  describe: 'the weekly social post',
  callerProp: 'socialCaller',
});

// Social image generation
router.get('/resultImage/:homeTeam/:awayTeam/:homeScore/:awayScore/:division/story.jpg', access.public, social_controller.resultStoryImage);
router.get('/resultImage/:homeTeam/:awayTeam/:homeScore/:awayScore/:division', access.public, social_controller.resultImage);
router.get('/tables-social', access.public, social_controller.tablesSocial);
router.get('/tournament-social', access.public, social_controller.tournamentSocial);
router.get('/handicap-tournament-social', access.public, social_controller.handicapTournamentSocial);

// The same pictures, generated per request and returned as JPEG, rather than written to a
// container's disk and fetched back by URL. See the header block in socialController.
//
// Public and unauthenticated on purpose: Meta fetches `image_url` from its own servers
// when building a post, so anything gated here cannot be posted. They are pure functions
// of data that is already public on the league tables page.
router.get('/league-table-image/:division', access.public, social_controller.leagueTableImage);
router.get('/league-table-image/:division/:season', access.public, social_controller.leagueTableImage);
router.get('/tournament-image/:poster', access.public, social_controller.tournamentImage);
router.get('/fixtures-image/:division', access.public, social_controller.fixturesImage);

// The weekly tables post. GET previews and sends nothing; POST publishes and is gated by a
// scheduler token or a superadmin session — 403, never a redirect.
const weekly_tables_controller = require('../controllers/weeklyTablesController');
router.get('/admin/social/weekly-tables', access.superadmin,
  weekly_tables_controller.preview);
router.post('/admin/social/weekly-tables', access.cron(requireSocialCaller), weekly_tables_controller.run);
// The same tables to Threads, as its own job: see weeklyTablesController.runThreads.
router.post('/admin/social/weekly-tables/threads', access.cron(requireSocialCaller), weekly_tables_controller.runThreads);
// Published results to Threads, from the queue the publish step fills. Its own job, every
// few minutes: see controllers/threadsResultsController.js.
const threads_results_controller = require('../controllers/threadsResultsController');
router.post('/admin/social/results/threads', access.cron(requireSocialCaller), threads_results_controller.run);
// The same queue idea for Facebook and Instagram, on `sbl-results-meta` (HARD-47): see
// controllers/metaResultsController.js.
const meta_results_controller = require('../controllers/metaResultsController');
router.post('/admin/social/results/meta', access.cron(requireSocialCaller), meta_results_controller.run);

// The weekly fixtures post — the same thing looking forwards, Sunday evening. It shares
// SOCIAL_CRON_TOKEN with the tables post rather than taking a sixth secret of its own:
// both are the weekly social post, called by the same scheduler as the same caller, and
// both publish content that is already public. A new variable would mean the route stays
// closed until somebody remembers to set it on the service, which is the step that gets
// forgotten — `unset closes the path` is a good default and a poor deployment plan.
const weekly_fixtures_controller = require('../controllers/weeklyFixturesController');
router.get('/admin/social/weekly-fixtures', access.superadmin,
  weekly_fixtures_controller.preview);
router.post('/admin/social/weekly-fixtures', access.cron(requireSocialCaller), weekly_fixtures_controller.run);
// The same cards to Threads, as its own job: see weeklyFixturesController.runThreads.
router.post('/admin/social/weekly-fixtures/threads', access.cron(requireSocialCaller), weekly_fixtures_controller.runThreads);

// The weekly results video. Same gate and the same SOCIAL_CRON_TOKEN as the other two —
// one secret for the weekly social post, called by the same scheduler as the same caller.
// Unlike the image posts this one needs the video to exist first: encoding takes ~36s, far
// longer than Meta will wait on a fetch, so it is generated ahead of time into S3 and
// served from GET /social-video/:aspect.
const weekly_video_controller = require('../controllers/weeklyVideoController');
router.get('/admin/social/weekly-video', access.superadmin,
  weekly_video_controller.preview);
router.post('/admin/social/weekly-video', access.cron(requireSocialCaller), weekly_video_controller.run);

// Connecting the league's Threads account (Sep 2026). The token lasts 60 days and has to be
// refreshed, so it is state in `social_token`, not an env var. The three pages are
// superadmin, and the connect page is also the recovery path when a refresh has lapsed.
// The weekly refresh takes SOCIAL_CRON_TOKEN, for the same reason the three weekly posts
// share it: one job, done by the same caller. See controllers/threadsController.js.
const threads_controller = require('../controllers/threadsController');
router.get('/admin/threads', access.superadmin, threads_controller.page);
router.get('/admin/threads/connect', access.superadmin, threads_controller.connect);
router.get('/admin/threads/callback', access.superadmin, threads_controller.callback);
router.post('/admin/threads/refresh', access.cron(requireSocialCaller), threads_controller.refresh);


// The weekly results video.
//
// The read path is public and unauthenticated for the same reason the league-table and
// fixtures images are: **Meta fetches `video_url` from its own servers**, so anything
// gated here could not be posted. The objects themselves stay private in S3 — this route
// is what replaces the bucket URL that answered 403 (HARD-21).
router.get('/social-video/:aspect', access.public, mediaLimiter, social_video_controller.serveWeeklyVideo);

// Generating, however, is gated. This used to be open to the internet, and it starts an
// ffmpeg encode on Cloud Run that takes ~36 seconds — anyone who knew the URL could run
// that as often as they liked. The S3 lock blunts it and is not an authorization control.
// Sixth caller of the same gate: a scheduler token or a superadmin session, never a
// redirect.
router.get('/api/social/generate-weekly-video', access.cron(requireSocialCaller), social_video_controller.generateWeeklyVideo);

module.exports = router;
