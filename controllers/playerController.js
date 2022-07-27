var Club = require('../models/club');
var Player = require('../models/players');
var Team = require('../models/teams');
var Venue = require('../models/venue');
var async = require('async');
var jp = require('jsonpath');


function logger(data) {
  return JSON.stringify(data, undefined, 2);
}

exports.index = function(req, res) {

    async.parallel({
        player_count: function(done) {
            Player.count("",done);
        },
        player_female_count: function(done) {
            Player.count("Female", done);
        },
        player_male_count: function(done) {
            Player.count("Male", done);
        },
/*       team_count: function(callback) {
            Team.count(callback);
        },
        venue_count: function(callback) {
            Venue.count(callback);
        },*/
    }, function(err, results) {
      // console.log("results: " + results);
      var flattenedResult = JSON.stringify(results);
      res.render('index', { title: 'Stockport League website', static_path:'/static', theme:'flatly', error: err, data: results, dataString:flattenedResult });
    });
};

// Display list of all Players
exports.player_list = function(req, res) {
    Player.search(req.params,function(err,rows){
      // console.log(rows);
      res.send(rows);
    })
};


// Display list of all Players
exports.player_game_data = function(req, res,next) {
    Player.getPlayerGameData(req.params.id,function(err,rows){
      if (err) return next(err)
      res.render('beta/player-game-stats', {
           static_path: '/static',
           theme: process.env.THEME || 'flatly',
           flask_debug: process.env.FLASK_DEBUG || 'false',
           pageTitle : "Player Game Data:"+ req.params.fullName,
           pageDescription : "Information about games that "+ req.params.fullName + "played in this season",
           result : rows,
           fullName: req.params.fullName
       });
    })
};


// Display list of all Players
exports.player_list_clubs_teams = function(req, res) {
    Player.getNamesClubsTeams(req.params, function(err,rows){
      // console.log(rows);
      if (err){
        // console.log("all_player_stats controller error")
        return next(err)
      }
      else {
        // console.log("all_player_stats controller success")
        // console.log(result);
        res.render('beta/player-list', {
             static_path: '/static',
             theme: process.env.THEME || 'flatly',
             flask_debug: process.env.FLASK_DEBUG || 'false',
             pageTitle : "Player Registrations",
             pageDescription : "List of players registered to teams in the Stockport League",
             result : rows
         });
      }
    })
};


exports.manage_player_list_clubs_teams = function(req, res) {
  Player.getNamesClubsTeams(req.params, function(err,rows){
    // console.log(rows);
    if (err){
      // console.log("all_player_stats controller error")
      return next(err)
    }
    else {
      var manageTeamObject = {}
      manageTeamObject.teams = [];
      var teamNames = jp.query(rows,"$..teamName").filter((v,i,a)=>a.indexOf(v)==i)
      console.log(teamNames);
      for(let i=0; i < teamNames.length; i++) {
        var nomMen = jp.query(rows,"$..[?(@.teamName=='"+teamNames[i]+"' && @.rank != 99 && @.gender == 'Male')]")
        var nomLadies = jp.query(rows,"$..[?(@.teamName=='"+teamNames[i]+"' && @.rank != 99 && @.gender == 'Female')]")
        var resMen = jp.query(rows,"$..[?(@.teamName=='"+teamNames[i]+"' && @.rank == 99 && @.gender == 'Male')]")
        var resLadies = jp.query(rows,"$..[?(@.teamName=='"+teamNames[i]+"' && @.rank == 99 && @.gender == 'Female')]")
        var teamObject = {
          name:teamNames[i],
          nominated:{
            men:nomMen,
            ladies:nomLadies
          },
          reserves:{
            men:resMen,
            ladies:resLadies
          }
        }
        manageTeamObject.teams.push(teamObject);

      }
      console.log(manageTeamObject);
      res.render('beta/team-admin', {
           static_path: '/static',
           theme: process.env.THEME || 'flatly',
           flask_debug: process.env.FLASK_DEBUG || 'false',
           pageTitle : "Player Registrations",
           pageDescription : "List of players registered to teams in the Stockport League",
           result : manageTeamObject
       });
    }
  })
};

// Return list of players eligible based on team
exports.eligible_players_list = function(req, res) {
    Player.findElgiblePlayersFromTeamId(req.params.id,req.params.gender,function(err,rows){
      res.send(rows);
    })
};

// Display detail page for a specific Player
exports.player_detail = function(req, res) {
  Player.getById(req.params.id,function(err,rows){
    // console.log(rows);
    res.send(rows);
  })
};

exports.all_player_stats = function (req, res,next){
  Player.getPlayerStats(req.params,function(err,result){
    if (err){
      return next(err)
    }
    else {
      res.render('beta/player-stats', {
           static_path: '/static',
           theme: process.env.THEME || 'flatly',
           flask_debug: process.env.FLASK_DEBUG || 'false',
           pageTitle : "Player Stats",
           pageDescription : "Geek out on Stockport League Player stats!",
           result : result
       });
    }
  })
}

exports.all_pair_stats = function (req, res,next){
  Player.getPairStats(req.params,function(err,result){
    if (err){
      return next(err)
    }
    else {
      res.render('beta/pair-stats', {
           static_path: '/static',
           theme: process.env.THEME || 'flatly',
           flask_debug: process.env.FLASK_DEBUG || 'false',
           pageTitle : "Pair Stats",
           pageDescription : "Geek out on Stockport League Player stats!",
           result : result
       });
    }
  })
}

// Display Player create form on GET
exports.player_create_get = function(req, res, next) {
  async.parallel({
    clubs:function(callback){
      Club.getAll(callback);
    },
  }, function(err,results){
    if(err){return next(err)};
    // console.log(results);
    res.render('player_form', { pageTitle: 'Create Player', pageDescription: 'Create a Player', static_path:'/static', theme:'flatly',club_list:results.clubs });
  })

};

// Handle Player create on POST
exports.player_create = function(req,res){
  Player.create(req.body.first_name, req.body.family_name, req.body.team, req.body.club, req.body.gender, function(err,row){
    if (err){
      res.send(err);
    }
    else {
      // console.log(row);
      Player.getPlayerClubandTeamById(row.insertId,function(err,rows){
        if (err){
          res.send(err)
        }
        else{
          res.render('player_form', { pageTitle: 'Create Player', pageDescription: 'Create a Player', static_path:'/static', theme:'flatly',result:req.body, row:rows });
          // console.log(req.body);
          // console.log(rows);
        }
      })

    }
  })

}

exports.player_create_post = function(req, res, next) {

    req.checkBody('first_name', 'First name must be specified.').notEmpty(); //We won't force Alphanumeric, because people might have spaces.
    req.checkBody('family_name', 'Family name must be specified.').notEmpty();
    req.checkBody('family_name', 'Family name must be alphanumeric text.').isAlpha();
    req.checkBody('gender', 'must be Male or Female.').isIn(['Male','Female']);

    req.sanitize('first_name').escape();
    req.sanitize('family_name').escape();
    req.sanitize('first_name').trim();
    req.sanitize('family_name').trim();
    req.sanitize('date_of_registration').toDate();
    req.sanitize('gender').escape();
    req.sanitize('gender').trim();

    var errors = req.validationErrors();


    var player = new Player(
      { first_name: req.body.first_name,
        family_name: req.body.family_name,
        date_of_registration: Date.now(),
        gender: req.body.gender,
        team: req.body.team
       });



    if (errors) {
        res.render('player_form', { title: 'Create Player - Error', static_path:'/static', theme:'flatly', player: player, errors: errors});
    return;
    }
    else {
    // Data from form is valid
        async.waterfall(
          [
            //create new player document
            function(callback){
              player.save(function(err,player){
                callback(err,player);
              })
            },
            //add that player to the specific team.players subdocument.
            function(player,callback){
              Team.findOneAndUpdate(
                {"_id":player.team},
                {"$push":{"players":player._id}},
                function(err,team){
                  callback(err,team);
                }
              )
            }
          ]
          ,function (err,result) {
            if (err) { return next(err); }
               //successful - redirect to new author record.
               res.redirect('/player/'+player._id);
          });
    }

};

exports.player_batch_create = function(req, res){
  Player.createBatch(req.body,function(err,result){
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

exports.player_batch_update = function(req, res){
  Player.updateBulk(req.body,function(err,result){
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

// Display Player delete form on GET
exports.player_delete_get = function(req, res) {
  async.waterfall([
    function(callback){
        Player.findOneAndRemove({'_id':req.params.id},function(err,player){
          callback(err, player);
        })
    },
    function(player,callback){
      Team.findOneAndUpdate({"_id":player.team},
      {"$pull":{"players":player._id}},
      function(err,team){
        callback(err,team);
      }
    )
    }


  ],
function(err, result){
  if(err) {return next(err);}
  res.redirect('/players/All/All/Both');
})

};

// Handle Player delete on POST
exports.player_delete = function(req, res) {
    Player.deleteById(req.params.id,function(err,row){
      // console.log(req.params)
      // console.log(row);
      res.send(row);
    })
};

// Display Player update form on GET
exports.player_update_get = function(req, res) {
    res.send('NOT IMPLEMENTED: Player update GET');
};

// Handle Player update on POST
exports.player_update_post = function(req, res) {
  Player.updateById(req.body.first_name, req.body.family_name, req.body.team, req.body.club, req.body.gender,req.params.id, function(err,row){
    if (err){
      res.send(err);
    }
    // console.log(req.body);
    // console.log(row);
    res.send(row);
  })
};
