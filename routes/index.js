var express = require('express');
var router = express.Router();
const Sentry = require('@sentry/node');
const secured = require('../middleware/secured');
const sesUtil = require('../utils/ses');
const { expressjwt: jwt } = require('express-jwt');
const jwksRsa = require('jwks-rsa');
const multer = require('multer');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
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
  publicFormLimiter, contactLimiter, webhookLimiter
} = require('../middleware/rateLimit');
const spamGate = require('../middleware/spamGate');

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
router.get('/sign-s3', async (req, res, next) => {
  const fileName = req.query['file-name'];
  const fileType = req.query['file-type'];
  const s3Params = {
    Bucket: process.env.S3_BUCKET_NAME,
    Key: fileName,
    ContentType: fileType,
    ACL: 'public-read'
  };
  const s3 = new S3Client({ region: 'eu-west-1' });
  const command = new PutObjectCommand(s3Params);
  try {
    const signedUrl = await getSignedUrl(s3, command, { expiresIn: 60 });
    res.json({ signedUrl });
  } catch (err) {
    console.error(err);
    next(err);
  }
});

router.get('/upload-scoresheet', scorecard_controller.upload_scoresheet);

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
router.post('/fixture/rearrangement', publicFormLimiter, fixture_controller.fixture_rearrange_by_team_name);
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

// Team registration form, generated with the current season filled in
router.get('/forms/team-registration', documents_controller.teamRegistrationForm);
// Same form, prefilled with a club's current player registrations (auth check in controller)
router.get('/forms/team-registration/:club/prefilled', secured, documents_controller.teamRegistrationFormPrefilled);
// Club registration form, generated with the current season filled in
router.get('/forms/club-registration', documents_controller.clubRegistrationForm);
// Same form, prefilled with a club's contacts, teams and venue (auth check in controller)
router.get('/forms/club-registration/:club/prefilled', secured, documents_controller.clubRegistrationFormPrefilled);

// Manual venues-map regeneration (superadmin only — role check in controller)
router.post('/venues-map/refresh', secured, venue_controller.venues_map_refresh);

// Error handlers
router.use(function(req, res) {
  res.status(404);
  res.render('404-error', {
    static_path: '/static',
    pageTitle: 'Can\'t find the page your looking for',
    pageDescription: 'HTTP 404 Error',
    canonical: ('https://' + req.get('host') + req.originalUrl).replace('www.\'', '').replace('.com', '.co.uk').replace('-badders.herokuapp', '-badminton')
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
  if (status >= 500) {
    Sentry.captureException(error);
  }
  res.status(status).json({
    ok: false,
    // A 5xx message can carry internals (SQL fragments, connection strings), so
    // only 4xx messages — which this code writes deliberately — are passed on.
    error: status < 500 ? error.message : 'Something went wrong saving that. Try again.'
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
      canonical: ('https://' + req.get('host') + req.originalUrl).replace('www.\'', '').replace('.com', '.co.uk').replace('-badders.herokuapp', '-badminton')
    });
  }

  // Report to Sentry before rendering. Flush first so the event is sent while
  // Cloud Run still has CPU allocated — post-response CPU is throttled, which
  // can drop a fire-and-forget send. Flush is capped so the error page isn't
  // held up if Sentry is slow/unreachable.
  Sentry.captureException(error);
  Sentry.flush(2000).catch(() => {}).finally(function() {
    res.status(500);
    res.render('500-error', {
      static_path: '/static',
      pageTitle: 'HTTP 500 Error',
      pageDescription: 'HTTP 500 Error',
      error: error,
      canonical: ('https://' + req.get('host') + req.originalUrl).replace('www.\'', '').replace('.com', '.co.uk').replace('-badders.herokuapp', '-badminton')
    });
  });
});

module.exports = router;
