var League = require('../models/league.js');
const { canonicalFor } = require('../utils/canonical');
const seasonModel = require('../models/season');
const { runIn, GAMES_PER_FIXTURE } = require('../utils/leagueRunIn');

// Display list of all Leagues
exports.league_table = async function(req, res, next) {
  try {
    const result = await League.getLeagueTable(req.params.division, req.params.season);
    // console.log(result)
    res.status(200);
    res.render('tables', {
        static_path: '/static',
        pageTitle : "League Table: "+ req.params.division.replace('-',' '),
        pageDescription : "Find out how your teams are peforming this season",
        division : req.params.division.replace('-',' '),
        result : result,
        error : false,
        season: req.params.season,
        canonical:canonicalFor(req)
    });
  } catch (err) {
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
        pageTitle : "League Tables",
        pageDescription : "Find out how your teams are peforming this season",
        result : result,
        season: req.params.season,
        canonical:canonicalFor(req)
    });
  } catch (err) {
    next(err);
  }
};

// The run-in (superadmin): this season's tables with the top two and bottom two marked,
// and which of those places are already certain. See utils/leagueRunIn.js.
exports.run_in = async function(req, res, next) {
  try {
    res.render('admin/league-run-in', {
      static_path: '/static',
      pageTitle: 'League Run-in',
      pageDescription: 'This season\'s run-in: who is going up and who is going down.',
      divisions: runIn(await League.getRunIn()),
      season: seasonModel.current(),
      GAMES_PER_FIXTURE,
      canonical: canonicalFor(req),
    });
  } catch (err) {
    next(err);
  }
};
