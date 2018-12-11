var League = require('../models/league.js');

// Display list of all Leagues
exports.league_list = function(req, res) {
    League.getAll(function(err,rows){
      if (err){
        console.log(err);
        res.send(err);
      }
      // console.log(rows);
      res.send(rows);
    })
};

// Display detail page for a specific League
exports.league_detail = function(req, res) {
    League.getById(req.params.id,function(err,row){
      // console.log(row);
      res.send(row);
    })
    // res.send('NOT IMPLEMENTED: League detail: ' + req.params.id);
};

// Display League create form on GET
exports.league_create_get = function(req, res) {
    res.send('NOT IMPLEMENTED: League create GET');
};

// Handle League create on POST
exports.league_create_post = function(req, res) {
  League.create(req.body.name, req.body.admin, req.body.url, function(err,row){
    // console.log(req.body);
    // console.log(row);
    res.send(row);
  })
  res.send('NOT IMPLEMENTED: League create POST');
};

// Handle League delete on DELETE
exports.league_delete = function(req, res) {
    League.deleteById(req.params.id,function(err,row){
      // console.log(req.params)
      // console.log(row);
      res.send(row);
    })
};

// Displey League delete on GET
exports.league_delete_get = function(req, res) {
    res.send('NOT IMPLEMENTED: League delete GET');
};

// Display League update form on GET
exports.league_update_get = function(req, res) {
    res.send('NOT IMPLEMENTED: League update GET');
};

// Handle League update on PATCH
exports.league_update = function(req, res) {
    League.updateById(req.body.name, req.body.admin, req.body.url, req.params.id, function(err,row){
      // console.log(req.body);
      // console.log(row);
      res.send(row);
    })
};

var League = require('../models/league.js');

// Display list of all Leagues
exports.league_table = function(req,res,next) {
    League.getLeagueTable(req.params.division,function(err,result){
      if (err){
        console.log(err);
        next(err);
      }
      else{
          // console.log(result)
          res.status(200);
         res.render('beta/tables', {
             static_path: '/static',
             theme: process.env.THEME || 'flatly',
             flask_debug: process.env.FLASK_DEBUG || 'false',
             pageTitle : "League Table: "+ req.params.division.replace('-',' '),
             pageDescription : "Find out how your teams are peforming this season",
             division : req.params.division.replace('-',' '),
             result : result,
             error : err
         });
      }
    })
};
