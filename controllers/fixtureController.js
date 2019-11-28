var Division = require('../models/division');
var Team = require('../models/teams');
var Player = require('../models/players');
var Fixture = require('../models/fixture');
var Game = require('../models/game');
var request = require('request');
var AWS = require('aws-sdk');
var Auth = require('../models/auth.js');
 var logger = require('logzio-nodejs').createLogger({
  token: process.env.LOGZ_SECRET,
  host: 'listener.logz.io'
 });



// Display fixtures played 6 days ago that haven't had results entered
exports.getLateScorecards = function(req, res) {
    Fixture.getCardsDueToday(function(err,row){
      var params = {
        Destination: { /* required */
          ToAddresses: [
            'stockport.badders.results@gmail.com'
          ]
        },
        Message: { /* required */
          Body: {
            Html: {
             Charset: 'UTF-8',
             Data: ''
            }
           },
           Subject: {
            Charset: 'UTF-8',
            Data: 'Todays outstanding fixtures'
           }
          },
        Source: 'stockport.badders.results@gmail.com', /* required */
        ReplyToAddresses: [
            'stockport.badders.results@gmail.com'
        ],
      };
      if (err){
        params.Message.Body.Html.Data = JSON.stringify(err);
        // console.log(err);
      }
      else{
        if (row.length > 0){
          for (var x = 0; x < row.length; x++){
              params.Message.Body.Html.Data += row[x]['date'] + " - "+ row[x]['homeTeam'] + " - " + row[x]['awayTeam']
          }
        }
        else {
          params.Message.Body.Html.Data += 'No outstanding fixtures today'
        }

      }
      var ses = new AWS.SES({apiVersion: '2010-12-01'});
      ses.sendEmail(params, function(err, data) {
        if (err) {
          // console.log(err, err.stack); // an error occurred
          res.send(err);
        }
        else {
          // console.log(data);           // successful response
          res.send(data);
        }
      })
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
    switch (req.params.division) {
      case 'All':
        divisionId = 0
        break;
      case 'Division-1':
        divisionId = 8
        break;
      case 'Premier':
        divisionId = 7
        break;
      case 'Division-2':
        divisionId = 9
        break;
      case 'Division-3':
        divisionId = 10
        break;
      case 'Division-4':
        divisionId = 11
        break;
      default:
        next(err);
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
};

// Display detail page for a specific Fixture
exports.fixture_detail_byDivision_admin = function(req, res,next) {
  var divisionId = 0;
  switch (req.params.division) {
    case 'All':
      divisionId = 0
      break;
    case 'Division-1':
      divisionId = 8
      break;
    case 'Premier':
      divisionId = 7
      break;
    case 'Division-2':
      divisionId = 9
      break;
    case 'Division-3':
      divisionId = 10
      break;
    case 'Division-4':
      divisionId = 11
      break;
    default:
      next(err);
  }

  
  Auth.getManagementAPIKey(function (err,apiKey){
    if (err){
      //console.log("error")
      //console.log(err);
      next(err);
    }
    else{
      //console.log(" apikey:" + apiKey)
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




const { validationResult } = require("express-validator/check");

exports.full_fixture_post = function(req,res){
  var errors = validationResult(req);
  // console.log(errors.array());
  if (!errors.isEmpty()) {
    res.render('index-scorecard',{
      static_path:'/static',
      theme:process.env.THEME || 'flatly',
      pageTitle : "Scorecard Received - Errors",
      pageDescription : "Something went wrong",
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
      ],
      errors: errors.array()
    })
  }
  else {
    logger.log(req.body);
    console.log(req.body);
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
                            if (err) res.send(err)
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

exports.fixture_populate_scorecard = function(data,req,res,next){
  Division.getAllAndSelectedByName(1,data[0].division,function(err,divisionRows){
    if(err){
      next(err)
    }
    else {
      // console.log(divisionRows)
      Division.getByName(data[0].division,function(err,divisionIdRows){
        if (err) {
          next(err)
        }
        else{
          // console.log(divisionIdRows)
          Team.getAllAndSelectedByName(data[0].home_team,divisionIdRows[0].id,function(err,homeTeamRows){
            if (err) {
              next(err)
            }
            else{
              // console.log(homeTeamRows)
              Team.getAllAndSelectedByName(data[0].away_team,divisionIdRows[0].id,function(err,awayTeamRows){
                if (err) {
                  next(err)
                }
                else{
                  // console.log(awayTeamRows)
                  Player.findElgiblePlayersFromTeamIdAndSelected(data[0].home_team,'Male',data[0].home_man_1,data[0].home_man_2,data[0].home_man_3,function(err,homeMenRows){
                    if(err){
                      next(err)
                    }
                    else{
                      // console.log(homeMenRows)
                      Player.findElgiblePlayersFromTeamIdAndSelected(data[0].home_team,'Female',data[0].home_lady_1,data[0].home_lady_2,data[0].home_lady_3,function(err,homeLadiesRows){
                        if(err){
                          next(err)
                        }
                        else{
                          // console.log(homeLadiesRows)
                          Player.findElgiblePlayersFromTeamIdAndSelected(data[0].away_team,'Male',data[0].away_man_1,data[0].away_man_2,data[0].away_man_3,function(err,awayMenRows){
                            if(err){
                              next(err)
                            }
                            else{
                              // console.log(awayMenRows)
                              Player.findElgiblePlayersFromTeamIdAndSelected(data[0].away_team,'Female',data[0].away_lady_1,data[0].away_lady_2,data[0].away_lady_3,function(err,awayLadiesRows){
                                if(err){
                                  next(err)
                                }
                                else{
                                  // console.log(awayLadiesRows)
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
                                  res.render('populated-scorecard', {
                                      static_path: '/static',
                                      pageTitle : "Spreadsheet Upload Scorecard",
                                      pageDescription : "Show result of uploading scorecard",
                                      result : renderData,
                                      data : data[0]
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
