var Team = require('../models/teams');

// Display list of all Teams
exports.team_list = function(req,res,next) {
    Team.getAll(function(err,rows){
      // console.log(rows);
      res.send(rows);
    })
};

// Display list of all Teams
exports.team_search = function(req,res,next) {
    Team.getTeams(req.body,function(err,rows){
      if(err){
        res.send(err);
        console.log(err);
      }
      else{
        // console.log(result)
        res.send(rows);
      }
    })
};

// Display detail page for a specific Team
exports.team_detail = function(req, res) {
    Team.getById(req.params.id,function(err,row){
      // console.log(row);
      res.send(row);
    })
};

// Display Team create form on GET
exports.team_create_get = function(req, res) {
    res.send('NOT IMPLEMENTED: Team create GET');
};

// Handle Team create on POST
exports.team_create_post = function(req, res) {
  Team.create(req.body.name,req.body.startTime,req.body.endTime,req.body.matchDay,req.body.venue,req.body.courtspace,req.body.club,req.body.division,req.body.rank, function(err,row){
    if(err) {
      console.log(err);
      res.send(err);
    }
    // console.log(req.body);
    // console.log(row);
    res.send(row);
  })
};

exports.teams_batch_create = function(req, res){
  Team.createBatch(req.body,function(err,result){
    if(err){
      res.send(err);
      console.log(err);
    }
    else{
      // console.log(result)
      res.send(result);
    }
  })
}

// Display Team delete form on GET
exports.team_delete_get = function(req, res) {
    res.send('NOT IMPLEMENTED: Team delete GET');
};

// Handle Team delete on POST
exports.team_delete_post = function(req, res) {
    Team.deleteById(req.params.id,function(err,row){
      // console.log(req.params)
      // console.log(row);
      res.send(row);
    })
};

// Display Team update form on GET
exports.team_update_get = function(req, res) {
    res.send('NOT IMPLEMENTED: Team update GET');
};

// Handle Team update on POST
exports.team_update_post = function(req, res) {
    Team.updateById(req.body, req.params.id, function(err,row){
      if (err){
        res.send(err);
        console.log(err);
      }
      else{
        // console.log(req.body);
        // console.log(row);
        res.send(row);
      }
    })
};

exports.messer_draw = function(req, res) {
  Team.getTeams({"section":"A"},function(err,rows){
    if(err){
      res.send(err);
      console.log(err)
    }
    else{
      console.log(rows.length);
      var totalRounds = Math.ceil(Math.log(rows.length)/Math.log(2))
      console.log(JSON.stringify(rows));
      res.render('beta/messer-draw', {
        static_path: '/static',
        theme: process.env.THEME || 'flatly',
        flask_debug: process.env.FLASK_DEBUG || 'false',
        teams: rows,
        pageTitle : "Messer Tropy Rules",
        pageDescription : "Rules and regulations around the Stockrt and District Badminton Leagues' cup competition"
      });
    }
  })
}
