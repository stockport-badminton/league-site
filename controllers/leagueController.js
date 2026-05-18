var League = require('../models/league.js');

// Display list of all Leagues
exports.league_list = async function(req, res, next) {
  try {
    const rows = await League.getAll();
    // console.log(rows);
    res.send(rows);
  } catch (err) {
    console.log(err);
    next(err);
  }
};

// Display detail page for a specific League
exports.league_detail = async function(req, res, next) {
  try {
    const row = await League.getById(req.params.id);
    // console.log(row);
    res.send(row);
  } catch (err) {
    next(err);
  }
};

// Display League create form on GET
exports.league_create_get = function(req, res) {
    res.send('NOT IMPLEMENTED: League create GET');
};

// Handle League create on POST
exports.league_create_post = async function(req, res, next) {
  try {
    const row = await League.create(req.body.name, req.body.admin, req.body.url);
    // console.log(req.body);
    // console.log(row);
    res.send(row);
  } catch (err) {
    next(err);
  }
};

// Handle League delete on DELETE
exports.league_delete = async function(req, res, next) {
  try {
    const row = await League.deleteById(req.params.id);
    // console.log(req.params)
    // console.log(row);
    res.send(row);
  } catch (err) {
    next(err);
  }
};

// Display League delete on GET
exports.league_delete_get = function(req, res) {
    res.send('NOT IMPLEMENTED: League delete GET');
};

// Display League update form on GET
exports.league_update_get = function(req, res) {
    res.send('NOT IMPLEMENTED: League update GET');
};

// Handle League update on PATCH
exports.league_update = async function(req, res, next) {
  try {
    const row = await League.updateById(req.body.name, req.body.admin, req.body.url, req.params.id);
    // console.log(req.body);
    // console.log(row);
    res.send(row);
  } catch (err) {
    next(err);
  }
};

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
        canonical:("https://" + req.get("host") + req.originalUrl).replace("www.'","").replace(".com",".co.uk").replace("-badders.herokuapp","-badminton")
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
        canonical:("https://" + req.get("host") + req.originalUrl).replace("www.'","").replace(".com",".co.uk").replace("-badders.herokuapp","-badminton")
    });
  } catch (err) {
    console.log(err);
    next(err);
  }
};
