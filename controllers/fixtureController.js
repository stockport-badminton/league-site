var Division = require('../models/division');
var Team = require('../models/teams');
var Player = require('../models/players');
var Fixture = require('../models/fixture');
var Game = require('../models/game');
var request = require('request');
var AWS = require('aws-sdk');
var Auth = require('../models/auth.js');
const sgMail = require('@sendgrid/mail');
sgMail.setApiKey(process.env.SENDGRID_API_KEY);

 var logger = require('logzio-nodejs').createLogger({
  token: process.env.LOGZ_SECRET,
  host: 'listener.logz.io'
 });


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

    exports.validateScorecard = [
      body('Game1homeScore').isInt({min:0, max:30}).withMessage("must be between 0 and 30"),
      body('Game1awayScore').isInt({min:0, max:30}).withMessage("must be between 0 and 30").custom(differenceOfTwo).withMessage("First Mens 1:winning score isn't 2 greater than losing score").custom(greaterThan21).withMessage("First Mens 1:one of the teams needs to score at least 21"),
      body('Game2homeScore').isInt({min:0, max:30}).withMessage("must be between 0 and 30"),
      body('Game2awayScore').isInt({min:0, max:30}).withMessage("must be between 0 and 30").custom(differenceOfTwo).withMessage("First Mens 2:winning score isn't 2 greater than losing score").custom(greaterThan21).withMessage("First Mens 2:one of the teams needs to score at least 21"),
      body('Game3homeScore').isInt({min:0, max:30}).withMessage("must be between 0 and 30"),
      body('Game3awayScore').isInt({min:0, max:30}).withMessage("must be between 0 and 30").custom(differenceOfTwo).withMessage("First Ladies 1:winning score isn't 2 greater than losing score").custom(greaterThan21).withMessage("First Ladies 1:one of the teams needs to score at least 21"),
      body('Game4homeScore').isInt({min:0, max:30}).withMessage("must be between 0 and 30"),
      body('Game4awayScore').isInt({min:0, max:30}).withMessage("must be between 0 and 30").custom(differenceOfTwo).withMessage("First Ladies 2:winning score isn't 2 greater than losing score").custom(greaterThan21).withMessage("First Ladies 2:one of the teams needs to score at least 21"),
      body('Game5homeScore').isInt({min:0, max:30}).withMessage("must be between 0 and 30"),
      body('Game5awayScore').isInt({min:0, max:30}).withMessage("must be between 0 and 30").custom(differenceOfTwo).withMessage("Second Mens 1:winning score isn't 2 greater than losing score").custom(greaterThan21).withMessage("Second Mens 1:one of the teams needs to score at least 21"),
      body('Game6homeScore').isInt({min:0, max:30}).withMessage("must be between 0 and 30"),
      body('Game6awayScore').isInt({min:0, max:30}).withMessage("must be between 0 and 30").custom(differenceOfTwo).withMessage("Second Mens 2:winning score isn't 2 greater than losing score").custom(greaterThan21).withMessage("Second Mens 2:one of the teams needs to score at least 21"),
      body('Game7homeScore').isInt({min:0, max:30}).withMessage("must be between 0 and 30"),
      body('Game7awayScore').isInt({min:0, max:30}).withMessage("must be between 0 and 30").custom(differenceOfTwo).withMessage("Second Ladies 1:winning score isn't 2 greater than losing score").custom(greaterThan21).withMessage("Second Ladies 1:one of the teams needs to score at least 21"),
      body('Game8homeScore').isInt({min:0, max:30}).withMessage("must be between 0 and 30"),
      body('Game8awayScore').isInt({min:0, max:30}).withMessage("must be between 0 and 30").custom(differenceOfTwo).withMessage("Second Ladies 2:winning score isn't 2 greater than losing score").custom(greaterThan21).withMessage("Second Ladies 2:one of the teams needs to score at least 21"),
      body('Game9homeScore').isInt({min:0, max:30}).withMessage("must be between 0 and 30"),
      body('Game9awayScore').isInt({min:0, max:30}).withMessage("must be between 0 and 30").custom(differenceOfTwo).withMessage("Third Mens 1:winning score isn't 2 greater than losing score").custom(greaterThan21).withMessage("Third Mens 1:one of the teams needs to score at least 21"),
      body('Game10homeScore').isInt({min:0, max:30}).withMessage("must be between 0 and 30"),
      body('Game10awayScore').isInt({min:0, max:30}).withMessage("must be between 0 and 30").custom(differenceOfTwo).withMessage("Third Mens 2:winning score isn't 2 greater than losing score").custom(greaterThan21).withMessage("Third Mens 2:one of the teams needs to score at least 21"),
      body('Game11homeScore').isInt({min:0, max:30}).withMessage("must be between 0 and 30"),
      body('Game11awayScore').isInt({min:0, max:30}).withMessage("must be between 0 and 30").custom(differenceOfTwo).withMessage("Third Ladies 1:winning score isn't 2 greater than losing score").custom(greaterThan21).withMessage("Third Ladies 1:one of the teams needs to score at least 21"),
      body('Game12homeScore').isInt({min:0, max:30}).withMessage("must be between 0 and 30"),
      body('Game12awayScore').isInt({min:0, max:30}).withMessage("must be between 0 and 30").custom(differenceOfTwo).withMessage("Third Ladies 2:winning score isn't 2 greater than losing score").custom(greaterThan21).withMessage("Third Ladies 2:one of the teams needs to score at least 21"),
      body('Game13homeScore').isInt({min:0, max:30}).withMessage("must be between 0 and 30"),
      body('Game13awayScore').isInt({min:0, max:30}).withMessage("must be between 0 and 30").custom(differenceOfTwo).withMessage("First Mixed 1:winning score isn't 2 greater than losing score").custom(greaterThan21).withMessage("First Mixed 1:one of the teams needs to score at least 21"),
      body('Game14homeScore').isInt({min:0, max:30}).withMessage("must be between 0 and 30"),
      body('Game14awayScore').isInt({min:0, max:30}).withMessage("must be between 0 and 30").custom(differenceOfTwo).withMessage("First Mixed 2:winning score isn't 2 greater than losing score").custom(greaterThan21).withMessage("First Mixed 2:one of the teams needs to score at least 21"),
      body('Game15homeScore').isInt({min:0, max:30}).withMessage("must be between 0 and 30"),
      body('Game15awayScore').isInt({min:0, max:30}).withMessage("must be between 0 and 30").custom(differenceOfTwo).withMessage("Second Mixed 1:winning score isn't 2 greater than losing score").custom(greaterThan21).withMessage("Second Mixed 1:one of the teams needs to score at least 21"),
      body('Game16homeScore').isInt({min:0, max:30}).withMessage("must be between 0 and 30"),
      body('Game16awayScore').isInt({min:0, max:30}).withMessage("must be between 0 and 30").custom(differenceOfTwo).withMessage("Second Mixed 2:winning score isn't 2 greater than losing score").custom(greaterThan21).withMessage("Second Mixed 2:one of the teams needs to score at least 21"),
      body('Game17homeScore').isInt({min:0, max:30}).withMessage("must be between 0 and 30"),
      body('Game17awayScore').isInt({min:0, max:30}).withMessage("must be between 0 and 30").custom(differenceOfTwo).withMessage("Third Mixed 1:winning score isn't 2 greater than losing score").custom(greaterThan21).withMessage("Third Mixed 1:one of the teams needs to score at least 21"),
      body('Game18homeScore').isInt({min:0, max:30}).withMessage("must be between 0 and 30"),
      body('Game18awayScore').isInt({min:0, max:30}).withMessage("must be between 0 and 30").custom(differenceOfTwo).withMessage("Third Mixed 2:winning score isn't 2 greater than losing score").custom(greaterThan21).withMessage("Third Mixed 2:one of the teams needs to score at least 21"),
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


// Display fixtures played 6 days ago that haven't had results entered
exports.getLateScorecards = function(req, res) {
    Fixture.getCardsDueToday(function(err,row){
      const msg = {
        to: 'stockport.badders.results@gmail.com',
        from: 'stockport.badders.results@stockport-badminton.co.uk',
        replyto: 'stockport.badders.results@gmail.com',
        templateId:'d-3a224c8f7b214f3ba4062f6a2dbd1bd4',
        dynamic_template_data:{
          "missingFixtures":[]
        }
      };
      if (err){        
        msg.dynamic_template_data.errors = JSON.stringify(err);
      }
      else{
        if (row.length > 0){
          console.log(JSON.stringify(row));
          for (var x = 0; x < row.length; x++){
              var fixture = {};
              fixture.date = row[x].date;
              fixture.homeTeam = row[x].homeTeam;
              fixture.awayTeam = row[x].awayTeam;
              msg.dynamic_template_data.missingFixtures.push(fixture);
          }
        }
        else {
          
          msg.dynamic_template_data.noFixtures = 'No outstanding fixtures today';
        }

      }
      
      sgMail.send(msg)
      .then(()=>res.send("Message Sent"))
      .catch(error => logger.log(error.toString()));
      
    })
};


exports.fixture_outstanding = function(req,res,next){
  Fixture.getOutstandingResults(function(err,result){
    if(err){
      next(err)
    }
    else {
      res.render('results-short', {
        static_path:'/static',
        theme:process.env.THEME || 'flatly',
        pageTitle : "Quick Results Entry",
        pageDescription : "Quick Results Entry",
        result:result,
        stringResult:JSON.stringify(result)
      });
    }
  })
}

// Handle Fixture update on POST
exports.fixture_outstanding_post = function(req, res,next) {

  var reqBody = {
    "homeScore":1*(req.body.homeTeamScore),
    "awayScore":18-req.body.homeTeamScore,
    "status":"completed"
  }
  // res.send(req.body)
  Fixture.updateById(reqBody,req.body.outstandingResults,function(err,row){
    if (err){
      next(err);
    }
    else{
      zapObject = {
        "homeTeam":req.body.homeTeamName,
        "awayTeam":req.body.awayTeamName,
        "homeScore":1*(req.body.homeTeamScore),
        "awayScore":1*(req.body.awayTeamScore)
      }
      Fixture.sendResultZap(zapObject,function(err,zapRes){
        if(err) {next(err)}
        else{
          Fixture.getOutstandingResults(function(err,result){
            if(err){
              next(err)
            }
            else {
              res.render('results-short', {
                static_path:'/static',
                theme:process.env.THEME || 'flatly',
                pageTitle : "Quick Results Entry - Success",
                pageDescription : "Quick Results Entry - Success",
                result:result,
                zapRes:zapRes,
                success:true,
              });
            }
          })
        }
      })
    }
  })
};

// Display list of all Fixtures
exports.fixture_list = function(req, res) {
    Fixture.getAll(function(err,row){
      if (err){
        res.send(err);
        // console.log(err);
      }
      else{
        // console.log(req.body);
        // console.log(row);
        res.send(row);
      }
    })
};

// Display list of all Fixtures
exports.get_fixture_players_details = function(req, res) {

    var searchObj = {
    }
    if (req.params.season !== undefined){
      searchObj.season = req.params.season
    }
    if (req.params.team !== undefined){
      searchObj.team = req.params.team
    }
    if (req.params.club !== undefined){
      searchObj.club = req.params.club
    }
    Fixture.getMatchPlayerOrderDetails(searchObj,function(err,row){
      if (err){
        res.send(err);
      }
      else{
        res.render('beta/fixture-players', {
            static_path: '/static',
            pageTitle : "Fixture Player Details",
            pageDescription : "Find out who played which matches and in what order",
            result: row
        });
      }
    })
};

// Return fixture id given home and away team ids
exports.fixture_id = function(req, res) {
    obj = {
      "homeTeam":req.params.homeTeam,
      "awayTeam":req.params.awayTeam
    }
    // console.log(JSON.stringify(obj));
    Fixture.getFixtureId(obj,function(err,row){
      if (err){
        res.send(err);
      }
      else{
        res.send(row);
      }
    })
};

// Return fixture id given home and away team names
exports.fixture_id_from_team_names = function(req, res) {
    obj = {
      "homeTeam":req.params.homeTeam,
      "awayTeam":req.params.awayTeam
    }
    Fixture.getFixtureIdFromTeamNames(obj,function(err,row){
      if (err){
        res.send(err);
      }
      else{
        res.send(row);
      }
    })
};

// Display detail page for a specific Fixture
exports.fixture_detail = function(req, res) {
    Fixture.getById(req.params.id, function(err,row){
      if (err){
        res.send(err);
        // console.log(err);
      }
      else{
        // console.log(req.body);
        // console.log(row);
        res.send(row);
      }
    })
};

// Display detail page for a specific Fixture
exports.getScorecard = function(req, res) {
    Fixture.getScorecardDataById(req.params.id, function(err,row){
      if (err){
        res.send(err);
        // console.log(err);
      }
      else{
        res.render('beta/viewScorecard', {
            static_path: '/static',
            pageTitle : "Scorecard Info",
            pageDescription : "View scorecard for this match",
            result: row
        });
      }
    })
};

// Display detail page for a specific Fixture
exports.fixture_detail_byDivision = function(req, res,next) {
    var divisionId = 0;
    Division.getIdByURLParam(req.params.division, function(err,row){
      if (row.length < 1){
        divisionId = 0
      }
      else {
        divisionId = row[0].id
      }
    Fixture.getFixtureDetails(divisionId, req.params.season, function(err,result){
      if (err){
        next(err);
      }
      else{
          res.status(200);
           res.render('beta/fixtures-results', {
               static_path: '/static',
               pageTitle : "Fixtures & Results: " + req.params.division.replace('-',' '),
               pageDescription : "Find out how the teams in your division have got on, and check when your next match is",
               result: result,
               error: false,
               division : req.params.division
           });

      }
    })
  })
};

// Display detail page for a specific Fixture
exports.fixture_detail_byDivision_admin = function(req, res,next) {
  var divisionId = 0;
  Division.getIdByURLParam(req.params.division, function(err,row){
    if (row.length < 1){
      divisionId = 0
    }
    else {
      divisionId = row[0].id
    }

  
  Auth.getManagementAPIKey(function (err,apiKey){
    if (err){
      next(err);
    }
    else{
      var options = {
        method:'GET',
        headers:{
          "Authorization":"Bearer "+apiKey
        },
        url:'https://'+process.env.AUTH0_DOMAIN+'/api/v2/users?q=user_id:'+req.user.id+'&fields=app_metadata,nickname,email'
      }
      //console.log(options);
      request(options,function(err,response,userBody){
        //console.log(options);
        if (err){
          //console.log(err)
          return false
        }
        else{
          var user = JSON.parse(userBody);
          var fixtureSearchObj = {
            "season":req.params.season,
            "division":divisionId
          }
          if (user[0].app_metadata.club) {
            fixtureSearchObj.club = user[0].app_metadata.club
          }
          if (user[0].app_metadata.club == 'All') {
            fixtureSearchObj.club = undefined
          }
          if (user[0].app_metadata.team) {
            fixtureSearchObj.team = user[0].app_metadata.team
          }
          
          Fixture.getClubFixtureDetails(fixtureSearchObj, function(err,result){
            if (err){
              next(err);
            }
            else{
              res.status(200);
              res.render('beta/fixtures-results', {
                  user:user,
                  static_path: '/static',
                  pageTitle : "Fixtures & Results: " + req.params.division.replace('-',' '),
                  pageDescription : "Find out how the teams in your division have got on, and check when your next match is",
                  result: result,
                  error: false,
                  division : req.params.division,
                  admin:true,
                  recaptcha:process.env.recaptcha
              });
            }
          })
        }
      })
    }
  })
})
};



// Display Fixture create form on GET
exports.fixture_create_get = function(req, res) {
    res.send('NOT IMPLEMENTED: Fixture create GET');
};

// Handle Fixture create on POST
exports.fixture_create_post = function(req, res) {
    Fixture.create(req.body, function(err,row){
      if (err){
        res.send(err);
        // console.log(err);
      }
      else{
        // console.log(req.body);
        // console.log(row);
        res.send(row);
      }
    })
};



// Handle getting results from previous 7 days
exports.fixture_get_summary = function(req, res,next) {
    Fixture.getRecent(function(err,recentResults){
      if (err){
        // console.log(err);
        next(err);
      }
      else{
        Fixture.getupComing(function(err,upcomingFixtures){
          if (err){
            // console.log(err);
            next(err);
          }
          else{
            // console.log(result);
            res.render('beta/homepage', {
                static_path: '/static',
                pageTitle : "Homepage",
                pageDescription : "Clubs: Aerospace, Astrazeneca, Altrincham Central, Bramhall Village, CAP, Canute, Carrington, Cheadle Hulme, College Green, David Lloyd, Disley, Dome, GHAP, Macclesfield, Manor, Mellor, New Mills, Parrswood, Poynton, Racketeer, Shell, Syddal Park, Tatton. Social and Competitive badminton in and around Stockport.",
                result : recentResults,
                row : upcomingFixtures
            });
          }
        })
      }
    })
};

exports.fixture_batch_create = function(req, res){
  Fixture.createBatch(req.body,function(err,result){
    if(err){
      res.send(err);
      // console.log(err);
    }
    else{
      // console.log(result)
      res.send(result);
    }
  })
}

exports.fixture_update_by_team_name = function(req, res,next){
  Fixture.updateByTeamNames(req.body,function(err,result){
    if(err){
      next(err);
      // console.log(err);
    }
    else{
      // console.log(result)
      res.send(result);
    }
  })
}


exports.fixture_rearrange_by_team_name = function(req, res,next){
  Fixture.rearrangeByTeamNames(req.body,function(err,result){
    if(err){
      next(err);
      // console.log(err);
    }
    else{
      // console.log(result)
      res.send(result);
    }
  })
}

// Display Fixture delete form on GET
exports.fixture_delete_get = function(req, res) {
    res.send('NOT IMPLEMENTED: Fixture delete GET');
};

// Handle Fixture delete on POST
exports.fixture_delete_post = function(req, res) {
    Fixture.deleteById(req.params.id, function(err,row){
      if (err){
        res.send(err);
        // console.log(err);
      }
      else{
        // console.log(req.body);
        // console.log(row);
        res.send(row);
      }
    })
};

// Display Fixture update form on GET
exports.fixture_update_get = function(req, res, next) {
    res.send('NOT IMPLEMENTED: Fixture update GET');
};


exports.full_fixture_post = function(req,res){
  var errors = validationResult(req);
  // console.log(errors.array());
  if (!errors.isEmpty()) {
    Division.getAllByLeague(1,function(err,rows){
      res.render('index-scorecard',{
        static_path:'/static',
        theme:process.env.THEME || 'flatly',
        pageTitle : "Scorecard Received - Errors",
        pageDescription : "Something went wrong",
        result:rows,
        errors: errors.array()
      })
    })
    
  }
  else {
    // logger.log(req.body);
    // console.log(req.body);
    Fixture.getOutstandingFixtureId({homeTeam:req.body.homeTeam, awayTeam:req.body.awayTeam},function(err,FixtureIdResult){
      if (err) {
        // console.log("getFixtureId sucess")
        // console.log(res)
        res.send(err);
      }
      else {
        // console.log("getFixtureId err")
        // console.log(res)
        // console.log(FixtureIdResult);
        var fixtureObject = {
          homeMan1 : req.body.homeMan1,
          homeMan2 : req.body.homeMan2,
          homeMan3 : req.body.homeMan3,
          homeLady1 : req.body.homeLady1,
          homeLady2 : req.body.homeLady2,
          homeLady3 : req.body.homeLady3,
          awayMan1 : req.body.awayMan1,
          awayMan2 : req.body.awayMan2,
          awayMan3 : req.body.awayMan3,
          awayLady1 : req.body.awayLady1,
          awayLady2 : req.body.awayLady2,
          awayLady3 : req.body.awayLady3,
          status:"complete",
          homeScore:req.body.homeScore,
          awayScore:req.body.awayScore
        }
        // console.log(fixtureObject);
        
        Fixture.updateById(fixtureObject,FixtureIdResult[0].id,function(err,fixResult){
          if (err) {
            // console.log("updateById err")
            // console.log(res)
            res.send(err)
          }
          else {
            // console.log("updateById sucess")
            // console.log(res)
            // console.log(fixResult)
            var gameObject = {
              tablename:"game",
              fields:[
                "homePlayer1", "homePlayer2", "awayPlayer1","awayPlayer2","homeScore","awayScore","fixture","gameType"
              ],
              data:[
                {
                  homePlayer1:req.body.FirstMenshomeMan1,
                  homePlayer2:req.body.FirstMenshomeMan2,
                  awayPlayer1:req.body.FirstMensawayMan1,
                  awayPlayer2:req.body.FirstMensawayMan2,
                  homeScore:req.body.Game1homeScore,
                  awayScore:req.body.Game1awayScore,
                  fixture:FixtureIdResult[0].id,
                  gameType:'FirstMens'
                },
                {
                  homePlayer1:req.body.FirstMenshomeMan1,
                  homePlayer2:req.body.FirstMenshomeMan2,
                  awayPlayer1:req.body.FirstMensawayMan1,
                  awayPlayer2:req.body.FirstMensawayMan2,
                  homeScore:req.body.Game2homeScore,
                  awayScore:req.body.Game2awayScore,
                  fixture:FixtureIdResult[0].id,
                  gameType:'FirstMens'
                },
                {
                  homePlayer1:req.body.FirstLadieshomeLady1,
                  homePlayer2:req.body.FirstLadieshomeLady2,
                  awayPlayer1:req.body.FirstLadiesawayLady1,
                  awayPlayer2:req.body.FirstLadiesawayLady2,
                  homeScore:req.body.Game3homeScore,
                  awayScore:req.body.Game3awayScore,
                  fixture:FixtureIdResult[0].id,
                  gameType:'FirstLadies'
                },
                {
                  homePlayer1:req.body.FirstLadieshomeLady1,
                  homePlayer2:req.body.FirstLadieshomeLady2,
                  awayPlayer1:req.body.FirstLadiesawayLady1,
                  awayPlayer2:req.body.FirstLadiesawayLady2,
                  homeScore:req.body.Game4homeScore,
                  awayScore:req.body.Game4awayScore,
                  fixture:FixtureIdResult[0].id,
                  gameType:'FirstLadies'
                },
                {
                  homePlayer1:req.body.SecondMenshomeMan1,
                  homePlayer2:req.body.SecondMenshomeMan3,
                  awayPlayer1:req.body.SecondMensawayMan1,
                  awayPlayer2:req.body.SecondMensawayMan3,
                  homeScore:req.body.Game5homeScore,
                  awayScore:req.body.Game5awayScore,
                  fixture:FixtureIdResult[0].id,
                  gameType:'SecondMens'
                },
                {
                  homePlayer1:req.body.SecondMenshomeMan1,
                  homePlayer2:req.body.SecondMenshomeMan3,
                  awayPlayer1:req.body.SecondMensawayMan1,
                  awayPlayer2:req.body.SecondMensawayMan3,
                  homeScore:req.body.Game6homeScore,
                  awayScore:req.body.Game6awayScore,
                  fixture:FixtureIdResult[0].id,
                  gameType:'SecondMens'
                },
                {
                  homePlayer1:req.body.SecondLadieshomeLady1,
                  homePlayer2:req.body.SecondLadieshomeLady3,
                  awayPlayer1:req.body.SecondLadiesawayLady1,
                  awayPlayer2:req.body.SecondLadiesawayLady3,
                  homeScore:req.body.Game7homeScore,
                  awayScore:req.body.Game7awayScore,
                  fixture:FixtureIdResult[0].id,
                  gameType:'SecondLadies'
                },
                {
                  homePlayer1:req.body.SecondLadieshomeLady1,
                  homePlayer2:req.body.SecondLadieshomeLady3,
                  awayPlayer1:req.body.SecondLadiesawayLady1,
                  awayPlayer2:req.body.SecondLadiesawayLady3,
                  homeScore:req.body.Game8homeScore,
                  awayScore:req.body.Game8awayScore,
                  fixture:FixtureIdResult[0].id,
                  gameType:'SecondLadies'
                },
                {
                  homePlayer1:req.body.ThirdMenshomeMan2,
                  homePlayer2:req.body.ThirdMenshomeMan3,
                  awayPlayer1:req.body.ThirdMensawayMan2,
                  awayPlayer2:req.body.ThirdMensawayMan3,
                  homeScore:req.body.Game9homeScore,
                  awayScore:req.body.Game9awayScore,
                  fixture:FixtureIdResult[0].id,
                  gameType:'ThirdMens'
                },
                {
                  homePlayer1:req.body.ThirdMenshomeMan2,
                  homePlayer2:req.body.ThirdMenshomeMan3,
                  awayPlayer1:req.body.ThirdMensawayMan2,
                  awayPlayer2:req.body.ThirdMensawayMan3,
                  homeScore:req.body.Game10homeScore,
                  awayScore:req.body.Game10awayScore,
                  fixture:FixtureIdResult[0].id,
                  gameType:'ThirdMens'
                },
                {
                  homePlayer1:req.body.ThirdLadieshomeLady2,
                  homePlayer2:req.body.ThirdLadieshomeLady3,
                  awayPlayer1:req.body.ThirdLadiesawayLady2,
                  awayPlayer2:req.body.ThirdLadiesawayLady3,
                  homeScore:req.body.Game11homeScore,
                  awayScore:req.body.Game11awayScore,
                  fixture:FixtureIdResult[0].id,
                  gameType:'ThirdLadies'
                },
                {
                  homePlayer1:req.body.ThirdLadieshomeLady2,
                  homePlayer2:req.body.ThirdLadieshomeLady3,
                  awayPlayer1:req.body.ThirdLadiesawayLady2,
                  awayPlayer2:req.body.ThirdLadiesawayLady3,
                  homeScore:req.body.Game12homeScore,
                  awayScore:req.body.Game12awayScore,
                  fixture:FixtureIdResult[0].id,
                  gameType:'ThirdLadies'
                },
                {
                  homePlayer1:req.body.FirstMixedhomeMan1,
                  homePlayer2:req.body.FirstMixedhomeLady1,
                  awayPlayer1:req.body.FirstMixedawayMan1,
                  awayPlayer2:req.body.FirstMixedawayLady1,
                  homeScore:req.body.Game13homeScore,
                  awayScore:req.body.Game13awayScore,
                  fixture:FixtureIdResult[0].id,
                  gameType:'FirstMixed'
                },
                {
                  homePlayer1:req.body.FirstMixedhomeMan1,
                  homePlayer2:req.body.FirstMixedhomeLady1,
                  awayPlayer1:req.body.FirstMixedawayMan1,
                  awayPlayer2:req.body.FirstMixedawayLady1,
                  homeScore:req.body.Game14homeScore,
                  awayScore:req.body.Game14awayScore,
                  fixture:FixtureIdResult[0].id,
                  gameType:'FirstMixed'
                },
                {
                  homePlayer1:req.body.SecondMixedhomeMan2,
                  homePlayer2:req.body.SecondMixedhomeLady2,
                  awayPlayer1:req.body.SecondMixedawayMan2,
                  awayPlayer2:req.body.SecondMixedawayLady2,
                  homeScore:req.body.Game15homeScore,
                  awayScore:req.body.Game15awayScore,
                  fixture:FixtureIdResult[0].id,
                  gameType:'SecondMixed'
                },
                {
                  homePlayer1:req.body.SecondMixedhomeMan2,
                  homePlayer2:req.body.SecondMixedhomeLady2,
                  awayPlayer1:req.body.SecondMixedawayMan2,
                  awayPlayer2:req.body.SecondMixedawayLady2,
                  homeScore:req.body.Game16homeScore,
                  awayScore:req.body.Game16awayScore,
                  fixture:FixtureIdResult[0].id,
                  gameType:'SecondMixed'
                },
                {
                  homePlayer1:req.body.ThirdMixedhomeMan3,
                  homePlayer2:req.body.ThirdMixedhomeLady3,
                  awayPlayer1:req.body.ThirdMixedawayMan3,
                  awayPlayer2:req.body.ThirdMixedawayLady3,
                  homeScore:req.body.Game17homeScore,
                  awayScore:req.body.Game17awayScore,
                  fixture:FixtureIdResult[0].id,
                  gameType:'ThirdMixed'
                },
                {
                  homePlayer1:req.body.ThirdMixedhomeMan3,
                  homePlayer2:req.body.ThirdMixedhomeLady3,
                  awayPlayer1:req.body.ThirdMixedawayMan3,
                  awayPlayer2:req.body.ThirdMixedawayLady3,
                  homeScore:req.body.Game18homeScore,
                  awayScore:req.body.Game18awayScore,
                  fixture:FixtureIdResult[0].id,
                  gameType:'ThirdMixed'
                }
              ]
            }
            Game.createBatch(gameObject,function(err,gameResult){
              if (err){
                // console.log("createBatch err")
                // console.log(res)
                res.send(err)
              }
              else {
                // console.log("createBatch sucess")
                Fixture.getFixtureDetailsById(FixtureIdResult[0].id,function(err,getFixtureDetailsResult){
                  if(err) res.send(err)
                  zapObject = {
                    "host":req.headers.host,
                    "homeTeam":getFixtureDetailsResult[0].homeTeam,
                    "awayTeam":getFixtureDetailsResult[0].awayTeam,
                    "homeScore":getFixtureDetailsResult[0].homeScore,
                    "awayScore":getFixtureDetailsResult[0].awayScore
                   }
                  // console.log(zapObject)
                  Fixture.sendResultZap(zapObject,function(err,zapRes){
                    if (err) res.send(err)
                    Player.getNominatedPlayers(getFixtureDetailsResult[0].homeTeam,function(err,homeTeamNomPlayers){
                      if (err) res.send(err)
                      Player.getNominatedPlayers(getFixtureDetailsResult[0].awayTeam,function(err,awayTeamNomPlayers){
                        if (err) res.send(err)
                        var searchObj = {};
                        searchObj.team = getFixtureDetailsResult[0].homeTeam
                        searchObj.limit = 4
                        Fixture.getMatchPlayerOrderDetails(searchObj,function(err,homeTeamFixturePlayers){
                          if (err) res.send(err)
                          var searchObj = {};
                          searchObj.team = getFixtureDetailsResult[0].awayTeam
                          searchObj.limit = 4
                          Fixture.getMatchPlayerOrderDetails(searchObj,function(err,awayTeamFixturePlayers){
                            if (err) res.send(err);
                            Player.getMatchStats(FixtureIdResult[0].id,function(err,matchStats){
                              if (err) res.send(err);                              
                              const ejs = require('ejs');
                              var emailData = {                                
                                "homeTeam":zapObject.homeTeam,
                                "awayTeam":zapObject.awayTeam,
                                "generatedImage":zapObject.homeTeam.replace(/([\s]{1,})/g,'-') + zapObject.awayTeam.replace(/([\s]{1,})/g,'-'),
                                "matchStats":matchStats[1]
                              }
                              // console.log(emailData);
                              ejs.renderFile('views/emails/websiteUpdated.ejs', {data:emailData}, {debug:true}, function(err, str){
                                if (err) console.log(err);
                                console.log("logged in user email:" + req.body.email);
                                const msg = {
                                  to: (typeof req.body.email !== 'undefined' ? (req.body.email.indexOf('@') > 1 ? req.body.email : 'stockport.badders.results@gmail.com') : 'stockport.badders.results@gmail.com'),
                                  bcc: 'bigcoops@gmail.com',
                                  from: 'stockport.badders.results@stockport-badminton.co.uk',
                                  subject: 'Website Updated: ' + zapObject.homeTeam + ' vs ' + zapObject.awayTeam,
                                  text: 'Thanks for sending your scorecard - website updated',
                                  html:str
                                };
                                // console.log(msg)
                                sgMail.send(msg)
                                .then(()=>{                                
                                  res.render('index-scorecard',{
                                    static_path:'/static',
                                    theme:process.env.THEME || 'flatly',
                                    pageTitle : "Scorecard Received - No Errors",
                                    pageDescription : "Enter some results!",
                                    scorecardData: gameObject,
                                    homeTeamNomPlayers:homeTeamNomPlayers,
                                    awayTeamNomPlayers:awayTeamNomPlayers,
                                    homeTeamFixturePlayers:homeTeamFixturePlayers,
                                    awayTeamFixturePlayers:awayTeamFixturePlayers
                                  })
                                })
                                .catch(error => {
                                  logger.log(error.toString());
                                  res.send("Sorry something went wrong sending your email - try sending it manually" + error);
                                })
                              });   
                            })
                          })
                        })
                      })
                    })
                  })
                })
              }
            })
          }
        })
      }
    })
  }
}

exports.fixture_populate_scorecard_errors = function(req, res,next) {

  var errors = validationResult(req);
  // console.log(errors.array());
  if (!errors.isEmpty()) {
    let data = req.body;
    console.log(data);
Division.getAllAndSelectedById(1,data.division,function(err,divisionRows){
  if(err){
    next(err)
  }
      else{
        // console.log(divisionIdRows)
        Team.getAllAndSelectedById(data.homeTeam,data.division,function(err,homeTeamRows){
          if (err) {
            next(err)
          }
          else{
            // console.log(homeTeamRows)
            Team.getAllAndSelectedById(data.awayTeam,data.division,function(err,awayTeamRows){
              if (err) {
                next(err)
              }
              else{
                // console.log(awayTeamRows)
                Player.getEligiblePlayersAndSelectedById(data.homeMan1,data.homeMan2,data.homeMan3,data.homeTeam,'Male',function(err,homeMenRows){
                  if(err){
                    next(err)
                  }
                  else{
                    // console.log(homeMenRows)
                    Player.getEligiblePlayersAndSelectedById(data.homeLady1,data.homeLady2,data.homeLady3,data.homeTeam,'Female',function(err,homeLadiesRows){
                      if(err){
                        next(err)
                      }
                      else{
                        // console.log(homeLadiesRows)
                        Player.getEligiblePlayersAndSelectedById(data.awayMan1,data.awayMan2,data.awayMan3,data.awayTeam,'Male',function(err,awayMenRows){
                          if(err){
                            next(err)
                          }
                          else{
                            // console.log(awayMenRows)
                            Player.getEligiblePlayersAndSelectedById(data.awayLady1,data.awayLady2,data.awayLady3,data.awayTeam,'Female',function(err,awayLadiesRows){
                              if(err){
                                next(err)
                              }
                              else{
                                // console.log(awayLadiesRows)
                                var renderData = {
                                  "divisionRows":divisionRows,
                                  "homeTeamRows":homeTeamRows,
                                  "awayTeamRows":awayTeamRows,
                                  "homeMenRows":homeMenRows,
                                  "homeLadiesRows":homeLadiesRows,
                                  "awayMenRows":awayMenRows,
                                  "awayLadiesRows":awayLadiesRows
                                };
                                logger.log(renderData);
                                res.render('email-scorecard', {
                                    static_path: '/static',
                                    pageTitle : "Spreadsheet Upload Scorecard",
                                    pageDescription : "Show result of uploading scorecard",
                                    scorecard : renderData,
                                    data:data,
                                    errors : errors.array()
                                });
                              }
                          })
                        }
                      })
                    }
                  })
                }
              })
            }
          })
        }
      })
      // console.log(data);
    }
  })
  }
  else {
      let scorecardUrl = 'https://' + req.headers.host + '/populated-scorecard/'+ req.body.division+'/'+ req.body.homeTeam+'/'+ req.body.awayTeam+'/'+ req.body.homeMan1+'/'+ req.body.homeMan2+'/'+ req.body.homeMan3+'/'+ req.body.homeLady1+'/'+ req.body.homeLady2+'/'+ req.body.homeLady3+'/'+ req.body.awayMan1+'/'+ req.body.awayMan2+'/'+ req.body.awayMan3+'/'+ req.body.awayLady1+'/'+ req.body.awayLady2+'/'+ req.body.awayLady3+'/'+ req.body.Game1homeScore+'/'+ req.body.Game1awayScore+'/'+ req.body.Game2homeScore+'/'+ req.body.Game2awayScore+'/'+ req.body.Game3homeScore+'/'+ req.body.Game3awayScore+'/'+ req.body.Game4homeScore+'/'+ req.body.Game4awayScore+'/'+ req.body.Game5homeScore+'/'+ req.body.Game5awayScore+'/'+ req.body.Game6homeScore+'/'+ req.body.Game6awayScore+'/'+ req.body.Game7homeScore+'/'+ req.body.Game7awayScore+'/'+ req.body.Game8homeScore+'/'+ req.body.Game8awayScore+'/'+ req.body.Game9homeScore+'/'+ req.body.Game9awayScore+'/'+ req.body.Game10homeScore+'/'+ req.body.Game10awayScore+'/'+ req.body.Game11homeScore+'/'+ req.body.Game11awayScore+'/'+ req.body.Game12homeScore+'/'+ req.body.Game12awayScore+'/'+ req.body.Game13homeScore+'/'+ req.body.Game13awayScore+'/'+ req.body.Game14homeScore+'/'+ req.body.Game14awayScore+'/'+ req.body.Game15homeScore+'/'+ req.body.Game15awayScore+'/'+ req.body.Game16homeScore+'/'+ req.body.Game16awayScore+'/'+ req.body.Game17homeScore+'/'+ req.body.Game17awayScore+'/'+ req.body.Game18homeScore+'/'+ req.body.Game18awayScore
      let scorecardObj = {};
      scorecardObj.date = req.body.date
  scorecardObj.division = req.body.division 
  scorecardObj.homeTeam = req.body.homeTeam 
  scorecardObj.awayTeam = req.body.awayTeam 
  scorecardObj.homeMan1 = req.body.homeMan1 
  scorecardObj.homeMan2 = req.body.homeMan2 
  scorecardObj.homeMan3 = req.body.homeMan3 
  scorecardObj.homeLady1 = req.body.homeLady1 
  scorecardObj.homeLady2 = req.body.homeLady2 
  scorecardObj.homeLady3 = req.body.homeLady3 
  scorecardObj.awayMan1 = req.body.awayMan1 
  scorecardObj.awayMan2 = req.body.awayMan2 
  scorecardObj.awayMan3 = req.body.awayMan3 
  scorecardObj.awayLady1 = req.body.awayLady1 
  scorecardObj.awayLady2 = req.body.awayLady2 
  scorecardObj.awayLady3 = req.body.awayLady3 
  scorecardObj.FirstMixedhomeMan1 = req.body.FirstMixedhomeMan1 
  scorecardObj.SecondMixedhomeMan2 = req.body.SecondMixedhomeMan2 
  scorecardObj.ThirdMixedhomeMan3 = req.body.ThirdMixedhomeMan3 
  scorecardObj.FirstMixedhomeLady1 = req.body.FirstMixedhomeLady1 
  scorecardObj.SecondMixedhomeLady2 = req.body.SecondMixedhomeLady2 
  scorecardObj.ThirdMixedhomeLady3 = req.body.ThirdMixedhomeLady3 
  scorecardObj.FirstMixedawayMan1 = req.body.FirstMixedawayMan1 
  scorecardObj.SecondMixedawayMan2 = req.body.SecondMixedawayMan2 
  scorecardObj.ThirdMixedawayMan3 = req.body.ThirdMixedawayMan3 
  scorecardObj.FirstMixedawayLady1 = req.body.FirstMixedawayLady1 
  scorecardObj.SecondMixedawayLady2 = req.body.SecondMixedawayLady2 
  scorecardObj.ThirdMixedawayLady3 = req.body.ThirdMixedawayLady3 
  scorecardObj.Game1homeScore = req.body.Game1homeScore 
  scorecardObj.Game1awayScore = req.body.Game1awayScore 
  scorecardObj.Game2homeScore = req.body.Game2homeScore 
  scorecardObj.Game2awayScore = req.body.Game2awayScore 
  scorecardObj.Game3homeScore = req.body.Game3homeScore 
  scorecardObj.Game3awayScore = req.body.Game3awayScore 
  scorecardObj.Game4homeScore = req.body.Game4homeScore 
  scorecardObj.Game4awayScore = req.body.Game4awayScore 
  scorecardObj.Game5homeScore = req.body.Game5homeScore 
  scorecardObj.Game5awayScore = req.body.Game5awayScore 
  scorecardObj.Game6homeScore = req.body.Game6homeScore 
  scorecardObj.Game6awayScore = req.body.Game6awayScore 
  scorecardObj.Game7homeScore = req.body.Game7homeScore 
  scorecardObj.Game7awayScore = req.body.Game7awayScore 
  scorecardObj.Game8homeScore = req.body.Game8homeScore 
  scorecardObj.Game8awayScore = req.body.Game8awayScore 
  scorecardObj.Game9homeScore = req.body.Game9homeScore 
  scorecardObj.Game9awayScore = req.body.Game9awayScore 
  scorecardObj.Game10homeScore = req.body.Game10homeScore 
  scorecardObj.Game10awayScore = req.body.Game10awayScore 
  scorecardObj.Game11homeScore = req.body.Game11homeScore 
  scorecardObj.Game11awayScore = req.body.Game11awayScore 
  scorecardObj.Game12homeScore = req.body.Game12homeScore 
  scorecardObj.Game12awayScore = req.body.Game12awayScore 
  scorecardObj.Game13homeScore = req.body.Game13homeScore 
  scorecardObj.Game13awayScore = req.body.Game13awayScore 
  scorecardObj.Game14homeScore = req.body.Game14homeScore 
  scorecardObj.Game14awayScore = req.body.Game14awayScore 
  scorecardObj.Game15homeScore = req.body.Game15homeScore 
  scorecardObj.Game15awayScore = req.body.Game15awayScore 
  scorecardObj.Game16homeScore = req.body.Game16homeScore 
  scorecardObj.Game16awayScore = req.body.Game16awayScore 
  scorecardObj.Game17homeScore = req.body.Game17homeScore 
  scorecardObj.Game17awayScore = req.body.Game17awayScore 
  scorecardObj.Game18homeScore = req.body.Game18homeScore 
  scorecardObj.Game18awayScore = req.body.Game18awayScore 
  scorecardObj['scoresheet-url'] = req.body['scoresheet-url']
  scorecardObj['email'] = req.body['email']
      Fixture.createScorecard(scorecardObj,function(err,rows){
        if (err){
          console.log(err)
          next(err)
        }
        else {
          console.log(rows);
          let scorecardUrlBeta = 'https://' + req.headers.host + '/populated-scorecard-beta/' + rows.insertId;
          const msg = {
            to: 'stockport.badders.results@gmail.com',
            from: 'stockport.badders.results@stockport-badminton.co.uk',
            subject: 'scorecard received',
            text: 'a new scorecard has been uploaded: ' + req.body["scoresheet-url"] + '\n check the result here:' + scorecardUrl,
            html: '<p>a new scorecard has been uploaded: <a href="'+ req.body["scoresheet-url"] +'">'+ req.body["scoresheet-url"]+ '</a><br />Check the result here: <a href="'+ scorecardUrl +'">Confirm</a> or <a href="'+ scorecardUrlBeta + '">'+ scorecardUrlBeta + '</a></p>'
          };
          sgMail.send(msg)
            .then(()=>{
              console.log(msg)
              res.render('email-scorecard', {
                static_path: '/static',
                theme: process.env.THEME || 'flatly',
                flask_debug: process.env.FLASK_DEBUG || 'false',
                pageTitle : "Stockport & District Badminton League Scorecard Upload",
                pageDescription : "Upload your scorecard and send to the website",
                scorecard:req.body
              });
            })
            .catch(error => {
              logger.log(error.toString());
              next("Sorry something went wrong sending your scoresheet to the admin - drop him an email.");
            })

        }
      })
      
    }
    
  }

exports.fixture_populate_scorecard = function(data,req,res,next){
  //console.log(data);
  //console.log(data.date);
  Division.getAllAndSelectedByName(1,data.division,function(err,divisionRows){
    if(err){
      next(err)
    }
    else {
      // console.log(divisionRows)
      Division.getByName(data.division,function(err,divisionIdRows){
        if (err) {
          next(err)
        }
        else{
          // console.log(divisionIdRows)
          Team.getAllAndSelectedByName(data.home_team,divisionIdRows[0].id,function(err,homeTeamRows){
            if (err) {
              next(err)
            }
            else{
              // console.log(homeTeamRows)
              Team.getAllAndSelectedByName(data.away_team,divisionIdRows[0].id,function(err,awayTeamRows){
                if (err) {
                  next(err)
                }
                else{
                  // console.log(awayTeamRows)
                  Player.findElgiblePlayersFromTeamNameAndSelectedSansLevenshtein(data.home_team,'Male',data.home_man_1,data.home_man_2,data.home_man_3,function(err,homeMenRows){
                    if(err){
                      next(err)
                    }
                    else{
                      // console.log(homeMenRows)
                      Player.findElgiblePlayersFromTeamNameAndSelectedSansLevenshtein(data.home_team,'Female',data.home_lady_1,data.home_lady_2,data.home_lady_3,function(err,homeLadiesRows){
                        if(err){
                          next(err)
                        }
                        else{
                          // console.log(homeLadiesRows)
                          Player.findElgiblePlayersFromTeamNameAndSelectedSansLevenshtein(data.away_team,'Male',data.away_man_1,data.away_man_2,data.away_man_3,function(err,awayMenRows){
                            if(err){
                              next(err)
                            }
                            else{
                              // console.log(awayMenRows)
                              Player.findElgiblePlayersFromTeamNameAndSelectedSansLevenshtein(data.away_team,'Female',data.away_lady_1,data.away_lady_2,data.away_lady_3,function(err,awayLadiesRows){
                                if(err){
                                  next(err)
                                }
                                else{
                                  var renderData = {
                                    "divisionRows":divisionRows,
                                    "divisionIdRows":divisionIdRows,
                                    "homeTeamRows":homeTeamRows,
                                    "awayTeamRows":awayTeamRows,
                                    "homeMenRows":homeMenRows,
                                    "homeLadiesRows":homeLadiesRows,
                                    "awayMenRows":awayMenRows,
                                    "awayLadiesRows":awayLadiesRows
                                  };
                                  logger.log(renderData);
                                  res.render('populated-scorecard', {
                                      static_path: '/static',
                                      pageTitle : "Spreadsheet Upload Scorecard",
                                      pageDescription : "Show result of uploading scorecard",
                                      result : renderData,
                                      data : data
                                  });
                                }
                            })
                          }
                        })
                      }
                    })
                  }
                })
              }
            })
          }
        })
        // console.log(data);
      }
    })
  }
})
}

exports.fixture_populate_scorecard_fromId = function(req,res,next){
  
  Fixture.getScorecardById(req.params.id,(err,rows) => {
    if(err){
      console.log(err);
      next(err)
    }
    else{
      Division.getAllAndSelectedById(1,rows[0].division,function(err,divisionRows){
        if(err){
          next(err)
        }
            else{
              // console.log(divisionIdRows)
              Team.getAllAndSelectedById(rows[0].homeTeam,rows[0].division,function(err,homeTeamRows){
                if (err) {
                  next(err)
                }
                else{
                  // console.log(homeTeamRows)
                  Team.getAllAndSelectedById(rows[0].awayTeam,rows[0].division,function(err,awayTeamRows){
                    if (err) {
                      next(err)
                    }
                    else{
                      // console.log(awayTeamRows)
                      Player.getEligiblePlayersAndSelectedById(rows[0].homeMan1,rows[0].homeMan2,rows[0].homeMan3,rows[0].homeTeam,'Male',function(err,homeMenRows){
                        if(err){
                          next(err)
                        }
                        else{
                          // console.log(homeMenRows)
                          Player.getEligiblePlayersAndSelectedById(rows[0].homeLady1,rows[0].homeLady2,rows[0].homeLady3,rows[0].homeTeam,'Female',function(err,homeLadiesRows){
                            if(err){
                              next(err)
                            }
                            else{
                              // console.log(homeLadiesRows)
                              Player.getEligiblePlayersAndSelectedById(rows[0].awayMan1,rows[0].awayMan2,rows[0].awayMan3,rows[0].awayTeam,'Male',function(err,awayMenRows){
                                if(err){
                                  next(err)
                                }
                                else{
                                  // console.log(awayMenRows)
                                  Player.getEligiblePlayersAndSelectedById(rows[0].awayLady1,rows[0].awayLady2,rows[0].awayLady3,rows[0].awayTeam,'Female',function(err,awayLadiesRows){
                                    if(err){
                                      next(err)
                                    }
                                    else{
                                      // console.log(awayLadiesRows)
                                      var renderData = {
                                        "divisionRows":divisionRows,
                                        "homeTeamRows":homeTeamRows,
                                        "awayTeamRows":awayTeamRows,
                                        "homeMenRows":homeMenRows,
                                        "homeLadiesRows":homeLadiesRows,
                                        "awayMenRows":awayMenRows,
                                        "awayLadiesRows":awayLadiesRows,
                                      };
                                      console.log(renderData);
                                      logger.log(renderData);

                                      res.render('populated-scorecard', {
                                          static_path: '/static',
                                          pageTitle : "Spreadsheet Upload Scorecard",
                                          pageDescription : "Show result of uploading scorecard",
                                          result : renderData,
                                          data : rows[0]
                                      });
                                    }
                                })
                              }
                            })
                          }
                        })
                      }
                    })
                  }
                })
              }
            })
            // console.log(data);
          }
        })
    }
  })
  
  //TODO tidy the chain below up
  
  }

  exports.fixture_populate_scorecard_fromUrl = function(req,res,next){
    //console.log(data);
    //console.log(data.date);
    console.log(req.params);
    
    let data = req.params;
    //TODO tidy the chain below up
    Division.getAllAndSelectedById(1,data.division,function(err,divisionRows){
      if(err){
        next(err)
      }
          else{
            // console.log(divisionIdRows)
            Team.getAllAndSelectedById(data.home_team,data.division,function(err,homeTeamRows){
              if (err) {
                next(err)
              }
              else{
                // console.log(homeTeamRows)
                Team.getAllAndSelectedById(data.away_team,data.division,function(err,awayTeamRows){
                  if (err) {
                    next(err)
                  }
                  else{
                    // console.log(awayTeamRows)
                    Player.getEligiblePlayersAndSelectedById(data.home_man_1,data.home_man_2,data.home_man_3,data.home_team,'Male',function(err,homeMenRows){
                      if(err){
                        next(err)
                      }
                      else{
                        // console.log(homeMenRows)
                        Player.getEligiblePlayersAndSelectedById(data.home_lady_1,data.home_lady_2,data.home_lady_3,data.home_team,'Female',function(err,homeLadiesRows){
                          if(err){
                            next(err)
                          }
                          else{
                            // console.log(homeLadiesRows)
                            Player.getEligiblePlayersAndSelectedById(data.away_man_1,data.away_man_2,data.away_man_3,data.away_team,'Male',function(err,awayMenRows){
                              if(err){
                                next(err)
                              }
                              else{
                                // console.log(awayMenRows)
                                Player.getEligiblePlayersAndSelectedById(data.away_lady_1,data.away_lady_2,data.away_lady_3,data.away_team,'Female',function(err,awayLadiesRows){
                                  if(err){
                                    next(err)
                                  }
                                  else{
                                    // console.log(awayLadiesRows)
                                    var renderData = {
                                      "divisionRows":divisionRows,
                                      "homeTeamRows":homeTeamRows,
                                      "awayTeamRows":awayTeamRows,
                                      "homeMenRows":homeMenRows,
                                      "homeLadiesRows":homeLadiesRows,
                                      "awayMenRows":awayMenRows,
                                      "awayLadiesRows":awayLadiesRows
                                    };
                                    logger.log(renderData);
                                    res.render('populated-scorecard', {
                                        static_path: '/static',
                                        pageTitle : "Spreadsheet Upload Scorecard",
                                        pageDescription : "Show result of uploading scorecard",
                                        result : renderData,
                                        data : data
                                    });
                                  }
                              })
                            }
                          })
                        }
                      })
                    }
                  })
                }
              })
            }
          })
          // console.log(data);
        }
      })
    }

  exports.scorecard_nonmodal = function(req,res){
    Division.getAllByLeague(1,function(err,rows){
      res.render('index-scorecard-nonmodal',{
        static_path:'/static',
        theme:process.env.THEME || 'flatly',
        pageTitle : "Scorecard",
        pageDescription : "Enter some results!",
        result:rows
      })
    })
    
  }

  exports.scorecard_beta = function(req,res){
    Division.getAllByLeague(1,function(err,rows){
      res.render('index-scorecard',{
        static_path:'/static',
        theme:process.env.THEME || 'flatly',
        pageTitle : "Scorecard",
        pageDescription : "Enter some results!",
        result:rows
      })
    })
    
  }

  exports.email_scorecard = function(req,res,next){
    Division.getAllByLeague(1,function(err,rows){
      if(err){
        next(err)
      }
      else{
        Auth.getManagementAPIKey(function (err,apiKey){
          if (err){
            next(err);
          }
          else{
            var options = {
              method:'GET',
              headers:{
                "Authorization":"Bearer "+apiKey
              },
              url:'https://'+process.env.AUTH0_DOMAIN+'/api/v2/users?q=user_id:'+req.user.id+'&fields=app_metadata,nickname,email'
            }
            //console.log(options);
            request(options,function(err,response,userBody){
              //console.log(options);
              if (err){
                //console.log(err)
                return false
              }
              else{
                var user = JSON.parse(userBody);
                res.render('email-scorecard',{
                  static_path:'/static',
                  theme:process.env.THEME || 'flatly',
                  pageTitle : "Scorecard",
                  pageDescription : "Enter some results!",
                  result:rows,
                  user:user
                })
              }
            })
          }
        })
      }
  })
}

  exports.scorecard_upload = function(req, res) {
    res.render('beta/scorecard-upload', {
        static_path: '/static',
        theme: process.env.THEME || 'flatly',
        flask_debug: process.env.FLASK_DEBUG || 'false',
        pageTitle : "Stockport & District Badminton League Scorecard Upload",
        pageDescription : "Upload your scorecard and send to the website"
    });
  };

  exports.upload_scoresheet = function(req,res){
    res.render('beta/file-upload',{
      static_path:'/static',
      theme:process.env.THEME || 'flatly',
      pageTitle : "Upload Scorecard",
      pageDescription : "Enter some results!",
    })
  }

  exports.fixture_reminder_post = function(req,res,next){
    
    const msg = {
      cc: 'stockport.badders.results@gmail.com',
      from: 'stockport.badders.results@stockport-badminton.co.uk',
      templateId:'d-bc4e9fe2b6a4410e838d1ac29e283d30',
      dynamic_template_data:{
        "homeTeam":req.body.homeTeam,
        "awayTeam":req.body.awayTeam
      }
    };
    msg.to = (req.body.email.indexOf(',') > 0 ? req.body.email.split(',') : req.body.email);
    console.log(msg);
    sgMail.send(msg)
    .then(()=>res.send("Message Sent"))
    .catch(error => logger.log(error.toString()));
  }

  exports.scorecard_received = function(req,res,next){
    res.render('index-scorecard',{
      static_path:'/static',
      theme:process.env.THEME || 'flatly',
      pageTitle : "Scorecard Received - No Errors",
      pageDescription : "Enter some results!",
      scorecardData: req.body
    })
  }

// Handle Fixture update on POST
exports.fixture_update_post = function(req, res) {
    Fixture.updateById(req.body,req.params.id,function(err,row){
      if (err){
        res.send(err);
        // console.log(err);
      }
      else{
        // console.log(req.body);
        // console.log(row);
        res.send(row);
      }
    })
};
