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

exports.messer_draw = function(req, res,next) {
  let renderstring = `beta/messer-draw-${req.params.section}`
   //console.log(renderstring)
  res.render(renderstring, {
    static_path: '/static',
    theme: process.env.THEME || 'flatly',
    flask_debug: process.env.FLASK_DEBUG || 'false',
    pageTitle : "Messer Tropy Draws and results",
    pageDescription : "Messer Trophy Draws and results",
    canonical:("https://" + req.get("host") + req.originalUrl).replace("www.'","").replace(".com",".co.uk").replace("-badders.herokuapp","-badminton")
  });
}

exports.new_messer_draw = function(req, res,next) {
  var searchObj = {
    "section":req.params.section.toUpperCase().at(0)
  }
  if (req.params.season !== undefined){
    searchObj.season = req.params.season
  }
  Team.getMesser(searchObj,function(err,rows){
    if(err){
      res.send(err);
      console.log(err)
    }
    else{
      // console.log(rows)
      var otherArray = rows.reduce(function(obj,row){
        // console.log(row)
        let homeTeamAdjHandicap = ''
        let awayTeamAdjHandicap = ''
        let homeHand = ''
        let awayHand = ''
        homeHand = row.homeTeamHandicap.indexOf('H') >= 0 ? 'H' : ''
        awayHand = row.awayTeamHandicap.indexOf('H') >= 0 ? 'H' : ''
        if (homeHand == 'H' && awayHand == 'H'){
          homeHand = ''
          awayHand = ''
        }
        if ((row.homeTeamHandicap.toString().indexOf('-') >= 0)&&(row.awayTeamHandicap.toString().indexOf('-') >= 0)){
           //console.log("both negative")
          if (Math.abs(parseInt(row.homeTeamHandicap)) > Math.abs(parseInt(row.awayTeamHandicap))){
            homeTeamAdjHandicap = Math.round((-21 * (Math.abs(parseInt(row.homeTeamHandicap)) - Math.abs(parseInt(row.awayTeamHandicap))))/(21 + Math.abs(parseInt(row.awayTeamHandicap))))
            // homeTeamAdjHandicap = homeTeamAdjHandicap < 0 ? Math.ceil(homeTeamAdjHandicap) : Math.floor(homeTeamAdjHandicap)
            awayTeamAdjHandicap = 'Scr'
          }
          else if (Math.abs(parseInt(row.homeTeamHandicap)) == Math.abs(parseInt(row.awayTeamHandicap))){
            homeTeamAdjHandicap = 'Scr'
            awayTeamAdjHandicap = 'Scr'
          }
          else {
            awayTeamAdjHandicap = Math.round((-21 * (Math.abs(parseInt(row.awayTeamHandicap)) - Math.abs(parseInt(row.homeTeamHandicap))))/(21 + Math.abs(parseInt(row.homeTeamHandicap))))
            // awayTeamAdjHandicap = awayTeamAdjHandicap < 0 ? Math.ceil(awayTeamAdjHandicap) : Math.floor(awayTeamAdjHandicap)
            homeTeamAdjHandicap = 'Scr'
          }
        }
        else if ((row.homeTeamHandicap.toString().indexOf('+') >= 0)&&(row.awayTeamHandicap.toString().indexOf('+') >= 0)){
           //console.log("both positive")
          if (Math.abs(parseInt(row.homeTeamHandicap)) > Math.abs(parseInt(row.awayTeamHandicap))){
            homeTeamAdjHandicap = Math.round((21 * (Math.abs(parseInt(row.homeTeamHandicap)) - Math.abs(parseInt(row.awayTeamHandicap))))/(21 - Math.abs(parseInt(row.awayTeamHandicap))))
            if (homeTeamAdjHandicap > 0){
              homeTeamAdjHandicap = '+'+homeTeamAdjHandicap
            }
            awayTeamAdjHandicap = 'Scr'
          }
          else if (Math.abs(parseInt(row.homeTeamHandicap)) == Math.abs(parseInt(row.awayTeamHandicap))){
            homeTeamAdjHandicap = 'Scr'
            awayTeamAdjHandicap = 'Scr'
          }
          else {
            awayTeamAdjHandicap = Math.round((21 * (Math.abs(parseInt(row.awayTeamHandicap)) - Math.abs(parseInt(row.homeTeamHandicap))))/(21 - Math.abs(parseInt(row.homeTeamHandicap))))
            if (awayTeamAdjHandicap > 0){
              awayTeamAdjHandicap = '+'+awayTeamAdjHandicap
            }
            // awayTeamAdjHandicap = awayTeamAdjHandicap < 0 ? Math.floor(awayTeamAdjHandicap) : Math.ceil(awayTeamAdjHandicap)
            homeTeamAdjHandicap = 'Scr'
          }
        }
        else {
          homeTeamAdjHandicap = row.homeTeamHandicap.replace('H','')
          awayTeamAdjHandicap = row.awayTeamHandicap.replace('H','')
        }
        // console.log(homeTeamAdjHandicap+homeHand)
        // console.log(awayTeamAdjHandicap+awayHand)
        obj[row.drawPos] = {"homeTeam":row.homeTeamName,"awayTeam":row.awayTeamName,"homeHandicap":row.homeTeamHandicap,"awayHandicap":row.awayTeamHandicap,"homeAdjHandicap":homeTeamAdjHandicap+homeHand,"awayAdjHandicap":awayTeamAdjHandicap+awayHand,"homeScore":row.homeScore,"awayScore":row.awayScore}; 
        return obj;
      }, {});
      
      // console.log(otherArray);
      // var totalRounds = Math.ceil(Math.log(rows.length)/Math.log(2))
      //console.log(JSON.stringify(rows));
      res.render('beta/messer-draw-a-section', {
        static_path: '/static',
        theme: process.env.THEME || 'flatly',
        flask_debug: process.env.FLASK_DEBUG || 'false',
        teams: otherArray,
        section: req.params.section.toUpperCase().at(0),
        pageTitle : "Messer Tropy Draws and results - " + req.params.section.toUpperCase().at(0) + " section" ,
        pageDescription : "Messer Trophy Draws and results",
        canonical:("https://" + req.get("host") + req.originalUrl).replace("www.'","").replace(".com",".co.uk").replace("-badders.herokuapp","-badminton")
      });
    }
  })
}
