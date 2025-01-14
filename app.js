//  find all console logs: ^(((?!\s\/\/).)*(console.log))
    var AWS = require('aws-sdk');
    var express = require('express');
    var session = require('express-session');
    var passport = require('passport');
    var Auth0Strategy = require('passport-auth0');
    var router = express.Router();
    var bodyParser = require('body-parser');
    const {check, validationResult} = require('express-validator')
    var path = require('path');
    const jwt = require('express-jwt');
    const jwksRsa = require('jwks-rsa');
    const fs = require('fs');
    const sgMail = require('@sendgrid/mail');
    const compression = require ('compression');
    const {
      S3Client,
      PutObjectCommand,
    } = require ("@aws-sdk/client-s3");
    const { getSignedUrl } = require ("@aws-sdk/s3-request-presigner");

    let currentURL = ""
    // require('dotenv').config()
    sgMail.setApiKey(process.env.SENDGRID_API_KEY);
    var app = express();

    
    
    

    if (!process.env.AUTH0_DOMAIN || !process.env.AUTH0_AUDIENCE) {
      throw 'Make sure you have AUTH0_DOMAIN, and AUTH0_AUDIENCE in your .env file';
    }

    const S3_BUCKET_NAME = process.env.S3_BUCKET_NAME;
    
    const BLACKLIST =['136.243.212.110'];
    //better to store as an String in process.env.BLACKLIST
    var getClientIp = function(req) {
      var ipAddress = req.connection.remoteAddress;
    if (!ipAddress) {
        return '';
      }
    // convert from "::ffff:192.0.0.1"  to "192.0.0.1"
      if (ipAddress.substr(0, 7) == "::ffff:") {
        ipAddress = ipAddress.substr(7)
      }
    return ipAddress;
    };
   
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

    
    app.use(function(req, res, next) {
      var ipAddress = getClientIp(req);
    if(BLACKLIST.indexOf(ipAddress) === -1){
        next();
      } else {
        res.send(ipAddress + ' IP is not in whiteList')
      }
    });
    app.use(compression());
    app.use('/static', express.static(path.join(__dirname,'/static')));
    app.use('/scripts', express.static(__dirname + '/node_modules/'));

    app.use(express.static('rootfiles'));
    app.set('view engine', 'ejs');
    app.set('views', __dirname + '/views');
    app.use(bodyParser.json());
    app.use(bodyParser.urlencoded({extended:false}));
    app.set('node_modules', __dirname + '/node_modules');
    app.set('models', __dirname + '/models');

    var db = require('./db_connect');
    var port = process.env.PORT || 8080;

    // Configure Passport to use Auth0
    var strategy = new Auth0Strategy(
      {
        domain: process.env.AUTH0_DOMAIN,
        clientID: process.env.AUTH0_CLIENTID,
        clientSecret: process.env.AUTH0_CLIENT_SECRET,
        callbackURL: process.env.AUTH0_CALLBACK_URL || 'http://127.0.0.1:8080/callback'
      },
      function (accessToken, refreshToken, extraParams, profile, done) {
        // accessToken is the token to call Auth0 API (not needed in the most cases)
        // extraParams.id_token has the JSON Web Token
        // profile has all the information from the user
        return done(null, profile);
      }
    );

    passport.use(strategy);
    
    

    // You can use this section to keep a smaller payload
    passport.serializeUser(function (user, done) {
      done(null, user);
    });

    passport.deserializeUser(function (user, done) {
      done(null, user);
    });

    // config express-session
    var sess = {
      secret: 'ThisisMySecret',
      cookie: {},
      resave: false,
      saveUninitialized: false
    };
    if (app.get('env') === 'prod') {
// console.log("prod environment")
      app.set('trust proxy', 1); // trust first proxy
      sess.cookie.secure = true; // serve secure cookies, requires https
      sess.proxy = true;
      // console.log("session:sess");
      // console.log(sess);
    }  

    
    app.use(session(sess));
    app.use(passport.initialize());
    app.use(passport.session());
    


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
    var auth_controller = require(__dirname + '/models/auth.js');

    

    router.use(userInViews())

    router.get('/login', function(req, res, next) {
      passport.authenticate('auth0', {
        scope: 'openid email profile'
      })(req, res, next);
    });

    router.get('/callback', function(req, res, next) {
      passport.authenticate('auth0', function(err, user, info) {
// console.log(user)
// console.log(info)
        if (err) { return next(err); }
        if (!user) {
// console.log(user)
// console.log(info)
          res.render('beta/failed-login', {
            static_path:'/static',
            theme:process.env.THEME || 'flatly',
            pageTitle : "Access Denied",
            pageDescription : "Access Denied",
            query:req.query,
            canonical:('https://' + req.get('host') + req.originalUrl).replace('www.','').replace('.com','.co.uk').replace('-badders.herokuapp','-badminton')
          });
        } else {
          req.logIn(user, function (err) {
            if (err) {console.log(err); return next(err); }
            const returnTo = req.session.returnTo || '/'; // Retrieve the returnTo value from session
            delete req.session.returnTo; // Remove the returnTo value from session
            res.redirect(currentURL);
          });
        }
      })(req, res, next);
    });
    
    router.post('/sendgrid',function(req,res,next){
      res.sendStatus(200)
    })

    const { createCanvas, loadImage } = require('canvas')
    const canvas = createCanvas(1080, 1350)
    const ctx = canvas.getContext('2d')

    router.get('/resultImage/:homeTeam/:awayTeam/:homeScore/:awayScore/:division',function(req,res,next){
      loadImage('static/beta/images/bg/social-'+ req.params.division.replace(/([\s]{1,})/g,'-') +'.png').then((image) => {
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
          const buffer = canvas.toBuffer("image/jpeg");
          const fs = require('fs')
          const out = fs.createWriteStream('static/beta/images/generated/'+ req.params.homeTeam.replace(/([\s]{1,})/g,'-') + req.params.awayTeam.replace(/([\s]{1,})/g,'-') +'.jpg')
          const stream = canvas.createJPEGStream()
          stream.pipe(out)
          out.on('finish', () =>  console.log('The Jpg file was created.'))
          res.write(buffer)
          res.end();
      })
    })

    router.get('/tables-social',function(req,res,next) {
      const canvasWidth = 1080; // Set canvas width
      const canvasHeight = 1080; // Set canvas height
      const bigCanvasWidth = 1080;
      const bigCanvasHeight = 1080*4;
      const bigCanvas = createCanvas(bigCanvasWidth, bigCanvasHeight);
      const bigCtx = bigCanvas.getContext('2d');

      getAllLeagueTables(req.params.season,async function(err,result){
        if (err){
          console.log(err);
          next(err);
        }
        else {
          // console.log(result)
          var newResultsArray = []
          var divIds = [7,8,9,10]
          for (div of divIds){
            var divObject = {}
            var divArray = await result.filter(row => row.division == div).map(obj => {
              return {
                divisionName:obj.divisionName,
                name: obj.name,
                points: (obj.pointsFor === null ? 0 : obj.pointsFor ),
                played: obj.played,
                pointsAgainst:(obj.pointsAgainst === null ? 0 : obj.pointsAgainst ),
              };
            })
            divObject[divArray[0].divisionName] = divArray
            newResultsArray.push(divObject)
          }
          // res.sendStatus(200)
          var i = 0
         for (division of newResultsArray){

          //console.log(Object.entries(division))
          for (let [key,value] of Object.entries(division)){
            //console.log(key);
            //console.log(value);
            let mergedPosY = 1080*i
            // console.log(mergedPosY)
            i++
            const canvas = createCanvas(canvasWidth, canvasHeight); // Create canvas instance
            const ctx = canvas.getContext('2d');
            loadImage('static/beta/images/bg/social.png').then(async (image) => {
              
              
              bigCtx.drawImage(image, 0, mergedPosY);
              ctx.drawImage(image, 0,0,canvasWidth, canvasHeight)
              // Set background color

              //ctx.fillStyle = '#FFF';
              //ctx.fillRect(0, 0, canvasWidth, canvasHeight);

              // Set font styles
              ctx.font = 'bold 40px Arial';
              ctx.fillStyle = '#000';
              ctx.textAlign = 'center';
              bigCtx.font = 'bold 40px Arial';
              bigCtx.fillStyle = '#000';
              bigCtx.textAlign = 'center';

              // Add League Table heading
              // ctx.fillText(key, canvasWidth / 2, 60);

              // widest team 430
              // total width 970
              // full width 1080

              // Add table header
              let posY = 120;
              let posX = 230
              let teamSpace = 300
              let numberSpace = 150
              ctx.font = 'bold 65px Arial';
              bigCtx.font = 'bold 65px Arial';
              ctx.fillText(key, posX, posY);
              bigCtx.fillText(key, posX, posY+mergedPosY);
              posX += teamSpace
              ctx.fillText('P', posX, posY);
              bigCtx.fillText('P', posX, posY+mergedPosY);
              posX += numberSpace
              ctx.fillText('W', posX, posY);
              bigCtx.fillText('W', posX, posY+mergedPosY);
              posX += numberSpace
              ctx.fillText('L', posX, posY);
              bigCtx.fillText('L', posX, posY+mergedPosY);
              posX += numberSpace
              ctx.fillText('Avg.', posX, posY);
              bigCtx.fillText('Avg.', posX, posY+mergedPosY);

              // Add table data
              posY += 100;
              ctx.font = '55px Arial';
              bigCtx.font = '55px Arial';
              for (i in value) {
                posX = 230
                var avg = (value[i].points / value[i].played).toFixed(1)
                // console.log(value[i])
                ctx.fillText(value[i].name, posX, posY);
                bigCtx.fillText(value[i].name, posX, posY+mergedPosY);
                posX += teamSpace
                ctx.fillText(value[i].played, posX, posY);
                bigCtx.fillText(value[i].played, posX, posY+mergedPosY);
                posX += numberSpace
                ctx.fillText(value[i].points, posX, posY);
                bigCtx.fillText(value[i].points, posX, posY+mergedPosY);
                posX += numberSpace
                ctx.fillText(value[i].pointsAgainst, posX, posY);
                bigCtx.fillText(value[i].pointsAgainst, posX, posY+mergedPosY);
                posX += numberSpace
                ctx.fillText((avg >= 0 ? avg:0), posX, posY);
                bigCtx.fillText((avg >= 0 ? avg:0), posX, posY+mergedPosY);
                posY += 90;
              };

              // Save image to file
              const out = fs.createWriteStream('static/beta/images/generated/league-table-'+key+'.png');
              const stream = canvas.createPNGStream();
              stream.pipe(out);
              out.on('finish', () => console.log('League table image created!'));
              // res.download('static/beta/images/generated/league-table-'+key+'.png')
            })

            
         }
          
         }
         const bigOut = fs.createWriteStream('static/beta/images/generated/league-table-merged.png');
              const stream = bigCanvas.createPNGStream();
              let bigBuffer = await bigCanvas.toBuffer("image/png");
              // console.log(bigBuffer)
              // imageArray.push(canvas.toBuffer("image/png"))
              stream.pipe(bigOut);
              bigOut.on('finish', () => console.log('League table image created!'));
              res.render('beta/league-table-social', {
                static_path:'/static',
                theme:process.env.THEME || 'flatly',
                pageTitle : "Table Social Images",
                pageDescription : "Table Social Images",
                query:req.query,
                canonical:("https://" + req.get("host") + req.originalUrl).replace("www.","").replace(".com",".co.uk").replace("-badders.herokuapp","-badminton")
              });
          
        }
        
      }) 
    })

    router.get('/tournament-social',function(req,res,next) {
      const canvasWidth = 1080; // Set canvas width
      const canvasHeight = 1080; // Set canvas height
      let canvas = createCanvas(canvasWidth, canvasHeight); // Create canvas instance
      let ctx = canvas.getContext('2d');
      loadImage('static/beta/images/bg/social.png').then(async (image) => {

        ctx.drawImage(image, 0,0,canvasWidth, canvasHeight)

        // Set font styles
        ctx.font = 'bold 40px Arial';
        ctx.fillStyle = '#000';
        ctx.textAlign = 'center';

        let posY = 120;
        let posX = 540
        ctx.font = 'bold 65px Arial';
        ctx.fillText('Open Tournament', posX, posY);
        posY += 100
        ctx.font = 'normal 40px Arial';
        ctx.fillText('LifeLeisure Bramhall Recreation', posX, posY);
        posY += 50
        ctx.fillText('Centre, Seal Rd, Bramhall', posX, posY);
        posY += 100
        ctx.font = 'bold 40px Arial';
        ctx.fillText('11th November', posX, posY);
        posY += 100
        ctx.font = 'normal 40px Arial';
        ctx.fillText('Mens & Womens Doubles', posX, posY);
        posY += 100
        ctx.font = 'bold 40px Arial';
        ctx.fillText('18th November', posX, posY);
        posY += 100
        ctx.font = 'normal 40px Arial';
        ctx.fillText('Mens & Womens Singles', posX, posY);
        posY += 50
        ctx.fillText('Mixed Doubles', posX, posY);
        posY += 100
        ctx.fillText('Entry form and details on the website', posX, posY);
        posY += 50
        ctx.fillText('https://stockport-badminton.co.uk', posX, posY);
        

        // Save image to file
        const out = fs.createWriteStream('static/beta/images/generated/open-tournament-social.png');
        const stream = canvas.createPNGStream();
        stream.pipe(out);
        out.on('finish', () => console.log('League table image created!'));
      })
      let bcanvas = createCanvas(canvasWidth, canvasHeight); // Create canvas instance
      let bctx = bcanvas.getContext('2d');
      loadImage('static/beta/images/bg/social.png').then(async (image) => {

        bctx.drawImage(image, 0,0,canvasWidth, canvasHeight)

        // Set font styles
        bctx.font = 'bold 40px Arial';
        bctx.fillStyle = '#000';
        bctx.textAlign = 'center';

        let posY = 120;
        let posX = 540
        bctx.font = 'bold 65px Arial';
        bctx.fillText('`B` Tournament', posX, posY);
        posY += 100
        bctx.font = 'normal 40px Arial';
        bctx.fillText('LifeLeisure Bramhall Recreation', posX, posY);
        posY += 50
        bctx.fillText('Centre, Seal Rd, Bramhall', posX, posY);
        posY += 100
        bctx.font = 'bold 40px Arial';
        bctx.fillText('11th November', posX, posY);
        posY += 100
        bctx.font = 'normal 40px Arial';
        bctx.fillText('Mens & Womens Doubles', posX, posY);
        posY += 100
        bctx.font = 'bold 40px Arial';
        bctx.fillText('18th November', posX, posY);
        posY += 100
        bctx.font = 'normal 40px Arial';
        bctx.fillText('Singles', posX, posY);
        posY += 50
        bctx.fillText('Mixed Doubles', posX, posY);
        posY += 100
        bctx.fillText('Entry form and details on the website', posX, posY);
        posY += 50
        bctx.fillText('https://stockport-badminton.co.uk', posX, posY);
        

        // Save image to file
        const out = fs.createWriteStream('static/beta/images/generated/B-tournament-social.png');
        const stream = bcanvas.createPNGStream();
        stream.pipe(out);
        out.on('finish', () => console.log('League table image created!'));
      })
      ccanvas = createCanvas(canvasWidth, canvasHeight); // Create canvas instance
      cctx = ccanvas.getContext('2d');
      loadImage('static/beta/images/bg/social.png').then(async (image) => {

        cctx.drawImage(image, 0,0,canvasWidth, canvasHeight)

        // Set font styles
        cctx.font = 'bold 40px Arial';
        cctx.fillStyle = '#000';
        cctx.textAlign = 'center';

        let posY = 120;
        let posX = 540
        cctx.font = 'bold 65px Arial';
        cctx.fillText('`C` Tournament', posX, posY);
        posY += 100
        cctx.font = 'normal 40px Arial';
        cctx.fillText('LifeLeisure Bramhall Recreation', posX, posY);
        posY += 50
        cctx.fillText('Centre, Seal Rd, Bramhall', posX, posY);
        posY += 100
        cctx.font = 'bold 40px Arial';
        cctx.fillText('11th November', posX, posY);
        posY += 100
        cctx.font = 'normal 40px Arial';
        cctx.fillText('Mens & Womens Doubles', posX, posY);
        posY += 100
        cctx.font = 'bold 40px Arial';
        cctx.fillText('18th November', posX, posY);
        posY += 100
        cctx.font = 'normal 40px Arial';
        cctx.fillText('Mixed Doubles', posX, posY);
        posY += 100
        cctx.fillText('Entry form and details on the website', posX, posY);
        posY += 50
        cctx.fillText('https://stockport-badminton.co.uk', posX, posY);
        

        // Save image to file
        const out = fs.createWriteStream('static/beta/images/generated/c-tournament-social.png');
        const stream = ccanvas.createPNGStream();
        stream.pipe(out);
        out.on('finish', () => console.log('League table image created!'));
      })
      supervetcanvas = createCanvas(canvasWidth, canvasHeight); // Create canvas instance
      supervetctx = supervetcanvas.getContext('2d');
      loadImage('static/beta/images/bg/social.png').then(async (image) => {

        supervetctx.drawImage(image, 0,0,canvasWidth, canvasHeight)

        // Set font styles
        supervetctx.font = 'bold 40px Arial';
        supervetctx.fillStyle = '#000';
        supervetctx.textAlign = 'center';

        let posY = 120;
        let posX = 540
        supervetctx.font = 'bold 65px Arial';
        supervetctx.fillText('Supervet Tournament', posX, posY);
        posY += 100
        supervetctx.font = 'normal 40px Arial';
        supervetctx.fillText('LifeLeisure Bramhall Recreation', posX, posY);
        posY += 50
        supervetctx.fillText('Centre, Seal Rd, Bramhall', posX, posY);
        posY += 100
        supervetctx.font = 'bold 40px Arial';
        supervetctx.fillText('11th November', posX, posY);
        posY += 100
        supervetctx.font = 'normal 40px Arial';
        supervetctx.fillText('Mixed Doubles', posX, posY);
        posY += 100
        supervetctx.font = 'bold 40px Arial';
        supervetctx.fillText('18th November', posX, posY);
        posY += 100
        supervetctx.font = 'normal 40px Arial';
        supervetctx.fillText('Mens Doubles', posX, posY);
        posY += 50
        supervetctx.fillText('Womens Doubles', posX, posY);
        posY += 100
        supervetctx.fillText('Entry form and details on the website', posX, posY);
        posY += 50
        supervetctx.fillText('https://stockport-badminton.co.uk', posX, posY);
        

        // Save image to file
        const out = fs.createWriteStream('static/beta/images/generated/supervet-tournament-social.png');
        const stream = supervetcanvas.createPNGStream();
        stream.pipe(out);
        out.on('finish', () => console.log('League table image created!'));
      })
      res.sendStatus(200)
      
    })

    router.get('/handicap-tournament-social',function(req,res,next) {
      const canvasWidth = 1080; // Set canvas width
      const canvasHeight = 1080; // Set canvas height
      let canvas = createCanvas(canvasWidth, canvasHeight); // Create canvas instance
      let ctx = canvas.getContext('2d');
      loadImage('static/beta/images/bg/social.png').then(async (image) => {

        ctx.drawImage(image, 0,0,canvasWidth, canvasHeight)

        // Set font styles
        ctx.font = 'bold 40px Arial';
        ctx.fillStyle = '#000';
        ctx.textAlign = 'center';

        let posY = 120;
        let posX = 540
        ctx.font = 'bold 65px Arial';
        ctx.fillText('Handicap Tournaments', posX, posY);
        posY += 100
        ctx.font = 'normal 40px Arial';
        ctx.fillText('Didsbury High School', posX, posY);
        posY += 50
        ctx.fillText('4 The Avenue, Didsbury, M20 2ET', posX, posY);
        posY += 100
        ctx.font = 'bold 50px Arial';
        ctx.fillText('2nd March', posX, posY);
        posY += 100
        ctx.font = 'normal 40px Arial';
        ctx.fillText('Handicap Mens & Womens Singles', posX, posY);
        posY += 50
        ctx.fillText('Handicap Mixed Doubles', posX, posY);
        posY += 50
        ctx.fillText('Veteran Mens & Womens Doubles', posX, posY);
        posY += 50
        ctx.fillText('Family Mixed Doubles', posX, posY);
        posY += 100
        ctx.font = 'bold 50px Arial';
        ctx.fillText('9th March', posX, posY);
        posY += 100
        ctx.font = 'normal 40px Arial';
        ctx.fillText('Handicap Mens & Womens Doubles', posX, posY);
        posY += 50
        ctx.fillText('Veteran Singles', posX, posY);
        posY += 50
        ctx.fillText('Veteran Mixed Doubles', posX, posY);
        posY += 100
        ctx.fillText('Entry form and details on the website', posX, posY);
        posY += 50
        ctx.fillText('https://stockport-badminton.co.uk', posX, posY);
        

        // Save image to file
        const out = fs.createWriteStream('static/beta/images/generated/handicap-tournament-social.png');
        const stream = canvas.createPNGStream();
        stream.pipe(out);
        out.on('finish', () => console.log('League table image created!'));
      })
      res.sendStatus(200)
    })

    // Perform session logout and redirect to homepage

    router.get('/logout', function(req, res, next) {
      req.logout(function(err) {
        if (err) { return next(err); }
        res.redirect('https://'+ process.env.AUTH0_DOMAIN + '/v2/logout?clientid='+ process.env.AUTH0_CLIENTID +'&returnTo=https://'+ req.headers.host);
      });
    });


    //GET to return signed S3 url for uploading scorecards
    
    router.get('/sign-s3', async (req, res, next) => {
      const fileName = req.query['file-name'];
      const fileType = req.query['file-type'];
      const s3Params = {
          Bucket: process.env.S3_BUCKET_NAME,
          Key: fileName,
          ContentType: fileType,
          ACL: 'public-read'
          // ACL: 'bucket-owner-full-control'
      };
      const s3 = new S3Client({ region: 'eu-west-1' })
      const command = new PutObjectCommand(s3Params);
  
      try {
          const signedUrl = await getSignedUrl(s3, command, { expiresIn: 60 });
           //console.log(signedUrl);
          res.json({ signedUrl })
      } catch (err) {
          console.error(err);
          next(err);
      }
  });

    


    router.get('/upload-scoresheet',fixture_controller.upload_scoresheet)

    router.post('/SESemail', (req,res,next) => {
      var ses = new AWS.SES({apiVersion: '2010-12-01'});
      
      var params = {
        Destination: { /* required */
          ToAddresses: [ 
            'bigcoops@gmail.com','stockport.badders.results@gmail.com'
          ]
        },
        Message: { /* required */
          Body: {
            Html: {
             Charset: 'UTF-8',
             Data: contact_controller.generateReminderHTML()
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


      const sendPromise = ses.sendEmail(params).promise();
      sendPromise
      .then(data => {
        res.render('beta/contact-us-form-delivered', {
            static_path: '/static',
            theme: process.env.THEME || 'flatly',
            flask_debug: process.env.FLASK_DEBUG || 'false',
            pageTitle: 'Contact Us - Success',
            pageDescription: 'Succes - we\'ve sent an email to your chosen contact for you',
            message: 'Success - we\'ve sent your email to your chosen contact',
            canonical:("https://" + req.get("host") + req.originalUrl).replace("www.'","").replace(".com",".co.uk").replace("-badders.herokuapp","-badminton")
        });
      })
      .catch(error => {
        // console.log(error);
        return next("Sorry something went wrong sending your email.");
      })

    })

    // for handling sendgrid parse 
    const multer  = require('multer');
const { getAllLeagueTables } = require('./models/league');
    const upload = multer();
    router.post('/mail', upload.any(),contact_controller.distribution_list); 
    router.post('/mailtest',contact_controller.distribution_list); 

    // Scorecard - Results Entry related routes


    //POST for processing results entry form - possibly redundant.
    router.post('/scorecard-beta',fixture_controller.validateScorecard, fixture_controller.full_fixture_post);

    // static page to display scorecard received messages - likely not being used
    router.get('/scorecard-received',fixture_controller.scorecard_received);
    
    // url for testing upload of scorecards
    /* router.get('/scorecard-upload', fixture_controller.scorecard_upload); */

    // post for processing results from entry form and emailing admin with confirmation link and link to scorecard photo
    router.post('/email-scorecard', fixture_controller.validateScorecard, fixture_controller.fixture_populate_scorecard_errors);
    router.post('/add-scorecard-photo/:id',fixture_controller.add_scorecard_photo)

    // post for processing results from excel spreadsheet
    router.post('/submit-form', (req,res,next) => {
      var data = [];
      data = req.body;
      console.log(req.body)
      fixture_controller.fixture_populate_scorecard(data,req,res,next)
    });

    //GET for displaying a populated form for the admin to review and confirm
    //TODO check larger file uploads & pdfs
    router.get('/populated-scorecard/:division/:home_team/:away_team/:home_man_1/:home_man_2/:home_man_3/:home_lady_1/:home_lady_2/:home_lady_3/:away_man_1/:away_man_2/:away_man_3/:away_lady_1/:away_lady_2/:away_lady_3/:Game1homeScore/:Game1awayScore/:Game2homeScore/:Game2awayScore/:Game3homeScore/:Game3awayScore/:Game4homeScore/:Game4awayScore/:Game5homeScore/:Game5awayScore/:Game6homeScore/:Game6awayScore/:Game7homeScore/:Game7awayScore/:Game8homeScore/:Game8awayScore/:Game9homeScore/:Game9awayScore/:Game10homeScore/:Game10awayScore/:Game11homeScore/:Game11awayScore/:Game12homeScore/:Game12awayScore/:Game13homeScore/:Game13awayScore/:Game14homeScore/:Game14awayScore/:Game15homeScore/:Game15awayScore/:Game16homeScore/:Game16awayScore/:Game17homeScore/:Game17awayScore/:Game18homeScore/:Game18awayScore', (req,res,next) => {
      console.log(req.params)
      fixture_controller.fixture_populate_scorecard_fromUrl(req,res,next)
    })

    router.get('/populated-scorecard-beta/:id',(req,res,next) => {
      console.log(req.body);
      fixture_controller.fixture_populate_scorecard_fromId(req,res,next)
    })


    // Static page routes
    router.get('/privacy-policy', static_controller.privacy_policy);
    router.get('/messer-rules', static_controller.messer_rules);
    router.get('/messer-draw/:section', team_controller.new_messer_draw);
    router.get('/messer-draw/:season/:section', team_controller.new_messer_draw);
    router.get('/rules', static_controller.rules);
    

    // POST to process input from Auth0 when non-authorised user attempt to use secure pages on the site and email the admin
    // TODO - prevent duplicate emails being sent when an existing user in Auth0 gets bounced out again because they're not authorised still.

    router.get('/approve-user/:userId',auth_controller.grantResultsAccess);

    router.post('/new-users-v2',(req,res,next) => {
      //console.log(req.body);
      //console.log("req.body.user:"+req.body.user);
      //console.log("req.body.id:"+req.body.id);
      //console.log("req.body.id.length:"+req.body.id.length);
      // console.log("req.body");
      const msg = {
        to: 'stockport.badders.results@gmail.com',
        from: 'stockport.badders.results@stockport-badminton.co.uk',
        subject: 'new user signup',
        text: 'a new user has signed up: ' + req.body.user,
        html: '<p>a new user has signed up: '+ req.body.user +'<br /><a href="https://stockport-badminton.co.uk/approve-user/'+req.body.id+'">Approve?</a></p>'
      };
      if (typeof req.body.id != 'undefined' && req.body.id.length > 3 && req.body.id != 'undefined'){
        sgMail.send(msg)
          .then(()=>{
            console.log(msg);
            // console.log(msg)
            res.sendStatus(200);
          })
          .catch(error => {
            console.log(error.toString());
            next("Sorry something went wrong sending your email.");
          })
      }
      else{
        res.sendStatus(200);
// console.log('userid undefined');
      }
      
    })

    /* contact us routes */
    router.get('/contact-us', contact_controller.contactus_get);
    router.post('/contact-us',contact_controller.validateContactUs, contact_controller.contactus);

    /// PLAYER ROUTES ///

    /* POST request for creating Player. */
    router.post('/player/create', player_controller.player_create);
    router.post('/manage-players/create', player_controller.player_create_from_team);

    /* POST request for batch creating Fixture. */
    router.post('/player/batch-create',checkJwt, player_controller.player_batch_create);

    /* GET request to delete Player. */
    router.get('/player/:id/delete', player_controller.player_delete_get);

    // POST request to delete Player
    router.delete('/player/:id',checkJwt, player_controller.player_delete);

    /* GET request to update Player. */
    router.get('/player/:id/update', player_controller.player_update_get);

    

    /* GET request for one Player. */
    router.get('/player/:id', player_controller.player_detail);

    /* GET request for one Player. */
    router.get('/playerStats/:id/:fullName', player_controller.player_game_data);

    /* player stats routes and filters. */

    router.get('/player-stats/*', player_controller.all_player_stats);
    router.get('/player-stats', player_controller.all_player_stats);

    router.get('/pair-stats/*', player_controller.all_pair_stats);
    router.get('/pair-stats', player_controller.all_pair_stats);

    /* GET request for one Player. */
    router.get('/player-stats', player_controller.all_player_stats);

    /* GET request for one Player. */
    router.get('/eligiblePlayers/:id/:gender', player_controller.eligible_players_list);

    /* GET request for list of all Player items. */
    router.get('/players/club-:clubid?/team-:teamid?/gender-:gender?', player_controller.player_list);
    router.get('/players/matching/:name/:gender',player_controller.find_closest_matched_player);

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

    // DELETE request to delete Club
    router.delete('/club/:id',checkJwt, club_controller.club_delete_post);

    /* GET request to update Club. */
    router.get('/club/:id/update', club_controller.club_update_get);

    // PATCH request to update Club
    router.patch('/club/:id',checkJwt, club_controller.club_update_post);

    /* GET request for one Club. */

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
    router.post('/fixture/reminder', fixture_controller.fixture_reminder_post);

    /* Get late scorecards (so that i can ping a daily Zap and get an email of them.) */
    router.get('/fixture/outstanding', fixture_controller.getLateScorecards);

    /* Get late scorecards (so that i can ping a daily Zap and get an email of them.) */
    router.get('/fixture/generate', fixtureGen_controller.genFixtures);


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
    router.get('/event/:id/:date-:homeTeam-:awayTeam', fixture_controller.fixture_event_detail);

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
    
    //TODO: some sort of notification for rearrangements?
    router.get('/fixtures/*', fixture_controller.fixture_detail_byDivision);
    router.get('/results/*', fixture_controller.fixture_detail_byDivision);
    router.get('/calendars/*', fixture_controller.fixture_calendars);
    router.get('/results-grid/*', fixture_controller.fixture_detail_byDivision);

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


    /***** SECURED ROUTES ******/

    // router.use(secured)
    function secured(req, res, next) {
      if (req.isAuthenticated()) {
        return next();
      }
      currentURL = req.originalUrl
// console.log("query in middleware: " + req.query.state)
// console.log("originalUrl in middleware: " + req.originalUrl)
      const returnTo = req.query.state || req.originalUrl;
      req.session.returnTo = returnTo; // Store the returnTo value in session
// console.log("returnTo in middleware: " + returnTo)
// console.log("session.returnTo in middleware: " + req.session.returnTo)
      res.redirect('/login?returnTo=' + encodeURIComponent(returnTo));
    }

    // PATCH request to update Player
    router.post('/player/batch-update',  secured,player_controller.player_batch_update);

    router.post('/player/:id',secured, player_controller.player_update_post);
    
    router.get('/admin/results/*', secured,fixture_controller.fixture_detail_byDivision);
    router.get('/admin/results/:division/:season',  secured,fixture_controller.fixture_detail_byDivision);
    router.get('/user', secured,async function (req, res) {
      const { _raw, _json, userProfile } = req.user;
// console.log(req.user)
      res.render('beta/user', {
        userProfile: JSON.stringify(userProfile, null, 2),
        static_path:'/static',
        theme:process.env.THEME || 'flatly',
        pageTitle : "User Profile",
        pageDescription : "User Profile",
        canonical:("https://" + req.get("host") + req.originalUrl).replace("www.'","").replace(".com",".co.uk").replace("-badders.herokuapp","-badminton")
      });
    });

    //GET to display a scorecard without the modal - not currently in use, but could be developed if there was a need for it
    router.get('/scorecard-beta-nonmodal', secured,fixture_controller.scorecard_nonmodal);

    //GET for displaying a results entry form - may be redundant - although this one doesn't have the option to upload a photo of your scorecard
    router.get('/scorecard-beta', secured,fixture_controller.scorecard_beta);

    //GET for displaying results entry for for users
    router.get('/email-scorecard', secured,fixture_controller.email_scorecard);
    // app.get('/messer-scorecard', fixture_controller.messer_scorecard);

    /* player listing / filtering routes */
    router.get('/players/club-:club?/team-:team?/gender-:gender?', secured,player_controller.player_list_clubs_teams);
    router.get('/players/club-:club?', secured,player_controller.player_list_clubs_teams);
    router.get('/players/team-:team?', secured,player_controller.player_list_clubs_teams);
    router.get('/players/gender-:gender?', secured,player_controller.player_list_clubs_teams);
    router.get('/players', secured,player_controller.player_list_clubs_teams);
    router.get('/manage-players/club-:club?', secured,player_controller.manage_player_list_clubs_teams);

    /* GET request for creating a Player. NOTE This must come before routes that display Player (uses id) */
    router.get('/player/create', secured,player_controller.player_create_get);
    router.get('/players/eloPop', player_controller.player_elo_populate);
        // TODO: Create page showing teams, venue, club night and match night details, player stats for the club, team registrations
    router.get('/club/:id', secured,club_controller.club_detail);
    router.get('/club-api/:id', secured,club_controller.club_detail_api);
    router.get('/admin/info/clubs', secured,club_controller.club_list_detail);

    /* Get request for quick results form */
    router.get('/short-results', secured,fixture_controller.fixture_outstanding);
    /* GET request for list of all Fixture items. */
    

    app.use(router);
    const connection = null
    // Connect to MySQL on start
    try {
        db.connect();
        var server = app.listen(port, function() {
        console.log('Server running at http://127.0.0.1:' + port + '/');
      })
    }
    catch {
      console.log('Unable to connect to MySQL.')
      process.exit(1)
    }

      /* var server = app.listen(port, function() {
        console.log('Server running at http://127.0.0.1:' + port + '/');
      }) */

     // Handle 404
     router.use(function(req, res) {
      res.status(404);
      res.render('beta/404-error', {
         static_path: '/static',
         pageTitle : "Can't find the page your looking for",
         pageDescription : "HTTP 404 Error",
         canonical:("https://" + req.get("host") + req.originalUrl).replace("www.'","").replace(".com",".co.uk").replace("-badders.herokuapp","-badminton")
     });
  });

  // Handle 500
  router.use(function(error, req, res) {
    res.status(500);
    res.render('beta/500-error', {
      static_path: '/static',
      pageTitle : "HTTP 500 Error",
      pageDescription : "HTTP 500 Error",
      error:error,
      canonical:("https://" + req.get("host") + req.originalUrl).replace("www.'","").replace(".com",".co.uk").replace("-badders.herokuapp","-badminton")
    });
  });