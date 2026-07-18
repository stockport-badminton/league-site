const Division = require('../models/division');
const Team = require('../models/teams');
const Player = require('../models/players');
const Fixture = require('../models/fixture');
const axios = require('axios');
var AWS = require('aws-sdk');
const { body, validationResult } = require('express-validator');

// Validation rules for 15-game messer format
function greaterThan21(value, { req, path }) {
  const otherValue = path.replace('away', 'home');
  if (value < 21 && req.body[otherValue] < 21) {
    return false;
  }
  return value;
}

function differenceOfTwo(value, { req, path }) {
  const otherValue = path.replace('away', 'home');
  if (Math.abs(value - req.body[otherValue]) < 2) {
    if (value < 30 && req.body[otherValue] < 30) {
      return false;
    } else {
      return value;
    }
  }
  return value;
}

exports.validateMesserScorecard = [
  body('Game1homeScore').isInt({ min: -10, max: 30 }).withMessage('must be between -10 and 30'),
  body('Game1awayScore').isInt({ min: -10, max: 30 }).withMessage('must be between -10 and 30').custom(greaterThan21).withMessage('Game 1: one team must score at least 21'),
  body('Game2homeScore').isInt({ min: -10, max: 30 }).withMessage('must be between -10 and 30'),
  body('Game2awayScore').isInt({ min: -10, max: 30 }).withMessage('must be between -10 and 30').custom(greaterThan21).withMessage('Game 2: one team must score at least 21'),
  body('Game3homeScore').isInt({ min: -10, max: 30 }).withMessage('must be between -10 and 30'),
  body('Game3awayScore').isInt({ min: -10, max: 30 }).withMessage('must be between -10 and 30').custom(greaterThan21).withMessage('Game 3: one team must score at least 21'),
  body('Game4homeScore').isInt({ min: -10, max: 30 }).withMessage('must be between -10 and 30'),
  body('Game4awayScore').isInt({ min: -10, max: 30 }).withMessage('must be between -10 and 30').custom(greaterThan21).withMessage('Game 4: one team must score at least 21'),
  body('Game5homeScore').isInt({ min: -10, max: 30 }).withMessage('must be between -10 and 30'),
  body('Game5awayScore').isInt({ min: -10, max: 30 }).withMessage('must be between -10 and 30').custom(greaterThan21).withMessage('Game 5: one team must score at least 21'),
  body('Game6homeScore').isInt({ min: -10, max: 30 }).withMessage('must be between -10 and 30'),
  body('Game6awayScore').isInt({ min: -10, max: 30 }).withMessage('must be between -10 and 30').custom(greaterThan21).withMessage('Game 6: one team must score at least 21'),
  body('Game7homeScore').isInt({ min: -10, max: 30 }).withMessage('must be between -10 and 30'),
  body('Game7awayScore').isInt({ min: -10, max: 30 }).withMessage('must be between -10 and 30').custom(greaterThan21).withMessage('Game 7: one team must score at least 21'),
  body('Game8homeScore').isInt({ min: -10, max: 30 }).withMessage('must be between -10 and 30'),
  body('Game8awayScore').isInt({ min: -10, max: 30 }).withMessage('must be between -10 and 30').custom(greaterThan21).withMessage('Game 8: one team must score at least 21'),
  body('Game9homeScore').isInt({ min: -10, max: 30 }).withMessage('must be between -10 and 30'),
  body('Game9awayScore').isInt({ min: -10, max: 30 }).withMessage('must be between -10 and 30').custom(greaterThan21).withMessage('Game 9: one team must score at least 21'),
  body('Game10homeScore').isInt({ min: -10, max: 30 }).withMessage('must be between -10 and 30'),
  body('Game10awayScore').isInt({ min: -10, max: 30 }).withMessage('must be between -10 and 30').custom(greaterThan21).withMessage('Game 10: one team must score at least 21'),
  body('Game11homeScore').isInt({ min: -10, max: 30 }).withMessage('must be between -10 and 30'),
  body('Game11awayScore').isInt({ min: -10, max: 30 }).withMessage('must be between -10 and 30').custom(greaterThan21).withMessage('Game 11: one team must score at least 21'),
  body('Game12homeScore').isInt({ min: -10, max: 30 }).withMessage('must be between -10 and 30'),
  body('Game12awayScore').isInt({ min: -10, max: 30 }).withMessage('must be between -10 and 30').custom(greaterThan21).withMessage('Game 12: one team must score at least 21'),
  body('Game13homeScore').isInt({ min: -10, max: 30 }).withMessage('must be between -10 and 30'),
  body('Game13awayScore').isInt({ min: -10, max: 30 }).withMessage('must be between -10 and 30').custom(greaterThan21).withMessage('Game 13: one team must score at least 21'),
  body('Game14homeScore').isInt({ min: -10, max: 30 }).withMessage('must be between -10 and 30'),
  body('Game14awayScore').isInt({ min: -10, max: 30 }).withMessage('must be between -10 and 30').custom(greaterThan21).withMessage('Game 14: one team must score at least 21'),
  body('Game15homeScore').isInt({ min: -10, max: 30 }).withMessage('must be between -10 and 30'),
  body('Game15awayScore').isInt({ min: -10, max: 30 }).withMessage('must be between -10 and 30').custom(greaterThan21).withMessage('Game 15: one team must score at least 21'),
  // Player uniqueness validation (3 men and 3 women per side)
  body('homeMan1', 'Please choose a player.').isInt().custom((value, { req }) => {
    return value != 0 ? ((value == req.body.homeMan2 || value == req.body.homeMan3 || value == req.body.awayMan1 || value == req.body.awayMan2 || value == req.body.awayMan3) ? false : value) : value;
  }).withMessage("Home Man 1: can't use the same player more than once"),
  body('homeMan2', 'Please choose a player.').isInt().custom((value, { req }) => {
    return value != 0 ? ((value == req.body.homeMan3 || value == req.body.homeMan1 || value == req.body.awayMan1 || value == req.body.awayMan2 || value == req.body.awayMan3) ? false : value) : value;
  }).withMessage("Home Man 2: can't use the same player more than once"),
  body('homeMan3', 'Please choose a player.').isInt().custom((value, { req }) => {
    return value != 0 ? ((value == req.body.homeMan2 || value == req.body.homeMan1 || value == req.body.awayMan1 || value == req.body.awayMan2 || value == req.body.awayMan3) ? false : value) : value;
  }).withMessage("Home Man 3: can't use the same player more than once"),
  body('homeLady1', 'Please choose a player.').isInt().custom((value, { req }) => {
    return value != 0 ? ((value == req.body.homeLady2 || value == req.body.homeLady3 || value == req.body.awayLady1 || value == req.body.awayLady2 || value == req.body.awayLady3) ? false : value) : value;
  }).withMessage("Home Lady 1: can't use the same player more than once"),
  body('homeLady2', 'Please choose a player.').isInt().custom((value, { req }) => {
    return value != 0 ? ((value == req.body.homeLady3 || value == req.body.homeLady1 || value == req.body.awayLady1 || value == req.body.awayLady2 || value == req.body.awayLady3) ? false : value) : value;
  }).withMessage("Home Lady 2: can't use the same player more than once"),
  body('homeLady3', 'Please choose a player.').isInt().custom((value, { req }) => {
    return value != 0 ? ((value == req.body.homeLady2 || value == req.body.homeLady1 || value == req.body.awayLady1 || value == req.body.awayLady2 || value == req.body.awayLady3) ? false : value) : value;
  }).withMessage("Home Lady 3: can't use the same player more than once"),
  body('awayMan1', 'Please choose a player.').isInt().custom((value, { req }) => {
    return value != 0 ? ((value == req.body.homeMan2 || value == req.body.homeMan3 || value == req.body.homeMan1 || value == req.body.awayMan2 || value == req.body.awayMan3) ? false : value) : value;
  }).withMessage("Away Man 1: can't use the same player more than once"),
  body('awayMan2', 'Please choose a player.').isInt().custom((value, { req }) => {
    return value != 0 ? ((value == req.body.homeMan2 || value == req.body.homeMan3 || value == req.body.awayMan1 || value == req.body.awayMan3 || value == req.body.homeMan1) ? false : value) : value;
  }).withMessage("Away Man 2: can't use the same player more than once"),
  body('awayMan3', 'Please choose a player.').isInt().custom((value, { req }) => {
    return value != 0 ? ((value == req.body.homeMan2 || value == req.body.homeMan3 || value == req.body.awayMan1 || value == req.body.awayMan2 || value == req.body.homeMan1) ? false : value) : value;
  }).withMessage("Away Man 3: can't use the same player more than once"),
  body('awayLady1', 'Please choose a player.').isInt().custom((value, { req }) => {
    return value != 0 ? ((value == req.body.homeLady2 || value == req.body.homeLady3 || value == req.body.homeLady1 || value == req.body.awayLady3 || value == req.body.awayLady2) ? false : value) : value;
  }).withMessage("Away Lady 1: can't use the same player more than once"),
  body('awayLady2', 'Please choose a player.').isInt().custom((value, { req }) => {
    return value != 0 ? ((value == req.body.homeLady2 || value == req.body.homeLady3 || value == req.body.homeLady1 || value == req.body.awayLady3 || value == req.body.awayLady1) ? false : value) : value;
  }).withMessage("Away Lady 2: can't use the same player more than once"),
  body('awayLady3', 'Please choose a player.').isInt().custom((value, { req }) => {
    return value != 0 ? ((value == req.body.homeLady2 || value == req.body.homeLady3 || value == req.body.homeLady1 || value == req.body.awayLady2 || value == req.body.awayLady1) ? false : value) : value;
  }).withMessage("Away Lady 3: can't use the same player more than once"),
  // Mixed game player validation
  body('FirstMixedhomeMan1', 'Please choose a player.').isInt().custom((value, { req }) => {
    return value != 0 ? ((value == req.body.SecondMixedhomeMan2 || value == req.body.ThirdMixedhomeMan3) ? false : value) : value;
  }).withMessage("First Mixed Home Man: can't use the same player more than once"),
  body('SecondMixedhomeMan2', 'Please choose a player.').isInt().custom((value, { req }) => {
    return value != 0 ? ((value == req.body.FirstMixedhomeMan1 || value == req.body.ThirdMixedhomeMan3) ? false : value) : value;
  }).withMessage("Second Mixed Home Man: can't use the same player more than once"),
  body('ThirdMixedhomeMan3', 'Please choose a player.').isInt().custom((value, { req }) => {
    return value != 0 ? ((value == req.body.FirstMixedhomeMan1 || value == req.body.SecondMixedhomeMan2) ? false : value) : value;
  }).withMessage("Third Mixed Home Man: can't use the same player more than once"),
  body('FirstMixedawayMan1', 'Please choose a player.').isInt().custom((value, { req }) => {
    return value != 0 ? ((value == req.body.SecondMixedawayMan2 || value == req.body.ThirdMixedawayMan3) ? false : value) : value;
  }).withMessage("First Mixed Away Man: can't use the same player more than once"),
  body('SecondMixedawayMan2', 'Please choose a player.').isInt().custom((value, { req }) => {
    return value != 0 ? ((value == req.body.FirstMixedawayMan1 || value == req.body.ThirdMixedawayMan3) ? false : value) : value;
  }).withMessage("Second Mixed Away Man: can't use the same player more than once"),
  body('ThirdMixedawayMan3', 'Please choose a player.').isInt().custom((value, { req }) => {
    return value != 0 ? ((value == req.body.FirstMixedawayMan1 || value == req.body.SecondMixedawayMan2) ? false : value) : value;
  }).withMessage("Third Mixed Away Man: can't use the same player more than once"),
  body('FirstMixedhomeLady1', 'Please choose a player.').isInt().custom((value, { req }) => {
    return value != 0 ? ((value == req.body.SecondMixedhomeLady2 || value == req.body.ThirdMixedhomeLady3) ? false : value) : value;
  }).withMessage("First Mixed Home Lady: can't use the same player more than once"),
  body('SecondMixedhomeLady2', 'Please choose a player.').isInt().custom((value, { req }) => {
    return value != 0 ? ((value == req.body.FirstMixedhomeLady1 || value == req.body.ThirdMixedhomeLady3) ? false : value) : value;
  }).withMessage("Second Mixed Home Lady: can't use the same player more than once"),
  body('ThirdMixedhomeLady3', 'Please choose a player.').isInt().custom((value, { req }) => {
    return value != 0 ? ((value == req.body.FirstMixedhomeLady1 || value == req.body.SecondMixedhomeLady2) ? false : value) : value;
  }).withMessage("Third Mixed Home Lady: can't use the same player more than once"),
  body('FirstMixedawayLady1', 'Please choose a player.').isInt().custom((value, { req }) => {
    return value != 0 ? ((value == req.body.SecondMixedawayLady2 || value == req.body.ThirdMixedawayLady3) ? false : value) : value;
  }).withMessage("First Mixed Away Lady: can't use the same player more than once"),
  body('SecondMixedawayLady2', 'Please choose a player.').isInt().custom((value, { req }) => {
    return value != 0 ? ((value == req.body.FirstMixedawayLady1 || value == req.body.ThirdMixedawayLady3) ? false : value) : value;
  }).withMessage("Second Mixed Away Lady: can't use the same player more than once"),
  body('ThirdMixedawayLady3', 'Please choose a player.').isInt().custom((value, { req }) => {
    return value != 0 ? ((value == req.body.FirstMixedawayLady1 || value == req.body.SecondMixedawayLady2) ? false : value) : value;
  }).withMessage("Third Mixed Away Lady: can't use the same player more than once"),
];

// GET /messer-scorecard-beta — render form
exports.messer_scorecard_beta = async function(req, res, next) {
  try {
    // Get section A teams (default sections for messer)
    const [homeTeamRows, awayTeamRows] = await Promise.all([
      Team.getAllAndSelectedBySection(0, 'A'),
      Team.getAllAndSelectedBySection(0, 'A'),
    ]);

    const scorecard = {
      homeTeamRows,
      awayTeamRows,
      homeMenRows: [],
      homeLadiesRows: [],
      awayMenRows: [],
      awayLadiesRows: [],
    };

    const data = {
      section: '',
      date: '',
      homeTeam: '',
      awayTeam: '',
    };

    res.render('messer-scorecard', {
      static_path: '/static',
      theme: process.env.THEME || 'flatly',
      result: true, // Signal to view to show the form modal
      scorecard,
      data,
      pageTitle: 'Enter Messer Result',
      pageDescription: 'Enter Messer Result',
      devMode: process.env.DEV_MODE === 'true' || process.env.NODE_ENV === 'development',
      canonical: ('https://' + req.get('host') + req.originalUrl).replace('www.', '').replace('.com', '.co.uk').replace('-badders.herokuapp', '-badminton'),
    });
  } catch (err) {
    console.error('messer_scorecard_beta error:', err);
    next(err);
  }
};

// GET /messer-scorecard-beta/test — render form pre-filled with test data (dev only)
exports.messer_scorecard_beta_test = async function(req, res, next) {
  try {
    // Get all Section A teams
    const allSectionATeams = await Team.getTeamsBySection('A');

    if (!allSectionATeams || allSectionATeams.length < 2) {
      throw new Error('Not enough teams in Section A for test data (need at least 2)');
    }

    // Use first two teams as home and away
    const homeTeamId = allSectionATeams[0].id;
    const awayTeamId = allSectionATeams[1].id;

    // Fetch teams with selection flags and get all eligible players (first pass)
    const [homeTeamRows, awayTeamRows, homeMenRowsTemp, homeLadiesRowsTemp, awayMenRowsTemp, awayLadiesRowsTemp] = await Promise.all([
      Team.getAllAndSelectedBySection(homeTeamId, 'A'),
      Team.getAllAndSelectedBySection(awayTeamId, 'A'),
      Player.getEligiblePlayersAndSelectedById(0, 0, 0, homeTeamId, 'Male'),
      Player.getEligiblePlayersAndSelectedById(0, 0, 0, homeTeamId, 'Female'),
      Player.getEligiblePlayersAndSelectedById(0, 0, 0, awayTeamId, 'Male'),
      Player.getEligiblePlayersAndSelectedById(0, 0, 0, awayTeamId, 'Female'),
    ]);

    // Find first 3 eligible men and women for each team
    const homeMen = homeMenRowsTemp && homeMenRowsTemp.length >= 3 ? homeMenRowsTemp.slice(0, 3) : [];
    const homeWomen = homeLadiesRowsTemp && homeLadiesRowsTemp.length >= 3 ? homeLadiesRowsTemp.slice(0, 3) : [];
    const awayMen = awayMenRowsTemp && awayMenRowsTemp.length >= 3 ? awayMenRowsTemp.slice(0, 3) : [];
    const awayWomen = awayLadiesRowsTemp && awayLadiesRowsTemp.length >= 3 ? awayLadiesRowsTemp.slice(0, 3) : [];

    // Verify we have enough players
    if (homeMen.length < 3 || homeWomen.length < 3 || awayMen.length < 3 || awayWomen.length < 3) {
      throw new Error(`Insufficient players for test data. Home: ${homeMen.length}M/${homeWomen.length}W, Away: ${awayMen.length}M/${awayWomen.length}W`);
    }

    // Now fetch players again with the correct selected IDs so they get marked with selected=true
    const [homeMenRaw, homeLadiesRaw, awayMenRaw, awayLadiesRaw] = await Promise.all([
      Player.getEligiblePlayersAndSelectedById(homeMen[0].id, homeMen[1].id, homeMen[2].id, homeTeamId, 'Male'),
      Player.getEligiblePlayersAndSelectedById(homeWomen[0].id, homeWomen[1].id, homeWomen[2].id, homeTeamId, 'Female'),
      Player.getEligiblePlayersAndSelectedById(awayMen[0].id, awayMen[1].id, awayMen[2].id, awayTeamId, 'Male'),
      Player.getEligiblePlayersAndSelectedById(awayWomen[0].id, awayWomen[1].id, awayWomen[2].id, awayTeamId, 'Female'),
    ]);

    // Transform to add selected field (function returns first/second/third flags, view expects selected)
    const transformPlayers = (players) => players.map(p => ({ ...p, selected: p.first || p.second || p.third ? 1 : 0, name: p.first_name + ' ' + p.family_name }));
    const homeMenRows = transformPlayers(homeMenRaw);
    const homeLadiesRows = transformPlayers(homeLadiesRaw);
    const awayMenRows = transformPlayers(awayMenRaw);
    const awayLadiesRows = transformPlayers(awayLadiesRaw);

    // Pre-fill with actual database IDs
    const testData = {
      section: 'A',
      date: new Date().toISOString().split('T')[0],
      homeTeam: homeTeamId.toString(),
      awayTeam: awayTeamId.toString(),
      homeMan1: homeMen[0].id.toString(),
      homeMan2: homeMen[1].id.toString(),
      homeMan3: homeMen[2].id.toString(),
      homeLady1: homeWomen[0].id.toString(),
      homeLady2: homeWomen[1].id.toString(),
      homeLady3: homeWomen[2].id.toString(),
      awayMan1: awayMen[0].id.toString(),
      awayMan2: awayMen[1].id.toString(),
      awayMan3: awayMen[2].id.toString(),
      awayLady1: awayWomen[0].id.toString(),
      awayLady2: awayWomen[1].id.toString(),
      awayLady3: awayWomen[2].id.toString(),
    };

    // Add game scores (21-19 for all games - valid)
    for (let i = 1; i <= 15; i++) {
      testData[`Game${i}homeScore`] = '21';
      testData[`Game${i}awayScore`] = '19';
    }

    const scorecard = { homeTeamRows, awayTeamRows, homeMenRows, homeLadiesRows, awayMenRows, awayLadiesRows };

    res.render('messer-scorecard', {
      static_path: '/static',
      theme: process.env.THEME || 'flatly',
      result: true,
      scorecard,
      data: testData,
      devMode: true,
      pageTitle: 'Enter Messer Result (Test Data)',
      pageDescription: 'Enter Messer Result',
      canonical: ('https://' + req.get('host') + req.originalUrl).replace('www.', '').replace('.com', '.co.uk').replace('-badders.herokuapp', '-badminton'),
    });
  } catch (err) {
    console.error('messer_scorecard_beta_test error:', err);
    next(err);
  }
};

// POST /messer-scorecard-beta — submit and validate
exports.full_messer_fixture_post = async function(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const data = req.body;
    try {
      const [homeTeamRows, awayTeamRows, homeMenRows, homeLadiesRows, awayMenRows, awayLadiesRows] = await Promise.all([
        Team.getAllAndSelectedBySection(data.homeTeam, data.section),
        Team.getAllAndSelectedBySection(data.awayTeam, data.section),
        Player.getEligiblePlayersAndSelectedById(data.homeMan1, data.homeMan2, data.homeMan3, data.homeTeam, 'Male'),
        Player.getEligiblePlayersAndSelectedById(data.homeLady1, data.homeLady2, data.homeLady3, data.homeTeam, 'Female'),
        Player.getEligiblePlayersAndSelectedById(data.awayMan1, data.awayMan2, data.awayMan3, data.awayTeam, 'Male'),
        Player.getEligiblePlayersAndSelectedById(data.awayLady1, data.awayLady2, data.awayLady3, data.awayTeam, 'Female'),
      ]);
      const scorecard = { homeTeamRows, awayTeamRows, homeMenRows, homeLadiesRows, awayMenRows, awayLadiesRows };
      return res.render('messer-scorecard', {
        static_path: '/static',
        theme: process.env.THEME || 'flatly',
        result: true,
        scorecard,
        data,
        errors: errors.array(),
        devMode: process.env.DEV_MODE === 'true' || process.env.NODE_ENV === 'development',
        pageTitle: 'Enter Messer Result',
        pageDescription: 'Enter Messer Result',
        canonical: ('https://' + req.get('host') + req.originalUrl).replace('www.', '').replace('.com', '.co.uk').replace('-badders.herokuapp', '-badminton'),
      });
    } catch (err) {
      return next(err);
    }
  }

  try {
    // Create messer_scorecard draft - convert all numeric fields to integers
    const scorecardData = {
      date: req.body.date,
      homeTeam: parseInt(req.body.homeTeam) || null,
      awayTeam: parseInt(req.body.awayTeam) || null,
      homeMan1: parseInt(req.body.homeMan1) || null,
      homeMan2: parseInt(req.body.homeMan2) || null,
      homeMan3: parseInt(req.body.homeMan3) || null,
      homeLady1: parseInt(req.body.homeLady1) || null,
      homeLady2: parseInt(req.body.homeLady2) || null,
      homeLady3: parseInt(req.body.homeLady3) || null,
      awayMan1: parseInt(req.body.awayMan1) || null,
      awayMan2: parseInt(req.body.awayMan2) || null,
      awayMan3: parseInt(req.body.awayMan3) || null,
      awayLady1: parseInt(req.body.awayLady1) || null,
      awayLady2: parseInt(req.body.awayLady2) || null,
      awayLady3: parseInt(req.body.awayLady3) || null,
      FirstMixedhomeMan: parseInt(req.body.FirstMixedhomeMan1) || null,
      FirstMixedhomeLady: parseInt(req.body.FirstMixedhomeLady1) || null,
      FirstMixedawayMan: parseInt(req.body.FirstMixedawayMan1) || null,
      FirstMixedawayLady: parseInt(req.body.FirstMixedawayLady1) || null,
      SecondMixedhomeMan: parseInt(req.body.SecondMixedhomeMan2) || null,
      SecondMixedhomeLady: parseInt(req.body.SecondMixedhomeLady2) || null,
      SecondMixedawayMan: parseInt(req.body.SecondMixedawayMan2) || null,
      SecondMixedawayLady: parseInt(req.body.SecondMixedawayLady2) || null,
      ThirdMixedhomeMan: parseInt(req.body.ThirdMixedhomeMan3) || null,
      ThirdMixedhomeLady: parseInt(req.body.ThirdMixedhomeLady3) || null,
      ThirdMixedawayMan: parseInt(req.body.ThirdMixedawayMan3) || null,
      ThirdMixedawayLady: parseInt(req.body.ThirdMixedawayLady3) || null,
      ...Object.fromEntries(
        Object.entries(req.body)
          .filter(([k]) => k.startsWith('Game') && (k.includes('homeScore') || k.includes('awayScore')))
          .map(([k, v]) => [k, parseInt(v) || null])
      ),
      email: req.user?.email || req.body.email,
      status: 'submitted',
    };

    const result = await Fixture.createMesserScorecard(scorecardData);
    const scorecardId = result[0]?.id;

    // Send email to results secretary
    await sendMesserSubmissionEmail(req, scorecardData, scorecardId);

    // Redirect to confirmation page
    res.redirect(`/populated-messer-scorecard/${scorecardId}`);
  } catch (err) {
    console.error('full_messer_fixture_post error:', err);
    next(err);
  }
};

// GET /populated-messer-scorecard/:id — load draft via POST-Redirect-Get
exports.messer_fixture_populate_scorecard_fromId = async function(req, res, next) {
  try {
    const scorecardId = req.params.id;
    const scorecard = await Fixture.getMesserScorecardById(scorecardId);

    if (!scorecard || scorecard.length === 0) {
      return res.status(404).render('404-error', {
        static_path: '/static',
        pageTitle: "Can't find the page you're looking for",
        pageDescription: 'HTTP 404 Error',
        canonical: ('https://' + req.get('host') + req.originalUrl).replace('www.', '').replace('.com', '.co.uk').replace('-badders.herokuapp', '-badminton'),
      });
    }

    res.render('messer-scorecard', {
      static_path: '/static',
      theme: process.env.THEME || 'flatly',
      result: true,
      scorecard: scorecard[0],
      devMode: process.env.DEV_MODE === 'true' || process.env.NODE_ENV === 'development',
      pageTitle: 'Messer Result Submitted',
      pageDescription: 'Your messer result has been submitted',
      canonical: ('https://' + req.get('host') + req.originalUrl).replace('www.', '').replace('.com', '.co.uk').replace('-badders.herokuapp', '-badminton'),
    });
  } catch (err) {
    console.error('messer_fixture_populate_scorecard_fromId error:', err);
    next(err);
  }
};

// GET /api/messer-teams-by-section/:section — get teams for messer section
exports.messer_teams_by_section = async function(req, res, next) {
  try {
    const section = req.params.section?.toUpperCase();
    if (!section || !['A', 'B'].includes(section)) {
      return res.status(400).json({ error: 'Invalid section' });
    }

    const teams = await Team.getTeamsBySection(section);
    res.json(teams);
  } catch (err) {
    console.error('messer_teams_by_section error:', err);
    res.status(500).json({ error: err.message });
  }
};

// GET /messer-results — list pending submissions (admin only)
exports.messer_results_list = async function(req, res, next) {
  try {
    // Verify only Neil can access this
    if (req.user._json["https://my-app.example.com/role"] !== 'superadmin' && !req.user._json["https://my-app.example.com/messeradmin"]) {
      return res.status(403).render('403-error', {
        static_path: '/static',
        pageTitle: 'Access Denied',
        pageDescription: 'Access Denied',
        canonical: ('https://' + req.get('host') + req.originalUrl).replace('www.', '').replace('.com', '.co.uk').replace('-badders.herokuapp', '-badminton'),
      });
    }

    const results = await Fixture.listMesserScorecardsForApproval();
    res.render('messer-results-list', {
      static_path: '/static',
      theme: process.env.THEME || 'flatly',
      results: results,
      pageTitle: 'Messer Results Pending Approval',
      pageDescription: 'Review and approve messer match results',
      canonical: ('https://' + req.get('host') + req.originalUrl).replace('www.', '').replace('.com', '.co.uk').replace('-badders.herokuapp', '-badminton'),
    });
  } catch (err) {
    console.error('messer_results_list error:', err);
    next(err);
  }
};

// GET /messer-result/:id — view detail (admin only)
exports.messer_result_detail = async function(req, res, next) {
  try {
    // Verify only Neil can access this
    if (req.user._json["https://my-app.example.com/role"] !== 'superadmin' && !req.user._json["https://my-app.example.com/messeradmin"]) {
      return res.status(403).render('403-error', {
        static_path: '/static',
        pageTitle: 'Access Denied',
        pageDescription: 'Access Denied',
        canonical: ('https://' + req.get('host') + req.originalUrl).replace('www.', '').replace('.com', '.co.uk').replace('-badders.herokuapp', '-badminton'),
      });
    }

    const scorecardId = req.params.id;
    const scorecard = await Fixture.getMesserScorecardById(scorecardId);

    if (!scorecard || scorecard.length === 0) {
      return res.status(404).render('404-error', {
        static_path: '/static',
        pageTitle: "Can't find the result",
        pageDescription: 'HTTP 404 Error',
        canonical: ('https://' + req.get('host') + req.originalUrl).replace('www.', '').replace('.com', '.co.uk').replace('-badders.herokuapp', '-badminton'),
      });
    }

    // Calculate home wins from scores
    let homeWins = 0;
    for (let i = 1; i <= 15; i++) {
      const homeKey = `Game${i}homeScore`;
      const awayKey = `Game${i}awayScore`;
      if (scorecard[0][homeKey] > scorecard[0][awayKey]) {
        homeWins++;
      }
    }

    const awayWins = 15 - homeWins;

    res.render('messer-result-detail', {
      static_path: '/static',
      theme: process.env.THEME || 'flatly',
      scorecard: scorecard[0],
      homeWins,
      awayWins,
      pageTitle: 'Review Messer Result',
      pageDescription: 'Review messer match result before approval',
      canonical: ('https://' + req.get('host') + req.originalUrl).replace('www.', '').replace('.com', '.co.uk').replace('-badders.herokuapp', '-badminton'),
    });
  } catch (err) {
    console.error('messer_result_detail error:', err);
    next(err);
  }
};

// POST /messer-result/:id/approve — approve and write to messer table
exports.messer_result_approve = async function(req, res, next) {
  try {
    // Verify only Neil can approve
    if (req.user._json["https://my-app.example.com/role"] !== 'superadmin' && !req.user._json["https://my-app.example.com/messeradmin"]) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const scorecardId = req.params.id;
    const scorecard = await Fixture.getMesserScorecardById(scorecardId);

    if (!scorecard || scorecard.length === 0) {
      return res.status(404).json({ error: 'Scorecard not found' });
    }

    const data = scorecard[0];

    // Idempotency guard: don't re-approve an already-processed scorecard.
    // Without this, a second click creates a duplicate messer_result row
    // (the pending list LEFT JOINs messer_result and fans out).
    if (data.status === 'approved') {
      return res.json({ success: true, message: 'Result already approved' });
    }

    // Calculate home wins
    let homeWins = 0;
    for (let i = 1; i <= 15; i++) {
      const homeKey = `Game${i}homeScore`;
      const awayKey = `Game${i}awayScore`;
      if (data[homeKey] > data[awayKey]) {
        homeWins++;
      }
    }
    const awayWins = 15 - homeWins;
    const winningTeam = homeWins > awayWins ? data.homeTeam : data.awayTeam;

    // Create messer_result record with all game scores
    const resultData = {
      messer_scorecard_id: scorecardId,
      date: data.date,
      homeTeam: data.homeTeam,
      awayTeam: data.awayTeam,
      Game1homeScore: data.Game1homeScore,
      Game1awayScore: data.Game1awayScore,
      Game2homeScore: data.Game2homeScore,
      Game2awayScore: data.Game2awayScore,
      Game3homeScore: data.Game3homeScore,
      Game3awayScore: data.Game3awayScore,
      Game4homeScore: data.Game4homeScore,
      Game4awayScore: data.Game4awayScore,
      Game5homeScore: data.Game5homeScore,
      Game5awayScore: data.Game5awayScore,
      Game6homeScore: data.Game6homeScore,
      Game6awayScore: data.Game6awayScore,
      Game7homeScore: data.Game7homeScore,
      Game7awayScore: data.Game7awayScore,
      Game8homeScore: data.Game8homeScore,
      Game8awayScore: data.Game8awayScore,
      Game9homeScore: data.Game9homeScore,
      Game9awayScore: data.Game9awayScore,
      Game10homeScore: data.Game10homeScore,
      Game10awayScore: data.Game10awayScore,
      Game11homeScore: data.Game11homeScore,
      Game11awayScore: data.Game11awayScore,
      Game12homeScore: data.Game12homeScore,
      Game12awayScore: data.Game12awayScore,
      Game13homeScore: data.Game13homeScore,
      Game13awayScore: data.Game13awayScore,
      Game14homeScore: data.Game14homeScore,
      Game14awayScore: data.Game14awayScore,
      Game15homeScore: data.Game15homeScore,
      Game15awayScore: data.Game15awayScore,
      homeWins,
      awayWins,
      status: 'approved',
      approved_at: new Date(),
    };

    // Get the messer match to get its ID
    const messerMatch = await getMesserMatchId(data.homeTeam, data.awayTeam);

    if (messerMatch) {
      resultData.messer_id = messerMatch.id;
      // Update messer table with final results
      await Fixture.updateMesserTable(messerMatch.id, {
        homeScore: homeWins,
        awayScore: awayWins,
        winningTeam,
      });
    }

    // Create result record with 'approved' status
    await Fixture.createMesserResult(resultData);

    // Mark the draft as approved so it drops out of the pending list.
    // (This is what was missing before — the scorecard stayed 'submitted'
    // and kept reappearing for approval.)
    await Fixture.updateMesserScorecardStatus(scorecardId, 'approved');

    // Send approval email to captain
    await sendMesserApprovalEmail(data);

    res.json({ success: true, message: 'Result approved and messer table updated' });
  } catch (err) {
    console.error('messer_result_approve error:', err);
    res.status(500).json({ error: err.message });
  }
};

// POST /messer-result/:id/reject — reject submission
exports.messer_result_reject = async function(req, res, next) {
  try {
    // Verify only Neil can reject
    if (req.user._json["https://my-app.example.com/role"] !== 'superadmin' && !req.user._json["https://my-app.example.com/messeradmin"]) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const scorecardId = req.params.id;

    // Fetch the scorecard to get details
    const scorecard = await Fixture.getMesserScorecardById(scorecardId);
    if (!scorecard || scorecard.length === 0) {
      return res.status(404).json({ error: 'Scorecard not found' });
    }

    const data = scorecard[0];

    // Idempotency guard: don't reject something already approved/rejected.
    if (data.status === 'approved' || data.status === 'rejected') {
      return res.json({ success: true, message: `Result already ${data.status}` });
    }

    // Create messer_result record with 'rejected' status
    const resultData = {
      messer_scorecard_id: scorecardId,
      messer_id: null, // Not linked to a messer record since it's rejected
      date: data.date,
      homeTeam: data.homeTeam,
      awayTeam: data.awayTeam,
      Game1homeScore: data.Game1homeScore,
      Game1awayScore: data.Game1awayScore,
      Game2homeScore: data.Game2homeScore,
      Game2awayScore: data.Game2awayScore,
      Game3homeScore: data.Game3homeScore,
      Game3awayScore: data.Game3awayScore,
      Game4homeScore: data.Game4homeScore,
      Game4awayScore: data.Game4awayScore,
      Game5homeScore: data.Game5homeScore,
      Game5awayScore: data.Game5awayScore,
      Game6homeScore: data.Game6homeScore,
      Game6awayScore: data.Game6awayScore,
      Game7homeScore: data.Game7homeScore,
      Game7awayScore: data.Game7awayScore,
      Game8homeScore: data.Game8homeScore,
      Game8awayScore: data.Game8awayScore,
      Game9homeScore: data.Game9homeScore,
      Game9awayScore: data.Game9awayScore,
      Game10homeScore: data.Game10homeScore,
      Game10awayScore: data.Game10awayScore,
      Game11homeScore: data.Game11homeScore,
      Game11awayScore: data.Game11awayScore,
      Game12homeScore: data.Game12homeScore,
      Game12awayScore: data.Game12awayScore,
      Game13homeScore: data.Game13homeScore,
      Game13awayScore: data.Game13awayScore,
      Game14homeScore: data.Game14homeScore,
      Game14awayScore: data.Game14awayScore,
      Game15homeScore: data.Game15homeScore,
      Game15awayScore: data.Game15awayScore,
      homeWins: 0,
      awayWins: 0,
      status: 'rejected',
    };

    await Fixture.createMesserResult(resultData);

    // Mark the draft as rejected so it drops out of the pending list
    // (single source of truth: ms.status, same as the approve path).
    await Fixture.updateMesserScorecardStatus(scorecardId, 'rejected');

    // Send rejection email to captain
    await sendMesserRejectionEmail(data);

    res.json({ success: true, message: 'Result rejected' });
  } catch (err) {
    console.error('messer_result_reject error:', err);
    res.status(500).json({ error: err.message });
  }
};

// Helper: Send submission email to results secretary
async function sendMesserSubmissionEmail(req, scorecardData, scorecardId) {
  try {
    const homeTeam = await Team.getById(scorecardData.homeTeam);
    const awayTeam = await Team.getById(scorecardData.awayTeam);

    const params = {
      Destination: {
        ToAddresses: ['stockport.badders.results@gmail.com','stockportbadminton18@btinternet.com'],
      },
      Message: {
        Body: {
          Html: {
            Charset: 'UTF-8',
            Data: `
              <p>A new messer result has been submitted.</p>
              <p><strong>Match:</strong> ${homeTeam[0]?.name || 'Home'} vs ${awayTeam[0]?.name || 'Away'}</p>
              <p><strong>Date:</strong> ${scorecardData.date}</p>
              <p><strong>Submitted by:</strong> ${scorecardData.email}</p>
              <p><a href="https://${req.get('host')}/messer-result/${scorecardId}">Review and approve this result</a></p>
            `,
          },
        },
        Subject: {
          Charset: 'UTF-8',
          Data: `Messer Result Submitted: ${homeTeam[0]?.name || 'Home'} vs ${awayTeam[0]?.name || 'Away'}`,
        },
      },
      Source: 'results@stockport-badminton.co.uk',
      ReplyToAddresses: ['stockport.badders.results@gmail.com','stockportbadminton18@btinternet.com'],
    };

    const ses = new AWS.SES({ apiVersion: '2010-12-01' });
    await ses.sendEmail(params).promise();
  } catch (err) {
    console.error('sendMesserSubmissionEmail error:', err);
  }
}

// Helper: Send approval email to captain
async function sendMesserApprovalEmail(scorecardData) {
  try {
    const homeTeam = await Team.getById(scorecardData.homeTeam);
    const awayTeam = await Team.getById(scorecardData.awayTeam);

    const params = {
      Destination: {
        ToAddresses: [scorecardData.email],
      },
      Message: {
        Body: {
          Html: {
            Charset: 'UTF-8',
            Data: `
              <p>Your messer result has been approved and entered into the system.</p>
              <p><strong>Match:</strong> ${homeTeam[0]?.name || 'Home'} vs ${awayTeam[0]?.name || 'Away'}</p>
              <p>The messer draw and standings have been updated.</p>
            `,
          },
        },
        Subject: {
          Charset: 'UTF-8',
          Data: `Messer Result Approved: ${homeTeam[0]?.name || 'Home'} vs ${awayTeam[0]?.name || 'Away'}`,
        },
      },
      Source: 'results@stockport-badminton.co.uk',
      ReplyToAddresses: ['stockport.badders.results@gmail.com','stockportbadminton18@btinternet.com'],
    };

    const ses = new AWS.SES({ apiVersion: '2010-12-01' });
    await ses.sendEmail(params).promise();
  } catch (err) {
    console.error('sendMesserApprovalEmail error:', err);
  }
}

async function sendMesserRejectionEmail(scorecardData) {
  try {
    const homeTeam = await Team.getById(scorecardData.homeTeam);
    const awayTeam = await Team.getById(scorecardData.awayTeam);

    const params = {
      Destination: {
        ToAddresses: [scorecardData.email],
      },
      Message: {
        Body: {
          Html: {
            Charset: 'UTF-8',
            Data: `
              <p>Your messer result submission has been rejected and was not entered into the system.</p>
              <p><strong>Match:</strong> ${homeTeam[0]?.name || 'Home'} vs ${awayTeam[0]?.name || 'Away'}</p>
              <p>Please review the scores and submit again if needed.</p>
            `,
          },
        },
        Subject: {
          Charset: 'UTF-8',
          Data: `Messer Result Rejected: ${homeTeam[0]?.name || 'Home'} vs ${awayTeam[0]?.name || 'Away'}`,
        },
      },
      Source: 'results@stockport-badminton.co.uk',
      ReplyToAddresses: ['stockport.badders.results@gmail.com','stockportbadminton18@btinternet.com'],
    };

    const ses = new AWS.SES({ apiVersion: '2010-12-01' });
    await ses.sendEmail(params).promise();
  } catch (err) {
    console.error('sendMesserRejectionEmail error:', err);
  }
}

// Helper: Get messer match ID by teams and date
async function getMesserMatchId(homeTeamId, awayTeamId) {
  try {
    const db = require('../db_connect');
    const [result] = await (await db.otherConnect()).query(
      'SELECT id FROM messer WHERE "homeTeam" = ? AND "awayTeam" = ?',
      [homeTeamId, awayTeamId]
    );
    return result && result.length > 0 ? result[0] : null;
  } catch (err) {
    console.error('getMesserMatchId error:', err);
    return null;
  }
}
