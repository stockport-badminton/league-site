
    var AWS = require('aws-sdk');
    var express = require('express');
    var router = express.Router();
    var cookieParser = require('cookie-parser');
    var bodyParser = require('body-parser');
    var expressValidator = require('express-validator');
    var path = require('path');
    const jwt = require('express-jwt');
    const jwtAuthz = require('express-jwt-authz');
    const jwksRsa = require('jwks-rsa');

    if (!process.env.AUTH0_DOMAIN || !process.env.AUTH0_AUDIENCE) {
      throw 'Make sure you have AUTH0_DOMAIN, and AUTH0_AUDIENCE in your .env file';
    }

    // Authentication middleware. When used, the
    // Access Token must exist and be verified against
    // the Auth0 JSON Web Key Set
    const checkJwt = jwt({
      // Dynamically provide a signing key
      // based on the kid in the header and
      // the signing keys provided by the JWKS endpoint.
      secret: jwksRsa.expressJwtSecret({
        cache: true,
        rateLimit: true,
        jwksRequestsPerMinute: 5,
        jwksUri: `https://${process.env.AUTH0_DOMAIN}/.well-known/jwks.json`
      }),

      // Validate the audience and the issuer.
      algorithms: ['RS256']
    });

    AWS.config.update({
      region: 'eu-west-1'
    });

    var app = express();
    app.use('/static', express.static(path.join(__dirname,'/static')));
    app.set('view engine', 'ejs');
    app.set('views', __dirname + '/views');
    app.use(bodyParser.json());
    app.use(bodyParser.urlencoded({extended:false}));
    app.use(expressValidator());
    app.set('node_modules', __dirname + '/node_modules');
    app.set('models', __dirname + '/models');

    var db = require('./db_connect');
    var port = process.env.PORT || 3000;
    // Connect to MySQL on start
    db.connect(function(err) {
      if (err) {
        console.log('Unable to connect to MySQL.')
        process.exit(1)
      } else {
        var server = app.listen(port, function() {
          console.log('Server running at http://127.0.0.1:' + port + '/')
        })
      }
    })


    // Require controller modules
    var venue_controller = require(__dirname + '/controllers/venueController');
    var team_controller = require(__dirname + '/controllers/teamController');
    var player_controller = require(__dirname + '/controllers/playerController');
    var club_controller = require(__dirname + '/controllers/clubController');
    var division_controller = require(__dirname + '/controllers/divisionController');
    var game_controller = require(__dirname + '/controllers/gameController');
    var fixture_controller = require(__dirname + '/controllers/fixtureController');
    var league_controller = require(__dirname + '/controllers/leagueController');



    app.get('/', function(req, res) {
        res.render('beta/homepage', {
            static_path: '/static',
            theme: process.env.THEME || 'flatly',
            flask_debug: process.env.FLASK_DEBUG || 'false'
        });
    });

    app.get('/contact-us', function(req, res) {
        res.render('beta/contact-us-form', {
            static_path: '/static',
            theme: process.env.THEME || 'flatly',
            flask_debug: process.env.FLASK_DEBUG || 'false'
        });
    });

    app.post('/contact-us', (req, res) => {
      req.checkBody('contactEmail', 'must enter an email address').notEmpty();
      req.checkBody('contactQuery', 'Please enter something in message field.').notEmpty();

      req.sanitize('contactQuery').escape();
      req.sanitize('contactQuery').trim();

      var errors = req.validationErrors();
      if (errors) {
          console.log(errors);
          res.render('beta/contact-us-form-delivered', { title: 'Contact Us - Error', static_path:'/static', theme:'flatly', content: errors});
      return;
      }
      else {
      console.log(req.body);
      var params = {
        Destination: { /* required */
          ToAddresses: [
          ]
        },
        Message: { /* required */
          Body: {
            Html: {
             Charset: 'UTF-8',
             Data: 'contact from the website:<br />'+ req.body.contactQuery +'<br /> from email address:'+req.body.contactEmail
            }
           },
           Subject: {
            Charset: 'UTF-8',
            Data: 'Somebody is trying to get in touch'
           }
          },
        Source: 'stockport.badders.results@gmail.com', /* required */
        ReplyToAddresses: [
            'stockport.badders.results@gmail.com'
        ],
      };
      var clubEmail = '';
      if(req.body.contactType == 'Clubs'){
        switch (req.body.clubSelect) {
          case 'Aerospace':
            params.Destination.ToAddresses = ['santanareedy@btinternet.com'];
          break;
          case 'AstraZeneca':
            params.Destination.ToAddresses = ['mel.curwen@ntlworld.com'];

          break;
          case 'AltrinchamCentral':
            params.Destination.ToAddresses = ['janecave53@gmail.com'];

          break;
          case 'BramhallQueensgate':
            params.Destination.ToAddresses = ['jjackson1969@btinternet.com'];

          break;
          case 'CAP':
            params.Destination.ToAddresses = ['dave_haigh@hotmail.co.uk'];

          break;
          case 'Canute':
            params.Destination.ToAddresses = ['canutesecretary@gmail.com'];

          break;
          case 'Carrington':
            params.Destination.ToAddresses = ['darrel@thegoughfamily.co.uk'];

          break;
          case 'CheadleHulme':
            params.Destination.ToAddresses = ['doug.grant@ntlworld.com'];

          break;
          case 'CollegeGreen':
            params.Destination.ToAddresses = ['paulakite@yahoo.co.uk'];

          break;
          case 'DavidLloyd':
            params.Destination.ToAddresses = ['dr_barks@yahoo.co.uk'];

          break;
          case 'Disley':
            params.Destination.ToAddresses = ['julian.cherryman@gmail.com','karlcramp@aol.com'];

          break;
          case 'Dome':
            params.Destination.ToAddresses = ['janet_knowles@ymail.com'];

          break;
          case 'GHAP':
            params.Destination.ToAddresses = ['rossowen40@hotmail.com'];

          break;
          case 'Macclesfield':
            params.Destination.ToAddresses = ['sueorwin@btinternet.com'];

          break;
          case 'Manor':
            params.Destination.ToAddresses = ['jo.woolley@tiscali.co.uk'];

          break;
          case 'Mellor':
            params.Destination.ToAddresses = ['enquiries@mellorbadminton.org.uk'];

          break;
          case 'NewMills':
            params.Destination.ToAddresses = ['bandibates@tiscali.co.uk'];

          break;
          case 'ParrsWood':
            params.Destination.ToAddresses = ['mikegreatorex@btinternet.com'];

          break;
          case 'Poynton':
            params.Destination.ToAddresses = ['ian.anderson12@ntlworld.com'];

          break;
          case 'Racketeer':
            params.Destination.ToAddresses = ['theracketeer@hotmail.com'];

          break;
          case 'Shell':
            params.Destination.ToAddresses = ['annawiza@aol.co.uk'];

          break;
          case 'SyddalPark':
            params.Destination.ToAddresses = ['derek.hillesdon@gmail.com'];

          break;
          case 'Tatton':
            params.Destination.ToAddresses = ['plumley123@btinternet.com'];

          break;
          default:
            params.Destination.ToAddresses = ['stockport.badders.results@gmail.com'];

        }
      }
      if (req.body.contactType == 'League'){
        switch (req.body.leagueSelect) {
          case 'results':
            params.Destination.ToAddresses = ['stockport.badders.results@gmail.com','neil.cooper.241180@gmail.com']
            break;
          case 'tournament':
            params.Destination.ToAddresses = ['sueorwin@btinternet.com']
            break;
          case 'league':
            params.Destination.ToAddresses = ['leaguesec.sdbl@gmail.com']
            break;
          case 'chair':
            params.Destination.ToAddresses = ['walkerd.sdbl@gmail.com']
            break;
          case 'messer':
            params.Destination.ToAddresses = ['sueorwin@btinternet.com']
            break;
          case 'junior':
            params.Destination.ToAddresses = ['stuartscoffins@btinternet.com']
            break;
          case 'juniortournament':
            params.Destination.ToAddresses = ['aim@talktalk.net']
            break;
          case 'treasurer':
            params.Destination.ToAddresses = ['rossowen40@hotmail.com']
            break;
          default:
        }
      }

      // Create sendEmail params


      console.log(params);
      var ses = new AWS.SES({apiVersion: '2010-12-01'});

      ses.sendEmail(params, function(err, data) {
        if (err) {
          console.log(err, err.stack); // an error occurred
        }
        else {
          console.log(data);           // successful response
          res.render('beta/contact-us-form-delivered', {
                static_path: '/static',
                theme: process.env.THEME || 'flatly',
                flask_debug: process.env.FLASK_DEBUG || 'false'
            });
        }
      });


      }
    });

    app.get('/tables/:league', function(req, res) {
        res.render('beta/table-' + req.params.league, {
            static_path: '/static',
            theme: process.env.THEME || 'flatly',
            flask_debug: process.env.FLASK_DEBUG || 'false'
        });
    });

    app.get('/results/:league', function(req, res) {
        res.render('beta/results-' + req.params.league, {
            static_path: '/static',
            theme: process.env.THEME || 'flatly',
            flask_debug: process.env.FLASK_DEBUG || 'false'
        });
    });

    app.get('/info/clubs', function(req, res) {
        res.render('beta/clubs', {
            static_path: '/static',
            theme: process.env.THEME || 'flatly',
            flask_debug: process.env.FLASK_DEBUG || 'false'
        });
    });

    /// PLAYER ROUTES ///

    /* GET catalog home page. */
    router.get('/players',checkJwt, player_controller.index);

    /* GET request for creating a Player. NOTE This must come before routes that display Player (uses id) */
    router.get('/player/create', player_controller.player_create_get);

    /* POST request for creating Player. */
    router.post('/player/create',checkJwt, player_controller.player_create);

    /* GET request to delete Player. */
    router.get('/player/:id/delete', player_controller.player_delete_get);

    // POST request to delete Player
    router.delete('/player/:id',checkJwt, player_controller.player_delete);

    /* GET request to update Player. */
    router.get('/player/:id/update', player_controller.player_update_get);

    // PATCH request to update Player
    router.patch('/player/:id',checkJwt, player_controller.player_update_post);

    /* GET request for one Player. */
    router.get('/player/:id', player_controller.player_detail);

    /* GET request for list of all Player items. */
    router.get('/players/club-:clubid?/team-:teamid?/gender-:gender?', player_controller.player_list);

    /// TEAM ROUTES ///

    /* GET request for creating a Team. NOTE This must come before routes that display Team (uses id) */
    router.get('/team/create', team_controller.team_create_get);

    /* POST request for creating Team. */
    router.post('/team/create',checkJwt, team_controller.team_create_post);

    /* GET request to delete Team. */
    router.get('/team/:id/delete', team_controller.team_delete_get);

    // POST request to delete Team
    router.delete('/team/:id',checkJwt, team_controller.team_delete_post);

    /* GET request to update Team. */
    router.get('/team/:id/update', team_controller.team_update_get);

    // POST request to update Team
    router.patch('/team/:id',checkJwt, team_controller.team_update_post);

    /* GET request for one Team. */
    router.get('/team/:id', team_controller.team_detail);

    /* GET request for list of all Team items.
    router.get('/teams/:clubid/:venue/:matchDay', team_controller.team_list); */

    /* GET request for list of all Team items. */
    router.get('/teams',checkJwt, team_controller.team_list);

    /// LEAGUE ROUTES ///

    /* GET request for creating a League. NOTE This must come before routes that display League (uses id) */
    router.get('/league/create', league_controller.league_create_get);

    /* POST request for creating League. */
    router.post('/league/create',checkJwt, league_controller.league_create_post);

    /* GET request to delete League. */
    router.get('/league/:id/delete', league_controller.league_delete_get);

    // DELETE request to delete League
    router.delete('/league/:id',checkJwt, league_controller.league_delete);

    /* GET request to update League. */
    router.get('/league/:id/update', league_controller.league_update_get);

    // POST request to update League
    router.patch('/league/:id',checkJwt, league_controller.league_update);

    /* GET request for one League. */
    router.get('/league/:id', league_controller.league_detail);

    /* GET request for list of all League items. */
    router.get('/leagues',checkJwt, league_controller.league_list);

    /// CLUB ROUTES ///

    /* GET request for creating a Club. NOTE This must come before routes that display Club (uses id) */
    router.get('/club/create', club_controller.club_create_get);

    /* POST request for creating Club. */
    router.post('/club/create',checkJwt, club_controller.club_create_post);

    /* GET request to delete Club. */
    router.get('/club/:id/delete', club_controller.club_delete_get);

    // POST request to delete Club
    router.delete('/club/:id',checkJwt, club_controller.club_delete_post);

    /* GET request to update Club. */
    router.get('/club/:id/update', club_controller.club_update_get);

    // POST request to update Club
    router.patch('/club/:id',checkJwt, club_controller.club_update_post);

    /* GET request for one Club. */
    router.get('/club/:id',checkJwt, club_controller.club_detail);

    /* GET request for list of all Club items. */
    router.get('/clubs',checkJwt, club_controller.club_list);

    /// DIVISION ROUTES ///

    /* GET request for creating a Division. NOTE This must come before routes that display Division (uses id) */
    router.get('/division/create', division_controller.division_create_get);

    /* POST request for creating Division. */
    router.post('/division/create',checkJwt, division_controller.division_create_post);

    /* GET request to delete Division. */
    router.get('/division/:id/delete', division_controller.division_delete_get);

    // POST request to delete Division
    router.delete('/division/:id',checkJwt, division_controller.division_delete_post);

    /* GET request to update Division. */
    router.get('/division/:id/update', division_controller.division_update_get);

    // POST request to update Division
    router.patch('/division/:id',checkJwt, division_controller.division_update_post);

    /* GET request for one Division. */
    router.get('/division/:id',checkJwt, division_controller.division_detail);

    /* GET request for list of all Division items. */
    router.get('/divisions',checkJwt, division_controller.division_list);

    /// FIXTURE ROUTES ///

    /* GET request for creating a Fixture. NOTE This must come before routes that display Fixture (uses id) */
    router.get('/fixture/create', fixture_controller.fixture_create_get);

    /* POST request for creating Fixture. */
    router.post('/fixture/create',checkJwt, fixture_controller.fixture_create_post);

    /* POST request for batch creating Fixture. */
    router.post('/fixture/batch-create',checkJwt, fixture_controller.fixture_batch_create);

    /* GET request to delete Fixture. */
    router.get('/fixture/:id/delete', fixture_controller.fixture_delete_get);

    // POST request to delete Fixture
    router.delete('/fixture/:id',checkJwt, fixture_controller.fixture_delete_post);

    /* GET request to update Fixture. */
    router.get('/fixture/:id/update', fixture_controller.fixture_update_get);

    // POST request to update Fixture
    router.patch('/fixture/:id',checkJwt, fixture_controller.fixture_update_post);

    /* GET request for one Fixture. */
    router.get('/fixture/:id',checkJwt, fixture_controller.fixture_detail);

    /* GET request for list of all Fixture items. */
    router.get('/fixtures',checkJwt, fixture_controller.fixture_list);

    /// GAME ROUTES ///

    /* GET request for creating a Game. NOTE This must come before routes that display Game (uses id) */
    router.get('/game/create', game_controller.game_create_get);

    /* POST request for creating Game. */
    router.post('/game/create',checkJwt, game_controller.game_create_post);

    /* GET request to delete Game. */
    router.get('/game/:id/delete', game_controller.game_delete_get);

    // POST request to delete Game
    router.delete('/game/:id',checkJwt, game_controller.game_delete_post);

    /* GET request to update Game. */
    router.get('/game/:id/update', game_controller.game_update_get);

    // POST request to update Game
    router.patch('/game/:id',checkJwt, game_controller.game_update_post);

    /* GET request for one Game. */
    router.get('/game/:id',checkJwt, game_controller.game_detail);

    /* GET request for list of all Game items. */
    router.get('/games',checkJwt, game_controller.game_list);

    /// VENUE ROUTES ///

    /* GET request for creating a Venue. NOTE This must come before routes that display Venue (uses id) */
    router.get('/venue/create', venue_controller.venue_create_get);

    /* POST request for creating Venue. */
    router.post('/venue/create',checkJwt, venue_controller.venue_create_post);

    /* POST request for batch creating Venue. */
    router.post('/venue/batchCreate',checkJwt, venue_controller.venue_batch_create);

    /* GET request to delete Venue. */
    router.get('/venue/:id/delete', venue_controller.venue_delete_get);

    // POST request to delete Venue
    router.delete('/venue/:id',checkJwt, venue_controller.venue_delete_post);

    /* GET request to update Venue. */
    router.get('/venue/:id/update', venue_controller.venue_update_get);

    // POST request to update Venue
    router.patch('/venue/:id',checkJwt, venue_controller.venue_update_post);

    /* GET request for one Venue. */
    router.get('/venue/:id',checkJwt, venue_controller.venue_detail);

    /* GET request for list of all Venue items. */
    router.get('/venues',checkJwt, venue_controller.venue_list);

    app.use('/',router);
