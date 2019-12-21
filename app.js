
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
    var logger = require('logzio-nodejs').createLogger({
      token: process.env.LOGZ_SECRET,
      host: 'listener.logz.io'
    });




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
          console.log('Server running at http://127.0.0.1:' + port + '/')
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
    var userInViews = require(__dirname + '/models/userInViews');
    var secured = require(__dirname + '/models/secured');


  /*  app.get('/', function(req, res) {

        res.render('beta/homepage', {
            static_path: '/static',
            pageTitle : "Homepage",
            pageDescription : "Clubs: Aerospace, Astrazeneca, Altrincham Central, Bramhall Village, CAP, Canute, Carrington, Cheadle Hulme, College Green, David Lloyd, Disley, Dome, GHAP, Macclesfield, Manor, Mellor, New Mills, Parrswood, Poynton, Racketeer, Shell, Syddal Park, Tatton. Social and Competitive badminton in and around Stockport."
        });
    }); */

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

    // Perform the final stage of authentication and redirect to previously requested URL or '/user'
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
            res.redirect(returnTo || '/user');
          });
        }
      })(req, res, next);
    });

    // Perform session logout and redirect to homepage
    app.get('/logout', (req, res) => {
      req.logout();
      res.redirect('https://'+ process.env.AUTH0_DOMAIN + '/v2/logout?clientid='+ process.env.AUTH0_CLIENTID +'returnTo=https://stockport-badminton.co.uk');
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

    sgMail.setApiKey(process.env.SENDGRID_API_KEY);
    
    app.post('/fixture/reminder', function(req,res,next){
      const msg = {
        to: req.body.email,
        cc: 'stockport.badders.results@gmail.com',
        from: 'stockport.badders.results@stockport-badminton.co.uk',
        templateId:'d-bc4e9fe2b6a4410e838d1ac29e283d30',
        dynamic_template_data:{
          "homeTeam":req.body.homeTeam,
          "awayTeam":req.body.awayTeam
        }
      };

      sgMail.send(msg)
      .then(()=>res.send("Message Sent"))
      .catch(error => logger.log(error.toString()));

    })

    app.get('/upload-scoresheet',function(req,res){
      res.render('beta/file-upload',{
        static_path:'/static',
        theme:process.env.THEME || 'flatly',
        pageTitle : "Upload Scorecard",
        pageDescription : "Enter some results!",
      })
    })

    const multer  = require('multer');
    const upload = multer();
      app.post('/mail', upload.none(), function(req,res){
        console.log(req.body.from);
        console.log(req.body.to);
        console.log(req.body.subject);
        logger.log(req.body.html);
        res.sendStatus(200);
    });



    app.get('/scorecard-beta-nonmodal', secured(), function(req,res){
      res.render('index-scorecard-nonmodal',{
        static_path:'/static',
        theme:process.env.THEME || 'flatly',
        pageTitle : "Scorecard",
        pageDescription : "Enter some results!",
        result:[
          {
            id:7,
            name:"Premier"
          },
          {
            id:8,
            name:"Division 1"
          },
          {
            id:9,
            name:"Division 2"
          },
          {
            id:10,
            name:"Division 3"
          },
          {
            id:11,
            name:"Division 4"
          }
        ]
      })
    })

    app.get('/scorecard-beta', secured(), function(req,res){
      res.render('index-scorecard',{
        static_path:'/static',
        theme:process.env.THEME || 'flatly',
        pageTitle : "Scorecard",
        pageDescription : "Enter some results!",
        result:[
          {
            id:7,
            name:"Premier"
          },
          {
            id:8,
            name:"Division 1"
          },
          {
            id:9,
            name:"Division 2"
          },
          {
            id:10,
            name:"Division 3"
          },
          {
            id:11,
            name:"Division 4"
          }
        ]
      })
    })

    const { body,validationResult } = require("express-validator/check");
    const { sanitizeBody } = require("express-validator/filter");

    function greaterThan21(value,{req,path}){
      var otherValue = path.replace('away','home')
      if (value < 21 && req.body[otherValue] < 21){
          return false
      }
      else{
        return value
      }
    }

    function containsProfanity(value,{req}){
      var substringsArray = ["Christ","God","http://","http","https","wininphone","corta.co","Cryptocurrency","adultdating","forex","ahole","anus","ash0le","ash0les","asholes","ass","Ass Monkey","Assface","assh0le","assh0lez","asshole","assholes","assholz","asswipe","azzhole","bassterds","bastard","bastards","bastardz","basterds","basterdz","Biatch","bitch","bitches","Blow Job","boffing","butthole","buttwipe","c0ck","c0cks","c0k","Carpet Muncher","cawk","cawks","Clit","cnts","cntz"," cock","cockhead","cock-head","cocks","CockSucker","cock-sucker","crap","cum","cunt","cunts","cuntz","dick","dild0","dild0s","dildo","dildos","dilld0","dilld0s","dominatricks","dominatrics","dominatrix","dyke","enema","f u c k","f u c k e r","fag","fag1t","faget","fagg1t","faggit","faggot","fagit","fags","fagz","faig","faigs","fart","flipping the bird","fuck","fucker","fuckin","fucking","fucks","Fudge Packer","fuk","Fukah","Fuken","fuker","Fukin","Fukk","Fukkah","Fukken","Fukker","Fukkin","g00k","gay","gayboy","gaygirl","gays","gayz","God-damned","h00r","h0ar","h0re","hells","hoar","hoor","hoore","jackoff","jap","japs","jerk-off","jisim","jiss","jizm","jizz","knob","knobs","knobz","kunt","kunts","kuntz","Lesbian","Lezzian","Lipshits","Lipshitz","masochist","masokist","massterbait","masstrbait","masstrbate","masterbaiter","masterbate","masterbates","Motha Fucker","Motha Fuker","Motha Fukkah","Motha Fukker","Mother Fucker","Mother Fukah","Mother Fuker","Mother Fukkah","Mother Fukker","mother-fucker","Mutha Fucker","Mutha Fukah","Mutha Fuker","Mutha Fukkah","Mutha Fukker","n1gr","nastt","nigger;","nigur;","niiger;","niigr;","orafis","orgasim;","orgasm","orgasum","oriface","orifice","orifiss","packi","packie","packy","paki","pakie","paky","pecker","peeenus","peeenusss","peenus","peinus","pen1s","penas","penis","penis-breath","penus","penuus","Phuc","Phuck","Phuk","Phuker","Phukker","polac","polack","polak","Poonani","pr1c","pr1ck","pr1k","pusse","pussee","pussy","puuke","puuker","queer","queers","queerz","qweers","qweerz","qweir","recktum","rectum","retard","sadist","scank","schlong","screwing","semen","sex","sexy","Sh!t","sh1t","sh1ter","sh1ts","sh1tter","sh1tz","shit","shits","shitter","Shitty","Shity","shitz","Shyt","Shyte","Shytty","Shyty","skanck","skank","skankee","skankey","skanks","Skanky","slut","sluts","Slutty","slutz","son-of-a-bitch","tit","turd","va1jina","vag1na","vagiina","vagina","vaj1na","vajina","vullva","vulva","w0p","wh00r","wh0re","whore","xrated","xxx","b!+ch","bitch","blowjob","clit","arschloch","fuck","shit","ass","asshole","b!tch","b17ch","b1tch","bastard","bi+ch","boiolas","buceta","c0ck","cawk","chink","cipa","clits","cock","cum","cunt","dildo","dirsa","ejakulate","fatass","fcuk","fuk","fux0r","hoer","hore","jism","kawk","l3itch","l3i+ch","lesbian","masturbate","masterbat*","masterbat3","motherfucker","s.o.b.","mofo","nazi","nigga","nigger","nutsack","phuck","pimpis","pusse","pussy","scrotum","sh!t","shemale","shi+","sh!+","slut","smut","teets","tits","boobs","b00bs","teez","testical","testicle","titt","w00se","jackoff","wank","whoar","whore","*damn","*dyke","*fuck*","*shit*","@$$","amcik","andskota","arse*","assrammer","ayir","bi7ch","bitch*","bollock*","breasts","butt-pirate","cabron","cazzo","chraa","chuj","Cock*","cunt*","d4mn","daygo","dego","dick*","dike*","dupa","dziwka","ejackulate","Ekrem*","Ekto","enculer","faen","fag*","fanculo","fanny","feces","feg","Felcher","ficken","fitt*","Flikker","foreskin","Fotze","Fu(*","fuk*","futkretzn","gay","gook","guiena","h0r","h4x0r"," hell ","helvete","hoer*","honkey","Huevon","hui","injun","jizz","kanker*","kike","klootzak","kraut","knulle","kuk","kuksuger","Kurac","kurwa","kusi*","kyrpa*","lesbo","mamhoon","masturbat*","merd*","mibun","monkleigh","mouliewop","muie","mulkku","muschi","nazis","nepesaurio","nigger*","orospu","paska*","perse","picka","pierdol*","pillu*","pimmel","piss*","pizda","poontsee","poop","porn","p0rn","pr0n","preteen","pula","pule","puta","puto","qahbeh","queef*","rautenberg","schaffer","scheiss*","schlampe","schmuck","screw","sh!t*","sharmuta","sharmute","shipal","shiz","skribz","skurwysyn","sphencter","spic","spierdalaj","splooge","suka","b00b*","testicle*","titt*","twat","vittu","wank*","wetback*","wichser","wop*","yed","zabourah"];

      if (substringsArray.some(function(v) { return value.indexOf(v) >= 0; })) {
         logger.log(value)
         logger.log('containsProfanity fail')
        console.log('containsProfanity fail')
        return false
      }
      // if (substringsArray.some(substring=>yourBigString.includes(substring))) {

      // }
      else{
        // console.log('containsProfanity sucess')
         logger.log(value)
        return value
      }
    }

    function differenceOfTwo(value,{req,path}){
        var otherValue = path.replace('away','home')
        if (Math.abs(value - req.body[otherValue]) < 2){
          if (value < 30 && req.body[otherValue] < 30){
            return false
          }
          else {
            return value
          }
        }
        else {
          return value
        }
    }

    let validateScorecard = [
      body('Game1homeScore').isInt({min:0, max:30}).withMessage("must be between 0 and 30"),
      body('Game1awayScore').isInt({min:0, max:30}).withMessage("must be between 0 and 30").custom(differenceOfTwo).withMessage("winning score isn't 2 greater than losing score").custom(greaterThan21).withMessage("one of the teams needs to score at least 21"),
      body('Game2homeScore').isInt({min:0, max:30}).withMessage("must be between 0 and 30"),
      body('Game2awayScore').isInt({min:0, max:30}).withMessage("must be between 0 and 30").custom(differenceOfTwo).withMessage("winning score isn't 2 greater than losing score").custom(greaterThan21).withMessage("one of the teams needs to score at least 21"),
      body('Game3homeScore').isInt({min:0, max:30}).withMessage("must be between 0 and 30"),
      body('Game3awayScore').isInt({min:0, max:30}).withMessage("must be between 0 and 30").custom(differenceOfTwo).withMessage("winning score isn't 2 greater than losing score").custom(greaterThan21).withMessage("one of the teams needs to score at least 21"),
      body('Game4homeScore').isInt({min:0, max:30}).withMessage("must be between 0 and 30"),
      body('Game4awayScore').isInt({min:0, max:30}).withMessage("must be between 0 and 30").custom(differenceOfTwo).withMessage("winning score isn't 2 greater than losing score").custom(greaterThan21).withMessage("one of the teams needs to score at least 21"),
      body('Game5homeScore').isInt({min:0, max:30}).withMessage("must be between 0 and 30"),
      body('Game5awayScore').isInt({min:0, max:30}).withMessage("must be between 0 and 30").custom(differenceOfTwo).withMessage("winning score isn't 2 greater than losing score").custom(greaterThan21).withMessage("one of the teams needs to score at least 21"),
      body('Game6homeScore').isInt({min:0, max:30}).withMessage("must be between 0 and 30"),
      body('Game6awayScore').isInt({min:0, max:30}).withMessage("must be between 0 and 30").custom(differenceOfTwo).withMessage("winning score isn't 2 greater than losing score").custom(greaterThan21).withMessage("one of the teams needs to score at least 21"),
      body('Game7homeScore').isInt({min:0, max:30}).withMessage("must be between 0 and 30"),
      body('Game7awayScore').isInt({min:0, max:30}).withMessage("must be between 0 and 30").custom(differenceOfTwo).withMessage("winning score isn't 2 greater than losing score").custom(greaterThan21).withMessage("one of the teams needs to score at least 21"),
      body('Game8homeScore').isInt({min:0, max:30}).withMessage("must be between 0 and 30"),
      body('Game8awayScore').isInt({min:0, max:30}).withMessage("must be between 0 and 30").custom(differenceOfTwo).withMessage("winning score isn't 2 greater than losing score").custom(greaterThan21).withMessage("one of the teams needs to score at least 21"),
      body('Game9homeScore').isInt({min:0, max:30}).withMessage("must be between 0 and 30"),
      body('Game9awayScore').isInt({min:0, max:30}).withMessage("must be between 0 and 30").custom(differenceOfTwo).withMessage("winning score isn't 2 greater than losing score").custom(greaterThan21).withMessage("one of the teams needs to score at least 21"),
      body('Game10homeScore').isInt({min:0, max:30}).withMessage("must be between 0 and 30"),
      body('Game10awayScore').isInt({min:0, max:30}).withMessage("must be between 0 and 30").custom(differenceOfTwo).withMessage("winning score isn't 2 greater than losing score").custom(greaterThan21).withMessage("one of the teams needs to score at least 21"),
      body('Game11homeScore').isInt({min:0, max:30}).withMessage("must be between 0 and 30"),
      body('Game11awayScore').isInt({min:0, max:30}).withMessage("must be between 0 and 30").custom(differenceOfTwo).withMessage("winning score isn't 2 greater than losing score").custom(greaterThan21).withMessage("one of the teams needs to score at least 21"),
      body('Game12homeScore').isInt({min:0, max:30}).withMessage("must be between 0 and 30"),
      body('Game12awayScore').isInt({min:0, max:30}).withMessage("must be between 0 and 30").custom(differenceOfTwo).withMessage("winning score isn't 2 greater than losing score").custom(greaterThan21).withMessage("one of the teams needs to score at least 21"),
      body('Game13homeScore').isInt({min:0, max:30}).withMessage("must be between 0 and 30"),
      body('Game13awayScore').isInt({min:0, max:30}).withMessage("must be between 0 and 30").custom(differenceOfTwo).withMessage("winning score isn't 2 greater than losing score").custom(greaterThan21).withMessage("one of the teams needs to score at least 21"),
      body('Game14homeScore').isInt({min:0, max:30}).withMessage("must be between 0 and 30"),
      body('Game14awayScore').isInt({min:0, max:30}).withMessage("must be between 0 and 30").custom(differenceOfTwo).withMessage("winning score isn't 2 greater than losing score").custom(greaterThan21).withMessage("one of the teams needs to score at least 21"),
      body('Game15homeScore').isInt({min:0, max:30}).withMessage("must be between 0 and 30"),
      body('Game15awayScore').isInt({min:0, max:30}).withMessage("must be between 0 and 30").custom(differenceOfTwo).withMessage("winning score isn't 2 greater than losing score").custom(greaterThan21).withMessage("one of the teams needs to score at least 21"),
      body('Game16homeScore').isInt({min:0, max:30}).withMessage("must be between 0 and 30"),
      body('Game16awayScore').isInt({min:0, max:30}).withMessage("must be between 0 and 30").custom(differenceOfTwo).withMessage("winning score isn't 2 greater than losing score").custom(greaterThan21).withMessage("one of the teams needs to score at least 21"),
      body('Game17homeScore').isInt({min:0, max:30}).withMessage("must be between 0 and 30"),
      body('Game17awayScore').isInt({min:0, max:30}).withMessage("must be between 0 and 30").custom(differenceOfTwo).withMessage("winning score isn't 2 greater than losing score").custom(greaterThan21).withMessage("one of the teams needs to score at least 21"),
      body('Game18homeScore').isInt({min:0, max:30}).withMessage("must be between 0 and 30"),
      body('Game18awayScore').isInt({min:0, max:30}).withMessage("must be between 0 and 30").custom(differenceOfTwo).withMessage("winning score isn't 2 greater than losing score").custom(greaterThan21).withMessage("one of the teams needs to score at least 21"),
      body('homeMan1', 'Please choose a player.').isInt().custom((value,{req}) => {
        if (value != 0){
          if (value == req.body.homeMan2 || value == req.body.homeMan3 || value == req.body.awayMan1 || value == req.body.awayMan2 || value == req.body.awayMan3){
            return false
          }
          else {
            return value
          }
        }
        else {
          return value
        }
      }).withMessage("can't use the same player more than once"),
      body('homeMan2', 'Please choose a player.').isInt().custom((value,{req}) => {
        if (value != 0){
          if (value == req.body.homeMan1 || value == req.body.homeMan3 || value == req.body.awayMan1 || value == req.body.awayMan2 || value == req.body.awayMan3){
            return false
          }
          else {
            return value
          }
        }
        else {
          return value
        }

      }).withMessage("can't use the same player more than once"),
      body('homeMan3', 'Please choose a player.').isInt().custom((value,{req}) => {
        if (value != 0){
          if (value == req.body.homeMan2 || value == req.body.homeMan1 || value == req.body.awayMan1 || value == req.body.awayMan2 || value == req.body.awayMan3){
            return false
          }
          else {
            return value
          }
        }
        else {
          return value
        }

      }).withMessage("can't use the same player more than once"),
      body('homeLady1', 'Please choose a player.').isInt().custom((value,{req}) => {
        if (value != 0){
          if (value == req.body.homeLady2 || value == req.body.homeLady3 || value == req.body.awayLady1 || value == req.body.awayLady2 || value == req.body.awayLady3){
            return false
          }
          else {
            return value
          }
        }
        else {
          return value
        }

      }).withMessage("can't use the same player more than once"),
      body('homeLady2', 'Please choose a player.').isInt().custom((value,{req}) => {
        if (value != 0){
          if (value == req.body.homeLady1 || value == req.body.homeLady3 || value == req.body.awayLady1 || value == req.body.awayLady2 || value == req.body.awayLady3){
            return false
          }
          else {
            return value
          }
        }
        else {
          return value
        }

      }).withMessage("can't use the same player more than once"),
      body('homeLady3', 'Please choose a player.').isInt().custom((value,{req}) => {
        if (value != 0){
          if (value == req.body.homeLady2 || value == req.body.homeLady1 || value == req.body.awayLady1 || value == req.body.awayLady2 || value == req.body.awayLady3){
            return false
          }
          else {
            return value
          }
        }
        else {
          return value
        }

      }).withMessage("can't use the same player more than once"),
      body('awayMan1', 'Please choose a player.').isInt().custom((value,{req}) => {
        if (value != 0){
          if (value == req.body.homeMan2 || value == req.body.homeMan3 || value == req.body.homeMan1 || value == req.body.awayMan2 || value == req.body.awayMan3){
            return false
          }
          else {
            return value
          }
        }
        else {
          return value
        }

      }).withMessage("can't use the same player more than once"),
      body('awayMan2', 'Please choose a player.').isInt().custom((value,{req}) => {
        if (value != 0){
          if (value == req.body.homeMan2 || value == req.body.homeMan3 || value == req.body.awayMan1 || value == req.body.awayMan3 || value == req.body.awayMan1){
            return false
          }
          else {
            return value
          }
        }
        else {
          return value
        }

      }).withMessage("can't use the same player more than once"),
      body('awayMan3', 'Please choose a player.').isInt().custom((value,{req}) => {
        if (value != 0){
          if (value == req.body.homeMan2 || value == req.body.homeMan3 || value == req.body.awayMan1 || value == req.body.awayMan2 || value == req.body.awayMan1){
            return false
          }
          else {
            return value
          }
        }
        else {
          return value
        }

      }).withMessage("can't use the same player more than once"),
      body('awayLady1', 'Please choose a player.').isInt().custom((value,{req}) => {
        if (value != 0){
          if (value == req.body.homeLady2 || value == req.body.homeLady3 || value == req.body.homeLady1 || value == req.body.awayLady2 || value == req.body.awayLady3){
            return false
          }
          else {
            return value
          }
        }
        else {
          return value
        }

      }).withMessage("can't use the same player more than once"),
      body('awayLady2', 'Please choose a player.').isInt().custom((value,{req}) => {
        if (value != 0){
          if (value == req.body.homeLady2 || value == req.body.homeLady3 || value == req.body.homeLady1 || value == req.body.awayLady1 || value == req.body.awayLady3){
            return false
          }
          else {
            return value
          }
        }
        else {
          return value
        }

      }).withMessage("can't use the same player more than once"),
      body('awayLady3', 'Please choose a player.').isInt().custom((value,{req}) => {
        if (value != 0){
          if (value == req.body.homeLady2 || value == req.body.homeLady3 || value == req.body.homeLady1 || value == req.body.awayLady2 || value == req.body.awayLady1){
            return false
          }
          else {
            return value
          }
        }
        else { 
          return value
        }

      }).withMessage("can't use the same player more than once")
    ]

    app.post('/scorecard-beta',validateScorecard, fixture_controller.full_fixture_post);

    app.post('/submit-form', (req,res,next) => {
      var data = [];
      data = req.body;
      logger.log(req.body)
      fixture_controller.fixture_populate_scorecard(data,req,res,next)
    })
    

    app.get('/scorecard-received',function(req,res,next){
      res.render('index-scorecard',{
        static_path:'/static',
        theme:process.env.THEME || 'flatly',
        pageTitle : "Scorecard Received - No Errors",
        pageDescription : "Enter some results!",
        scorecardData: req.body
      })
    })

    app.get('/contact-us', function(req, res) {
        res.render('beta/contact-us-form', {
            static_path: '/static',
            theme: process.env.THEME || 'flatly',
            flask_debug: process.env.FLASK_DEBUG || 'false',
            pageTitle : "Contact Us",
            pageDescription : "Get in touch with your league representatives, or club secretaries",
            recaptcha : process.env.RECAPTCHA
        });
    });

    app.get('/messer-rules', function(req, res) {
        res.render('beta/messer-rules', {
            static_path: '/static',
            theme: process.env.THEME || 'flatly',
            flask_debug: process.env.FLASK_DEBUG || 'false',
            pageTitle : "Messer Tropy Rules",
            pageDescription : "Rules and regulations around the Stockrt and District Badminton Leagues' cup competition"
        });
    });

    app.get('/rules', function(req, res) {
        res.render('beta/rules', {
            static_path: '/static',
            theme: process.env.THEME || 'flatly',
            flask_debug: process.env.FLASK_DEBUG || 'false',
            pageTitle : "Stockport & District Badminton League Rules",
            pageDescription : "Rules and regulations for the Stockport and District Badminton League"
        });
    });

    app.get('/privacy-policy', function(req, res) {
        res.render('beta/privacy', {
            static_path: '/static',
            theme: process.env.THEME || 'flatly',
            flask_debug: process.env.FLASK_DEBUG || 'false',
            pageTitle : "Stockport & District Badminton League Privacy Policy",
            pageDescription : "Privacy Policy for the Stockport and District Badminton League"
        });
    });

    function validCaptcha(value,{req}){
      var options = {
        method:'POST',
        url:'https://www.google.com/recaptcha/api/siteverify?secret='+ process.env.RECAPTCHA_SECRET +'&response='+value,
        json:true
      }
      request(options,function(err,response,body){
        if (err){
          // console.log(err)
          return false
        }
        else {
          if (body.success){
            // console.log('recaptcha sucess')
            return value
          }
          else {
            // console.log('recaptcha fail')
            return false
          }
        }

      })
    }


let validateContactUs = [
  body('contactEmail').not().isEmpty().withMessage('please enter an Email address').isEmail().withMessage('Please enter a valid email address'),
  body('contactQuery').not().isEmpty().withMessage('Please enter something in message field.').custom(containsProfanity).withMessage("Please don't use profanity in the message body"),
  body('g-recaptcha-response').not().custom(validCaptcha).withMessage('your not a human')
]

    app.post('/new-users',(req,res,next) => {
      console.log("req.query");
      console.log(req.query.user);
      // console.log("req.params");
      // console.log(req.params);
      const msg = {
        to: 'stockport.badders.results@gmail.com',
        from: 'stockport.badders.results@stockport-badminton.co.uk',
        subject: 'new user signup',
        text: 'a new user has signed up: ' + req.query.user,
        html: '<p>a new user has signed up: '+ req.query.user +'</p>'
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
    app.post('/contact-us',validateContactUs, (req, res,next) => {
      var errors = validationResult(req);
      if (!errors.isEmpty()) {
           logger.log(errors.array());
          res.render('beta/contact-us-form-delivered', {
            pageTitle: 'Contact Us - Error',
            pageDescription: 'Sorry we weren\'t able sent your email - something went wrong',
            message: 'Sorry something went wrong',
            static_path:'/static',
            theme:'flatly',
            content: errors.array()
          });
          return;
      }
      else {

      const msg = {
        to: '',
        cc: 'stockport.badders.results@gmail.com',
        from: 'stockport.badders.results@stockport-badminton.co.uk',
        replyto: req.body.contactEmail,
        templateId:'d-53fc74c4a6cc4b85bb3126418087cf0b',
        dynamic_template_data:{
          "message":req.body.contactQuery,
          "email":req.body.contactEmail
        }
      };
        var clubEmail = '';
        if(req.body.contactType == 'Clubs'){
          switch (req.body.clubSelect) {
            case 'Aerospace':
              msg.to = ['santanareedy@btinternet.com'];
            break;
            case 'Alderley Park':
              msg.to = ['mel.curwen@ntlworld.com'];

            break;
            case 'Altrincham Central':
              msg.to = ['janecave53@gmail.com'];

            break;
            case 'Bramhall Village':
              msg.to = ['jjackson1969@btinternet.com'];

            break;
            case 'CAP':
              msg.to = ['dave_haigh@hotmail.co.uk'];

            break;
            case 'Canute':
              msg.to = ['canutesecretary@gmail.com'];

            break;
            case 'Carrington':
              msg.to = ['darrel@thegoughfamily.co.uk'];

            break;
            case 'Cheadle Hulme':
              msg.to = ['doug.grant@ntlworld.com'];

            break;
            case 'College Green':
              msg.to = ['paulakite@yahoo.co.uk'];

            break;
            case 'David Lloyd':
              msg.to = ['dr_barks@yahoo.co.uk'];

            break;
            case 'Disley':
              msg.to = ['julian.cherryman@gmail.com','karlcramp@aol.com'];

            break;
            case 'Dome':
              msg.to = ['janet_knowles@ymail.com'];

            break;
            case 'G.H.A.P':
              msg.to = ['rossowen40@hotmail.com'];

            break;
            case 'Macclesfield':
              msg.to = ['sueorwin@btinternet.com'];

            break;
            case 'Manor':
              msg.to = ['jo.woolley@tiscali.co.uk'];

            break;
            case 'Mellor':
              msg.to = ['enquiries@mellorbadminton.org.uk'];

            break;
            case 'New Mills':
              msg.to = ['bandibates@tiscali.co.uk'];

            break;
            case 'Parrswood':
              msg.to = ['mikegreatorex@btinternet.com'];

            break;
            case 'Poynton':
              msg.to = ['poyntonbadminton@btinternet.com'];

            break;
            case 'Racketeer':
              msg.to = ['theracketeer@hotmail.com'];

            break;
            case 'Shell':
              msg.to = ['annawiza@aol.co.uk'];

            break;
            case 'Syddal Park':
              msg.to = ['derek.hillesdon@gmail.com'];

            break;
            case 'Tatton':
              msg.to = ['plumley123@btinternet.com'];

            break;
            case 'Blue Triangle':
              msg.to = ['francesedavies@sky.com'];

            break;
            default:
              msg.to = ['stockport.badders.results@gmail.com'];

          }
        }
        if (req.body.contactType == 'League'){
          switch (req.body.leagueSelect) {
            case 'results':
              msg.to = ['stockport.badders.results@gmail.com','neil.cooper.241180@gmail.com']
              msg.cc = null;
              break;
            case 'tournament':
              msg.to = ['sueorwin@btinternet.com']
              break;
            case 'league':
              msg.to = ['leaguesec.sdbl@gmail.com']
              break;
            case 'chair':
              msg.to = ['walkerd.sdbl@gmail.com']
              break;
            case 'messer':
              msg.to = ['sueorwin@btinternet.com']
              break;
            case 'junior':
              msg.to = ['stuartscoffins@btinternet.com']
              break;
            case 'juniortournament':
              msg.to = ['aim@talktalk.net']
              break;
            case 'treasurer':
              msg.to = ['rossowen40@hotmail.com']
              break;
            default:
          }
        }
        sgMail.send(msg)
          .then(()=>{
            logger.log(msg);
            res.render('beta/contact-us-form-delivered', {
                static_path: '/static',
                theme: process.env.THEME || 'flatly',
                flask_debug: process.env.FLASK_DEBUG || 'false',
                pageTitle: 'Contact Us - Success',
                pageDescription: 'Succes - we\'ve sent an email to your chosen contact for you',
                message: 'Success - we\'ve sent your email to your chosen contact'
            });
          })
          .catch(error => {
            logger.log(error.toString());
            return next("Sorry something went wrong sending your email.");
          })
      }
    })

    /// PLAYER ROUTES ///

    /* GET catalog home page. */
    router.get('/players/club-:club?/team-:team?/gender-:gender?', secured(),player_controller.player_list_clubs_teams);
    router.get('/players/club-:club?', secured(),player_controller.player_list_clubs_teams);
    router.get('/players/team-:team?', secured(),player_controller.player_list_clubs_teams);
    router.get('/players/gender-:gender?', secured(),player_controller.player_list_clubs_teams);
    router.get('/players', secured(),player_controller.player_list_clubs_teams);

    /* GET request for creating a Player. NOTE This must come before routes that display Player (uses id) */
    router.get('/player/create',secured(), player_controller.player_create_get);

    /* POST request for creating Player. */
    router.post('/player/create', player_controller.player_create);

    /* POST request for creating Player. */
    router.post('/player/createByName',checkJwt, player_controller.player_create_by_name);

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

    /* GET request for one Player. */
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

    /* GET request for list of all Fixture items. */
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
