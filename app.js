
    var AWS = require('aws-sdk');
    var express = require('express');
    var router = express.Router();
    var cookieParser = require('cookie-parser');
    var bodyParser = require('body-parser');
    var expressValidator = require('express-validator');
    var path = require('path');
    var request = require('request');
    const jwt = require('express-jwt');
    const jwtAuthz = require('express-jwt-authz');
    const jwksRsa = require('jwks-rsa');
    const formidable = require('formidable')
    const exceljs = require('exceljs')
    const fs = require('fs');
    const sgMail = require('@sendgrid/mail');
    sgMail.setApiKey(process.env.SENDGRID_API_KEY);
    var logger = require('logzio-nodejs').createLogger({
      token: process.env.LOGZ_SECRET,
      host: 'listener.logz.io'
    });
    const compression = require ('compression');

    if (!process.env.AUTH0_DOMAIN || !process.env.AUTH0_AUDIENCE) {
      throw 'Make sure you have AUTH0_DOMAIN, and AUTH0_AUDIENCE in your .env file';
    }

    const S3_BUCKET_NAME = process.env.S3_BUCKET_NAME;
   
    // Authentication middleware. When used, the
    // Access Token must exist and be verified against
    // the Auth0 JSON Web Key Set
    const checkJwt = jwt({
      // Dynamically provide a signing key
      // based on the key in the header and
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
    app.use(compression());
    app.use('/static', express.static(path.join(__dirname,'/static')));
    app.use('/scripts', express.static(__dirname + '/node_modules/'));

    app.use(express.static('rootfiles'));
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
          console.log('Server running at http://127.0.0.1:' + port + '/');
        })
      }
    })

    var session = require('express-session');
    // config express-session
    var sess = {
      secret: 'ThisisMySecret',
      cookie: {},
      resave: false,
      saveUninitialized: true
    };

    if (app.get('env') === 'production') {
      app.set('trust proxy', 1); // trust first proxy
      sess.cookie.secure = true; // serve secure cookies, requires https
    }  

    app.use(session(sess));

    var passport = require('passport');
    var Auth0Strategy = require('passport-auth0');

    // Configure Passport to use Auth0
    var strategy = new Auth0Strategy(
      {
        domain: process.env.AUTH0_DOMAIN,
        clientID: process.env.AUTH0_CLIENTID,
        clientSecret: process.env.AUTH0_CLIENT_SECRET,
        callbackURL:
          process.env.AUTH0_CALLBACK_URL || 'http://127.0.0.1:3000/callback'
      },
      function (accessToken, refreshToken, extraParams, profile, done) {
        // accessToken is the token to call Auth0 API (not needed in the most cases)
        // extraParams.id_token has the JSON Web Token
        // profile has all the information from the user
        return done(null, profile);
      }
    );

    passport.use(strategy);
    app.use(passport.initialize());
    app.use(passport.session());

    // You can use this section to keep a smaller payload
    passport.serializeUser(function (user, done) {
      done(null, user);
    });

    passport.deserializeUser(function (user, done) {
      done(null, user);
    });

    


    // Require controller modules
    var venue_controller = require(__dirname + '/controllers/venueController');
    var team_controller = require(__dirname + '/controllers/teamController');
    var player_controller = require(__dirname + '/controllers/playerController');
    var club_controller = require(__dirname + '/controllers/clubController');
    var division_controller = require(__dirname + '/controllers/divisionController');
    var game_controller = require(__dirname + '/controllers/gameController');
    var fixture_controller = require(__dirname + '/controllers/fixtureController');
    var league_controller = require(__dirname + '/controllers/leagueController');
    var fixtureGen_controller = require(__dirname + '/controllers/fixtureGenerator');
    var contact_controller = require(__dirname + '/controllers/contactusController');
    var static_controller = require(__dirname + '/controllers/staticPagesController');
    var userInViews = require(__dirname + '/models/userInViews');
    var secured = require(__dirname + '/models/secured');
    var auth_controller = require(__dirname + '/models/auth.js');

    app.use(userInViews())

    app.get('/login', passport.authenticate('auth0', {
      scope: 'openid email profile'
    }), function (req, res) {
      res.redirect('/');
    });

    app.get('/chooseUser',function(req,res,next){
      console.log(req.query.state)
      res.redirect('https://'+ process.env.AUTH0_DOMAIN + '/continue?state='+req.query.state);
    })

    app.get('/resultImage/:homeTeam/:awayTeam/:homeScore/:awayScore/:division',function(req,res,next){
      loadImage('static/beta/images/bg/social-'+ req.params.division +'.png').then((image) => {
        ctx.drawImage(image, 0,0,1080, 1350)
        ctx.font = 'bold 60px Arial'
        ctx.fillStyle = 'White'
        ctx.textAlign = 'right'
        var text = "Result: "+ req.params.homeTeam +" vs <br> "+ req.params.awayTeam +" <br> "+ req.params.homeScore +"-"+ req.params.awayScore +" <br> #stockport #badminton #sdbl #result https://stockport-badminton.co.uk"
        var words = text.split(' ');
        var line = '';
        var y = canvas.height/2 + canvas.width/4;
        var x = (canvas.width - 100);
        var lineHeight = 80;
        for(var n = 0; n < words.length; n++) {
          if (line.indexOf('#') > -1 || line.indexOf('http') > -1){
            ctx.font = 'normal 30px Arial';
            lineHeight = 40;
          }
          if (words[n] == '<br>'){
            ctx.fillText(line, x, y);
            line = '';
            y += lineHeight;
          }
          else {
            var testLine = line + words[n] + ' ';
            var metrics = ctx.measureText(testLine);
            var testWidth = metrics.width;
            if (testWidth > 900 && n > 0) {
              ctx.fillText(line, x, y);
              line = words[n] + ' ';
              y += lineHeight;
            }
            else {
              line = testLine;
            }
          }
        }
        ctx.fillText(line, x, y);
        /*const fs = require('fs')
        const out = fs.createWriteStream('static/beta/images/generated/'+req.params.homeTeam.replace(/([\s]{1,})/g,'-')+req.params.awayTeam.replace(/([\s]{1,})/g,'-')+'.jpg')
        const stream = canvas.createJPEGStream()
        stream.pipe(out)
        out.on('finish', () =>  {
          console.log('The Jpg file was created.')
          res.render('beta/resultImage', {
            static_path:'/static',
            theme:process.env.THEME || 'flatly',
            pageTitle : "Result Image",
            pageDescription : "Result Image",
            result:canvas.toDataURL()
          });*/
          const buffer = canvas.toBuffer("image/jpeg");
          res.write(buffer);
        /* }
          ) */
      })
    })

    // Perform the final stage of authentication and redirect to previously requested URL or homepage ('/')
    app.get('/callback', function (req, res, next) {
      passport.authenticate('auth0', function (err, user, info) {
        console.log('USER:')
        console.log(user)
        console.log('INFO:')
        console.log(info)
        if (err) { return next(err); }
        if (!user) {
          //console.log(req);
          res.render('beta/failed-login', {
            static_path:'/static',
            theme:process.env.THEME || 'flatly',
            pageTitle : "Access Denied",
            pageDescription : "Access Denied",
            query:req.query
          });
        }
        else {
          req.logIn(user, function (err) {
            if (err) { return next(err); }
            const returnTo = req.session.returnTo;
            delete req.session.returnTo;
            res.redirect(returnTo || '/');
          });
        }
      })(req, res, next);
    });

    // Perform session logout and redirect to homepage
    app.get('/logout', (req, res) => {
      req.logout();
      res.redirect('https://'+ process.env.AUTH0_DOMAIN + '/v2/logout?clientid='+ process.env.AUTH0_CLIENTID +'returnTo=https://'+ req.headers.host);
    });

    app.get('/user', secured(), function (req, res, next) {
      const { _raw, _json, userProfile } = req.user;
      res.render('beta/user', {
        userProfile: JSON.stringify(userProfile, null, 2),
        static_path:'/static',
        theme:process.env.THEME || 'flatly',
        pageTitle : "User Profile",
        pageDescription : "User Profile",
      });
    });

    //GET to return signed S3 url for uploading scorecards
    app.get('/sign-s3', (req, res) => {
      const s3 = new AWS.S3();
      const fileName = req.query['file-name'];
      const fileType = req.query['file-type'];
      const s3Params = {
        Bucket: S3_BUCKET_NAME,
        Key: fileName,
        Expires: 60,
        ContentType: fileType,
        ACL: 'public-read'
      };
    
      s3.getSignedUrl('putObject', s3Params, (err, data) => {
        if(err){
          console.log(err);
          return res.end();
        }
        const returnData = {
          signedRequest: data,
          url: 'https://'+ S3_BUCKET_NAME + '.s3-eu-west-1.amazonaws.com/'+encodeURIComponent(fileName)
        };
        res.write(JSON.stringify(returnData));
        res.end();
      });
    });

    


    app.get('/upload-scoresheet',fixture_controller.upload_scoresheet)

// for handling sendgrid parse 
    const multer  = require('multer');
    const upload = multer();
      app.post('/mail', upload.none(), function(req,res){
        console.log(req.body.from);
        console.log(req.body.to);
        console.log(req.body.subject);
        logger.log(req.body.html);
        res.sendStatus(200);
    }); 


    // Scorecard - Results Entry related routes

    //GET to display a scorecard without the modal - not currently in use, but could be developed if there was a need for it
    app.get('/scorecard-beta-nonmodal', secured(), fixture_controller.scorecard_nonmodal);

    //GET for displaying a results entry form - may be redundant - although this one doesn't have the option to upload a photo of your scorecard
    app.get('/scorecard-beta', secured(), fixture_controller.scorecard_beta);

    //GET for displaying results entry for for users
    app.get('/email-scorecard', secured(), fixture_controller.email_scorecard);

    //POST for processing results entry form - possibly redundant.
    app.post('/scorecard-beta',fixture_controller.validateScorecard, fixture_controller.full_fixture_post);

    // static page to display scorecard received messages - likely not being used
    app.get('/scorecard-received',fixture_controller.scorecard_received);
    
    // url for testing upload of scorecards
    /* app.get('/scorecard-upload', fixture_controller.scorecard_upload); */

    // post for processing results from entry form and emailing admin with confirmation link and link to scorecard photo
    app.post('/email-scorecard', fixture_controller.validateScorecard, fixture_controller.fixture_populate_scorecard_errors);

    // post for processing results from excel spreadsheet
    app.post('/submit-form', (req,res,next) => {
      var data = [];
      data = req.body;
      logger.log(req.body)
      fixture_controller.fixture_populate_scorecard(data,req,res,next)
    });

    //GET for displaying a populated form for the admin to review and confirm
    //TODO check larger file uploads & pdfs
    app.get('/populated-scorecard/:division/:home_team/:away_team/:home_man_1/:home_man_2/:home_man_3/:home_lady_1/:home_lady_2/:home_lady_3/:away_man_1/:away_man_2/:away_man_3/:away_lady_1/:away_lady_2/:away_lady_3/:Game1homeScore/:Game1awayScore/:Game2homeScore/:Game2awayScore/:Game3homeScore/:Game3awayScore/:Game4homeScore/:Game4awayScore/:Game5homeScore/:Game5awayScore/:Game6homeScore/:Game6awayScore/:Game7homeScore/:Game7awayScore/:Game8homeScore/:Game8awayScore/:Game9homeScore/:Game9awayScore/:Game10homeScore/:Game10awayScore/:Game11homeScore/:Game11awayScore/:Game12homeScore/:Game12awayScore/:Game13homeScore/:Game13awayScore/:Game14homeScore/:Game14awayScore/:Game15homeScore/:Game15awayScore/:Game16homeScore/:Game16awayScore/:Game17homeScore/:Game17awayScore/:Game18homeScore/:Game18awayScore', (req,res,next) => {
      logger.log(req.params)
      fixture_controller.fixture_populate_scorecard_fromUrl(req,res,next)
    })

    app.get('/populated-scorecard-beta/:id',(req,res,next) => {
      console.log(req.body);
      fixture_controller.fixture_populate_scorecard_fromId(req,res,next)
    })


    // Static page routes
    app.get('/privacy-policy', static_controller.privacy_policy);
    app.get('/messer-rules', static_controller.messer_rules);
    app.get('/rules', static_controller.rules);

    // POST to process input from Auth0 when non-authorised user attempt to use secure pages on the site and email the admin
    // TODO - prevent duplicate emails being sent when an existing user in Auth0 gets bounced out again because they're not authorised still.

    app.get('/approve-user/:userId',auth_controller.grantResultsAccess);

    app.post('/new-users',(req,res,next) => {
      console.log("req.query");
      console.log(req.query.user);
      console.log(req.query.id);
      // console.log("req.params");
      // console.log(req.params);
      const msg = {
        to: 'stockport.badders.results@gmail.com',
        from: 'stockport.badders.results@stockport-badminton.co.uk',
        subject: 'new user signup',
        text: 'a new user has signed up: ' + req.query.user,
        html: '<p>a new user has signed up: '+ req.query.user +'<br /><a href="https://stockport-badminton.co.uk/approve-user/auth0|'+req.query.id+'">Approve?</a></p>'
      };
      sgMail.send(msg)
          .then(()=>{
            logger.log(msg);
            console.log(msg)
            res.sendStatus(200);
          })
          .catch(error => {
            logger.log(error.toString());
            next("Sorry something went wrong sending your email.");
          })
    })

    /* contact us routes */
    app.get('/contact-us', contact_controller.contactus_get);
    app.post('/contact-us',contact_controller.validateContactUs, contact_controller.contactus);

    /// PLAYER ROUTES ///

    /* player listing / filtering routes */
    router.get('/players/club-:club?/team-:team?/gender-:gender?', secured(),player_controller.player_list_clubs_teams);
    router.get('/players/club-:club?', secured(),player_controller.player_list_clubs_teams);
    router.get('/players/team-:team?', secured(),player_controller.player_list_clubs_teams);
    router.get('/players/gender-:gender?', secured(),player_controller.player_list_clubs_teams);
    router.get('/players', secured(),player_controller.player_list_clubs_teams);

    /* GET request for creating a Player. NOTE This must come before routes that display Player (uses id) */
    router.get('/player/create',secured(), player_controller.player_create_get);

    /* POST request for creating Player. */
    router.post('/player/create', player_controller.player_create);

    /* POST request for batch creating Fixture. */
    router.post('/player/batch-create',checkJwt, player_controller.player_batch_create);

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

    /* GET request for one Player. */
    router.get('/playerStats/:id/:fullName', player_controller.player_game_data);

    /* player stats routes and filters. */

    router.get('/player-stats/division-:divisionId?/game-:gameType?', player_controller.all_player_stats);
    router.get('/player-stats/game-:gameType?/division-:divisionId?', player_controller.all_player_stats);
    router.get('/player-stats/division-:divisionId?', player_controller.all_player_stats);
    router.get('/player-stats/game-:gameType?', player_controller.all_player_stats);
    router.get('/player-stats/club-:club?/division-:divisionId?/game-:gameType?', player_controller.all_player_stats);
    router.get('/player-stats/club-:club?/division-:divisionId?', player_controller.all_player_stats);
    router.get('/player-stats/club-:club?/game-:gameType?', player_controller.all_player_stats);
    router.get('/player-stats/club-:club?', player_controller.all_player_stats);
    router.get('/player-stats/team-:team?/division-:divisionId?/game-:gameType?', player_controller.all_player_stats);
    router.get('/player-stats/team-:team?/division-:divisionId?', player_controller.all_player_stats);
    router.get('/player-stats/team-:team?/game-:gameType?', player_controller.all_player_stats);
    router.get('/player-stats/team-:team?', player_controller.all_player_stats);
    router.get('/player-stats/:season?/division-:divisionId?/game-:gameType?', player_controller.all_player_stats);
    router.get('/player-stats/:season?/division-:divisionId?', player_controller.all_player_stats);
    router.get('/player-stats/:season?/game-:gameType?', player_controller.all_player_stats);
    router.get('/player-stats/:season?', player_controller.all_player_stats);

    router.get('/pair-stats/division-:divisionId?/game-:gameType?', player_controller.all_pair_stats);
    router.get('/pair-stats/game-:gameType?/division-:divisionId?', player_controller.all_pair_stats);
    router.get('/pair-stats/division-:divisionId?', player_controller.all_pair_stats);
    router.get('/pair-stats/game-:gameType?', player_controller.all_pair_stats);
    router.get('/pair-stats/club-:club?/division-:divisionId?/game-:gameType?', player_controller.all_pair_stats);
    router.get('/pair-stats/club-:club?/division-:divisionId?', player_controller.all_pair_stats);
    router.get('/pair-stats/club-:club?/game-:gameType?', player_controller.all_pair_stats);
    router.get('/pair-stats/club-:club?', player_controller.all_pair_stats);
    router.get('/pair-stats/team-:team?/division-:divisionId?/game-:gameType?', player_controller.all_pair_stats);
    router.get('/pair-stats/team-:team?/division-:divisionId?', player_controller.all_pair_stats);
    router.get('/pair-stats/team-:team?/game-:gameType?', player_controller.all_pair_stats);
    router.get('/pair-stats/team-:team?', player_controller.all_pair_stats);
    router.get('/pair-stats/:season?/division-:divisionId?/game-:gameType?', player_controller.all_pair_stats);
    router.get('/pair-stats/:season?/division-:divisionId?', player_controller.all_pair_stats);
    router.get('/pair-stats/:season?/game-:gameType?', player_controller.all_pair_stats);
    router.get('/pair-stats/:season?', player_controller.all_pair_stats);

    router.get('/pair-stats', player_controller.all_pair_stats);

    /* GET request for one Player. */
    router.get('/player-stats', player_controller.all_player_stats);

    /* GET request for one Player. */
    router.get('/eligiblePlayers/:id/:gender', player_controller.eligible_players_list);

    /* GET request for list of all Player items. */
    router.get('/players/club-:clubid?/team-:teamid?/gender-:gender?', player_controller.player_list);

    /// TEAM ROUTES ///

    /* GET request for creating a Team. NOTE This must come before routes that display Team (uses id) */
    router.get('/team/create', team_controller.team_create_get);

    /* POST request for creating Team. */
    router.post('/team/create',checkJwt, team_controller.team_create_post);

    /* POST request for batch creating Fixture. */
    router.post('/team/batch-create',checkJwt, team_controller.teams_batch_create);


    /* GET request to delete Team. */
    router.get('/team/:id/delete', team_controller.team_delete_get);

    // POST request to delete Team
    router.delete('/team/:id',checkJwt, team_controller.team_delete_post);

    /* GET request to update Team. */
    router.get('/team/:id/update', team_controller.team_update_get);

    // POST request to update Team
    router.patch('/team/:id',checkJwt, team_controller.team_update_post);

    /* GET request for one Team. */
    // TODO: create page showing: players registered, results, fixtures, league table with highlighted name
    router.get('/team/:id', team_controller.team_detail);

    /* GET request for list of all Team items.
    router.get('/teams/:clubid/:venue/:matchDay', team_controller.team_list); */

    /* GET request for list of all Team items. */
    router.get('/teams', team_controller.team_list);

    /* GET request for list of all Team items. */
    router.post('/teams', team_controller.team_search);

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

    /* GET request for list of all League items. */
    router.get('/tables/All', league_controller.all_league_tables);
    router.get('/tables/All/:season', league_controller.all_league_tables);

    /* GET request for list of all League items. */
    router.get('/tables/:division', league_controller.league_table);
    router.get('/tables/:division/:season', league_controller.league_table);



    /// CLUB ROUTES ///

    /* GET request for creating a Club. NOTE This must come before routes that display Club (uses id) */
    router.get('/club/create', club_controller.club_create_get);

    /* POST request for creating Club. */
    router.post('/club/create',checkJwt, club_controller.club_create_post);

    /* POST request for batch creating Fixture. */
    router.post('/club/batch-create',checkJwt, club_controller.club_batch_create);


    /* GET request to delete Club. */
    router.get('/club/:id/delete', club_controller.club_delete_get);

    // POST request to delete Club
    router.delete('/club/:id',checkJwt, club_controller.club_delete_post);

    /* GET request to update Club. */
    router.get('/club/:id/update', club_controller.club_update_get);

    // POST request to update Club
    router.patch('/club/:id',checkJwt, club_controller.club_update_post);

    /* GET request for one Club. */
    // TODO: Create page showing teams, venue, club night and match night details, player stats for the club, team registrations
    router.get('/club/:id',checkJwt, club_controller.club_detail);

    /* GET request for list of all Club items. */
    router.get('/clubs', club_controller.club_list);

    /* GET request for list of all Club items. */
    router.get('/info/clubs', club_controller.club_list_detail);

    /// DIVISION ROUTES ///

    /* GET request for creating a Division. NOTE This must come before routes that display Division (uses id) */
    router.get('/division/create', division_controller.division_create_get);

    /* POST request for creating Division. */
    router.post('/division/create',checkJwt, division_controller.division_create_post);

    /* POST request for batch creating Fixture. */
    router.post('/division/batch-create',checkJwt, division_controller.division_batch_create);


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

    //POST for Zapier to call to daily to email reminders for scorecards
    app.post('/fixture/reminder', fixture_controller.fixture_reminder_post);

    /* Get late scorecards (so that i can ping a daily Zap and get an email of them.) */
    router.get('/fixture/outstanding', fixture_controller.getLateScorecards);

    /* Get late scorecards (so that i can ping a daily Zap and get an email of them.) */
    router.get('/fixture/generate', fixtureGen_controller.genFixtures);

    /* Get request for quick results form */
    router.get('/fixture/short-result',secured(), fixture_controller.fixture_outstanding);

    /* POST request for sending the quick result to */
    router.post('/fixture/short-result', fixture_controller.fixture_outstanding_post);

    /* POST request for creating Fixture. */
    router.post('/fixture/create',checkJwt, fixture_controller.fixture_create_post);

    /* POST request for batch creating Fixture. */
    router.post('/fixture/batch-create',checkJwt, fixture_controller.fixture_batch_create);

    /* POST request for batch creating Fixture. */
    router.post('/fixture/enter-result',checkJwt, fixture_controller.fixture_update_by_team_name);

    /* POST request for batch creating Fixture. */
    router.post('/fixture/enter-full-result', fixture_controller.full_fixture_post);

    /* POST request for batch creating Fixture. */
    router.post('/fixture/rearrangement', fixture_controller.fixture_rearrange_by_team_name);

    /* POST request for batch creating Fixture. */
    router.patch('/fixture/rearrange',checkJwt, fixture_controller.fixture_rearrange_by_team_name);

    /* POST request for batch creating Fixture. */
    //router.post('/fixture/batch-update',checkJwt, fixture_controller.fixture_batch_update);

    /* GET request to delete Fixture. */
    router.get('/fixture/:id/delete', fixture_controller.fixture_delete_get);

    // POST request to delete Fixture
    router.delete('/fixture/:id',checkJwt, fixture_controller.fixture_delete_post);

    /* GET request to update Fixture. */
    router.get('/fixture/:id/update', fixture_controller.fixture_update_get);

    /* GET request to update Fixture. */
    router.get('/fixture/home-:homeTeam/away-:awayTeam', fixture_controller.fixture_id_from_team_names);

    /* GET request to get fixture id from home and away team ids. */
    router.get('/fixture/homeId-:homeTeam/awayId-:awayTeam', fixture_controller.fixture_id);

    // PATCH request to update Fixture
    router.patch('/fixture/:id',checkJwt, fixture_controller.fixture_update_post);

    /* GET request for one Fixture. */
    router.get('/fixture/:id',checkJwt, fixture_controller.fixture_detail);

    /* GET request for one Fixture. */
    router.get('/scorecard/fixture/:id', fixture_controller.getScorecard);

    /* GET request for list of players of fixtures. */
    router.get('/fixture-players', fixture_controller.get_fixture_players_details);
    router.get('/fixture-players/team-:team?', fixture_controller.get_fixture_players_details);
    router.get('/fixture-players/club-:club?', fixture_controller.get_fixture_players_details);
    router.get('/fixture-players/:season?', fixture_controller.get_fixture_players_details);
    router.get('/fixture-players/team-:team?/season-:season?', fixture_controller.get_fixture_players_details);
    router.get('/fixture-players/club-:club?/:season?', fixture_controller.get_fixture_players_details);

    /* GET request for list of all Fixture items. */
    router.get('/fixtures', fixture_controller.fixture_list);

    router.get('/', fixture_controller.fixture_get_summary);

    /* GET request for list of all Fixture items. */
    //TODO: filter by club & team
    //TODO: add calendar exports so that teams can import to calendars
    //TODO: some sort of notification for rearrangements?
    router.get('/results/:division', fixture_controller.fixture_detail_byDivision);
    router.get('/results/:division/:season', fixture_controller.fixture_detail_byDivision);

    /* GET request for list of all Fixture items. */
    router.get('/admin/results/:division', secured(), fixture_controller.fixture_detail_byDivision_admin);
    router.get('/admin/results/:division/:season', secured(), fixture_controller.fixture_detail_byDivision_admin);

    /// GAME ROUTES ///

    /* GET request for creating a Game. NOTE This must come before routes that display Game (uses id) */
    router.get('/game/create', game_controller.game_create_get);

    /* POST request for creating Game. */
    router.post('/game/create',checkJwt, game_controller.game_create_post);

    /* POST request for batch creating Games. */
    router.post('/game/batch-create',checkJwt, game_controller.game_batch_create);

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
    router.post('/venue/batch-create',checkJwt, venue_controller.venue_batch_create);

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
    router.get('/venues', venue_controller.venue_list);

     app.use('/',router);

    // Handle 404
     app.use(function(req, res) {
        res.status(404);
        res.render('beta/404-error', {
           static_path: '/static',
           pageTitle : "Can't find the page your looking for",
           pageDescription : "HTTP 404 Error"
       });
    });

    // Handle 500
    app.use(function(error, req, res, next) {
      res.status(500);
      res.render('beta/500-error', {
        static_path: '/static',
        pageTitle : "HTTP 500 Error",
        pageDescription : "HTTP 500 Error",
        error:error
      });
    });
