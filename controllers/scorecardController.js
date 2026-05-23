var Division = require('../models/division');
var Team = require('../models/teams');
var Player = require('../models/players');
var Fixture = require('../models/fixture');
var Game = require('../models/game');
const axios = require('axios');
var AWS = require('aws-sdk');
var Auth = require('../models/auth.js');
const sgMail = require('@sendgrid/mail');
sgMail.setApiKey(process.env.SENDGRID_API_KEY);
var contact_controller = require(__dirname + '/contactusController');
const { body, validationResult } = require("express-validator");

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
    next(err);
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
      res.render('index-scorecard', {
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
              Data: '<p>a new scorecard has been uploaded: <a href="' + req.body["scoresheet-url"] + '">' + req.body["scoresheet-url"] + '</a><br />Check the result here: <a href="' + scorecardUrlBeta + '">' + scorecardUrlBeta + '</a></p>'
            }
          },
          Subject: { Charset: 'UTF-8', Data: 'Scorecard Received' }
        },
        Source: 'results@stockport-badminton.co.uk',
        ReplyToAddresses: ['stockport.badders.results@gmail.com'],
      };
      const ses = new AWS.SES({ apiVersion: '2010-12-01' });
      await ses.sendEmail(params).promise();
      res.redirect('/populated-scorecard-beta/' + rows.insertId);
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
      res.render('index-scorecard', {
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

  exports.scorecard_upload = function(req, res) {
    res.render('scorecard-upload', {
        static_path: '/static',
        theme: process.env.THEME || 'flatly',
        flask_debug: process.env.FLASK_DEBUG || 'false',
        pageTitle : "Stockport & District Badminton League Scorecard Upload",
        pageDescription : "Upload your scorecard and send to the website",
        canonical:("https://" + req.get("host") + req.originalUrl).replace("www.'","").replace(".com",".co.uk").replace("-badders.herokuapp","-badminton")
    });
  };

  exports.upload_scoresheet = function(req,res){
    res.render('file-upload',{
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
