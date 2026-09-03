var express = require('express');
var router = express.Router();
const Sentry = require('@sentry/node');
const secured = require('../middleware/secured');
const sesUtil = require('../utils/ses');
const { expressjwt: jwt } = require('express-jwt');
const jwksRsa = require('jwks-rsa');
const multer = require('multer');
const { S3Client, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

var venue_controller = require('../controllers/venueController');
var team_controller = require('../controllers/teamController');
var player_controller = require('../controllers/playerController');
var club_controller = require('../controllers/clubController');
var division_controller = require('../controllers/divisionController');
var game_controller = require('../controllers/gameController');
var fixture_controller = require('../controllers/fixtureController');
var scorecard_controller = require('../controllers/scorecardController');
var scorecard_analysis_controller = require('../controllers/scorecardAnalysisController');
var league_controller = require('../controllers/leagueController');
var validateSeason = require('../middleware/validateSeason');
var contact_controller = require('../controllers/contactusController');
var static_controller = require('../controllers/staticPagesController');
var sitemap_controller = require('../controllers/sitemapController');
var social_controller = require('../controllers/socialController');
var social_video_controller = require('../controllers/socialVideoController');
var messer_scorecard_controller = require('../controllers/messer-scorecard-controller');
var shuttle_controller = require('../controllers/shuttleController');
var documents_controller = require('../controllers/documentsController');
var homepage_content_controller = require('../controllers/homepageContentController');
var site_settings_controller = require('../controllers/siteSettingsController');
var spam_admin_controller = require('../controllers/spamAdminController');
var roster_controller = require('../controllers/rosterController');
const requireClubAccess = require('../middleware/requireClubAccess');
const verifySns = require('../middleware/verifySns');
const {
  publicFormLimiter, contactLimiter, webhookLimiter, mediaLimiter
} = require('../middleware/rateLimit');
const spamGate = require('../middleware/spamGate');
const { buildUploadKey } = require('../utils/uploads');
// The read path for a scorecard photo (HARD-02b) — see GET /scorecard-photo/:id below.
const { photoKeyFromStored, contentTypeFor, downloadTypeFor, downloadNameFor } = require('../utils/scorecardPhoto');
const { mayOpenDraft } = require('../utils/scorecardLinks');
const Fixture = require('../models/fixture');

var userInViews = require('../models/userInViews');
var auth_controller = require('../models/auth.js');

// For the one place a route handler builds email HTML inline. Anything richer belongs
// in a controller with a template.
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const checkJwt = jwt({
  secret: jwksRsa.expressJwtSecret({
    cache: true,
    rateLimit: true,
    jwksRequestsPerMinute: 5,
    jwksUri: `https://${process.env.AUTH0_DOMAIN}/.well-known/jwks.json`
  }),
  algorithms: ['RS256']
});

router.use(userInViews());

// Auth routes
router.get('/login', function(req, res, next) {
  var passport = require('passport');
  passport.authenticate('auth0', { scope: 'openid email profile' })(req, res, next);
});

router.get('/callback', function(req, res, next) {
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

// Social image generation
router.get('/resultImage/:homeTeam/:awayTeam/:homeScore/:awayScore/:division', social_controller.resultImage);
router.get('/tables-social', social_controller.tablesSocial);
router.get('/tournament-social', social_controller.tournamentSocial);
router.get('/handicap-tournament-social', social_controller.handicapTournamentSocial);

// Social API endpoints with mentions for Make.com integration
router.get('/api/social/tables-mentions', social_controller.tablesMentions);

// Social video generation
router.get('/api/social/generate-weekly-video', social_video_controller.generateWeeklyVideo);

router.get('/logout', function(req, res, next) {
  req.logout(function(err) {
    if (err) { return next(err); }
    res.redirect('https://' + process.env.AUTH0_DOMAIN + '/v2/logout?clientid=' + process.env.AUTH0_CLIENTID + '&returnTo=https://' + req.headers.host);
  });
});

// S3 signed URL for scorecard uploads
// Presigned upload for a scorecard photo.
//
// This took `file-name` and `file-type` straight from the query string and returned a
// presigned PUT with `ACL: public-read`. Both were attacker-chosen, so any anonymous
// caller could overwrite any object in the bucket by naming it — including the venues
// map and the generated weekly videos, which live in the same bucket — and could have
// the bucket serve HTML or an executable from our own storage by picking the type.
//
// The key is now generated server-side under a fixed `scorecards/` prefix and the
// content type has to be an image we recognise (see utils/uploads.js), so neither is
// reachable. `file-name` survives only as an advisory hint, sanitised down to letters
// and digits, so the results secretary can still tell photos apart in the bucket.
//
// **No `ACL: 'public-read'` any more** (HARD-02b). It was there because scorecard photos
// were rendered directly from the bucket by `<img src>` and by links already stored in
// `scorecardstore."scoresheet-url"`, so dropping it without a read path would have
// blanked every photo on the site, including on archived seasons. `GET
// /scorecard-photo/:id` above is that read path, and it serves the historical URL shapes
// as well as new keys, so the signer no longer asks for one.
//
// **What this does and does not do.** It stops a *new* object being made public by its
// own ACL. It does not touch objects already in the bucket, which keep the ACL they were
// written with, and it is overridden by a bucket policy granting public read. Both of
// those live on the bucket rather than in this repo — see the runbook in
// docs/hardening/HARD-02b-private-scorecard-photos.md for the order to do them in and
// how to reverse each. Until they are done, photos are still publicly readable; nothing
// here breaks either way, because the read path does not depend on the object being
// private or public.
//
// Residual, unchanged: an anonymous caller can still upload a JPEG under a random name
// in `scorecards/`. That is a storage-cost nuisance, the endpoint carries
// publicFormLimiter, and a lifecycle rule on the prefix is the answer rather than more
// code. Still deliberately out of scope, as is deleting what is already there.
router.get('/sign-s3', publicFormLimiter, async (req, res, next) => {
  try {
    const { key } = buildUploadKey(req.query['file-type'], req.query['file-name']);
    const s3 = new S3Client({ region: 'eu-west-1' });
    const command = new PutObjectCommand({
      Bucket: process.env.S3_BUCKET_NAME,
      Key: key,
      ContentType: String(req.query['file-type']).toLowerCase().trim()
    });
    const signedUrl = await getSignedUrl(s3, command, { expiresIn: 60 });
    const url = `https://${process.env.S3_BUCKET_NAME}.s3.eu-west-1.amazonaws.com/${key}`;
    // `signedUrl` for the two scorecard views, `signedRequest`/`url` for
    // views/scorecard-upload.ejs, which has always read those names and so has never
    // worked against this endpoint. Same values, three keys, no caller left broken.
    res.json({ signedUrl, signedRequest: signedUrl, url, key });
  } catch (err) {
    if (err.status === 400) return res.status(400).json({ error: err.message });
    console.error('sign-s3 failed:', err.message);
    next(err);
  }
});


// /SESemail is gone. It was an unauthenticated POST that sent a hardcoded message
// to three of our own inboxes — a one-line curl loop was a mail bomb, and nothing
// in the app ever called it. /mailtest went with it for the same reason: an
// unauthenticated twin of the /mail webhook below.
// verifySns runs first: without it this endpoint accepted any POST that set the
// x-amz-sns-message-type header, and forwarded the attached MIME message to a real
// distribution list.
router.post('/mail', webhookLimiter, multer().none(), verifySns, contact_controller.distribution_list);

// Scorecard routes
router.post('/scorecard-beta', publicFormLimiter, scorecard_controller.validateScorecard, scorecard_controller.full_fixture_post);
router.post('/email-scorecard', publicFormLimiter, scorecard_controller.validateScorecard, scorecard_controller.fixture_populate_scorecard_errors);
router.post('/add-scorecard-photo/:id', publicFormLimiter, scorecard_controller.add_scorecard_photo);
router.post('/submit-form', publicFormLimiter, (req, res, next) => {
  scorecard_controller.fixture_populate_scorecard(req.body, req, res, next);
});
router.get('/populated-scorecard-beta/:id', (req, res, next) => {
  scorecard_controller.fixture_populate_scorecard_fromId(req, res, next);
});

// GET /scorecard-photo/:id — the only way a scorecard photo is read (HARD-02b).
//
// Scorecard photos were `ACL: public-read` and rendered straight out of the bucket, with
// the URL stored in `scorecardstore."scoresheet-url"` and emailed to the results
// secretary. So the authorization on a photo of a match was "know the URL", forever, for
// anyone the email was ever forwarded to; and the objects could not be made private
// without blanking every photo the site has, including on archived seasons.
//
// **This route is keyed by draft id, never by object key.** That is the whole design.
// Every part of the object's identity comes from the row:
//
//   - the draft must exist, and must have a photo (404 otherwise);
//   - **who may see it is exactly who may see the draft** — `mayOpenDraft`, the same
//     per-draft token as the confirmation page (HARD-03), including the same
//     grandfather clause for links filed before migration 011. There is deliberately
//     not a second authorization model for photos: a photo of a scorecard is the
//     scorecard;
//   - the key comes from `photoKeyFromStored`, which accepts only an object in our own
//     bucket and refuses the prefixes belonging to the venues map and the weekly videos
//     (a row could name one — `POST /add-scorecard-photo/:id` accepted any string for
//     years before HARD-03);
//   - the content type is one we recognise as an image or the answer is 404. Objects
//     predating HARD-02 were uploaded with a caller-chosen type, and echoing that back
//     would make this a way to serve HTML from our *own origin*, which is worse than
//     from the bucket because here it is same-origin with the session cookie.
//
// Modelled on the venues-map proxy in app.js, which does the same thing for a public
// object. `Cache-Control: private` because the token in the query string is the
// authorization, so a shared cache must not hold the answer.
router.get('/scorecard-photo/:id', mediaLimiter, async (req, res, next) => {
  try {
    const rows = await Fixture.getScorecardById(req.params.id);
    if (!rows || !rows.length) return res.status(404).end();
    const draft = rows[0];

    if (!mayOpenDraft(draft.confirmToken, req.query.t)) return res.status(403).end();

    const key = photoKeyFromStored(draft['scoresheet-url']);
    if (!key) return res.status(404).end();

    const s3 = new S3Client({ region: 'eu-west-1' });
    let obj;
    try {
      obj = await s3.send(new GetObjectCommand({ Bucket: process.env.S3_BUCKET_NAME, Key: key }));
    } catch (err) {
      // A key the bucket does not hold is a 404, not a 500. There are rows whose key was
      // corrupted on the way in years ago (the upload page used to rewrite %20 as '+'),
      // and a missing photo must not take the page with it.
      return res.status(404).end();
    }

    // An image is served inline. A PDF or Word document is a real scorecard too — 109 of
    // the 1,479 on record, filed before HARD-02 restricted uploads to images — and is
    // served as a download instead: inline PDF rendering happens in our origin and PDFs
    // can carry script, whereas an attachment is saved and never executes. 404ing them
    // would have turned "make photos private" into "silently lose 7% of the archive".
    const contentType = contentTypeFor(key, obj.ContentType);
    const downloadType = contentType ? null : downloadTypeFor(key);
    if (!contentType && !downloadType) return res.status(404).end();

    res.set('Content-Type', contentType || downloadType);
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Content-Disposition', contentType
      ? 'inline'
      : 'attachment; filename="' + downloadNameFor(key) + '"');
    res.set('Cache-Control', 'private, max-age=300');
    if (obj.ContentLength) res.set('Content-Length', String(obj.ContentLength));

    // The stream needs its own 'error' listener or a mid-transfer failure is an
    // unhandled 'error' event on an EventEmitter, which takes the instance down — the
    // same shape as the pg pool bug in gotcha 2c. Headers are already sent by then, so
    // all that is left is to stop talking.
    obj.Body.on('error', () => res.destroy());
    obj.Body.pipe(res);
  } catch (err) {
    next(err);
  }
});

// Static pages
router.get('/privacy-policy', static_controller.privacy_policy);
router.get('/history', static_controller.history);
router.get('/messer-rules', static_controller.messer_rules);
router.get('/messer-draw/:section', team_controller.new_messer_draw);
router.get('/messer-draw/:season/:section', team_controller.new_messer_draw);
router.get('/rules', static_controller.rules);

// Generated from the database — see controllers/sitemapController.js. The stale
// hand-written rootfiles/sitemap.xml was deleted along with this, because
// `express.static('rootfiles')` is mounted in app.js well before the router and
// would have shadowed this route for as long as the file existed.
router.get('/sitemap.xml', sitemap_controller.sitemap);

router.get('/approve-user/:userId', secured, auth_controller.approve_signup_get);
router.post('/approve-user/:userId', secured, auth_controller.approve_signup_post);

router.post('/new-users-v2', publicFormLimiter, (req, res, next) => {
  if (typeof req.body.id != 'undefined' && req.body.id.length > 3 && req.body.id != 'undefined') {
    // req.body.id is an Auth0 user_id (e.g. "auth0|abc123") — must be
    // encoded before going into a URL, or the emailed link breaks.
    const approveLink = 'https://stockport-badminton.co.uk/approve-user/' + encodeURIComponent(req.body.id);
    var params = {
      Destination: {
        ToAddresses: ['stockport.badders.results@gmail.com'],
        BccAddresses: ['stockport.badders.results@gmail.com', 'bigcoops@outlook.com']
      },
      Message: {
        // `req.body.user` used to be interpolated raw into this HTML and
        // `req.body.contactEmail` went into ReplyToAddresses — both from an
        // unauthenticated request, so anyone could post arbitrary markup into an email
        // we send ourselves and choose where a reply would land. Escaped and capped;
        // ReplyTo is fixed.
        Body: { Html: { Charset: 'UTF-8', Data: '<p>a new user has signed up: ' + escapeHtml(String(req.body.user || '').slice(0, 200)) + '<br /><a href="' + approveLink + '">Approve?</a></p>' } },
        Subject: { Charset: 'UTF-8', Data: 'New User Signup' }
      },
      Source: 'results@stockport-badminton.co.uk',
      ReplyToAddresses: ['stockport.badders.results@gmail.com'],
    };
    const sendPromise = sesUtil.sendEmail(params);
    sendPromise
      .then(() => { res.sendStatus(200); })
      .catch(error => { console.log(error.toString()); next('Sorry something went wrong sending your email.'); });
  } else {
    res.sendStatus(200);
  }
});

// Contact us
router.get('/contact-us', contact_controller.contactus_get);
router.post('/contact-us', contactLimiter, spamGate({ endpoint: '/contact-us' }), contact_controller.validateContactUs, contact_controller.contactus);

// Player routes
//
// `/player/create` and `/manage-players/create` used to sit here with no
// middleware at all — anyone could create a player into any club, because both
// took the club and team straight from the request body. Creating a player is now
// only possible through POST /api/roster/club-:club/players, which is authorized
// against the club in the URL and derives the club from the destination team.
router.post('/player/create', secured, requireClubAccess.requireSuperAdmin, player_controller.player_create);
router.post('/player/batch-create', checkJwt, player_controller.player_batch_create);
router.get('/player/:id/delete', player_controller.player_delete_get);
router.delete('/player/:id', checkJwt, player_controller.player_delete);
router.get('/player/:id/update', secured, player_controller.player_update_get);
router.get('/player/:id', player_controller.player_detail);
router.get('/playerStats/:id/:fullName', player_controller.player_game_data);
router.get('/eligiblePlayers/:id/:gender', player_controller.eligible_players_list);
// `/players/club-:clubid?/team-:teamid?/gender-:gender?` used to be declared here,
// unauthenticated, returning the registration rows as raw JSON. It shadowed the
// identically-shaped `secured` route further down — first match wins — so the
// Registered Players page never rendered for that URL shape and anyone could read
// the data. Nothing in the app called the JSON version, so it is gone rather than
// merely secured, which un-shadows the real page.
router.get('/players/matching/:name/:gender', secured, player_controller.find_closest_matched_player);

// Team routes
router.get('/team/create', team_controller.team_create_get);
router.post('/team/create', checkJwt, team_controller.team_create_post);
router.post('/team/batch-create', checkJwt, team_controller.teams_batch_create);
router.get('/team/:id/delete', team_controller.team_delete_get);
router.delete('/team/:id', checkJwt, team_controller.team_delete_post);
router.get('/team/:id/update', team_controller.team_update_get);
router.patch('/team/:id', checkJwt, team_controller.team_update_post);
router.get('/team/:id', team_controller.team_detail);
router.get('/teams', team_controller.team_list);
router.post('/teams', team_controller.team_search);

// League routes
router.get('/league/create', league_controller.league_create_get);
router.post('/league/create', checkJwt, league_controller.league_create_post);
router.get('/league/:id/delete', league_controller.league_delete_get);
router.delete('/league/:id', checkJwt, league_controller.league_delete);
router.get('/league/:id/update', league_controller.league_update_get);
router.patch('/league/:id', checkJwt, league_controller.league_update);
// Superadmin only. These were unauthenticated, protected by nothing but a check that
// today is the annual invoice date — so on that one day of the year any caller could
// send every club its invoice, repeatedly, from our own verified domain. The date check
// stays, but as a safety net rather than as the only control.
router.post('/league/sendInvoices', secured, requireClubAccess.requireSuperAdmin,
  publicFormLimiter, contact_controller.send_invoices);
router.post('/league/sendInvoice/:club', secured, requireClubAccess.requireSuperAdmin,
  publicFormLimiter, contact_controller.send_invoices);
router.get('/league/:id', league_controller.league_detail);
router.get('/leagues', checkJwt, league_controller.league_list);
router.get('/tables/All', league_controller.all_league_tables);
router.get('/tables/All/:season', validateSeason, league_controller.all_league_tables);
router.get('/tables/:division', league_controller.league_table);
router.get('/tables/:division/:season', validateSeason, league_controller.league_table);

// Club routes
router.get('/club/create', club_controller.club_create_get);
router.post('/club/create', checkJwt, club_controller.club_create_post);
router.post('/club/batch-create', checkJwt, club_controller.club_batch_create);
router.get('/club/:id/delete', club_controller.club_delete_get);
router.delete('/club/:id', checkJwt, club_controller.club_delete_post);
router.get('/club/:id/update', club_controller.club_update_get);
router.patch('/club/:id', checkJwt, club_controller.club_update_post);
router.get('/clubs', club_controller.club_list);
// A public page per club — the surface for "badminton club near me", which
// /info/clubs cannot rank for because all 18 clubs share that one URL. Matched by
// name slug, not id, so the URL reads. Declared after `/clubs` so the exact path
// still reaches club_list.
router.get('/clubs/:slug', club_controller.club_public_page);
router.get('/info/clubs', club_controller.club_list_detail);

// Division routes
router.get('/division/create', division_controller.division_create_get);
router.post('/division/create', checkJwt, division_controller.division_create_post);
router.post('/division/batch-create', checkJwt, division_controller.division_batch_create);
router.get('/division/:id/delete', division_controller.division_delete_get);
router.delete('/division/:id', checkJwt, division_controller.division_delete_post);
router.get('/division/:id/update', division_controller.division_update_get);
router.patch('/division/:id', checkJwt, division_controller.division_update_post);
router.get('/division/:id', checkJwt, division_controller.division_detail);
router.get('/divisions', checkJwt, division_controller.division_list);

// Fixture routes
router.get('/fixture/create', fixture_controller.fixture_create_get);
router.post('/fixture/reminder', publicFormLimiter, scorecard_controller.fixture_reminder_post);
router.get('/fixture/outstanding', fixture_controller.getLateScorecards);
router.post('/fixture/short-result', publicFormLimiter, fixture_controller.fixture_outstanding_post);
router.post('/fixture/create', checkJwt, fixture_controller.fixture_create_post);
router.post('/fixture/batch-create', checkJwt, fixture_controller.fixture_batch_create);
router.post('/fixture/enter-result', checkJwt, fixture_controller.fixture_update_by_team_name);
// Superadmin only. This was unauthenticated behind nothing but a rate limit until
// Sep 2026 — anyone who could POST could set a fixture to 'rearranged' and insert a
// replacement at a date of their choosing. The only client is the rearrangement modal
// in fixtures-results.ejs, which is itself inside `if (superadmin)`, so the server now
// says what the UI always assumed. Captains request rearrangements by email; they have
// never had this form.
router.post('/fixture/rearrangement', secured, requireClubAccess.requireSuperAdmin, fixture_controller.fixture_rearrange_by_team_name);
router.patch('/fixture/rearrange', checkJwt, fixture_controller.fixture_rearrange_by_team_name);
router.get('/fixture/:id/delete', fixture_controller.fixture_delete_get);
router.delete('/fixture/:id', checkJwt, fixture_controller.fixture_delete_post);
router.get('/fixture/:id/update', fixture_controller.fixture_update_get);
router.get('/fixture/home-:homeTeam/away-:awayTeam', fixture_controller.fixture_id_from_team_names);
router.get('/fixture/homeId-:homeTeam/awayId-:awayTeam', fixture_controller.fixture_id);
router.patch('/fixture/:id', checkJwt, fixture_controller.fixture_update_post);
router.get('/fixture/:id(\\d+)', checkJwt, fixture_controller.fixture_detail);
router.get('/event/:id/:date-:homeTeam-:awayTeam', fixture_controller.fixture_event_detail);
router.get('/scorecard/fixture/:id', fixture_controller.getScorecard);
router.get('/fixture-players', fixture_controller.get_fixture_players_details);
router.get('/fixture-players/team-:team?', fixture_controller.get_fixture_players_details);
router.get('/fixture-players/club-:club?', fixture_controller.get_fixture_players_details);
router.get('/fixture-players/:season?', fixture_controller.get_fixture_players_details);
router.get('/fixture-players/team-:team?/season-:season?', fixture_controller.get_fixture_players_details);
router.get('/fixture-players/club-:club?/:season?', fixture_controller.get_fixture_players_details);
router.get('/fixtures', fixture_controller.fixture_list);

// Game routes
router.get('/game/create', game_controller.game_create_get);
router.post('/game/create', checkJwt, game_controller.game_create_post);
router.post('/game/batch-create', checkJwt, game_controller.game_batch_create);
router.get('/game/:id/delete', game_controller.game_delete_get);
router.delete('/game/:id', checkJwt, game_controller.game_delete_post);
router.get('/game/:id/update', game_controller.game_update_get);
router.patch('/game/:id', checkJwt, game_controller.game_update_post);
router.get('/game/:id', checkJwt, game_controller.game_detail);
router.get('/games', checkJwt, game_controller.game_list);

// Venue routes
router.get('/venue/create', venue_controller.venue_create_get);
router.post('/venue/create', checkJwt, venue_controller.venue_create_post);
router.post('/venue/batch-create', checkJwt, venue_controller.venue_batch_create);
router.get('/venue/:id/delete', venue_controller.venue_delete_get);
router.delete('/venue/:id', checkJwt, venue_controller.venue_delete_post);
router.get('/venue/:id/update', venue_controller.venue_update_get);
router.patch('/venue/:id', checkJwt, venue_controller.venue_update_post);
router.get('/venue/:id', checkJwt, venue_controller.venue_detail);
router.get('/venues', venue_controller.venue_list);

// Homepage and gallery
router.get('/', fixture_controller.fixture_get_summary);
router.get('/offline-home', fixture_controller.fixture_get_offline_home);
router.get('/gallery', static_controller.get_gallery);

// Wildcard fixture/result routes
router.get('/fixtures/*', fixture_controller.fixture_detail_byDivision);
router.get('/results/*', fixture_controller.fixture_detail_byDivision);
router.get('/calendars/*', fixture_controller.fixture_calendars);
router.get('/results-grid/*', fixture_controller.fixture_detail_byDivision);

// Secured routes
//
// `POST /player/batch-update` used to live here. It took `tablename` and `fields`
// from the request body and interpolated both into an UPDATE, behind `secured`
// only — so any logged-in captain could write any column of any table, including
// their own player.role. It was also the only write path the team-management page
// had. The roster API below replaces it: each endpoint takes intent (an ordered
// list of player ids, a destination team) and derives its own SQL.
//
// Roster writes. Authorization is resolved from the row's real owner inside each
// handler — the club in the URL is never taken on trust.
router.post('/api/teams/:id/order', secured, roster_controller.api_team_order);
router.post('/api/players/:id/move', secured, roster_controller.api_player_move);
router.post('/api/players/:id/release', secured, roster_controller.api_player_release);
router.get('/api/roster/club-:club/candidates', secured, requireClubAccess, roster_controller.api_candidates);
router.post('/api/roster/club-:club/players', secured, requireClubAccess, roster_controller.api_player_create);
router.post('/api/roster/club-:club/attach', secured, requireClubAccess, roster_controller.api_player_attach);
router.post('/api/roster/club-:club/transfer', secured, requireClubAccess, roster_controller.api_transfer_request);

router.post('/player/:id', secured, player_controller.player_update_post);
router.get('/admin/results/*', secured, fixture_controller.fixture_detail_byDivision);
router.get('/admin/results/:division/:season', secured, fixture_controller.fixture_detail_byDivision);

router.get('/user', secured, async function(req, res) {
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

router.post('/api/analyse-scorecard', secured,
  scorecard_analysis_controller.uploadMiddleware,
  scorecard_analysis_controller.analyse_scorecard);
router.get('/scorecard-beta', secured, scorecard_controller.scorecard_beta);
router.get('/email-scorecard', secured, scorecard_controller.email_scorecard);

// Messer scorecard routes
router.get('/messer-scorecard-beta', secured, messer_scorecard_controller.messer_scorecard_beta);
router.get('/messer-scorecard-beta/test', secured, messer_scorecard_controller.messer_scorecard_beta_test);
router.post('/messer-scorecard-beta', secured, messer_scorecard_controller.validateMesserScorecard, messer_scorecard_controller.full_messer_fixture_post);
router.get('/populated-messer-scorecard/:id', secured, messer_scorecard_controller.messer_fixture_populate_scorecard_fromId);
router.get('/api/messer-teams-by-section/:section', secured, messer_scorecard_controller.messer_teams_by_section);
router.get('/messer-results', secured, messer_scorecard_controller.messer_results_list);
router.get('/messer-result/:id', secured, messer_scorecard_controller.messer_result_detail);
router.post('/messer-result/:id/approve', secured, messer_scorecard_controller.messer_result_approve);
router.post('/messer-result/:id/reject', secured, messer_scorecard_controller.messer_result_reject);

// Messer bracket wire-up (admin) — set up auto-advance links once per season
router.get('/admin/messer-bracket', secured, messer_scorecard_controller.messer_bracket_landing);
router.get('/admin/messer-bracket/:section', secured, messer_scorecard_controller.messer_bracket_edit);
router.post('/admin/messer-bracket/:section', secured, messer_scorecard_controller.messer_bracket_save);

router.get('/players/club-:club?/team-:team?/gender-:gender?', secured, player_controller.player_list_clubs_teams);
router.get('/players/club-:club?', secured, player_controller.player_list_clubs_teams);
router.get('/players/team-:team?', secured, player_controller.player_list_clubs_teams);
router.get('/players/gender-:gender?', secured, player_controller.player_list_clubs_teams);
router.get('/players', secured, player_controller.player_list_clubs_teams);
router.get('/missed-three', secured, player_controller.players_missed_three);
// Team management. Two pages with two jobs, where there used to be one template
// switching on a `superadmin` boolean: the roster a captain reads, and the editor
// the results secretary works in. The .docx is its own endpoint rather than a side
// effect of rendering the page.
//
// More specific paths first — `/manage-players/club-:club?` would otherwise match
// `/manage-players/club-Aerospace/edit` with the club captured as 'Aerospace/edit'.
router.get('/manage-players/club-:club/edit', secured, requireClubAccess, roster_controller.club_roster_edit);
router.get('/manage-players/club-:club/registration.docx', secured, requireClubAccess, roster_controller.registration_docx);
router.get('/manage-players/club-:club', secured, roster_controller.club_roster);
router.get('/manage-players', secured, roster_controller.club_picker);
router.get('/player/create', secured, player_controller.player_create_get);
router.get('/players/eloPop', player_controller.player_elo_populate);
router.get('/dev/player-stats-debug', player_controller.player_stats_debug);
router.get('/dev/elo-audit', player_controller.player_elo_audit);
router.get('/dev/elo-raw/:playerId', player_controller.player_elo_raw);
router.get('/players/eloFullRecalc', secured, player_controller.player_elo_full_recalc);
router.get('/players/eloBackfillAll', secured, player_controller.player_elo_backfill_all);

router.get('/admin/homepage-content', secured, homepage_content_controller.list);
router.get('/admin/homepage-content/create', secured, homepage_content_controller.createForm);
router.post('/admin/homepage-content', secured, homepage_content_controller.create);
router.get('/admin/homepage-content/:id', secured, homepage_content_controller.editForm);
router.post('/admin/homepage-content/:id', secured, homepage_content_controller.update);
router.post('/admin/homepage-content/:id/delete', secured, homepage_content_controller.remove);

router.get('/admin/site-settings', secured, site_settings_controller.form);
router.post('/admin/site-settings', secured, site_settings_controller.update);

// Blocklists and the submission log. `secured` proves someone is logged in; the
// controller checks superadmin, same as the other /admin screens.
router.get('/admin/spam', secured, spam_admin_controller.form);
router.post('/admin/spam', secured, spam_admin_controller.add);
router.post('/admin/spam/:id/active', secured, spam_admin_controller.toggle);

// League structure admin (superadmin only — role check in controller)
router.get('/admin/clubs', secured, club_controller.admin_club_list);
router.get('/admin/clubs/create', secured, club_controller.admin_club_createForm);
router.post('/admin/clubs', secured, club_controller.admin_club_create);
router.get('/admin/clubs/:id', secured, club_controller.admin_club_editForm);
router.post('/admin/clubs/:id', secured, club_controller.admin_club_update);

router.get('/admin/teams', secured, team_controller.admin_team_list);
router.get('/admin/teams/create', secured, team_controller.admin_team_createForm);
router.post('/admin/teams', secured, team_controller.admin_team_create);
router.post('/admin/teams/:id/move', secured, team_controller.admin_team_move);
// Withdrawing a team voids fixtures and takes a team out of the league table, so it
// carries requireSuperAdmin as well as the in-controller role check the rest of
// /admin/teams uses — `secured` only proves someone is logged in. HARD-10.
router.get('/admin/teams/:id/withdraw', secured, requireClubAccess.requireSuperAdmin, team_controller.admin_team_withdrawForm);
router.post('/admin/teams/:id/withdraw', secured, requireClubAccess.requireSuperAdmin, team_controller.admin_team_withdraw);
router.post('/admin/teams/:id/reinstate', secured, requireClubAccess.requireSuperAdmin, team_controller.admin_team_reinstate);
router.get('/admin/teams/:id', secured, team_controller.admin_team_editForm);
router.post('/admin/teams/:id', secured, team_controller.admin_team_update);
router.post('/admin/fixture/:id/date', secured, fixture_controller.admin_fixture_date_update);
router.get('/players/eloBackfillAdmin', secured, player_controller.player_elo_backfill_admin);
router.get('/api/player-elo', player_controller.player_elo_history_api);
router.get('/api/players/search', player_controller.player_search_api);
router.get('/api/seasons', player_controller.get_seasons_api);
router.get('/elo-chart', secured, player_controller.player_elo_chart);
router.get('/player-stats/*', secured, player_controller.all_player_stats);
router.get('/player-stats', secured, player_controller.all_player_stats);
router.get('/pair-stats/*', secured, player_controller.all_pair_stats);
router.get('/pair-stats', secured, player_controller.all_pair_stats);

router.get('/club/:id', secured, club_controller.club_detail);
router.get('/club-api/:id', secured, club_controller.club_detail_api);
router.get('/admin/info/clubs', secured, club_controller.club_list_detail);
router.get('/short-results', secured, fixture_controller.fixture_outstanding);

// Shuttle price comparison (superadmin only — role check in controller)
router.get('/shuttle-prices', secured, shuttle_controller.shuttlePrices);
router.get('/shuttle-prices/export', secured, shuttle_controller.exportPrices);
router.post('/shuttle-prices/refresh', secured, shuttle_controller.refreshPrices);

// Team registration form as an editable Word document — the one the nav links to.
// A PDF AcroForm has a fixed set of named fields, so a club secretary cannot add or
// delete a roster row; a Word table can. Same layout, no 12-row cap.
router.get('/forms/team-registration.docx', documents_controller.teamRegistrationFormDocx);
// Same, prefilled with a club's current player registrations (auth check in controller)
router.get('/forms/team-registration/:club/prefilled.docx', secured, documents_controller.teamRegistrationFormPrefilledDocx);
// The original PDF versions. Kept working for anyone holding an old link, but no
// longer linked from the nav.
router.get('/forms/team-registration', documents_controller.teamRegistrationForm);
router.get('/forms/team-registration/:club/prefilled', secured, documents_controller.teamRegistrationFormPrefilled);
// Club registration form, generated with the current season filled in
router.get('/forms/club-registration', documents_controller.clubRegistrationForm);
// Same form, prefilled with a club's contacts, teams and venue (auth check in controller)
router.get('/forms/club-registration/:club/prefilled', secured, documents_controller.clubRegistrationFormPrefilled);

// Manual venues-map regeneration (superadmin only — role check in controller)
router.post('/venues-map/refresh', secured, venue_controller.venues_map_refresh);

// ---------------------------------------------------------------------------
// Weekly data-integrity digest (HARD-07)
// ---------------------------------------------------------------------------
// Required here rather than at the top of the file to keep this package's diff inside
// the block it owns; `require` is cached, so there is no cost to it.
const audit_controller = require('../controllers/auditController');

// The report is a list of every weakness in the league's data, so both routes are
// gated. The preview is superadmin-session only. The send additionally accepts a shared
// secret in X-Audit-Token, for Cloud Scheduler, and deliberately does *not* use
// `secured`: `secured` answers an anonymous caller with a 302 to /login, which a
// scheduler would record as a successful job.
router.get('/admin/audit', secured, requireClubAccess.requireSuperAdmin, audit_controller.audit_preview);
router.post('/admin/audit/run', audit_controller.requireAuditCaller, audit_controller.audit_run);

// ---------------------------------------------------------------------------
// Error handlers
// ---------------------------------------------------------------------------

// Required here rather than at the top of the file only to keep this package's diff
// inside the block it owns; `require` is cached, so there is no cost to it.
const { canonicalFor } = require('../utils/canonical');
const crypto = require('crypto');

// A short code the visitor can quote back to us, and the same string is put on the
// Sentry event as a *tag* — tags are indexed and searchable, extra context is not, so
// this is what makes "I saw error 7F2A1B" one search away from the stack trace. Without
// it a friendly error page is just a prettier dead end, which matters more here than
// usual: the site is meant to be runnable by someone who will never read a log.
//
// Random rather than a counter or a timestamp. A code has to name exactly one event,
// and Cloud Run runs several instances that share no state. Six hex characters is 16.7
// million — plenty to keep a day's errors apart, short enough to read down a phone.
function errorReference() {
  return crypto.randomBytes(3).toString('hex').toUpperCase();
}

router.use(function(req, res) {
  res.status(404);
  res.render('404-error', {
    static_path: '/static',
    pageTitle: 'Can\'t find the page your looking for',
    pageDescription: 'HTTP 404 Error',
    canonical: canonicalFor(req)
  });
});

// The /api/ routes answer in JSON, so their errors have to as well. Falling through
// to the HTML handler below sent a rendered 403 page to a fetch() caller, which
// could only report a generic "Save failed" — the roster editor shows the server's
// reason in its toast ("Priya Ramanathan is registered to College Green. Request a
// transfer instead."), and that only works if the reason survives the trip.
router.use(function(error, req, res, next) {
  if (!req.path.startsWith('/api/')) return next(error);

  var status = (error && (error.status || error.statusCode)) || 500;

  // A 4xx is a bad request, not a fault of ours: its message is written deliberately by
  // this code and is what the roster editor shows in its toast, so it goes straight
  // back. No Sentry event, no reference code — there is nothing to look up.
  if (status < 500) {
    return res.status(status).json({ ok: false, error: error.message });
  }

  var reference = errorReference();
  Sentry.captureException(error, { tags: { reference: reference } });
  res.status(status).json({
    ok: false,
    // A 5xx message can carry internals (SQL fragments, connection strings), so it is
    // replaced rather than escaped or truncated. The reference is what makes the
    // generic message actionable.
    error: 'Something went wrong saving that. Try again.',
    reference: reference
  });
});

router.use(function(error, req, res, next) {
  // An error carrying a 4xx status is a bad request, not a fault of ours: render the
  // matching page and don't spend a Sentry event on it. Without this a junk season
  // in a path splat (see models/season.js) would 500 and refill the issue list the
  // way NODE-Q did, and assertClubAccess's 403 rendered the 500 page.
  var status = error && (error.status || error.statusCode);
  if (status >= 400 && status < 500) {
    var view = status === 403 ? '403-error' : '404-error';
    res.status(status);
    return res.render(view, {
      static_path: '/static',
      theme: process.env.THEME || 'flatly',
      pageTitle: status === 403 ? 'Access Denied' : 'Can\'t find the page your looking for',
      pageDescription: 'HTTP ' + status + ' Error',
      canonical: canonicalFor(req)
    });
  }

  // Report to Sentry before rendering. Flush first so the event is sent while
  // Cloud Run still has CPU allocated — post-response CPU is throttled, which
  // can drop a fire-and-forget send. Flush is capped so the error page isn't
  // held up if Sentry is slow/unreachable.
  var reference = errorReference();
  Sentry.captureException(error, { tags: { reference: reference } });
  Sentry.flush(2000).catch(() => {}).finally(function() {
    res.status(500);
    // `error` is deliberately NOT a local. The template used to render it, and a pg
    // error stringifies to its message — which is made of table and column names and
    // fragments of the failing statement. The visitor gets the reference instead; the
    // message stays on the Sentry event, tagged with the same code.
    res.render('500-error', {
      static_path: '/static',
      pageTitle: 'Something went wrong',
      pageDescription: 'HTTP 500 Error',
      reference: reference,
      canonical: canonicalFor(req)
    });
  });
});

module.exports = router;
