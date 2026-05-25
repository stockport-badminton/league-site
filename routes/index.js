var express = require('express');
var router = express.Router();
var AWS = require('aws-sdk');
const jwt = require('express-jwt');
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
var fixtureGen_controller = require('../controllers/fixtureGenerator');
var contact_controller = require('../controllers/contactusController');
var static_controller = require('../controllers/staticPagesController');
var social_controller = require('../controllers/socialController');
var messer_scorecard_controller = require('../controllers/messer-scorecard-controller');
var userInViews = require('../models/userInViews');
var auth_controller = require('../models/auth.js');

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

router.post('/sendgrid', function(req, res, next) {
  res.sendStatus(200);
});

// Social image generation
router.get('/resultImage/:homeTeam/:awayTeam/:homeScore/:awayScore/:division', social_controller.resultImage);
router.get('/tables-social', social_controller.tablesSocial);
router.get('/tournament-social', social_controller.tournamentSocial);
router.get('/handicap-tournament-social', social_controller.handicapTournamentSocial);

// Social API endpoints with mentions for Make.com integration
router.post('/api/social/result-webhook', social_controller.resultWebhookWithMentions);
router.get('/api/social/tables-with-mentions/:season?', social_controller.tablesSocialWithMentions);

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

router.post('/SESemail', (req, res, next) => {
  var ses = new AWS.SES({ apiVersion: '2010-12-01' });
  var params = {
    Destination: { ToAddresses: ['bigcoops@gmail.com', 'stockport.badders.results@gmail.com', 'bigcoops@outlook.com'] },
    Message: {
      Body: { Html: { Charset: 'UTF-8', Data: contact_controller.generateContactUsHTML('some generic contact message', 'fromme@gmail.com') } },
      Subject: { Charset: 'UTF-8', Data: 'Somebody is trying to get in touch' }
    },
    Source: 'results@stockport-badminton.co.uk',
    ReplyToAddresses: ['stockport.badders.results@gmail.com'],
  };
  const sendPromise = ses.sendEmail(params).promise();
  sendPromise
    .then(data => {
      res.render('contact-us-form-delivered', {
        static_path: '/static',
        theme: process.env.THEME || 'flatly',
        flask_debug: process.env.FLASK_DEBUG || 'false',
        pageTitle: 'Contact Us - Success',
        pageDescription: 'Succes - we\'ve sent an email to your chosen contact for you',
        message: 'Success - we\'ve sent your email to your chosen contact',
        canonical: ('https://' + req.get('host') + req.originalUrl).replace('www.\'', '').replace('.com', '.co.uk').replace('-badders.herokuapp', '-badminton')
      });
    })
    .catch(error => {
      return next('Sorry something went wrong sending your email.');
    });
});

router.post('/mail', multer().none(), contact_controller.distribution_list);
router.post('/mailtest', multer().none(), contact_controller.distribution_list);

// Scorecard routes
router.post('/scorecard-beta', scorecard_controller.validateScorecard, scorecard_controller.full_fixture_post);
router.post('/email-scorecard', scorecard_controller.validateScorecard, scorecard_controller.fixture_populate_scorecard_errors);
router.post('/add-scorecard-photo/:id', scorecard_controller.add_scorecard_photo);
router.post('/submit-form', (req, res, next) => {
  scorecard_controller.fixture_populate_scorecard(req.body, req, res, next);
});
router.get('/populated-scorecard-beta/:id', (req, res, next) => {
  scorecard_controller.fixture_populate_scorecard_fromId(req, res, next);
});

// Static pages
router.get('/privacy-policy', static_controller.privacy_policy);
router.get('/messer-rules', static_controller.messer_rules);
router.get('/messer-draw/:section', team_controller.new_messer_draw);
router.get('/messer-draw/:season/:section', team_controller.new_messer_draw);
router.get('/rules', static_controller.rules);

router.get('/approve-user/:userId', auth_controller.grantResultsAccess);

router.post('/new-users-v2', (req, res, next) => {
  const msg = {
    to: 'stockport.badders.results@gmail.com',
    from: 'stockport.badders.results@stockport-badminton.co.uk',
    subject: 'new user signup',
    text: 'a new user has signed up: ' + req.body.user,
    html: '<p>a new user has signed up: ' + req.body.user + '<br /><a href="https://stockport-badminton.co.uk/approve-user/' + req.body.id + '">Approve?</a></p>'
  };
  if (typeof req.body.id != 'undefined' && req.body.id.length > 3 && req.body.id != 'undefined') {
    var params = {
      Destination: {
        ToAddresses: ['stockport.badders.results@gmail.com'],
        BccAddresses: ['stockport.badders.results@gmail.com', 'bigcoops@outlook.com']
      },
      Message: {
        Body: { Html: { Charset: 'UTF-8', Data: '<p>a new user has signed up: ' + req.body.user + '<br /><a href="https://stockport-badminton.co.uk/approve-user/' + req.body.id + '">Approve?</a></p>' } },
        Subject: { Charset: 'UTF-8', Data: 'New User Signup' }
      },
      Source: 'results@stockport-badminton.co.uk',
      ReplyToAddresses: ['stockport.badders.results@gmail.com', req.body.contactEmail],
    };
    var ses = new AWS.SES({ apiVersion: '2010-12-01' });
    const sendPromise = ses.sendEmail(params).promise();
    sendPromise
      .then(() => { res.sendStatus(200); })
      .catch(error => { console.log(error.toString()); next('Sorry something went wrong sending your email.'); });
  } else {
    res.sendStatus(200);
  }
});

// Contact us
router.get('/contact-us', contact_controller.contactus_get);
router.post('/contact-us', contact_controller.validateContactUs, contact_controller.contactus);

// Player routes
router.post('/player/create', player_controller.player_create);
router.post('/manage-players/create', player_controller.player_create_from_team);
router.post('/player/batch-create', checkJwt, player_controller.player_batch_create);
router.get('/player/:id/delete', player_controller.player_delete_get);
router.delete('/player/:id', checkJwt, player_controller.player_delete);
router.get('/player/:id/update', player_controller.player_update_get);
router.get('/player/:id', player_controller.player_detail);
router.get('/playerStats/:id/:fullName', player_controller.player_game_data);
router.get('/eligiblePlayers/:id/:gender', player_controller.eligible_players_list);
router.get('/players/club-:clubid?/team-:teamid?/gender-:gender?', player_controller.player_list);
router.get('/players/matching/:name/:gender', player_controller.find_closest_matched_player);

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
router.post('/league/sendInvoices', contact_controller.send_invoices);
router.post('/league/sendInvoice/:club', contact_controller.send_invoices);
router.get('/league/:id', league_controller.league_detail);
router.get('/leagues', checkJwt, league_controller.league_list);
router.get('/tables/All', league_controller.all_league_tables);
router.get('/tables/All/:season', league_controller.all_league_tables);
router.get('/tables/:division', league_controller.league_table);
router.get('/tables/:division/:season', league_controller.league_table);

// Club routes
router.get('/club/create', club_controller.club_create_get);
router.post('/club/create', checkJwt, club_controller.club_create_post);
router.post('/club/batch-create', checkJwt, club_controller.club_batch_create);
router.get('/club/:id/delete', club_controller.club_delete_get);
router.delete('/club/:id', checkJwt, club_controller.club_delete_post);
router.get('/club/:id/update', club_controller.club_update_get);
router.patch('/club/:id', checkJwt, club_controller.club_update_post);
router.get('/clubs', club_controller.club_list);
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
router.post('/fixture/reminder', scorecard_controller.fixture_reminder_post);
router.get('/fixture/outstanding', fixture_controller.getLateScorecards);
router.get('/fixture/generate', fixtureGen_controller.genFixtures);
router.post('/fixture/short-result', fixture_controller.fixture_outstanding_post);
router.post('/fixture/create', checkJwt, fixture_controller.fixture_create_post);
router.post('/fixture/batch-create', checkJwt, fixture_controller.fixture_batch_create);
router.post('/fixture/enter-result', checkJwt, fixture_controller.fixture_update_by_team_name);
router.post('/fixture/rearrangement', fixture_controller.fixture_rearrange_by_team_name);
router.patch('/fixture/rearrange', checkJwt, fixture_controller.fixture_rearrange_by_team_name);
router.get('/fixture/:id/delete', fixture_controller.fixture_delete_get);
router.delete('/fixture/:id', checkJwt, fixture_controller.fixture_delete_post);
router.get('/fixture/:id/update', fixture_controller.fixture_update_get);
router.get('/fixture/home-:homeTeam/away-:awayTeam', fixture_controller.fixture_id_from_team_names);
router.get('/fixture/homeId-:homeTeam/awayId-:awayTeam', fixture_controller.fixture_id);
router.patch('/fixture/:id', checkJwt, fixture_controller.fixture_update_post);
router.get('/fixture/:id', checkJwt, fixture_controller.fixture_detail);
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
router.get('/gallery', static_controller.get_gallery);

// Wildcard fixture/result routes
router.get('/fixtures/*', fixture_controller.fixture_detail_byDivision);
router.get('/results/*', fixture_controller.fixture_detail_byDivision);
router.get('/calendars/*', fixture_controller.fixture_calendars);
router.get('/results-grid/*', fixture_controller.fixture_detail_byDivision);

// Secured routes
const secured = require('../middleware/secured');

router.post('/player/batch-update', secured, player_controller.player_batch_update);
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

router.get('/players/club-:club?/team-:team?/gender-:gender?', secured, player_controller.player_list_clubs_teams);
router.get('/players/club-:club?', secured, player_controller.player_list_clubs_teams);
router.get('/players/team-:team?', secured, player_controller.player_list_clubs_teams);
router.get('/players/gender-:gender?', secured, player_controller.player_list_clubs_teams);
router.get('/players', secured, player_controller.player_list_clubs_teams);
router.get('/missed-three', secured, player_controller.players_missed_three);
router.get('/manage-players/club-:club?', secured, player_controller.manage_player_list_clubs_teams);
router.get('/manage-players/:season?/club-:club?', secured, player_controller.manage_player_list_clubs_teams);
router.get('/player/create', secured, player_controller.player_create_get);
router.get('/players/eloPop', player_controller.player_elo_populate);
router.get('/player-stats/*', secured, player_controller.all_player_stats);
router.get('/player-stats', secured, player_controller.all_player_stats);
router.get('/pair-stats/*', secured, player_controller.all_pair_stats);
router.get('/pair-stats', secured, player_controller.all_pair_stats);

router.get('/club/:id', secured, club_controller.club_detail);
router.get('/club-api/:id', secured, club_controller.club_detail_api);
router.get('/admin/info/clubs', secured, club_controller.club_list_detail);
router.get('/short-results', secured, fixture_controller.fixture_outstanding);

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

router.use(function(error, req, res, next) {
  res.status(500);
  res.render('500-error', {
    static_path: '/static',
    pageTitle: 'HTTP 500 Error',
    pageDescription: 'HTTP 500 Error',
    error: error,
    canonical: ('https://' + req.get('host') + req.originalUrl).replace('www.\'', '').replace('.com', '.co.uk').replace('-badders.herokuapp', '-badminton')
  });
});

module.exports = router;
