var Club = require('../models/club');
var Player = require('../models/players');
var Team = require('../models/teams');
var Venue = require('../models/venue');
var async = require('async');
var jp = require('jsonpath');
const {distance, closest} = require('fastest-levenshtein');
var request = require('request');
var Auth = require('../models/auth.js');
const { read } = require('fs');
const { validationResult } = require('express-validator');
const docx = require("docx");
const fs = require("fs");
const path = require('path');


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
           fullName: req.params.fullName,
           canonical:("https://" + req.get("host") + req.originalUrl).replace("www.'","").replace(".com",".co.uk").replace("-badders.herokuapp","-badminton")
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
             result : rows,
             canonical:("https://" + req.get("host") + req.originalUrl).replace("www.'","").replace(".com",".co.uk").replace("-badders.herokuapp","-badminton")
         });
      }
    })
};

exports.find_closest_matched_player = function(req, res) {
// console.log("received request")
  var searchTerms = {
    "name":req.params.name,
    "gender":req.params.gender
  }
  Player.getNamesClubsTeams(searchTerms, function(err,rows){
    if (err){
      // console.log("all_player_stats controller error")
      return next(err)
    }
    else {
      //console.log(rows);
      var names = jp.query(rows,"$..name")
      var playerID = jp.query(rows,"$..playerID")
      var clubId = jp.query(rows,"$..clubId")
      var clubName = jp.query(rows,"$..clubName")
      //console.log(names);
      var distanceArray = [];
      var nameDistance = []
      for (const [i,name] of names.entries()) {
        distanceArray.push(distance(req.params.name,name))
        //console.log(name + ": " +distance(req.params.name,name))
        var nameDistanceElement = {
          "name":name,
          "distance":distance(req.params.name,name),
          "playerID":playerID[i],
          "clubId":clubId[i],
          "clubName":clubName[i]
        }
        if (nameDistanceElement.distance <= 10){
          nameDistance.push(nameDistanceElement);
        }
      }
      nameDistance.sort((a, b) => a.distance - b.distance);
      // console.log(nameDistance)
      res.send(nameDistance.slice(0,8))
    }
  })
}


exports.manage_player_list_clubs_teams = function(req, res,next) {
  Auth.getManagementAPIKey(function (err,apiKey){
    if (err){
      next(err);
    }
    else{
      var options = {
        method:'GET',
        headers:{
          "Authorization":"Bearer "+apiKey
        },
        url:'https://'+process.env.AUTH0_DOMAIN+'/api/v2/users?q=user_id:'+req.user.id+'&fields=app_metadata,nickname,email'
      }
      //console.log(options);
      request(options,function(err,response,userBody){
        //console.log(options);
        if (err){
          //console.log(err)
          return false
        }
        else{
          var user = JSON.parse(userBody);
          if (user[0].app_metadata.role) {
            if (user[0].app_metadata.role == "superadmin"){
              var superadmin = true;
            }
            else {
              var superadmin = false;
            }
          }
          if (user[0].app_metadata.club) {
            var club = user[0].app_metadata.club;
          }
          else {
            var club = false;
          }
          if (user[0].app_metadata.club == req.params.club || user[0].app_metadata.club == "All"){
            Player.getNamesClubsTeams(req.params, function(err,rows){
              // console.log(rows);
              if (err){
                // console.log("all_player_stats controller error")
                return next(err)
              }
              else if (rows.length < 1){
                return next("no club by that name");
              }
              else {
                
                var manageTeamObject = {}
                manageTeamObject.teams = [];
                var teamNames = jp.query(rows,"$..teamName").filter((v,i,a)=>a.indexOf(v)==i)
                var teamIds = jp.query(rows,"$..teamId").filter((v,i,a)=>a.indexOf(v)==i)
                const table = new docx.Table({
                  rows:[
                    new docx.TableRow({
                      children: [
                          new docx.TableCell({
                              children: [new docx.Paragraph({
                                text: teamNames[0].substring(0,teamNames[0].length-2) + " Registrations",
                                style:"docHeading"
                            })],
                              columnSpan:4
                          })
                      ]
                  })
                  ],
                  margins: {
                    top: docx.convertInchesToTwip(0.05),
                    bottom: docx.convertInchesToTwip(0.05),
                    right: docx.convertInchesToTwip(0.1),
                    left: docx.convertInchesToTwip(0.1),
                  },
                  width:{
                    size:100,
                    type:docx.percentage
                  }});
                // console.log(teamNames);
                for(let i=0; i < teamNames.length; i++) {
                  table.addChildElement(new docx.TableRow({
                    children: [
                        new docx.TableCell({
                            children: [new docx.Paragraph({
                              text: teamNames[i],
                              style:"teamHeading"
                          })],
                            columnSpan:4
                        })
                    ],
                  }))
                  table.addChildElement(new docx.TableRow({
                    children: [
                        new docx.TableCell({
                            children: [new docx.Paragraph({
                              text: "Men",
                              style:"gender"
                          })],
                            columnSpan:2
                        }),
                        new docx.TableCell({
                            children: [new docx.Paragraph({
                              text: "Ladies",
                              style:"gender"
                          })],
                            columnSpan:2
                        }),
                    ],
                  }))
                
                  var nomMen = jp.query(rows,"$..[?(@.teamName=='"+teamNames[i]+"' && @.rank != 99 && @.gender == 'Male')]")
                  var nomLadies = jp.query(rows,"$..[?(@.teamName=='"+teamNames[i]+"' && @.rank != 99 && @.gender == 'Female')]")
                  var resMen = jp.query(rows,"$..[?(@.teamName=='"+teamNames[i]+"' && @.rank == 99 && @.gender == 'Male')]")
                  var resLadies = jp.query(rows,"$..[?(@.teamName=='"+teamNames[i]+"' && @.rank == 99 && @.gender == 'Female')]")
                  let longest = Math.max(nomMen.length + resMen.length,nomLadies.length + resLadies.length);
                  // console.log(nomMen.length + ": " + resMen.length + ": " + nomLadies.length + ": " + resLadies.length + ": " + longest)
                  for(let j=1; j <= longest; j++){
                    var manName = (j > (nomMen.length + resMen.length) ? "" : (j > nomMen.length ? resMen[j - nomMen.length-1].name : nomMen[j-1].name))
                    var menTeamName = teamNames[i].substring(teamNames[i].length - 1)
                    var ladiesTeamName = menTeamName
                    if (j > nomMen.length){
                      menTeamName = "R"
                    }
                    if (j > nomLadies.length){
                      ladiesTeamName = "R"
                    }
                    var ladyName = (j > (nomLadies.length + resLadies.length) ? "" : (j > nomLadies.length ? resLadies[j - nomLadies.length - 1].name : nomLadies[j-1].name))
                    table.addChildElement(new docx.TableRow({
                      children: [
                          new docx.TableCell({
                              children: [new docx.Paragraph(manName)],
                              width:{
                                size:40,
                                type:docx.PERCENTAGE
                              }
                          }),
                          new docx.TableCell({
                              children: [new docx.Paragraph(menTeamName)],
                              width:{
                                size:10,
                                type:docx.PERCENTAGE
                              }
                          }),
                          new docx.TableCell({
                              children: [new docx.Paragraph(ladyName)],
                              width:{
                                size:40,
                                type:docx.PERCENTAGE
                              }
                          }),
                          new docx.TableCell({
                              children: [new docx.Paragraph(ladiesTeamName)],
                              width:{
                                size:10,
                                type:docx.PERCENTAGE
                              }
                          }),
                      ],
                  }))
                  }

                  var teamObject = {
                    name:teamNames[i],
                    id:teamIds[i],
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
                const doc = new docx.Document({
                  title: "Title",
                  sections: [
                      {
                          children: [table],
                      },
                  ],
                  styles:{
                    paragraphStyles:[{
                      name:'Normal',
                      run:{
                        font:"Arial"
                      }
                    },
                    {
                      name:'docHeading',
                      basedOn:"Normal",
                      run:{
                        bold:true,
                        size:30
                      }
                    },
                    {
                      name:'teamHeading',
                      basedOn:"Normal",
                      run:{
                        bold:true,
                        size:24
                      }
                    },
                    {
                      name:'gender',
                      basedOn:"Normal",
                      run:{
                        bold:true
                      }
                    }]
                  }
                });
                
                docx.Packer.toBuffer(doc).then((buffer) => {
                    fs.writeFileSync('static/beta/docs/'+teamNames[0].substring(0,teamNames[0].length-2)+'.docx', buffer);
                });
                // console.log(JSON.stringify(manageTeamObject));
                Club.getAll( function(err,clubsRes){
                  console.log(clubsRes);
                  if (err){
                    // console.log("all_player_stats controller error")
                    return next(err)
                  }
                  else {
                    let clubs = clubsRes.map(row => row.name)
                    res.render('beta/team-admin', {
                        static_path: '/static',
                        theme: process.env.THEME || 'flatly',
                        flask_debug: process.env.FLASK_DEBUG || 'false',
                        pageTitle : "Player Registrations",
                        pageDescription : "List of players registered to teams in the Stockport League",
                        result : manageTeamObject,
                        clubId: rows[0].clubId,
                        superadmin:superadmin,
                        filter:true,
                        hideFilters:["season","gametype","gender","division"],
                        club:club,
                        clubs:clubs,
                        canonical:("https://" + req.get("host") + req.originalUrl).replace("www.'","").replace(".com",".co.uk").replace("-badders.herokuapp","-badminton")
                    });
                  }
                })
              }
            })
          }
          else {
            return next("Sorry you don't have access to this page");
          }
        }
      })
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

exports.old_all_player_stats = function (req, res,next){
  Player.getPlayerStats(req.params,function(err,result){
    if (err){
      return next(err)
    }
    else {
// console.log(req.params);
      let clubs = result.map(item => item.clubName).filter((value, index, self) => self.indexOf(value) === index) 
      let teams = result.map(item => item.teamName).filter((value, index, self) => self.indexOf(value) === index) 
      res.render('beta/player-stats', {
           static_path: '/static',
           theme: process.env.THEME || 'flatly',
           flask_debug: process.env.FLASK_DEBUG || 'false',
           pageTitle : "Player Stats",
           pageDescription : "Geek out on Stockport League Player stats!",
           result : result,
           filter : true,
           hideFilters:[],
           result : result,
           clubs : clubs,
           teams : teams,
           query:searchObj,
           canonical:("https://" + req.get("host") + req.originalUrl).replace("www.'","").replace(".com",".co.uk").replace("-badders.herokuapp","-badminton")
       });
    }
  })
}

exports.all_player_stats = function (req, res,next){
  // console.log(Object.entries(req.params))
  const pattern = /(\bPremier(?!\s|-\d)|Division(?:-|\s))(\d+)/g;
  const replacedMatches = [];
  let divisionString = "All"
  let searchObj = {}
  // console.log(req.params)
  if (Object.entries(req.params).length > 0) {
    var convertedParams = req.params[0].replace('Premier','division-7')
    .replace('Division 1','division-8')
    .replace('Division-1','division-8')
    .replace('Division 2','division-9')
    .replace('Division-2','division-9')
    .replace('Division 3','division-10')
    .replace('Division-3','division-10')
    .replace('season-','')
    .replace(/(\/)(20\d\d20\d\d)/g,'$1season-$2')
    .replace(/(20\d\d20\d\d)/g,'season-$1')
  
    // Finding matches using regex and replacing them
    
    const replacedString = req.params[0].replace(pattern, (match, p1, p2) => {
      let replacedMatch;
      if (p1 === "Premier") {
        replacedMatch = p1;
      } else {
        replacedMatch = `${p1.replace('-', ' ')}${p2}`;
      }
      replacedMatches.push(replacedMatch);
      return replacedMatch;
    });
    var searchArray = convertedParams.split('/')
    searchObj = searchArray.reduce((acc, str) => {
      const [key, value] = str.split("-");
      return { ...acc, [key]: value };
    }, {});
    // console.log(req.session.user)
    if (typeof req.session.user != 'undefined'){
      if (req.user._json["https://my-app.example.com/role"] !== undefined){
        if (req.user._json["https://my-app.example.com/role"] == "admin"){
          if (req.user._json["https://my-app.example.com/club"] != "All" && req.user._json["https://my-app.example.com/club"] !== undefined){
          searchObj.club = req.user._json["https://my-app.example.com/club"]
          }
        }
      }
    }
// console.log(searchObj)
  }
  else {
    searchObj = {}
  }
  
  if (replacedMatches.length > 0){
    divisionString = replacedMatches[0]
  }

  // console.log(regexParams)
  
  Player.newGetPlayerStats(searchObj,function(err,result){
    if (err){
      return next(err)
    }
    else {
// console.log(req.params);
      let clubs = result.map(item => item.clubName).filter((value, index, self) => self.indexOf(value) === index) 
      let teams = result.map(item => item.teamName).filter((value, index, self) => self.indexOf(value) === index) 
      res.render('beta/player-stats', {
           static_path: '/static',
           theme: process.env.THEME || 'flatly',
           flask_debug: process.env.FLASK_DEBUG || 'false',
           pageTitle : "Player Stats",
           pageDescription : "Geek out on Stockport League Player stats!",
           result : result,
           filter : true,
           hideFilters:[],
           result : result,
           clubs : clubs,
           teams : teams,
           query:searchObj,
           canonical:("https://" + req.get("host") + req.originalUrl).replace("www.'","").replace(".com",".co.uk").replace("-badders.herokuapp","-badminton")
       });
    }
  })
}

exports.old_all_pair_stats = function (req, res,next){
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
           result : result,
           canonical:("https://" + req.get("host") + req.originalUrl).replace("www.'","").replace(".com",".co.uk").replace("-badders.herokuapp","-badminton")
       });
    }
  })
}

exports.all_pair_stats = function (req, res,next){
  // console.log(Object.entries(req.params))
  const replacedMatches = [];
  const pattern = /(\bPremier(?!\s|-\d)|Division(?:-|\s))(\d+)/g;
  let searchObj = {}
  //console.log(req.params)
  if (Object.entries(req.params).length > 0) {
    var convertedParams = req.params[0].replace('Premier','division-7')
    .replace('Division 1','division-8')
    .replace('Division-1','division-8')
    .replace('Division 2','division-9')
    .replace('Division-2','division-9')
    .replace('Division 3','division-10')
    .replace('Division-3','division-10')
    .replace('season-','')
    // .replace(/(\/)(20\d\d20\d\d)/g,'$1season-$2')
    .replace(/(20\d\d20\d\d)/g,'season-$1')
    
    // Finding matches using regex and replacing them
    
    const replacedString = req.params[0].replace(pattern, (match, p1, p2) => {
      let replacedMatch;
      if (p1 === "Premier") {
        replacedMatch = p1;
      } else {
        replacedMatch = `${p1.replace('-', ' ')}${p2}`;
      }
      replacedMatches.push(replacedMatch);
      return replacedMatch;
    });
    // console.log(regexParams)
    var searchArray = convertedParams.split('/')
    // console.log(searchArray)
    searchObj = searchArray.reduce((acc, str) => {
      const [key, value] = str.split("-");
      return { ...acc, [key]: value };
    }, {});
    // console.log(searchObj)
    // console.log(req.session.user)
    if (typeof req.session.user != 'undefined'){
      if (req.user._json["https://my-app.example.com/role"] !== undefined){
        if (req.user._json["https://my-app.example.com/role"] == "admin"){
          if (req.user._json["https://my-app.example.com/club"] != "All" && req.user._json["https://my-app.example.com/club"] !== undefined){
          searchObj.club = req.user._json["https://my-app.example.com/club"]
          }
        }
      }
    }
    
  }
  else {
    searchObj = {}
  }
  let divisionString = "All"
  if (replacedMatches.length > 0){
    divisionString = replacedMatches[0]
  }



  
  // console.log(searchObj)
  Player.newGetPairStats(searchObj,function(err,result){
    if (err){
      return next(err)
    }
    else {
       //console.log("rendering this page")
       //console.log(JSON.stringify(req.params))
      let clubs = result.map(item => item.clubName).filter((value, index, self) => self.indexOf(value) === index) 
      let teams = result.map(item => item.teamName).filter((value, index, self) => self.indexOf(value) === index) 
      res.render('beta/pair-stats', {
           static_path: '/static',
           theme: process.env.THEME || 'flatly',
           flask_debug: process.env.FLASK_DEBUG || 'false',
           pageTitle : "Pair Stats",
           pageDescription : "Geek out on Stockport League Player stats!",
           filter:true,
           hideFilters:[],
           clubs:clubs,
           teams:teams,
           result : result,
           query: searchObj,
           canonical:("https://" + req.get("host") + req.originalUrl).replace("www.'","").replace(".com",".co.uk").replace("-badders.herokuapp","-badminton")
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
    res.render('player_form', { pageTitle: 'Create Player', pageDescription: 'Create a Player', static_path:'/static', theme:'flatly',club_list:results.clubs,
      canonical:("https://" + req.get("host") + req.originalUrl).replace("www.'","").replace(".com",".co.uk").replace("-badders.herokuapp","-badminton") });
  })

};

exports.player_create_from_team = function(req,res){
  Player.create(req.body.first_name, req.body.family_name, req.body.team, req.body.club, req.body.gender, function(err,row){
    if (err){
      res.send(err);
    }
    else {
// console.log(row.insertId)
      res.send(row)
    }
  })
}

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
          res.render('player_form', { pageTitle: 'Create Player', pageDescription: 'Create a Player', static_path:'/static', theme:'flatly',result:req.body, row:rows,
            canonical:("https://" + req.get("host") + req.originalUrl).replace("www.'","").replace(".com",".co.uk").replace("-badders.herokuapp","-badminton") });
          // console.log(req.body);
          // console.log(rows);
        }
      })

    }
  })

}

exports.player_create_post = async function(req, res, next) {

    await check('first_name').notEmpty().withMessage('First name must be specified.').run(req); //We won't force Alphanumeric, because people might have spaces.
    await check('family_name').notEmpty().withMessage('Family name must be specified.').run(req);
    await check('family_name').isAlpha().withMessage('Family name must be alphanumeric text.').run(req);
    await check('gender').isIn(['Male','Female']).withMessage('must be Male or Female.').run(req);

    await check('first_name').escape().trim().run(req);
    await check('family_name').escape().trim().run(req);
    await check('date_of_registration').toDate().run(req);
    await check('gender').escape().trim().run(req);

    var errors = validationResult(req);


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
// console.log(err);
    }
    else{
      // console.log(result)
      res.send(result);
    }
  })
}

exports.player_batch_update = function(req, res){
   //console.log("inside player_batch_update")
   //console.log(req.body)
  Player.updateBulk(req.body,function(err,result){
    
    if(err){
      res.send(err);
// console.log(err);
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
exports.player_update_get = function(req, res,next) {
  Player.getById(req.params.id,function(err,result){
    if (err){
      return next(err)
    }
    else {
      
      res.render('player_update_form', {
           static_path: '/static',
           theme: process.env.THEME || 'flatly',
           flask_debug: process.env.FLASK_DEBUG || 'false',
           pageTitle : "Pair Stats",
           pageDescription : "Geek out on Stockport League Player stats!",
           result : result,
           canonical:("https://" + req.get("host") + req.originalUrl).replace("www.'","").replace(".com",".co.uk").replace("-badders.herokuapp","-badminton")
       });
    }
  })
};

// Handle Player update on POST
exports.player_update_post = function(req, res) {
   //console.log("inside player_update_post")
  let patchObj = {
    "tablename":"player",
    "fields":[
        "id","first_name","family_name","gender","playerTel","playerEmail","teamCaptain","clubSecretary","matchSecrertary","treasurer"
    ],
    "data":[[req.params.id,req.body.first_name,req.body.family_name,req.body.gender,req.body.playerTel,req.body.playerEmail, req.body.teamCaptain == 1 ? 1 :0, req.body.clubSecretary == 1 ? 1 :0, req.body.matchSecrertary == 1 ? 1 :0, req.body.treasurer == 1 ? 1 : 0]
  ]
}
 //console.log(patchObj)
  Player.updateBulk(patchObj, function(err,row){
    if (err){
      res.send(err);
    }
    // console.log(req.body);
    // console.log(row);
    res.redirect(`/player/${req.params.id}/update`);
  })
};
