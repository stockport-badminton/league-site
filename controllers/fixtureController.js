var Division = require('../models/division');
var Team = require('../models/teams');
var Player = require('../models/players');
var Fixture = require('../models/fixture');
var Game = require('../models/game');
const axios = require('axios');
var AWS = require('aws-sdk');
var Auth = require('../models/auth.js');
const ICAL = require('ical.js');
const sgMail = require('@sendgrid/mail');
sgMail.setApiKey(process.env.SENDGRID_API_KEY);
var contact_controller = require(__dirname + '/contactusController');

const year = new Date().getFullYear()
const SEASON = new Date().getMonth() < 7
  ? `${year - 1}${year}`
  : `${year}${year + 1}`


 const { body,validationResult } = require("express-validator");
    const { sanitizeBody } = require("express-validator");

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
        return value !=0 ? ((value == req.body.homeMan2 || value == req.body.homeMan3 || value == req.body.awayMan1 || value == req.body.awayMan2 || value == req.body.awayMan3) ? false : value) : value
      }).withMessage("Home Man 1: can't use the same player more than once"),
      body('homeMan2', 'Please choose a player.').isInt().custom((value,{req}) => {
        return value !=0 ? ((value == req.body.homeMan3 || value == req.body.homeMan1 || value == req.body.awayMan1 || value == req.body.awayMan2 || value == req.body.awayMan3) ? false : value) : value
      }).withMessage("Home Man 2: can't use the same player more than once"),
      body('homeMan3', 'Please choose a player.').isInt().custom((value,{req}) => {
        return value !=0 ? ((value == req.body.homeMan2 || value == req.body.homeMan1 || value == req.body.awayMan1 || value == req.body.awayMan2 || value == req.body.awayMan3) ? false : value) : value 
      }).withMessage("Home Man 3:can't use the same player more than once"),
      body('homeLady1', 'Please choose a player.').isInt().custom((value,{req}) => {
        return value !=0 ? ((value == req.body.homeLady2 || value == req.body.homeLady3 || value == req.body.awayLady1 || value == req.body.awayLady2 || value == req.body.awayLady3) ? false : value) : value 
      }).withMessage("Home Lady 1: can't use the same player more than once"),
      body('homeLady2', 'Please choose a player.').isInt().custom((value,{req}) => {
        return value !=0 ? ((value == req.body.homeLady3 || value == req.body.homeLady1 || value == req.body.awayLady1 || value == req.body.awayLady2 || value == req.body.awayLady3) ? false : value) : value 
      }).withMessage("Home Lady 2: can't use the same player more than once"),
      body('homeLady3', 'Please choose a player.').isInt().custom((value,{req}) => {
        return value !=0 ? ((value == req.body.homeLady2 || value == req.body.homeLady1 || value == req.body.awayLady1 || value == req.body.awayLady2 || value == req.body.awayLady3) ? false : value) : value 
      }).withMessage("Home Lady 3: can't use the same player more than once"),
      body('awayMan1', 'Please choose a player.').isInt().custom((value,{req}) => {
        return value !=0 ? ((value == req.body.homeMan2 || value == req.body.homeMan3 || value == req.body.homeMan1 || value == req.body.awayMan2 || value == req.body.awayMan3) ? false : value) : value 
      }).withMessage("Away Man 1: can't use the same player more than once"),
      body('awayMan2', 'Please choose a player.').isInt().custom((value,{req}) => {
        return value !=0 ? ((value == req.body.homeMan2 || value == req.body.homeMan3 || value == req.body.awayMan1 || value == req.body.awayMan3 || value == req.body.awayMan1) ? false : value) : value 
      }).withMessage("Away Man 2: can't use the same player more than once"),
      body('awayMan3', 'Please choose a player.').isInt().custom((value,{req}) => {
        return value !=0 ? ((value == req.body.homeMan2 || value == req.body.homeMan3 || value == req.body.awayMan1 || value == req.body.awayMan2 || value == req.body.awayMan1) ? false : value) : value 
      }).withMessage("Away Man 3: can't use the same player more than once"),
      body('awayLady1', 'Please choose a player.').isInt().custom((value,{req}) => {
        return value !=0 ? ((value == req.body.homeLady2 || value == req.body.homeLady3 || value == req.body.homeLady1 || value == req.body.awayLady3 || value == req.body.awayLady2) ? false : value) : value 
      }).withMessage("Away Lady 1: can't use the same player more than once"),
      body('awayLady2', 'Please choose a player.').isInt().custom((value,{req}) => {
        return value !=0 ? ((value == req.body.homeLady2 || value == req.body.homeLady3 || value == req.body.homeLady1 || value == req.body.awayLady3 || value == req.body.awayLady1) ? false : value) : value 
      }).withMessage("Away Lady 2: can't use the same player more than once"),
      body('awayLady3', 'Please choose a player.').isInt().custom((value,{req}) => {
        return value !=0 ? ((value == req.body.homeLady2 || value == req.body.homeLady3 || value == req.body.homeLady1 || value == req.body.awayLady2 || value == req.body.awayLady1) ? false : value) : value 
      }).withMessage("Away Lady 3: can't use the same player more than once"),
      body('FirstMixedhomeMan1', 'Please choose a player.').isInt().custom((value,{req}) => {
        return value !=0 ? ((value == req.body.SecondMixedhomeMan2 || value == req.body.ThirdMixedhomeMan3) ? false : value) : value 
      }).withMessage("First Mixed Home Man: can't use the same player more than once"),
      body('SecondMixedhomeMan2', 'Please choose a player.').isInt().custom((value,{req}) => {
        return value !=0 ? ((value == req.body.FirstMixedhomeMan1 || value == req.body.ThirdMixedhomeMan3) ? false : value) : value 
      }).withMessage("Second Mixed Home Man: can't use the same player more than once"),
      body('ThirdMixedhomeMan3', 'Please choose a player.').isInt().custom((value,{req}) => {
        return value !=0 ? ((value == req.body.FirstMixedhomeMan1 || value == req.body.SecondMixedhomeMan2) ? false : value) : value 
      }).withMessage("Third Mixed Home Man: can't use the same player more than once"),
      body('FirstMixedawayMan1', 'Please choose a player.').isInt().custom((value,{req}) => {
        return value !=0 ? ((value == req.body.SecondMixedawayMan2 || value == req.body.ThirdMixedawayMan3) ? false : value) : value 
      }).withMessage("First Mixed Away Man: can't use the same player more than once"),
      body('SecondMixedawayMan2', 'Please choose a player.').isInt().custom((value,{req}) => {
        return value !=0 ? ((value == req.body.FirstMixedawayMan1 || value == req.body.ThirdMixedawayMan3) ? false : value) : value 
      }).withMessage("Second Mixed Away Man: can't use the same player more than once"),
      body('ThirdMixedawayMan3', 'Please choose a player.').isInt().custom((value,{req}) => {
        return value !=0 ? ((value == req.body.FirstMixedawayMan1 || value == req.body.SecondMixedawayMan2) ? false : value) : value 
      }).withMessage("Third Mixed Away Man: can't use the same player more than once"),
      body('FirstMixedhomeLady1', 'Please choose a player.').isInt().custom((value,{req}) => {
        return value !=0 ? ((value == req.body.SecondMixedhomeLady2 || value == req.body.ThirdMixedhomeLady3) ? false : value) : value 
      }).withMessage("First Mixed Home Lady: can't use the same player more than once"),
      body('SecondMixedhomeLady2', 'Please choose a player.').isInt().custom((value,{req}) => {
        return value !=0 ? ((value == req.body.FirstMixedhomeLady1 || value == req.body.ThirdMixedhomeLady3) ? false : value) : value 
      }).withMessage("Second Mixed Home Lady: can't use the same player more than once"),
      body('ThirdMixedhomeLady3', 'Please choose a player.').isInt().custom((value,{req}) => {
        return value !=0 ? ((value == req.body.FirstMixedhomeLady1 || value == req.body.SecondMixedhomeLady2) ? false : value) : value 
      }).withMessage("Third Mixed Home Lady: can't use the same player more than once"),
      body('FirstMixedawayLady1', 'Please choose a player.').isInt().custom((value,{req}) => {
        return value !=0 ? ((value == req.body.SecondMixedawayLady2 || value == req.body.ThirdMixedawayLady3) ? false : value) : value 
      }).withMessage("First Mixed Away Lady: can't use the same player more than once"),
      body('SecondMixedawayLady2', 'Please choose a player.').isInt().custom((value,{req}) => {
        return value !=0 ? ((value == req.body.FirstMixedawayLady1 || value == req.body.ThirdMixedawayLady3) ? false : value) : value 
      }).withMessage("Second Mixed Away Lady: can't use the same player more than once"),
      body('ThirdMixedawayLady3', 'Please choose a player.').isInt().custom((value,{req}) => {
        return value !=0 ? ((value == req.body.FirstMixedawayLady1 || value == req.body.SecondMixedawayLady2) ? false : value) : value 
      }).withMessage("Third Mixed Away Lady: can't use the same player more than once")
    ]


// Display fixtures played 6 days ago that haven't had results entered
exports.getLateScorecards = async function(req, res) {
  try {
    const row = await Fixture.getCardsDueToday();
    const msg = {
      to: 'stockport.badders.results@gmail.com',
      from: 'stockport.badders.results@stockport-badminton.co.uk',
      replyto: 'stockport.badders.results@gmail.com',
      templateId: 'd-3a224c8f7b214f3ba4062f6a2dbd1bd4',
      dynamic_template_data: { "missingFixtures": [] }
    };

    var params;
    if (row.length > 0) {
      for (var x = 0; x < row.length; x++) {
        var fixture = {};
        fixture.date = row[x].date;
        fixture.homeTeam = row[x].homeTeam;
        fixture.awayTeam = row[x].awayTeam;
        msg.dynamic_template_data.missingFixtures.push(fixture);
      }
      params = {
        Destination: { ToAddresses: ['stockport.badders.results@gmail.com', 'bigcoops@outlook.com'] },
        Message: {
          Body: { Html: { Charset: 'UTF-8', Data: contact_controller.generateMissingScorecardHTML(msg.dynamic_template_data.missingFixtures) } },
          Subject: { Charset: 'UTF-8', Data: 'Todays Missing Scorecards' }
        },
        Source: 'results@stockport-badminton.co.uk',
        ReplyToAddresses: ['stockport.badders.results@gmail.com'],
      };
    } else {
      msg.dynamic_template_data.noFixtures = 'No outstanding fixtures today';
    }

    let today = new Date()
    if (today.getMonth() <= 4 || today.getMonth() >= 7) {
      var ses = new AWS.SES({ apiVersion: '2010-12-01' });
      await ses.sendEmail(params).promise();
      res.send("Message Sent");
    } else {
      res.sendStatus(200);
    }
  } catch (err) {
    console.log(err.toString());
    res.status(500).send(err);
  }
};


exports.fixture_outstanding = async function(req, res, next) {
  try {
    const result = await Fixture.getOutstandingResults();
    res.render('results-short', {
      static_path: '/static',
      theme: process.env.THEME || 'flatly',
      pageTitle: "Quick Results Entry",
      pageDescription: "Quick Results Entry",
      result: result,
      stringResult: JSON.stringify(result),
      canonical: ("https://" + req.get("host") + req.originalUrl).replace("www.'", "").replace(".com", ".co.uk").replace("-badders.herokuapp", "-badminton")
    });
  } catch (err) {
    next(err);
  }
}

// Handle Fixture update on POST
exports.fixture_outstanding_post = async function(req, res, next) {
  try {
    var reqBody = {
      "homeScore": 1 * (req.body.homeTeamScore),
      "awayScore": 18 - req.body.homeTeamScore,
      "status": "complete"
    }
    await Fixture.updateById(reqBody, req.body.outstandingResults);
    var zapObject = {
      "homeTeam": req.body.homeTeamName,
      "awayTeam": req.body.awayTeamName,
      "homeScore": 1 * (req.body.homeTeamScore),
      "awayScore": 1 * (req.body.awayTeamScore),
      "division": "Premier"
    }
    const zapRes = await Fixture.sendResultZap(zapObject);
    const result = await Fixture.getOutstandingResults();
    res.render('results-short', {
      static_path: '/static',
      theme: process.env.THEME || 'flatly',
      pageTitle: "Quick Results Entry - Success",
      pageDescription: "Quick Results Entry - Success",
      result: result,
      zapRes: zapRes,
      success: true,
      canonical: ("https://" + req.get("host") + req.originalUrl).replace("www.", "").replace(".com", ".co.uk").replace("-badders.herokuapp", "-badminton")
    });
  } catch (err) {
    next(err);
  }
};

// Display list of all Fixtures
exports.fixture_list = async function(req, res, next) {
  try {
    const row = await Fixture.getAll();
    res.send(row);
  } catch (err) {
    res.send(err);
  }
};

// Display list of all Fixtures
exports.get_fixture_players_details = async function(req, res, next) {
  try {
    var searchObj = {}
    if (req.params.season !== undefined) searchObj.season = req.params.season
    if (req.params.team !== undefined) searchObj.team = req.params.team
    if (req.params.club !== undefined) searchObj.club = req.params.club
    const row = await Fixture.getMatchPlayerOrderDetails(searchObj);
    let clubs = row.map(item => item.name).filter((value, index, self) => self.indexOf(value) === index)
    let teams = row.map(item => item.teamName).filter((value, index, self) => self.indexOf(value) === index)
    res.render('beta/fixture-players', {
      static_path: '/static',
      pageTitle: "Fixture Player Details",
      pageDescription: "Find out who played which matches and in what order",
      filter: true,
      hideFilters: ["division", "gender", "gametype"],
      teams: teams,
      clubs: clubs,
      result: row,
      canonical: ("https://" + req.get("host") + req.originalUrl).replace("www.'", "").replace(".com", ".co.uk").replace("-badders.herokuapp", "-badminton")
    });
  } catch (err) {
    res.send(err);
  }
};

// Return fixture id given home and away team ids
exports.fixture_id = async function(req, res, next) {
  try {
    const row = await Fixture.getFixtureId({ "homeTeam": req.params.homeTeam, "awayTeam": req.params.awayTeam });
    res.send(row);
  } catch (err) {
    res.send(err);
  }
};

// Return fixture id given home and away team names
exports.fixture_id_from_team_names = async function(req, res, next) {
  try {
    const row = await Fixture.getFixtureIdFromTeamNames({ "homeTeam": req.params.homeTeam, "awayTeam": req.params.awayTeam });
    res.send(row);
  } catch (err) {
    res.send(err);
  }
};

// Display detail page for a specific Fixture
exports.fixture_detail = async function(req, res, next) {
  try {
    const row = await Fixture.getById(req.params.id);
    res.send(row);
  } catch (err) {
    res.send(err);
  }
};

// Display detail page for a specific Fixture
exports.fixture_event_detail = async function(req, res, next) {
  try {
    const row = await Fixture.getFixtureEventById(req.params.id);
    res.render('beta/viewEventDetails', {
      static_path: '/static',
      pageTitle: 'Event Details: ' + row[0].homeTeam + " vs " + row[0].awayTeam,
      pageDescription: "View scorecard for this match",
      fixtureDetails: row[0],
      mapsApiKey: process.env.GMAPSAPIKEY,
      canonical: ("https://" + req.get("host") + req.originalUrl).replace("www.'", "").replace(".com", ".co.uk").replace("-badders.herokuapp", "-badminton")
    });
  } catch (err) {
    res.send(err);
  }
};

// Display detail page for a specific Fixture
exports.getScorecard = async function(req, res, next) {
  try {
    const row = await Fixture.getScorecardDataById(req.params.id);
    res.render('beta/viewScorecard', {
      static_path: '/static',
      pageTitle: "Scorecard Info",
      pageDescription: "View scorecard for this match",
      result: row,
      canonical: ("https://" + req.get("host") + req.originalUrl).replace("www.'", "").replace(".com", ".co.uk").replace("-badders.herokuapp", "-badminton")
    });
  } catch (err) {
    res.send(err);
  }
};

exports.fixture_calendars = async function(req,res,next){
    // console.log(Object.entries(req.params))
    var convertedParams = req.params[0].replace('Premier','division-7')
      .replace('Division 1','division-8')
      .replace('Division-1','division-8')
      .replace('Division 2','division-9')
      .replace('Division-2','division-9')
      .replace('Division 3','division-10')
      .replace('Division-3','division-10')
      .replace(/(\/)(20\d\d20\d\d)/g,'$1season-$2')
    const pattern = /(\bPremier(?!\s|-\d)|Division(?:-|\s))(\d+)/g;
    // Finding matches using regex and replacing them
    const replacedMatches = [];
    const replacedString = req.params[0].replace(pattern, (match, p1, p2) => {
      let replacedMatch;
      if (p1 === "Premier") {
        replacedMatch = p1;
      } else {
        replacedMatch = `${p1.replace('-', ' ')}${p2}`;
      }
      replacedMatches.push(replacedMatch);
      return replacedMatch;
    });
    let divisionString = "All"
    if (replacedMatches.length > 0){
      divisionString = replacedMatches[0]
    }
    // console.log(regexParams)
    var searchArray = convertedParams.split('/')
    let searchObj = searchArray.reduce((acc, str) => {
      const [key, value] = str.split("-");
      return { ...acc, [key]: value };
    }, {});
     //console.log(searchObj)
    try {
      let result = await Fixture.getFixtureDetails(searchObj);
      {
          result = result.filter(row => row.homeClub.indexOf('No Club') == -1)
          let id = (searchObj.season != undefined ? searchObj.season:SEASON) + (searchObj.division != undefined ? searchObj.division:"") + (searchObj.club != undefined ? searchObj.club:"") + (searchObj.team != undefined ? searchObj.team:"")

          const jcal = new ICAL.Component('vcalendar');
          jcal.addPropertyWithValue('prodid', (searchObj.season != undefined ? searchObj.season:SEASON) +"/"+ (searchObj.division != undefined ? searchObj.division:"") +"/"+ (searchObj.club != undefined ? searchObj.club:"") +"/"+ (searchObj.team != undefined ? searchObj.team:""));
          jcal.addPropertyWithValue('version', '2.0');
          const vcalendar = jcal

          // Iterate over each event and convert it to an iCalendar event
          result.forEach(row => {
            let MyDate = new Date(row.date)

            let startDate = MyDate.getFullYear()+ ('0' + (MyDate.getMonth()+1)).slice(-2)  + ('0' + MyDate.getDate()).slice(-2)
            let endDate = MyDate.getFullYear() + ('0' + (MyDate.getMonth()+1)).slice(-2) + ('0' + (MyDate.getDate()+1)).slice(-2)
            const vevent = new ICAL.Component('vevent');
            vevent.addPropertyWithValue('uid', row.id.toString());
            vevent.addPropertyWithValue('summary', row.homeTeam + " vs " + row.awayTeam);
            vevent.addPropertyWithValue('dtstart;value=date', startDate);
            vevent.addPropertyWithValue('dtend;value=date', endDate);
            vevent.addPropertyWithValue('location', row.venueName + " " + row.venueLink);

            // Add other properties if needed

            vcalendar.addSubcomponent(vevent);
          });

          // Convert the iCalendar object to a string
          const icsData = jcal.toString();

          // Set the response headers
          res.setHeader('Content-Type', 'text/calendar');
          res.setHeader('Content-Disposition', `attachment; filename=${id}.ics`);
          res.setHeader('Cache-Control', 'no-cache');
          res.setHeader('ETag', id + new Date().toUTCString()); // Update the ETag value when the calendar data changes
          res.setHeader('Last-Modified', new Date().toUTCString());

          // Send the iCalendar data as the response
          res.send(icsData);
      }
    } catch (err) {
      next(err);
    }
}

// Display detail page for a specific Fixture
exports.fixture_detail_byDivision = async function(req, res, next) {
  function buildGridData(result) {
    let divisionsArray = result.map(row => row.division).filter((division, index, arr) => arr.indexOf(division) == index)
    let griddedData = []
    for (division of divisionsArray) {
      let gridFixtures = result.filter(row => row.division == division && row.status != 'rearranged' && row.id != 99999)
      gridFixtures.sort(function(x, y) { return x.homeTeam.localeCompare(y.homeTeam) || x.awayTeam.localeCompare(y.awayTeam); });
      let gridTeams = gridFixtures.map(p => p.homeTeam).filter((homeTeam, index, arr) => arr.indexOf(homeTeam) == index)
      let gridDataElem = {}
      gridDataElem.teams = gridTeams
      gridDataElem.fixtures = gridFixtures
      gridDataElem.division = division == 7 ? "Prem" : division == 8 ? "Division 1" : division == 9 ? "Division 2" : "Division 3";
      griddedData.push(gridDataElem)
    }
    return griddedData
  }

  function getNearestFixture(result) {
    let today = new Date()
    today.setHours(0); today.setMinutes(0); today.setSeconds(0); today.setMilliseconds(0);
    let nearestFixture = result
      .map((row) => ({ "date": row.date, "diff": new Date(row.date) - today }))
      .filter(row => row.diff >= 0)
      .sort((a, b) => a.diff - b.diff)
    if (nearestFixture.length == 0) nearestFixture.push(result[result.length - 1])
    return nearestFixture
  }

  function applyAdminRole(renderObject, req) {
    if (req.path.search('admin') != -1 && req.user._json["https://my-app.example.com/role"] !== undefined) {
      const role = req.user._json["https://my-app.example.com/role"]
      if (role == "admin" || role == "superadmin") {
        renderObject.admin = true
        renderObject.superadmin = role == "superadmin"
        renderObject.user = req.user
      }
    }
  }

  try {
    let divisionString = "";
    let searchObj = {}
    if (req.params.division !== undefined) {
      divisionString = req.params.division.replace('-', ' ')
      const row = await Division.getIdByURLParam(req.params.division);
      if (row.length < 1) {
        delete req.params.division
        searchObj = req.params
      } else {
        searchObj = req.params
        searchObj.division = row[0].id
      }
      const result = await Fixture.getFixtureDetails(searchObj);
      const nearestFixture = getNearestFixture(result)
      console.log(`nearestFixture: ${nearestFixture[0].date}`)
      var type = '';
      if (req.path.indexOf('results-grid') > -1) type = '-grid'
      const griddedData = buildGridData(result)
      let renderObject = {
        static_path: '/static',
        pageTitle: "Fixtures & Results: " + divisionString,
        pageDescription: "Find out how the teams in your division have got on, and check when your next match is",
        result: result,
        jsonResult: griddedData,
        error: false,
        division: divisionString,
        nearestDate: nearestFixture[0].date,
        canonical: ("https://" + req.get("host") + req.originalUrl).replace("www.", "").replace(".com", ".co.uk").replace("-badders.herokuapp", "-badminton")
      }
      applyAdminRole(renderObject, req)
      console.log(renderObject)
      res.render('beta/fixtures-results' + type, renderObject);
    } else {
      var convertedParams = req.params[0].replace('Premier', 'division-7')
        .replace('Division 1', 'division-8').replace('Division-1', 'division-8')
        .replace('Division 2', 'division-9').replace('Division-2', 'division-9')
        .replace('Division 3', 'division-10').replace('Division-3', 'division-10')
        .replace(/(\/)(20\d\d20\d\d)/g, '$1season-$2')
      const pattern = /(\bPremier(?!\s|-\d)|Division(?:-|\s))(\d+)/g;
      const replacedMatches = [];
      req.params[0].replace(pattern, (match, p1, p2) => {
        replacedMatches.push(p1 === "Premier" ? p1 : `${p1.replace('-', ' ')}${p2}`);
        return match;
      });
      divisionString = replacedMatches.length > 0 ? replacedMatches[0] : "All"
      var searchArray = convertedParams.split('/')
      searchObj = searchArray.reduce((acc, str) => {
        const [key, value] = str.split("-");
        return { ...acc, [key]: value };
      }, {});
      if (req.path.search('admin') != -1 && req.user._json["https://my-app.example.com/role"] == "admin") {
        if (req.user._json["https://my-app.example.com/club"] != "All" && req.user._json["https://my-app.example.com/club"] !== undefined) {
          searchObj.club = req.user._json["https://my-app.example.com/club"]
        }
      }
      const result = await Fixture.getFixtureDetails(searchObj);
      const nearestFixture = getNearestFixture(result)
      console.log(`nearestFixture: ${nearestFixture[0].date}`)
      var type = '';
      if (req.path.indexOf('results-grid') > -1) type = '-grid'
      const griddedData = buildGridData(result)
      let titleString = ""
      if (searchObj !== undefined) {
        for (filter of ['season', 'division', 'club', 'team']) {
          let sqlParams = Object.entries(searchObj).filter(obj => obj[0] === filter)
          if (sqlParams.length > 0) titleString += sqlParams[0][1] + " "
        }
      }
      let clubs = result.map(item => item.homeClub).filter((value, index, self) => self.indexOf(value) === index)
      let teams = result.map(item => item.homeTeam).filter((value, index, self) => self.indexOf(value) === index)
      let renderObject = {
        path: req.path,
        user: req.user,
        clubs: clubs,
        teams: teams,
        filter: true,
        hideFilters: ["gender", "gametype"],
        static_path: '/static',
        pageTitle: "Fixtures & Results: " + titleString,
        pageDescription: "Find out how the teams in your division have got on, and check when your next match is",
        result: result,
        jsonResult: griddedData,
        error: false,
        division: divisionString,
        nearestDate: nearestFixture[0].date,
        canonical: ("https://" + req.get("host") + req.originalUrl).replace("www.'", "").replace(".com", ".co.uk").replace("-badders.herokuapp", "-badminton")
      }
      applyAdminRole(renderObject, req)
      if (req.path.indexOf('fixtures') > -1) {
        res.status(200);
        res.send(result);
      } else {
        res.status(200);
        console.log(renderObject.jsonResult)
        res.render('beta/fixtures-results' + type, renderObject);
      }
    }
  } catch (err) {
    next(err);
  }
};


// Display Fixture create form on GET
exports.fixture_create_get = function(req, res,next) {
    res.send('NOT IMPLEMENTED: Fixture create GET');
};

// Handle Fixture create on POST
exports.fixture_create_post = async function(req, res, next) {
  try {
    const row = await Fixture.create(req.body);
    res.send(row);
  } catch (err) {
    res.send(err);
  }
};



// Handle getting results from previous 7 days
exports.fixture_get_summary = async function(req, res, next) {
  try {
    const [scorecards, recentResults, upcomingFixtures] = await Promise.all([
      Fixture.getOutstandingScorecards(),
      Fixture.getRecent(),
      Fixture.getupComing()
    ]);
    const response = await axios.get('https://api.cloudinary.com/v1_1/hvunsveuh/resources/image/tags/messer2026?max_results=30&context=true', {
      headers: { 'Authorization': 'Basic ' + process.env.CLOUDINARY_AUTH }
    });
    res.render('beta/homepage', {
      static_path: '/static',
      pageTitle: "Homepage",
      pageDescription: "Clubs: Aerospace, Astrazeneca, Altrincham Central, Bramhall Village, CAP, Canute, Carrington, Cheadle Hulme, College Green, David Lloyd, Disley, Dome, GHAP, Macclesfield, Manor, Mellor, New Mills, Parrswood, Poynton, Racketeer, Shell, Syddal Park, Tatton. Social and Competitive badminton in and around Stockport.",
      result: recentResults,
      row: upcomingFixtures,
      scorecards,
      assets: response.data.resources,
      canonical: ("https://" + req.get("host") + req.originalUrl).replace("www.'", "").replace(".com", ".co.uk").replace("-badders.herokuapp", "-badminton")
    });
  } catch (err) {
    next(err);
  }
};

exports.fixture_batch_create = async function(req, res, next) {
  try {
    const result = await Fixture.createBatch(req.body);
    res.send(result);
  } catch (err) {
    next(err);
  }
}

exports.fixture_update_by_team_name = async function(req, res, next) {
  try {
    const result = await Fixture.updateByTeamNames(req.body);
    res.send(result);
  } catch (err) {
    next(err);
  }
}


exports.fixture_rearrange_by_team_name = async function(req, res, next) {
  try {
    const result = await Fixture.rearrangeByTeamNames(req.body);
    res.send(result);
  } catch (err) {
    next(err);
  }
}

// Display Fixture delete form on GET
exports.fixture_delete_get = function(req, res,next) {
    res.send('NOT IMPLEMENTED: Fixture delete GET');
};

// Handle Fixture delete on POST
exports.fixture_delete_post = async function(req, res, next) {
  try {
    const row = await Fixture.deleteById(req.params.id);
    res.send(row);
  } catch (err) {
    next(err);
  }
};

// Display Fixture update form on GET
exports.fixture_update_get = function(req, res, next) {
    res.send('NOT IMPLEMENTED: Fixture update GET');
};


exports.full_fixture_post = async function(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    try {
      const rows = await Division.getAllByLeague(1);
      res.render('index-scorecard', {
        static_path: '/static',
        theme: process.env.THEME || 'flatly',
        pageTitle: "Scorecard Received - Errors",
        pageDescription: "Something went wrong",
        result: rows,
        errors: errors.array(),
        canonical: ("https://" + req.get("host") + req.originalUrl).replace("www.'", "").replace(".com", ".co.uk").replace("-badders.herokuapp", "-badminton")
      });
    } catch (err) { next(err); }
    return;
  }

  try {
    const FixtureIdResult = await Fixture.getOutstandingFixtureId({ homeTeam: req.body.homeTeam, awayTeam: req.body.awayTeam });

    const fixtureObject = {
      homeMan1: req.body.homeMan1,
      homeMan2: req.body.homeMan2,
      homeMan3: req.body.homeMan3,
      homeLady1: req.body.homeLady1,
      homeLady2: req.body.homeLady2,
      homeLady3: req.body.homeLady3,
      awayMan1: req.body.awayMan1,
      awayMan2: req.body.awayMan2,
      awayMan3: req.body.awayMan3,
      awayLady1: req.body.awayLady1,
      awayLady2: req.body.awayLady2,
      awayLady3: req.body.awayLady3,
      status: "complete",
      homeScore: req.body.homeScore,
      awayScore: req.body.awayScore
    };

    let prevScores = {};
    prevScores[req.body.homeMan1] = {};
    prevScores[req.body.homeMan2] = {};
    prevScores[req.body.homeMan3] = {};
    prevScores[req.body.homeLady1] = {};
    prevScores[req.body.homeLady2] = {};
    prevScores[req.body.homeLady3] = {};
    prevScores[req.body.awayMan1] = {};
    prevScores[req.body.awayMan2] = {};
    prevScores[req.body.awayMan3] = {};
    prevScores[req.body.awayLady1] = {};
    prevScores[req.body.awayLady2] = {};
    prevScores[req.body.awayLady3] = {};
    prevScores = await Player.getPrevRating(req.body.date, prevScores);

    await Fixture.updateById(fixtureObject, FixtureIdResult[0].id);

    const gameObject = {
      tablename: "game",
      fields: [
        "homePlayer1", "homePlayer2", "awayPlayer1", "awayPlayer2", "homeScore", "awayScore", "fixture", "gameType", "homePlayer1Start", "homePlayer2Start", "awayPlayer1Start", "awayPlayer2Start", "homePlayer1End", "homePlayer2End", "awayPlayer1End", "awayPlayer2End"
      ],
      data: [
        { homePlayer1: req.body.FirstMenshomeMan1, homePlayer2: req.body.FirstMenshomeMan2, awayPlayer1: req.body.FirstMensawayMan1, awayPlayer2: req.body.FirstMensawayMan2, homeScore: req.body.Game1homeScore, awayScore: req.body.Game1awayScore, fixture: FixtureIdResult[0].id, gameType: 'FirstMens' },
        { homePlayer1: req.body.FirstMenshomeMan1, homePlayer2: req.body.FirstMenshomeMan2, awayPlayer1: req.body.FirstMensawayMan1, awayPlayer2: req.body.FirstMensawayMan2, homeScore: req.body.Game2homeScore, awayScore: req.body.Game2awayScore, fixture: FixtureIdResult[0].id, gameType: 'FirstMens' },
        { homePlayer1: req.body.FirstLadieshomeLady1, homePlayer2: req.body.FirstLadieshomeLady2, awayPlayer1: req.body.FirstLadiesawayLady1, awayPlayer2: req.body.FirstLadiesawayLady2, homeScore: req.body.Game3homeScore, awayScore: req.body.Game3awayScore, fixture: FixtureIdResult[0].id, gameType: 'FirstLadies' },
        { homePlayer1: req.body.FirstLadieshomeLady1, homePlayer2: req.body.FirstLadieshomeLady2, awayPlayer1: req.body.FirstLadiesawayLady1, awayPlayer2: req.body.FirstLadiesawayLady2, homeScore: req.body.Game4homeScore, awayScore: req.body.Game4awayScore, fixture: FixtureIdResult[0].id, gameType: 'FirstLadies' },
        { homePlayer1: req.body.SecondMenshomeMan1, homePlayer2: req.body.SecondMenshomeMan3, awayPlayer1: req.body.SecondMensawayMan1, awayPlayer2: req.body.SecondMensawayMan3, homeScore: req.body.Game5homeScore, awayScore: req.body.Game5awayScore, fixture: FixtureIdResult[0].id, gameType: 'SecondMens' },
        { homePlayer1: req.body.SecondMenshomeMan1, homePlayer2: req.body.SecondMenshomeMan3, awayPlayer1: req.body.SecondMensawayMan1, awayPlayer2: req.body.SecondMensawayMan3, homeScore: req.body.Game6homeScore, awayScore: req.body.Game6awayScore, fixture: FixtureIdResult[0].id, gameType: 'SecondMens' },
        { homePlayer1: req.body.SecondLadieshomeLady1, homePlayer2: req.body.SecondLadieshomeLady3, awayPlayer1: req.body.SecondLadiesawayLady1, awayPlayer2: req.body.SecondLadiesawayLady3, homeScore: req.body.Game7homeScore, awayScore: req.body.Game7awayScore, fixture: FixtureIdResult[0].id, gameType: 'SecondLadies' },
        { homePlayer1: req.body.SecondLadieshomeLady1, homePlayer2: req.body.SecondLadieshomeLady3, awayPlayer1: req.body.SecondLadiesawayLady1, awayPlayer2: req.body.SecondLadiesawayLady3, homeScore: req.body.Game8homeScore, awayScore: req.body.Game8awayScore, fixture: FixtureIdResult[0].id, gameType: 'SecondLadies' },
        { homePlayer1: req.body.ThirdMenshomeMan2, homePlayer2: req.body.ThirdMenshomeMan3, awayPlayer1: req.body.ThirdMensawayMan2, awayPlayer2: req.body.ThirdMensawayMan3, homeScore: req.body.Game9homeScore, awayScore: req.body.Game9awayScore, fixture: FixtureIdResult[0].id, gameType: 'ThirdMens' },
        { homePlayer1: req.body.ThirdMenshomeMan2, homePlayer2: req.body.ThirdMenshomeMan3, awayPlayer1: req.body.ThirdMensawayMan2, awayPlayer2: req.body.ThirdMensawayMan3, homeScore: req.body.Game10homeScore, awayScore: req.body.Game10awayScore, fixture: FixtureIdResult[0].id, gameType: 'ThirdMens' },
        { homePlayer1: req.body.ThirdLadieshomeLady2, homePlayer2: req.body.ThirdLadieshomeLady3, awayPlayer1: req.body.ThirdLadiesawayLady2, awayPlayer2: req.body.ThirdLadiesawayLady3, homeScore: req.body.Game11homeScore, awayScore: req.body.Game11awayScore, fixture: FixtureIdResult[0].id, gameType: 'ThirdLadies' },
        { homePlayer1: req.body.ThirdLadieshomeLady2, homePlayer2: req.body.ThirdLadieshomeLady3, awayPlayer1: req.body.ThirdLadiesawayLady2, awayPlayer2: req.body.ThirdLadiesawayLady3, homeScore: req.body.Game12homeScore, awayScore: req.body.Game12awayScore, fixture: FixtureIdResult[0].id, gameType: 'ThirdLadies' },
        { homePlayer1: req.body.FirstMixedhomeMan1, homePlayer2: req.body.FirstMixedhomeLady1, awayPlayer1: req.body.FirstMixedawayMan1, awayPlayer2: req.body.FirstMixedawayLady1, homeScore: req.body.Game13homeScore, awayScore: req.body.Game13awayScore, fixture: FixtureIdResult[0].id, gameType: 'FirstMixed' },
        { homePlayer1: req.body.FirstMixedhomeMan1, homePlayer2: req.body.FirstMixedhomeLady1, awayPlayer1: req.body.FirstMixedawayMan1, awayPlayer2: req.body.FirstMixedawayLady1, homeScore: req.body.Game14homeScore, awayScore: req.body.Game14awayScore, fixture: FixtureIdResult[0].id, gameType: 'FirstMixed' },
        { homePlayer1: req.body.SecondMixedhomeMan2, homePlayer2: req.body.SecondMixedhomeLady2, awayPlayer1: req.body.SecondMixedawayMan2, awayPlayer2: req.body.SecondMixedawayLady2, homeScore: req.body.Game15homeScore, awayScore: req.body.Game15awayScore, fixture: FixtureIdResult[0].id, gameType: 'SecondMixed' },
        { homePlayer1: req.body.SecondMixedhomeMan2, homePlayer2: req.body.SecondMixedhomeLady2, awayPlayer1: req.body.SecondMixedawayMan2, awayPlayer2: req.body.SecondMixedawayLady2, homeScore: req.body.Game16homeScore, awayScore: req.body.Game16awayScore, fixture: FixtureIdResult[0].id, gameType: 'SecondMixed' },
        { homePlayer1: req.body.ThirdMixedhomeMan3, homePlayer2: req.body.ThirdMixedhomeLady3, awayPlayer1: req.body.ThirdMixedawayMan3, awayPlayer2: req.body.ThirdMixedawayLady3, homeScore: req.body.Game17homeScore, awayScore: req.body.Game17awayScore, fixture: FixtureIdResult[0].id, gameType: 'ThirdMixed' },
        { homePlayer1: req.body.ThirdMixedhomeMan3, homePlayer2: req.body.ThirdMixedhomeLady3, awayPlayer1: req.body.ThirdMixedawayMan3, awayPlayer2: req.body.ThirdMixedawayLady3, homeScore: req.body.Game18homeScore, awayScore: req.body.Game18awayScore, fixture: FixtureIdResult[0].id, gameType: 'ThirdMixed' }
      ]
    };

    for (const game of gameObject.data) {
      if (game.homePlayer1 != 0 || game.homePlayer2 != 0 || game.awayPlayer1 != 0 || game.awayPlayer2 != 0) {
        game.homePlayer1Start = prevScores[game.homePlayer1].rating;
        game.homePlayer2Start = prevScores[game.homePlayer2].rating;
        game.awayPlayer1Start = prevScores[game.awayPlayer1].rating;
        game.awayPlayer2Start = prevScores[game.awayPlayer2].rating;
      }
      const rateResult = Game.calculateRating(game, prevScores, req.body.date, FixtureIdResult[0].rank);
      if (rateResult) {
        if (game.homePlayer1 != 0 || game.homePlayer2 != 0 || game.awayPlayer1 != 0 || game.awayPlayer2 != 0) {
          prevScores[game.homePlayer1].rating = rateResult.updateObj.homePlayer1End;
          prevScores[game.homePlayer1].date = req.body.date;
          prevScores[game.homePlayer2].rating = rateResult.updateObj.homePlayer2End;
          prevScores[game.homePlayer2].date = req.body.date;
          prevScores[game.awayPlayer1].rating = rateResult.updateObj.awayPlayer1End;
          prevScores[game.awayPlayer1].date = req.body.date;
          prevScores[game.awayPlayer2].rating = rateResult.updateObj.awayPlayer2End;
          prevScores[game.awayPlayer2].date = req.body.date;
        }
        game.homePlayer1End = rateResult.updateObj.homePlayer1End;
        game.homePlayer2End = rateResult.updateObj.homePlayer2End;
        game.awayPlayer1End = rateResult.updateObj.awayPlayer1End;
        game.awayPlayer2End = rateResult.updateObj.awayPlayer2End;
        game.homePlayer1Start = rateResult.updateObj.homePlayer1Start;
        game.homePlayer2Start = rateResult.updateObj.homePlayer2Start;
        game.awayPlayer1Start = rateResult.updateObj.awayPlayer1Start;
        game.awayPlayer2Start = rateResult.updateObj.awayPlayer2Start;
      }
    }

    await Game.createBatch(gameObject);

    const getFixtureDetailsResult = await Fixture.getFixtureDetailsById(FixtureIdResult[0].id);
    const zapObject = {
      host: req.headers.host,
      homeTeam: getFixtureDetailsResult[0].homeTeam,
      awayTeam: getFixtureDetailsResult[0].awayTeam,
      homeScore: getFixtureDetailsResult[0].homeScore,
      awayScore: getFixtureDetailsResult[0].awayScore,
      division: FixtureIdResult[0].name
    };

    await Fixture.sendResultZap(zapObject);

    const [homeTeamNomPlayers, awayTeamNomPlayers, homeTeamFixturePlayers, awayTeamFixturePlayers, matchStats] = await Promise.all([
      Player.getNominatedPlayers(getFixtureDetailsResult[0].homeTeam),
      Player.getNominatedPlayers(getFixtureDetailsResult[0].awayTeam),
      Fixture.getMatchPlayerOrderDetails({ team: getFixtureDetailsResult[0].homeTeam, limit: 4 }),
      Fixture.getMatchPlayerOrderDetails({ team: getFixtureDetailsResult[0].awayTeam, limit: 4 }),
      Player.getMatchStats(FixtureIdResult[0].id)
    ]);

    const ejs = require('ejs');
    const emailData = {
      homeTeam: zapObject.homeTeam,
      awayTeam: zapObject.awayTeam,
      generatedImage: zapObject.homeTeam.replace(/([\s]{1,})/g, '-') + zapObject.awayTeam.replace(/([\s]{1,})/g, '-'),
      matchStats: matchStats[1]
    };
    const str = await ejs.renderFile('views/emails/websiteUpdated.ejs', { data: emailData }, { debug: true });

    const toAddresses = (typeof req.body.email !== 'undefined' ? (req.body.email.indexOf('@') > 1 ? [req.body.email] : ['stockport.badders.results@gmail.com']) : ['stockport.badders.results@gmail.com']);
    const params = {
      Destination: {
        ToAddresses: toAddresses,
        BccAddresses: ['bigcoops@outlook.com', 'bigcoops@gmail.com']
      },
      Message: {
        Body: {
          Html: { Charset: 'UTF-8', Data: str }
        },
        Subject: { Charset: 'UTF-8', Data: 'Website Updated: ' + zapObject.homeTeam + ' vs ' + zapObject.awayTeam }
      },
      Source: 'results@stockport-badminton.co.uk',
      ReplyToAddresses: ['stockport.badders.results@gmail.com'],
    };
    const ses = new AWS.SES({ apiVersion: '2010-12-01' });
    await ses.sendEmail(params).promise();

    res.render('index-scorecard', {
      static_path: '/static',
      theme: process.env.THEME || 'flatly',
      pageTitle: "Scorecard Received - No Errors",
      pageDescription: "Enter some results!",
      scorecardData: gameObject,
      homeTeamNomPlayers,
      awayTeamNomPlayers,
      homeTeamFixturePlayers,
      awayTeamFixturePlayers,
      canonical: ("https://" + req.get("host") + req.originalUrl).replace("www.'", "").replace(".com", ".co.uk").replace("-badders.herokuapp", "-badminton")
    });
  } catch (err) {
    res.send(err);
  }
}

exports.fixture_populate_scorecard_errors = async function(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const data = req.body;
    console.log(data);
    try {
      const [divisionRows, homeTeamRows, awayTeamRows, homeMenRows, homeLadiesRows, awayMenRows, awayLadiesRows] = await Promise.all([
        Division.getAllAndSelectedById(1, data.division),
        Team.getAllAndSelectedById(data.homeTeam, data.division),
        Team.getAllAndSelectedById(data.awayTeam, data.division),
        Player.getEligiblePlayersAndSelectedById(data.homeMan1, data.homeMan2, data.homeMan3, data.homeTeam, 'Male'),
        Player.getEligiblePlayersAndSelectedById(data.homeLady1, data.homeLady2, data.homeLady3, data.homeTeam, 'Female'),
        Player.getEligiblePlayersAndSelectedById(data.awayMan1, data.awayMan2, data.awayMan3, data.awayTeam, 'Male'),
        Player.getEligiblePlayersAndSelectedById(data.awayLady1, data.awayLady2, data.awayLady3, data.awayTeam, 'Female'),
      ]);
      const renderData = { divisionRows, homeTeamRows, awayTeamRows, homeMenRows, homeLadiesRows, awayMenRows, awayLadiesRows };
      console.log(renderData);
      res.render('email-scorecard', {
        static_path: '/static',
        pageTitle: "Spreadsheet Upload Scorecard",
        pageDescription: "Show result of uploading scorecard",
        scorecard: renderData,
        data,
        errors: errors.array(),
        canonical: ("https://" + req.get("host") + req.originalUrl).replace("www.'", "").replace(".com", ".co.uk").replace("-badders.herokuapp", "-badminton")
      });
    } catch (err) { next(err); }
  } else {
    const scorecardUrl = 'https://' + req.headers.host + '/populated-scorecard/' + req.body.division + '/' + req.body.homeTeam + '/' + req.body.awayTeam + '/' + req.body.homeMan1 + '/' + req.body.homeMan2 + '/' + req.body.homeMan3 + '/' + req.body.homeLady1 + '/' + req.body.homeLady2 + '/' + req.body.homeLady3 + '/' + req.body.awayMan1 + '/' + req.body.awayMan2 + '/' + req.body.awayMan3 + '/' + req.body.awayLady1 + '/' + req.body.awayLady2 + '/' + req.body.awayLady3 + '/' + req.body.Game1homeScore + '/' + req.body.Game1awayScore + '/' + req.body.Game2homeScore + '/' + req.body.Game2awayScore + '/' + req.body.Game3homeScore + '/' + req.body.Game3awayScore + '/' + req.body.Game4homeScore + '/' + req.body.Game4awayScore + '/' + req.body.Game5homeScore + '/' + req.body.Game5awayScore + '/' + req.body.Game6homeScore + '/' + req.body.Game6awayScore + '/' + req.body.Game7homeScore + '/' + req.body.Game7awayScore + '/' + req.body.Game8homeScore + '/' + req.body.Game8awayScore + '/' + req.body.Game9homeScore + '/' + req.body.Game9awayScore + '/' + req.body.Game10homeScore + '/' + req.body.Game10awayScore + '/' + req.body.Game11homeScore + '/' + req.body.Game11awayScore + '/' + req.body.Game12homeScore + '/' + req.body.Game12awayScore + '/' + req.body.Game13homeScore + '/' + req.body.Game13awayScore + '/' + req.body.Game14homeScore + '/' + req.body.Game14awayScore + '/' + req.body.Game15homeScore + '/' + req.body.Game15awayScore + '/' + req.body.Game16homeScore + '/' + req.body.Game16awayScore + '/' + req.body.Game17homeScore + '/' + req.body.Game17awayScore + '/' + req.body.Game18homeScore + '/' + req.body.Game18awayScore;
    const scorecardObj = {
      date: req.body.date, division: req.body.division, homeTeam: req.body.homeTeam, awayTeam: req.body.awayTeam,
      homeMan1: req.body.homeMan1, homeMan2: req.body.homeMan2, homeMan3: req.body.homeMan3,
      homeLady1: req.body.homeLady1, homeLady2: req.body.homeLady2, homeLady3: req.body.homeLady3,
      awayMan1: req.body.awayMan1, awayMan2: req.body.awayMan2, awayMan3: req.body.awayMan3,
      awayLady1: req.body.awayLady1, awayLady2: req.body.awayLady2, awayLady3: req.body.awayLady3,
      FirstMixedhomeMan1: req.body.FirstMixedhomeMan1, SecondMixedhomeMan2: req.body.SecondMixedhomeMan2, ThirdMixedhomeMan3: req.body.ThirdMixedhomeMan3,
      FirstMixedhomeLady1: req.body.FirstMixedhomeLady1, SecondMixedhomeLady2: req.body.SecondMixedhomeLady2, ThirdMixedhomeLady3: req.body.ThirdMixedhomeLady3,
      FirstMixedawayMan1: req.body.FirstMixedawayMan1, SecondMixedawayMan2: req.body.SecondMixedawayMan2, ThirdMixedawayMan3: req.body.ThirdMixedawayMan3,
      FirstMixedawayLady1: req.body.FirstMixedawayLady1, SecondMixedawayLady2: req.body.SecondMixedawayLady2, ThirdMixedawayLady3: req.body.ThirdMixedawayLady3,
      Game1homeScore: req.body.Game1homeScore, Game1awayScore: req.body.Game1awayScore,
      Game2homeScore: req.body.Game2homeScore, Game2awayScore: req.body.Game2awayScore,
      Game3homeScore: req.body.Game3homeScore, Game3awayScore: req.body.Game3awayScore,
      Game4homeScore: req.body.Game4homeScore, Game4awayScore: req.body.Game4awayScore,
      Game5homeScore: req.body.Game5homeScore, Game5awayScore: req.body.Game5awayScore,
      Game6homeScore: req.body.Game6homeScore, Game6awayScore: req.body.Game6awayScore,
      Game7homeScore: req.body.Game7homeScore, Game7awayScore: req.body.Game7awayScore,
      Game8homeScore: req.body.Game8homeScore, Game8awayScore: req.body.Game8awayScore,
      Game9homeScore: req.body.Game9homeScore, Game9awayScore: req.body.Game9awayScore,
      Game10homeScore: req.body.Game10homeScore, Game10awayScore: req.body.Game10awayScore,
      Game11homeScore: req.body.Game11homeScore, Game11awayScore: req.body.Game11awayScore,
      Game12homeScore: req.body.Game12homeScore, Game12awayScore: req.body.Game12awayScore,
      Game13homeScore: req.body.Game13homeScore, Game13awayScore: req.body.Game13awayScore,
      Game14homeScore: req.body.Game14homeScore, Game14awayScore: req.body.Game14awayScore,
      Game15homeScore: req.body.Game15homeScore, Game15awayScore: req.body.Game15awayScore,
      Game16homeScore: req.body.Game16homeScore, Game16awayScore: req.body.Game16awayScore,
      Game17homeScore: req.body.Game17homeScore, Game17awayScore: req.body.Game17awayScore,
      Game18homeScore: req.body.Game18homeScore, Game18awayScore: req.body.Game18awayScore,
      'scoresheet-url': req.body['scoresheet-url'],
      email: req.body['email']
    };
    try {
      const rows = await Fixture.createScorecard(scorecardObj);
      const scorecardUrlBeta = 'https://' + req.headers.host + '/populated-scorecard-beta/' + rows.insertId;
      const params = {
        Destination: {
          ToAddresses: ['stockport.badders.results@gmail.com'],
          BccAddresses: ['bigcoops@outlook.com', 'bigcoops@gmail.com']
        },
        Message: {
          Body: {
            Html: {
              Charset: 'UTF-8',
              Data: '<p>a new scorecard has been uploaded: <a href="' + req.body["scoresheet-url"] + '">' + req.body["scoresheet-url"] + '</a><br />Check the result here: <a href="' + scorecardUrl + '">Confirm</a> or <a href="' + scorecardUrlBeta + '">' + scorecardUrlBeta + '</a></p>'
            }
          },
          Subject: { Charset: 'UTF-8', Data: 'Scorecard Received' }
        },
        Source: 'results@stockport-badminton.co.uk',
        ReplyToAddresses: ['stockport.badders.results@gmail.com'],
      };
      const ses = new AWS.SES({ apiVersion: '2010-12-01' });
      await ses.sendEmail(params).promise();
      res.render('email-scorecard', {
        static_path: '/static',
        theme: process.env.THEME || 'flatly',
        flask_debug: process.env.FLASK_DEBUG || 'false',
        pageTitle: "Stockport & District Badminton League Scorecard Upload",
        pageDescription: "Upload your scorecard and send to the website",
        scorecard: req.body,
        canonical: ("https://" + req.get("host") + req.originalUrl).replace("www.", "").replace(".com", ".co.uk").replace("-badders.herokuapp", "-badminton")
      });
    } catch (err) { next(err); }
  }
}

exports.fixture_populate_scorecard = async function(data, req, res, next) {
  try {
    const [divisionRows, divisionIdRows] = await Promise.all([
      Division.getAllAndSelectedByName(1, data.division),
      Division.getByName(data.division)
    ]);
    const [homeTeamRows, awayTeamRows] = await Promise.all([
      Team.getAllAndSelectedByName(data.home_team, divisionIdRows[0].id),
      Team.getAllAndSelectedByName(data.away_team, divisionIdRows[0].id)
    ]);
    const [homeMenRows, homeLadiesRows, awayMenRows, awayLadiesRows] = await Promise.all([
      Player.findElgiblePlayersFromTeamNameAndSelectedSansLevenshtein(data.home_team, 'Male', data.home_man_1, data.home_man_2, data.home_man_3),
      Player.findElgiblePlayersFromTeamNameAndSelectedSansLevenshtein(data.home_team, 'Female', data.home_lady_1, data.home_lady_2, data.home_lady_3),
      Player.findElgiblePlayersFromTeamNameAndSelectedSansLevenshtein(data.away_team, 'Male', data.away_man_1, data.away_man_2, data.away_man_3),
      Player.findElgiblePlayersFromTeamNameAndSelectedSansLevenshtein(data.away_team, 'Female', data.away_lady_1, data.away_lady_2, data.away_lady_3),
    ]);
    const renderData = { divisionRows, divisionIdRows, homeTeamRows, awayTeamRows, homeMenRows, homeLadiesRows, awayMenRows, awayLadiesRows };
    console.log(renderData);
    res.render('populated-scorecard', {
      static_path: '/static',
      pageTitle: "Spreadsheet Upload Scorecard",
      pageDescription: "Show result of uploading scorecard",
      result: renderData,
      data,
      canonical: ("https://" + req.get("host") + req.originalUrl).replace("www.'", "").replace(".com", ".co.uk").replace("-badders.herokuapp", "-badminton")
    });
  } catch (err) { next(err); }
}

exports.fixture_populate_scorecard_fromId = async function(req, res, next) {
  try {
    const rows = await Fixture.getScorecardById(req.params.id);
    const [divisionRows, homeTeamRows, awayTeamRows, homeMenRows, homeLadiesRows, awayMenRows, awayLadiesRows] = await Promise.all([
      Division.getAllAndSelectedById(1, rows[0].division),
      Team.getAllAndSelectedById(rows[0].homeTeam, rows[0].division),
      Team.getAllAndSelectedById(rows[0].awayTeam, rows[0].division),
      Player.getEligiblePlayersAndSelectedById(rows[0].homeMan1, rows[0].homeMan2, rows[0].homeMan3, rows[0].homeTeam, 'Male'),
      Player.getEligiblePlayersAndSelectedById(rows[0].homeLady1, rows[0].homeLady2, rows[0].homeLady3, rows[0].homeTeam, 'Female'),
      Player.getEligiblePlayersAndSelectedById(rows[0].awayMan1, rows[0].awayMan2, rows[0].awayMan3, rows[0].awayTeam, 'Male'),
      Player.getEligiblePlayersAndSelectedById(rows[0].awayLady1, rows[0].awayLady2, rows[0].awayLady3, rows[0].awayTeam, 'Female'),
    ]);
    const renderData = { divisionRows, homeTeamRows, awayTeamRows, homeMenRows, homeLadiesRows, awayMenRows, awayLadiesRows };
    console.log(renderData);
    res.render('populated-scorecard', {
      static_path: '/static',
      pageTitle: "Spreadsheet Upload Scorecard",
      pageDescription: "Show result of uploading scorecard",
      result: renderData,
      data: rows[0],
      canonical: ("https://" + req.get("host") + req.originalUrl).replace("www.'", "").replace(".com", ".co.uk").replace("-badders.herokuapp", "-badminton")
    });
  } catch (err) { next(err); }
}

  exports.fixture_populate_scorecard_fromUrl = async function(req, res, next) {
    const data = req.params;
    try {
      const [divisionRows, homeTeamRows, awayTeamRows, homeMenRows, homeLadiesRows, awayMenRows, awayLadiesRows] = await Promise.all([
        Division.getAllAndSelectedById(1, data.division),
        Team.getAllAndSelectedById(data.home_team, data.division),
        Team.getAllAndSelectedById(data.away_team, data.division),
        Player.getEligiblePlayersAndSelectedById(data.home_man_1, data.home_man_2, data.home_man_3, data.home_team, 'Male'),
        Player.getEligiblePlayersAndSelectedById(data.home_lady_1, data.home_lady_2, data.home_lady_3, data.home_team, 'Female'),
        Player.getEligiblePlayersAndSelectedById(data.away_man_1, data.away_man_2, data.away_man_3, data.away_team, 'Male'),
        Player.getEligiblePlayersAndSelectedById(data.away_lady_1, data.away_lady_2, data.away_lady_3, data.away_team, 'Female'),
      ]);
      const renderData = { divisionRows, homeTeamRows, awayTeamRows, homeMenRows, homeLadiesRows, awayMenRows, awayLadiesRows };
      console.log(renderData);
      res.render('populated-scorecard', {
        static_path: '/static',
        pageTitle: "Spreadsheet Upload Scorecard",
        pageDescription: "Show result of uploading scorecard",
        result: renderData,
        data,
        canonical: ("https://" + req.get("host") + req.originalUrl).replace("www.'", "").replace(".com", ".co.uk").replace("-badders.herokuapp", "-badminton")
      });
    } catch (err) { next(err); }
  }

  exports.scorecard_nonmodal = async function(req, res, next) {
    try {
      const rows = await Division.getAllByLeague(1);
      res.render('index-scorecard-nonmodal', {
        static_path: '/static',
        theme: process.env.THEME || 'flatly',
        pageTitle: "Scorecard",
        pageDescription: "Enter some results!",
        result: rows,
        canonical: ("https://" + req.get("host") + req.originalUrl).replace("www.'", "").replace(".com", ".co.uk").replace("-badders.herokuapp", "-badminton")
      });
    } catch (err) { next(err); }
  }

  exports.scorecard_beta = async function(req, res, next) {
    try {
      const rows = await Division.getAllByLeague(1);
      res.render('index-scorecard', {
        static_path: '/static',
        theme: process.env.THEME || 'flatly',
        pageTitle: "Scorecard",
        pageDescription: "Enter some results!",
        result: rows,
        canonical: ("https://" + req.get("host") + req.originalUrl).replace("www.'", "").replace(".com", ".co.uk").replace("-badders.herokuapp", "-badminton")
      });
    } catch (err) { next(err); }
  }

  exports.email_scorecard = async function(req, res, next) {
    try {
      const [rows, apiKey] = await Promise.all([
        Division.getAllByLeague(1),
        Auth.getManagementAPIKey()
      ]);
      const response = await axios.get('https://' + process.env.AUTH0_DOMAIN + '/api/v2/users?q=user_id:' + req.user.id + '&fields=app_metadata,nickname,email', {
        headers: { 'Authorization': 'Bearer ' + apiKey }
      });
      const user = response.data;
      const fixtures = await Fixture.getMissingScorecardPhotos(user[0].email);
      res.render('email-scorecard', {
        static_path: '/static',
        theme: process.env.THEME || 'flatly',
        pageTitle: "Scorecard",
        pageDescription: "Enter some results!",
        result: rows,
        fixtures,
        canonical: ("https://" + req.get("host") + req.originalUrl).replace("www.'", "").replace(".com", ".co.uk").replace("-badders.herokuapp", "-badminton")
      });
    } catch (err) { next(err); }
  }

exports.messer_scorecard = async function(req, res, next) {
  try {
    const [rows, apiKey] = await Promise.all([
      Division.getAllByLeague(1),
      Auth.getManagementAPIKey()
    ]);
    await axios.get('https://' + process.env.AUTH0_DOMAIN + '/api/v2/users?q=user_id:' + req.user.id + '&fields=app_metadata,nickname,email', {
      headers: { 'Authorization': 'Bearer ' + apiKey }
    });
    res.render('messer-scorecard', {
      static_path: '/static',
      theme: process.env.THEME || 'flatly',
      pageTitle: "Scorecard",
      pageDescription: "Enter some results!",
      result: rows,
      canonical: ("https://" + req.get("host") + req.originalUrl).replace("www.", "").replace(".com", ".co.uk").replace("-badders.herokuapp", "-badminton")
    });
  } catch (err) { next(err); }
}

  exports.scorecard_upload = function(req, res) {
    res.render('beta/scorecard-upload', {
        static_path: '/static',
        theme: process.env.THEME || 'flatly',
        flask_debug: process.env.FLASK_DEBUG || 'false',
        pageTitle : "Stockport & District Badminton League Scorecard Upload",
        pageDescription : "Upload your scorecard and send to the website",
        canonical:("https://" + req.get("host") + req.originalUrl).replace("www.'","").replace(".com",".co.uk").replace("-badders.herokuapp","-badminton")
    });
  };

  exports.upload_scoresheet = function(req,res){
    res.render('beta/file-upload',{
      static_path:'/static',
      theme:process.env.THEME || 'flatly',
      pageTitle : "Upload Scorecard",
      pageDescription : "Enter some results!",
      canonical:("https://" + req.get("host") + req.originalUrl).replace("www.'","").replace(".com",".co.uk").replace("-badders.herokuapp","-badminton")
    })
  }

  exports.fixture_reminder_post = async function(req, res, next) {
    const localToAdds = (req.body.email.indexOf(',') > 0 ? req.body.email.split(',') : [req.body.email]);
    const params = {
      Destination: {
        ToAddresses: localToAdds,
        BccAddresses: ['stockport.badders.results@gmail.com', 'bigcoops@outlook.com']
      },
      Message: {
        Body: {
          Html: { Charset: 'UTF-8', Data: contact_controller.generateScorecardReminderHTML() }
        },
        Subject: { Charset: 'UTF-8', Data: `Reminder: ${req.body.homeTeam} vs ${req.body.awayTeam}` }
      },
      Source: 'results@stockport-badminton.co.uk',
      ReplyToAddresses: ['stockport.badders.results@gmail.com'],
    };
    try {
      const ses = new AWS.SES({ apiVersion: '2010-12-01' });
      await ses.sendEmail(params).promise();
      res.send("Message Sent");
    } catch (err) {
      console.log(err.toString());
      next(err);
    }
  }

  exports.scorecard_received = function(req,res,next){
    res.render('index-scorecard',{
      static_path:'/static',
      theme:process.env.THEME || 'flatly',
      pageTitle : "Scorecard Received - No Errors",
      pageDescription : "Enter some results!",
      scorecardData: req.body,
      canonical:("https://" + req.get("host") + req.originalUrl).replace("www.'","").replace(".com",".co.uk").replace("-badders.herokuapp","-badminton")
    })
  }

// Handle Fixture update on POST
exports.fixture_update_post = async function(req, res, next) {
  try {
    const row = await Fixture.updateById(req.body, req.params.id);
    res.send(row);
  } catch (err) {
    res.send(err);
  }
};

exports.add_scorecard_photo = async function(req, res, next) {
  try {
    await Fixture.updateScorecardPhoto(req.params.id, req.body.imgURL);
    const params = {
      Destination: {
        ToAddresses: ['stockport.badders.results@gmail.com'],
        BccAddresses: ['bigcoops@outlook.com', 'bigcoops@gmail.com']
      },
      Message: {
        Body: {
          Html: {
            Charset: 'UTF-8',
            Data: `<p>a scorecard has been updated with a photo: <a href="${req.body.imgURL}">${req.body.imgURL}</a><br />Check the result here: <a href="https://stockport-badminton.co.uk/populated-scorecard-beta/${req.params.id}">Confirm</a> or <a href="https://stockport-badminton.co.uk/populated-scorecard-beta/${req.params.id}">https://stockport-badminton.co.uk/populated-scorecard-beta/${req.params.id}</a></p>`
          }
        },
        Subject: { Charset: 'UTF-8', Data: 'Scorecard Updated' }
      },
      Source: 'results@stockport-badminton.co.uk',
      ReplyToAddresses: ['stockport.badders.results@gmail.com'],
    };
    const ses = new AWS.SES({ apiVersion: '2010-12-01' });
    await ses.sendEmail(params).promise();
    res.sendStatus(200);
  } catch (err) {
    console.log(err.toString());
    next("Sorry something went wrong sending your scoresheet to the admin - drop him an email.");
  }
}