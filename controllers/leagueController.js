var League = require('../models/league.js');
const { canonicalFor } = require('../utils/canonical');

// Display list of all Leagues
exports.league_table = async function(req, res, next) {
  try {
    const result = await League.getLeagueTable(req.params.division, req.params.season);
    // console.log(result)
    res.status(200);
    res.render('tables', {
        static_path: '/static',
        theme: process.env.THEME || 'flatly',
        flask_debug: process.env.FLASK_DEBUG || 'false',
        pageTitle : "League Table: "+ req.params.division.replace('-',' '),
        pageDescription : "Find out how your teams are peforming this season",
        division : req.params.division.replace('-',' '),
        result : result,
        error : false,
        season: req.params.season,
        canonical:canonicalFor(req)
    });
  } catch (err) {
    console.log(err);
    next(err);
  }
};

exports.all_league_tables = async function(req, res, next) {
  try {
    const result = await League.getAllLeagueTables(req.params.season);
    // console.log(result)
    res.status(200);
    res.render('all-tables', {
        static_path: '/static',
        theme: process.env.THEME || 'flatly',
        flask_debug: process.env.FLASK_DEBUG || 'false',
        pageTitle : "League Tables",
        pageDescription : "Find out how your teams are peforming this season",
        result : result,
        season: req.params.season,
        canonical:canonicalFor(req)
    });
  } catch (err) {
    console.log(err);
    next(err);
  }
};
