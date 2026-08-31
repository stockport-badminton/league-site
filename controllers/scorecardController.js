var Division = require('../models/division');
var Team = require('../models/teams');
var Player = require('../models/players');
var Fixture = require('../models/fixture');
var Game = require('../models/game');
var db = require('../db_connect.js');
const axios = require('axios');
const Sentry = require('@sentry/node');
const ses = require('../utils/ses');
var Auth = require('../models/auth.js');
var contact_controller = require(__dirname + '/contactusController');
const { body, validationResult } = require("express-validator");
const { canonicalFor, absoluteUrl } = require('../utils/canonical');
const { escapeHtml } = require('../utils/html');
const {
  newDraftToken, mayOpenDraft, confirmationPath, confirmationUrl,
  normalisePhotoUrl, isPhotoUrl
} = require('../utils/scorecardLinks');

// A league fixture is 18 games — three pairs each of men's, ladies' and mixed, played
// twice. Messer is 15 and goes through its own controller.
const GAMES_PER_FIXTURE = 18;

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


exports.full_fixture_post = async function(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const data = req.body;
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
      const scorecard = { divisionRows, homeTeamRows, awayTeamRows, homeMenRows, homeLadiesRows, awayMenRows, awayLadiesRows };
      res.render('index-scorecard', {
        static_path: '/static',
        theme: process.env.THEME || 'flatly',
        pageTitle: "Scorecard Received - Errors",
        pageDescription: "Something went wrong",
        scorecard,
        data,
        errors: errors.array(),
        canonical: canonicalFor(req)
      });
    } catch (err) { next(err); }
    return;
  }

  try {
    // Which fixture is this? Resolved from every row for the pairing rather than from
    // the first outstanding one the planner happened to return — see
    // Fixture.getFixturesForTeams for what that used to cost.
    const candidateRows = await Fixture.getFixturesForTeams({
      homeTeam: req.body.homeTeam,
      awayTeam: req.body.awayTeam
    });
    const resolved = Fixture.resolveFixtureForResult(candidateRows, req.body.date);
    if (resolved.conflict) {
      return renderSubmissionConflict(req, res, resolved.conflict);
    }
    const FixtureIdResult = [resolved.fixture];

    // A league fixture is 18 games, so the scores must total 18. Nothing checked this
    // before, and 8 fixtures in the table record something else — a 3–3 among them.
    // An impossible result silently distorts the league table and the points.
    const total = Number(req.body.homeScore) + Number(req.body.awayScore);
    if (!Number.isFinite(total) || total !== GAMES_PER_FIXTURE) {
      return renderSubmissionConflict(req, res, {
        reason: 'bad-total',
        homeScore: req.body.homeScore,
        awayScore: req.body.awayScore,
        total: Number.isFinite(total) ? total : null
      });
    }

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

    // The result and its games land together or not at all.
    //
    // These were two independent writes, and the fixture went first. Anything that
    // threw afterwards — a bad game row, an ELO error, a momentary SES outage — left
    // the league table showing a result with no games behind it, so player stats, pair
    // stats and ELO silently omitted the match and the scorecard view for it was blank.
    // Three fixtures from last season are still in that state (#6117, #6576, #6037);
    // nobody noticed for a whole season, because a half-applied result renders
    // perfectly. `node tools/dbq.js --check orphan-results`
    await db.withTransaction(async conn => {
      await Fixture.updateById(fixtureObject, FixtureIdResult[0].id, conn);
      await Game.createBatch(gameObject, conn);
    });

    // Past this point the result is safely recorded. Everything below is notification
    // and presentation, and none of it may cost the captain their submission — so each
    // step is allowed to fail on its own without taking the request down with it.
    const getFixtureDetailsResult = await Fixture.getFixtureDetailsById(FixtureIdResult[0].id);
    const zapObject = {
      host: req.headers.host,
      homeTeam: getFixtureDetailsResult[0].homeTeam,
      awayTeam: getFixtureDetailsResult[0].awayTeam,
      homeScore: getFixtureDetailsResult[0].homeScore,
      awayScore: getFixtureDetailsResult[0].awayScore,
      division: FixtureIdResult[0].name
    };

    await afterCommit('result zap', () => Fixture.sendResultZap(zapObject));

    const [homeTeamNomPlayers, awayTeamNomPlayers, homeTeamFixturePlayers, awayTeamFixturePlayers, matchStats] =
      await afterCommit('confirmation page data', () => Promise.all([
        Player.getNominatedPlayers(getFixtureDetailsResult[0].homeTeam),
        Player.getNominatedPlayers(getFixtureDetailsResult[0].awayTeam),
        Fixture.getMatchPlayerOrderDetails({ team: getFixtureDetailsResult[0].homeTeam, limit: 4 }),
        Fixture.getMatchPlayerOrderDetails({ team: getFixtureDetailsResult[0].awayTeam, limit: 4 }),
        Player.getMatchStats(FixtureIdResult[0].id)
      ])) || [[], [], [], [], []];

    const notified = await afterCommit('results email', async () => {
      const ejs = require('ejs');
      const emailData = {
        homeTeam: zapObject.homeTeam,
        awayTeam: zapObject.awayTeam,
        generatedImage: zapObject.homeTeam.replace(/([\s]{1,})/g, '-') + zapObject.awayTeam.replace(/([\s]{1,})/g, '-'),
        matchStats: matchStats && matchStats[1]
      };
      const str = await ejs.renderFile('views/emails/websiteUpdated.ejs', { data: emailData }, { debug: false });

      const toAddresses = (typeof req.body.email !== 'undefined' ? (req.body.email.indexOf('@') > 1 ? [req.body.email] : ['stockport.badders.results@gmail.com']) : ['stockport.badders.results@gmail.com']);
      await ses.sendEmail({
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
      });
      return true;
    });

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
      // The captain needs to know the difference between "we have your result" and
      // "we have your result and told the results secretary".
      notificationFailed: !notified,
      canonical: canonicalFor(req)
    });
  } catch (err) {
    next(err);
  }
}

// Runs a post-commit step that must not be able to undo a saved result. Returns the
// step's value, or null if it threw — the caller carries on either way.
//
// The result is already in the database by the time any of these run. Letting one of
// them reject would send the captain to the 500 page, which tells them nothing was
// recorded, which is false. That is how a momentary SES outage used to turn into a
// captain re-submitting a result that was already saved — and getting "no matching
// fixtures" for their trouble.
async function afterCommit(label, fn) {
  try {
    return await fn();
  } catch (err) {
    console.error(`scorecard: ${label} failed after the result was saved:`, err.message);
    Sentry.captureException(err, { tags: { stage: 'scorecard-post-commit', step: label } });
    return null;
  }
}

// What a captain sees when their submission cannot be matched to an open fixture.
//
// Every one of these used to be a thrown Error reaching the 500 page, which prints the
// error text verbatim — so a captain re-submitting a result that had saved perfectly
// well read "no matching fixtures" and reasonably concluded it had not.
function renderSubmissionConflict(req, res, conflict) {
  const view = {
    static_path: '/static',
    theme: process.env.THEME || 'flatly',
    pageTitle: 'Scorecard not recorded',
    pageDescription: 'We could not match this scorecard to a fixture',
    conflict,
    data: req.body,
    canonical: canonicalFor(req)
  };
  // 409: the request was well-formed, it just conflicts with what we already hold.
  // Deliberately not a 500 — nothing has gone wrong on our side.
  res.status(conflict.reason === 'not-found' ? 404 : 409);
  return res.render('scorecard-conflict', view);
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
      res.render('index-scorecard', {
        static_path: '/static',
        pageTitle: "Spreadsheet Upload Scorecard",
        pageDescription: "Show result of uploading scorecard",
        scorecard: renderData,
        data,
        errors: errors.array(),
        canonical: canonicalFor(req)
      });
    } catch (err) { next(err); }
  } else {
    // The photo URL the upload widget put in the form. It is emailed as an anchor a few
    // lines below, so the same rule as the photo endpoint applies — but a captain's
    // result must not be lost over a link we don't like, so a URL that isn't one of our
    // own bucket objects is dropped and the draft saved without it. The fixture then
    // shows up in the "add scorecard photos" list, which is the recoverable outcome.
    const submittedPhoto = req.body['scoresheet-url'];
    const photoUrl = isPhotoUrl(submittedPhoto) ? normalisePhotoUrl(submittedPhoto) : '';
    if (submittedPhoto && !photoUrl) {
      console.warn('scorecard: dropped a scoresheet-url that is not an object in our bucket');
      Sentry.captureMessage('scorecard: rejected scoresheet-url on draft submission', {
        level: 'warning', tags: { stage: 'scorecard-draft' }
      });
    }

    // Per-draft secret for the confirmation link. Without it the link is
    // /populated-scorecard-beta/<sequential id>, which can be walked by counting — so
    // any result could be read, and confirmed, by an outsider. See
    // utils/scorecardLinks.js and migrations/011_scorecard_confirm_token.sql.
    const confirmToken = newDraftToken();

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
      'scoresheet-url': photoUrl,
      email: req.body['email'],
      confirmToken
    };
    try {
      const rows = await Fixture.createScorecard(scorecardObj);
      // `rows.insertId` used to be read here. Postgres returns nothing about an
      // inserted row unless the statement says RETURNING, so it was always
      // undefined: every submitted scorecard redirected the captain to
      // /populated-scorecard-beta/undefined and emailed the results secretary the
      // same dead link. createScorecard now RETURNs the id.
      const scorecardId = rows[0] && rows[0].id;
      if (!scorecardId) {
        // The draft may well have been written; what we can't do is tell anyone
        // where it is. Better to fail visibly than to send another broken link.
        throw new Error('scorecard was saved but no id came back, so no confirmation link could be built');
      }
      // Built from the site's own origin, never from req.headers.host: behind Firebase
      // that header is the Cloud Run hostname, so this link used to point at
      // league-site-…-nw.a.run.app. See utils/canonical.js.
      const scorecardUrlBeta = confirmationUrl(scorecardId, confirmToken);
      const photoLine = photoUrl
        ? 'a new scorecard has been uploaded: <a href="' + escapeHtml(photoUrl) + '">' +
          escapeHtml(photoUrl) + '</a>'
        : 'a new scorecard has been entered, with no photo attached.';
      const params = {
        Destination: {
          ToAddresses: ['stockport.badders.results@gmail.com'],
          BccAddresses: ['bigcoops@outlook.com', 'bigcoops@gmail.com']
        },
        Message: {
          Body: {
            Html: {
              Charset: 'UTF-8',
              Data: '<p>' + photoLine + '<br />Check the result here: <a href="' +
                escapeHtml(scorecardUrlBeta) + '">' + escapeHtml(scorecardUrlBeta) + '</a></p>'
            }
          },
          Subject: { Charset: 'UTF-8', Data: 'Scorecard Received' }
        },
        Source: 'results@stockport-badminton.co.uk',
        ReplyToAddresses: ['stockport.badders.results@gmail.com'],
      };
      await ses.sendEmail(params);
      // The captain gets the token too, or the page they are redirected to would refuse
      // the draft they have just this moment filed.
      res.redirect(confirmationPath(scorecardId, confirmToken));
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
      canonical: canonicalFor(req)
    });
  } catch (err) { next(err); }
}

exports.fixture_populate_scorecard_fromId = async function(req, res, next) {
  try {
    const rows = await Fixture.getScorecardById(req.params.id);

    // No such draft. This used to fall through to rows[0].division and throw, which the
    // central handler turned into a 500 — an id that has never existed is a 404.
    if (!rows || !rows.length) {
      return renderLinkRefused(req, res, 404);
    }

    // The token that makes this link unguessable. Before it, the URL was the draft's
    // sequential primary key and nothing else: about 2,400 of them, so every scorecard
    // ever filed could be read — and confirmed — by counting. See
    // utils/scorecardLinks.js for the grandfather clause that keeps links already sitting
    // in captains' inboxes working.
    if (!mayOpenDraft(rows[0].confirmToken, req.query.t)) {
      return renderLinkRefused(req, res, 403);
    }

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
      // Deliberately not canonicalFor(req): that keeps the query string, and the query
      // string is now a secret. A canonical tag is copied, shared and crawled.
      canonical: absoluteUrl('/populated-scorecard-beta/' + encodeURIComponent(String(req.params.id)))
    });
  } catch (err) { next(err); }
}

// What someone sees when a confirmation link doesn't open a draft: either it names an id
// that has never existed (404) or it is missing the token, or has the wrong one (403).
//
// 403 rather than 404 for a bad token, because the person on the other end is far more
// likely to be a captain whose email client mangled a long URL than an attacker, and
// "this link isn't complete" is actionable where "not found" is not. It does tell a
// walker that draft #2100 exists — but not its teams, its players or its score, and it
// cannot be confirmed, which is what the token is protecting.
function renderLinkRefused(req, res, status) {
  res.status(status);
  return res.render('scorecard-link-invalid', {
    static_path: '/static',
    theme: process.env.THEME || 'flatly',
    pageTitle: 'Scorecard link not valid',
    pageDescription: 'This confirmation link cannot be opened',
    notFound: status === 404,
    canonical: absoluteUrl('/populated-scorecard-beta/' + encodeURIComponent(String(req.params.id)))
  });
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
        formAction: '/scorecard-beta',
        canonical: canonicalFor(req)
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
      res.render('index-scorecard', {
        static_path: '/static',
        theme: process.env.THEME || 'flatly',
        pageTitle: "Scorecard",
        pageDescription: "Enter some results!",
        result: rows,
        fixtures,
        canonical: canonicalFor(req)
      });
    } catch (err) { next(err); }
  }

  exports.scorecard_upload = function(req, res) {
    res.render('scorecard-upload', {
        static_path: '/static',
        theme: process.env.THEME || 'flatly',
        flask_debug: process.env.FLASK_DEBUG || 'false',
        pageTitle : "Stockport & District Badminton League Scorecard Upload",
        pageDescription : "Upload your scorecard and send to the website",
        canonical:canonicalFor(req)
    });
  };

  exports.upload_scoresheet = function(req,res){
    res.render('file-upload',{
      static_path:'/static',
      theme:process.env.THEME || 'flatly',
      pageTitle : "Upload Scorecard",
      pageDescription : "Enter some results!",
      canonical:canonicalFor(req)
    })
  }

  // POST /fixture/reminder — nudge the home team about a missing scorecard.
  //
  // Reachable from the public /results page, so every input is hostile. It used to be
  // an open relay: `req.body.email` went straight into SES ToAddresses (comma-split,
  // so one request could reach many recipients) and `req.body.homeTeam`/`awayTeam`
  // went into the Subject. Sending from our own verified domain to arbitrary
  // addresses with attacker-chosen subject text puts the domain's reputation and the
  // SES account at risk, which is a bigger problem than spam arriving here.
  //
  // Now: the teams are looked up, the recipient is derived from the fixture, and
  // nothing from the request reaches the message. When no captain or match secretary
  // email is on file the nudge goes to the league inbox instead — the sender gets the
  // same acknowledgement either way, so the endpoint reveals nothing about who is or
  // is not contactable.
  const LEAGUE_INBOX = 'stockport.badders.results@gmail.com';
  const MAX_REMINDER_RECIPIENTS = 3;

  exports.fixture_reminder_post = async function(req, res, next) {
    try {
      const homeTeam = String(req.body.homeTeam || '').trim();
      const awayTeam = String(req.body.awayTeam || '').trim();
      if (!homeTeam || !awayTeam) {
        return res.status(400).send('Which fixture?');
      }

      let recipients = await Fixture.getReminderRecipients(homeTeam, awayTeam);
      // A team pair that matches no fixture gets nothing sent at all — otherwise the
      // endpoint would still emit a message for made-up teams.
      if (!recipients.length) {
        const [known] = await Promise.all([Fixture.getFixtureId({ homeTeam, awayTeam })]);
        if (!known || !known.length) {
          return res.send('Message Sent');
        }
        recipients = [LEAGUE_INBOX];
      }
      recipients = recipients.slice(0, MAX_REMINDER_RECIPIENTS);

      // Team names come from the database rows we just matched, not from the request,
      // so the subject cannot be authored by the sender.
      await ses.sendEmail({
        Destination: {
          ToAddresses: recipients,
          BccAddresses: [LEAGUE_INBOX, 'bigcoops@outlook.com']
        },
        Message: {
          Body: { Html: { Charset: 'UTF-8', Data: contact_controller.generateScorecardReminderHTML() } },
          Subject: { Charset: 'UTF-8', Data: 'Reminder: outstanding scorecard' }
        },
        Source: 'results@stockport-badminton.co.uk',
        ReplyToAddresses: [LEAGUE_INBOX],
      });
      res.send('Message Sent');
    } catch (err) {
      console.log(err.toString());
      next(err);
    }
  }

// The body of the "Scorecard Updated" email, escaped.
//
// Exported because it cannot be exercised through the endpoint any more: no value that
// survives normalisePhotoUrl contains an HTML metacharacter, so the escaping is a second
// line of defence and the only way to prove it holds is to call it directly.
exports.buildPhotoEmailHtml = function(photoUrl, confirmUrl) {
  const safePhoto = escapeHtml(photoUrl);
  const safeConfirm = escapeHtml(confirmUrl);
  return `<p>a scorecard has been updated with a photo: <a href="${safePhoto}">${safePhoto}</a>` +
    `<br />Check the result here: <a href="${safeConfirm}">${safeConfirm}</a></p>`;
};

// POST /add-scorecard-photo/:id — attach a photo to a draft that was filed without one.
//
// Reachable unauthenticated, and it was the worst endpoint on the site (SEC-2): it wrote
// `req.body.imgURL` against any draft id and interpolated that value **unescaped** into
// an HTML email from results@stockport-badminton.co.uk. So any scorecard's photo could
// be replaced with a link to anything, and a crafted value rewrote the message itself —
// a phishing email from our own verified domain, delivered to the results secretary, who
// is expecting exactly that email about exactly that fixture.
//
// Four things stand between the request and that email now:
//
//   1. the URL has to be an object in our own S3 bucket (utils/scorecardLinks.js);
//   2. it is HTML-escaped on the way into the body regardless;
//   3. the draft has to exist and to have no photo yet — an id alone was never
//      authorisation, and a photo that is already there is not ours to replace;
//   4. if the draft carries a confirmation token, the request has to present it.
//
// A rejection sends no email at all, so the results secretary is never notified about a
// write that did not happen.
exports.add_scorecard_photo = async function(req, res, next) {
  try {
    let photoUrl;
    try {
      photoUrl = normalisePhotoUrl(req.body.imgURL);
    } catch (err) {
      if (err.status === 400) return res.status(400).json({ error: err.message });
      throw err;
    }

    const rows = await Fixture.getScorecardById(req.params.id);
    if (!rows || !rows.length) {
      return res.status(404).json({ error: 'There is no scorecard with that id.' });
    }
    const draft = rows[0];

    // Same grandfather clause as the confirmation page: a draft filed before the token
    // column existed has none, and the page offering the upload was rendered without one.
    if (!mayOpenDraft(draft.confirmToken, req.body.token)) {
      return res.status(403).json({ error: 'That link is not valid for this scorecard.' });
    }

    if (String(draft['scoresheet-url'] || '').trim() !== '') {
      return res.status(409).json({
        error: 'This scorecard already has a photo. Email the results secretary if it needs replacing.'
      });
    }

    const result = await Fixture.updateScorecardPhoto(req.params.id, photoUrl);
    // The model repeats the "no photo yet" test in its WHERE clause, so a row that
    // gained one between the read above and this write matches nothing.
    if (result && result.affectedRows === 0) {
      return res.status(409).json({ error: 'This scorecard already has a photo.' });
    }

    const params = {
      Destination: {
        ToAddresses: ['stockport.badders.results@gmail.com'],
        BccAddresses: ['bigcoops@outlook.com', 'bigcoops@gmail.com']
      },
      Message: {
        Body: {
          Html: {
            Charset: 'UTF-8',
            Data: exports.buildPhotoEmailHtml(
              photoUrl,
              confirmationUrl(req.params.id, draft.confirmToken)
            )
          }
        },
        Subject: { Charset: 'UTF-8', Data: 'Scorecard Updated' }
      },
      Source: 'results@stockport-badminton.co.uk',
      ReplyToAddresses: ['stockport.badders.results@gmail.com'],
    };
    await ses.sendEmail(params);
    res.sendStatus(200);
  } catch (err) {
    console.log(err.toString());
    next(err);
  }
}
