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
  body('Game1homeScore').isInt({ min: -10, max: 30 }).withMessage('must be between 0 and 30'),
  body('Game1awayScore').isInt({ min: -10, max: 30 }).withMessage('must be between 0 and 30').custom(greaterThan21).withMessage('Game 1: one team must score at least 21'),
  body('Game2homeScore').isInt({ min: -10, max: 30 }).withMessage('must be between 0 and 30'),
  body('Game2awayScore').isInt({ min: -10, max: 30 }).withMessage('must be between 0 and 30').custom(greaterThan21).withMessage('Game 2: one team must score at least 21'),
  body('Game3homeScore').isInt({ min: -10, max: 30 }).withMessage('must be between 0 and 30'),
  body('Game3awayScore').isInt({ min: -10, max: 30 }).withMessage('must be between 0 and 30').custom(greaterThan21).withMessage('Game 3: one team must score at least 21'),
  body('Game4homeScore').isInt({ min: -10, max: 30 }).withMessage('must be between 0 and 30'),
  body('Game4awayScore').isInt({ min: -10, max: 30 }).withMessage('must be between 0 and 30').custom(greaterThan21).withMessage('Game 4: one team must score at least 21'),
  body('Game5homeScore').isInt({ min: -10, max: 30 }).withMessage('must be between 0 and 30'),
  body('Game5awayScore').isInt({ min: -10, max: 30 }).withMessage('must be between 0 and 30').custom(greaterThan21).withMessage('Game 5: one team must score at least 21'),
  body('Game6homeScore').isInt({ min: -10, max: 30 }).withMessage('must be between 0 and 30'),
  body('Game6awayScore').isInt({ min: -10, max: 30 }).withMessage('must be between 0 and 30').custom(greaterThan21).withMessage('Game 6: one team must score at least 21'),
  body('Game7homeScore').isInt({ min: -10, max: 30 }).withMessage('must be between 0 and 30'),
  body('Game7awayScore').isInt({ min: -10, max: 30 }).withMessage('must be between 0 and 30').custom(greaterThan21).withMessage('Game 7: one team must score at least 21'),
  body('Game8homeScore').isInt({ min: -10, max: 30 }).withMessage('must be between 0 and 30'),
  body('Game8awayScore').isInt({ min: -10, max: 30 }).withMessage('must be between 0 and 30').custom(greaterThan21).withMessage('Game 8: one team must score at least 21'),
  body('Game9homeScore').isInt({ min: -10, max: 30 }).withMessage('must be between 0 and 30'),
  body('Game9awayScore').isInt({ min: -10, max: 30 }).withMessage('must be between 0 and 30').custom(greaterThan21).withMessage('Game 9: one team must score at least 21'),
  body('Game10homeScore').isInt({ min: -10, max: 30 }).withMessage('must be between 0 and 30'),
  body('Game10awayScore').isInt({ min: -10, max: 30 }).withMessage('must be between 0 and 30').custom(greaterThan21).withMessage('Game 10: one team must score at least 21'),
  body('Game11homeScore').isInt({ min: -10, max: 30 }).withMessage('must be between 0 and 30'),
  body('Game11awayScore').isInt({ min: -10, max: 30 }).withMessage('must be between 0 and 30').custom(greaterThan21).withMessage('Game 11: one team must score at least 21'),
  body('Game12homeScore').isInt({ min: -10, max: 30 }).withMessage('must be between 0 and 30'),
  body('Game12awayScore').isInt({ min: -10, max: 30 }).withMessage('must be between 0 and 30').custom(greaterThan21).withMessage('Game 12: one team must score at least 21'),
  body('Game13homeScore').isInt({ min: -10, max: 30 }).withMessage('must be between 0 and 30'),
  body('Game13awayScore').isInt({ min: -10, max: 30 }).withMessage('must be between 0 and 30').custom(greaterThan21).withMessage('Game 13: one team must score at least 21'),
  body('Game14homeScore').isInt({ min: -10, max: 30 }).withMessage('must be between 0 and 30'),
  body('Game14awayScore').isInt({ min: -10, max: 30 }).withMessage('must be between 0 and 30').custom(greaterThan21).withMessage('Game 14: one team must score at least 21'),
  body('Game15homeScore').isInt({ min: -10, max: 30 }).withMessage('must be between 0 and 30'),
  body('Game15awayScore').isInt({ min: -10, max: 30 }).withMessage('must be between 0 and 30').custom(greaterThan21).withMessage('Game 15: one team must score at least 21'),
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
    res.render('messer-scorecard', {
      static_path: '/static',
      theme: process.env.THEME || 'flatly',
      result: true, // Signal to view to show the form modal
      pageTitle: 'Enter Messer Result',
      pageDescription: 'Enter Messer Result',
      canonical: ('https://' + req.get('host') + req.originalUrl).replace('www.', '').replace('.com', '.co.uk').replace('-badders.herokuapp', '-badminton'),
    });
  } catch (err) {
    console.error('messer_scorecard_beta error:', err);
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
      'scoresheet-url': req.body['scoresheet-url'] || null,
      status: 'submitted',
    };

    const result = await Fixture.createMesserScorecard(scorecardData);
    const scorecardId = result.insertId || result[0]?.id;

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

    // Create messer_result record
    const resultData = {
      date: data.date,
      homeTeam: data.homeTeam,
      awayTeam: data.awayTeam,
      homeScore: homeWins,
      awayScore: awayWins,
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

    // Create result record
    await Fixture.createMesserResult(resultData);

    // Update scorecard status
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
    await Fixture.updateMesserScorecardStatus(scorecardId, 'rejected');

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
        ToAddresses: ['stockport.badders.results@gmail.com'],
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
      ReplyToAddresses: ['stockport.badders.results@gmail.com'],
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
      ReplyToAddresses: ['stockport.badders.results@gmail.com'],
    };

    const ses = new AWS.SES({ apiVersion: '2010-12-01' });
    await ses.sendEmail(params).promise();
  } catch (err) {
    console.error('sendMesserApprovalEmail error:', err);
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
