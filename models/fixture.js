var db = require('../db_connect.js');
var request = require('request');

 var logger = require('logzio-nodejs').createLogger({
  token: process.env.LOGZ_SECRET,
  host: 'listener-uk.logz.io'
 });

 var SEASON = '';
    if (new Date().getMonth() < 6){
      SEASON = '' + new Date().getFullYear()-1 +''+ new Date().getFullYear();
    }
    else {
      SEASON = '' + new Date().getFullYear() +''+ (new Date().getFullYear()+1);
    }

// POST
exports.create = function(fixtureObj,done){
  if (db.isObject(fixtureObj)){
    var sql = 'INSERT INTO `fixture` (';
    var updateArray = [];
    var updateArrayVars = [];
    var updateArrayValues = []
    for (x in fixtureObj){
      // console.log(fixtureObj[x]);
      updateArray.push('`'+ x +'`');
      updateArrayVars.push(fixtureObj[x]);
      updateArrayValues.push('?');
    }
    var updateVars = updateArray.join(',');
    var updateValues = updateArrayValues.join(',');
    // console.log(updateVars);
    sql = sql + updateVars + ') VALUES (' + updateValues + ')';
    // console.log(sql);
    db.get().query(sql,updateArrayVars,function(err,result){
      console.log(this.sql)
      if (err) return done(err);
      done(null,result);
    });
  }
  else {
    return done(err);
  }
}

exports.getScorecardById = function(fixtureId,done){
  db.get().query('SELECT * FROM `scorecardstore` WHERE `id` = ?',fixtureId, function (err, rows){
    console.log(this.sql);
    if (err) return done(err);
    done(null,rows);
  })
}

exports.deleteScorecardById = function(fixtureId,done){
  db.get().query('DELETE FROM `scorecard` WHERE `id` = ?',fixtureId, function (err, rows){
    if (err) return done(err);
    done(null,rows);
  })
}

exports.createScorecard = function(fixtureObj,done){
  if (db.isObject(fixtureObj)){
    var sql = 'INSERT INTO `scorecardstore` (';
    var updateArray = [];
    var updateArrayVars = [];
    var updateArrayValues = []
    for (x in fixtureObj){
      // console.log(fixtureObj[x]);
      updateArray.push('`'+ x +'`');
      updateArrayVars.push(fixtureObj[x]);
      updateArrayValues.push('?');
    }
    var updateVars = updateArray.join(',');
    var updateValues = updateArrayValues.join(',');
    // console.log(updateVars);
    sql = sql + updateVars + ') VALUES (' + updateValues + ')';
    // console.log(sql);
    db.get().query(sql,updateArrayVars,function(err,result){
      console.log(this.sql)
      if (err) return done(err);
      done(null,result);
    });
  }
  else {
    return done(err);
  }
}

exports.createBatch = function(BatchObj,done){
  if(db.isObject(BatchObj)){
    var fields = BatchObj.fields.join("`,`");
    var sql = 'INSERT INTO `'+BatchObj.tablename+'` (`'+fields+'`) VALUES ';
    // console.log(sql);
    var containerArray = [];
    var updateArray = [];
    var updateValuesString = '';
    for (x in BatchObj.data){
      updateArray = [];
      for (y in BatchObj.data[x]){
        updateArray.push(BatchObj.data[x][y]);
      }
      updateValuesString = '("'+updateArray.join('","')+'")'
      containerArray.push(updateValuesString)
    }
    // console.log(containerArray);
    sql = sql + containerArray.join(',')
    // console.log(sql);
    db.get().query(sql,function(err,result){
      if (err) return done(err);
      done(null,result)
    })
  }
  else{
    return done('not object');
  }
}

exports.getMatchPlayerOrderDetails = function(fixtureObj,done){
  var searchTerms = [];
  var sqlArray = []
  var seasonName = ''
  if (!fixtureObj.club){
    console.log("no club name");
  }
  else {
    searchTerms.push('c.name = ?');
    sqlArray.push(fixtureObj.club);
  }
  if (!fixtureObj.team){
    console.log("no team name");
  }
  else {
    searchTerms.push('c.teamName = ?');
    sqlArray.push(fixtureObj.team);
  }
  if (!fixtureObj.season || fixtureObj.season == SEASON){
    console.log("no season");
    searchTerms.push('season.name = ? AND c.date > season.startDate AND c.date < season.endDate');
    sqlArray.push(SEASON);
  }
  else {
    searchTerms.push('season.name = ? AND c.date > season.startDate AND c.date < season.endDate');
    sqlArray.push(fixtureObj.season);
    seasonName = fixtureObj.season
  }
  console.log(searchTerms)

  if (searchTerms.length > 0) {
    var conditions = searchTerms.join(' AND ');
    conditions = ' join season WHERE ' + conditions;
  }
  if (!fixtureObj.limit){
    var limit = "";
  }
  else {
    var limit = " limit "+ fixtureObj.limit
  }

  db.get().query("SELECT c.* FROM (SELECT fixturePlayers.*, club"+seasonName+".name FROM (SELECT playerNames.id, playerNames.date, homeTeam.name as teamName, homeTeam.id as teamId, homeTeam.club as clubId, awayTeam.name as oppositionName, playerNames.Man1, playerNames.Man1Rank, Man1Team.name as Man1TeamName, playerNames.Man2, playerNames.Man2Rank, Man2Team.name as Man2TeamName, playerNames.Man3, playerNames.Man3Rank, Man3Team.name as Man3TeamName, playerNames.Lady1, playerNames.Lady1Rank, Lady1Team.name as Lady1TeamName, playerNames.Lady2, playerNames.Lady2Rank, Lady2Team.name as Lady2TeamName, playerNames.Lady3, playerNames.Lady3Rank, Lady3Team.name as Lady3TeamName FROM (SELECT fixture.id, fixture.date, fixture.homeTeam AS Team, fixture.awayTeam AS Opposition, CONCAT(homeMan1.first_name, ' ', homeMan1.family_name) AS Man1, homeMan1.rank AS Man1Rank, homeMan1.team AS Man1TeamId, CONCAT(homeMan2.first_name, ' ', homeMan2.family_name) AS Man2, homeMan2.rank AS Man2Rank, homeMan2.team AS Man2TeamId, CONCAT(homeMan3.first_name, ' ', homeMan3.family_name) AS Man3, homeMan3.rank AS Man3Rank, homeMan3.team AS Man3TeamId, CONCAT(homeLady1.first_name, ' ', homeLady1.family_name) AS Lady1, homeLady1.rank AS Lady1Rank, homeLady1.team AS Lady1TeamId, CONCAT(homeLady2.first_name, ' ', homeLady2.family_name) AS Lady2, homeLady2.rank AS Lady2Rank, homeLady2.team AS Lady2TeamId, CONCAT(homeLady3.first_name, ' ', homeLady3.family_name) AS Lady3, homeLady3.rank AS Lady3Rank, homeLady3.team AS Lady3TeamId FROM fixture JOIN player homeMan1 ON fixture.homeMan1 = homeMan1.id JOIN player homeMan2 ON fixture.homeMan2 = homeMan2.id JOIN player homeMan3 ON fixture.homeMan3 = homeMan3.id JOIN player homeLady1 ON fixture.homeLady1 = homeLady1.id JOIN player homeLady2 ON fixture.homeLady2 = homeLady2.id JOIN player homeLady3 ON fixture.homeLady3 = homeLady3.id UNION ALL SELECT fixture.id, fixture.date, fixture.awayTeam AS Team, fixture.homeTeam AS Opposition, CONCAT(awayMan1.first_name, ' ', awayMan1.family_name) AS Man1, awayMan1.rank AS Man1Rank, awayMan1.team AS Man1TeamId, CONCAT(awayMan2.first_name, ' ', awayMan2.family_name) AS Man2, awayMan2.rank AS Man2Rank, awayMan2.team AS Man2TeamId, CONCAT(awayMan3.first_name, ' ', awayMan3.family_name) AS Man3, awayMan3.rank AS Man3Rank, awayMan3.team AS Man3TeamId, CONCAT(awayLady1.first_name, ' ', awayLady1.family_name) AS Lady1, awayLady1.rank AS Lady1Rank, awayLady1.team AS Lady1TeamId, CONCAT(awayLady2.first_name, ' ', awayLady2.family_name) AS Lady2, awayLady2.rank AS Lady2Rank, awayLady2.team AS Lady2TeamId, CONCAT(awayLady3.first_name, ' ', awayLady3.family_name) AS Lady3, awayLady3.rank AS Lady3Rank, awayLady3.team AS Lady3TeamId FROM fixture JOIN player awayMan1 ON fixture.awayMan1 = awayMan1.id JOIN player awayMan2 ON fixture.awayMan2 = awayMan2.id JOIN player awayMan3 ON fixture.awayMan3 = awayMan3.id JOIN player awayLady1 ON fixture.awayLady1 = awayLady1.id JOIN player awayLady2 ON fixture.awayLady2 = awayLady2.id JOIN player awayLady3 ON fixture.awayLady3 = awayLady3.id) AS playerNames JOIN team"+seasonName+" homeTeam ON playerNames.Team = homeTeam.id JOIN team"+seasonName+" awayTeam ON playerNames.Opposition = awayTeam.id join team"+seasonName+" Man1Team on playerNames.Man1TeamID = Man1Team.id join team"+seasonName+" Man2Team on playerNames.Man2TeamID = Man2Team.id join team"+seasonName+" Man3Team on playerNames.Man3TeamID = Man3Team.id join team"+seasonName+" Lady1Team on playerNames.Lady1TeamID = Lady1Team.id join team"+seasonName+" Lady2Team on playerNames.Lady2TeamID = Lady2Team.id join team"+seasonName+" Lady3Team on playerNames.Lady3TeamID = Lady3Team.id) AS fixturePlayers JOIN club"+seasonName+" ON club"+seasonName+".id = clubId) AS c "+conditions+" ORDER BY teamName , date DESC"+limit,sqlArray,function(err,rows){
     logger.log(this.sql)
    console.log(this.sql)
    if (err) {
      console.log(err);
      return done(err);
    }
    else {
      // console.log(rows);
      done(null,rows);
    }
  })
}

// GET
exports.getAll = function(done){
  db.get().query('select fixture.* from fixture join season where season.id = 2 and fixture.date > season.startDate and fixture.date < season.endDate', function (err, rows){
    if (err) return done(err);
    done(null, rows);
  })
}

exports.getRecent = function(done){
  othersql = "SELECT a.date, a.homeTeam, team.name AS awayTeam, a.address, a.venueName, a.mapLink, a.Lat, a.Lng, a.homeScore, a.awayScore FROM (SELECT fixture.date, team.name AS homeTeam, venue.address as address, venue.name as venueName, venue.gMapUrl as mapLink, venue.Lat, venue.Lng, fixture.homeScore, fixture.awayScore, fixture.awayTeam FROM fixture JOIN team on fixture.homeTeam = team.id join venue on team.venue = venue.id) AS a JOIN team WHERE a.awayTeam = team.id AND homeScore IS NOT NULL AND date BETWEEN ADDDATE(NOW(), - 7) AND NOW() ORDER BY date; ;";
  db.get().query(othersql,function(err,result){
     logger.log(this.sql)
    if (err) {
      console.log(err);
      return done(err);
    }
    else {
      
      // console.log(result);
      done(null,result);
    }
  })
}

exports.getOutstandingResults = function(done){
  db.get().query("SELECT a.id, a.date, a.homeTeam, a.homeTeamId, team.name AS awayTeam, team.id AS awayTeamId, a.homeScore, a.awayScore FROM (SELECT fixture.id, fixture.date, team.name AS homeTeam, team.id AS homeTeamId, fixture.homeScore, fixture.awayScore, fixture.awayTeam FROM fixture JOIN team WHERE fixture.homeTeam = team.id AND fixture.status NOT IN ('rearranged' , 'rearranging')) AS a JOIN team WHERE a.awayTeam = team.id AND homeScore IS NULL AND date BETWEEN ADDDATE(NOW(), - 7) AND ADDDATE(NOW(), 1) ORDER BY date", function (err, rows){
    if (err) return done(err);
    done(null, rows);
  })
}




exports.getCardsDueToday = function(done){
  othersql = "select fixId, date, status, homeTeam, team.name as awayTeam, homeScore, awayScore from  (select fixture.id as fixId, fixture.date, fixture.status, team.name as homeTeam, fixture.homeScore, fixture.awayScore, fixture.awayTeam from fixture join team where fixture.homeTeam = team.id AND fixture.status not in ('rearranged','rearranging')) as a join team where a.awayTeam = team.id AND homeScore is null AND date between adddate(now(),-7) and adddate(now(),-6) order by date";
  db.get().query(othersql,function(err,result){
    if (err) {
      console.log(err);
      return done(err);
    }
    else {
      // console.log(result);
      done(null,result);
    }
  })
}

exports.getupComing = function(done){
  db.get().query("SELECT a.fixId, a.date, a.status, a.homeTeam, a.homeTeamId, a.address, a.venueName, a.mapLink, a.Lat, a.Lng, team.id AS awayTeamId, team.name AS awayTeam, a.homeScore, a.awayScore FROM (SELECT fixture.id AS fixId, fixture.date, fixture.status, team.id AS homeTeamId, team.name AS homeTeam, venue.address as address, venue.name as venueName, venue.gMapUrl as mapLink, venue.Lat, venue.Lng, fixture.homeScore, fixture.awayScore, fixture.awayTeam FROM fixture JOIN team on fixture.homeTeam = team.id join venue on team.venue = venue.id ) AS a JOIN team WHERE a.awayTeam = team.id AND homeScore IS NULL AND status NOT IN ('rearranged' , 'rearranging') AND date BETWEEN ADDDATE(NOW(), - 1) AND ADDDATE(NOW(), 7) ORDER BY date",function(err,result){
    if (err) {
      console.log(err);
      return done(err);
    }
    else {
      // console.log(result);
      done(null,result);
    }
  })
}

exports.getClubFixtureDetails = function(fixtureObj, done){
  var searchTerms = [];
  var sqlArray = []
  var seasonName = ''
  var clubSeasonName = ''
  if (!fixtureObj.club){
    console.log("no club name");
  }
  else {
    searchTerms.push('(e.homeClubName = ? OR e.awayClubName = ?)');
    sqlArray.push(fixtureObj.club);
    sqlArray.push(fixtureObj.club);
  }
  if (!fixtureObj.team){
    console.log("no team name");
  }
  else {
    searchTerms.push('(e.homeTeam = ? OR e.awayTeam = ?)');
    sqlArray.push(fixtureObj.team);
    sqlArray.push(fixtureObj.team);
  }
  if (!fixtureObj.division){
    console.log("no division name");
  }
  else {
    searchTerms.push('division = ?');
    sqlArray.push(fixtureObj.division);
  }
  if (!fixtureObj.season){
    console.log("no season");
    searchTerms.push('season.name = ? AND e.date > season.startDate AND e.date < season.endDate');
    sqlArray.push(SEASON);
  }
  else {
    searchTerms.push('season.name = ? AND e.date > season.startDate AND e.date < season.endDate');
    sqlArray.push(fixtureObj.season);
    seasonName = fixtureObj.season + ' as team'
    clubSeasonName = fixtureObj.season + ' as club'
  }
  console.log(searchTerms)

  if (searchTerms.length > 0) {
    var conditions = searchTerms.join(' AND ');
    conditions = ' WHERE ' + conditions;
    // console.log(conditions);
  }
  /* if (fixtureObj.season === undefined){
    var seasonName = ''
    fixtureObj.season = SEASON
  }
  else {
    var seasonName = season + ' as team'
  } */

  db.get().query('select e.* from ( SELECT d.*, division.name as divisionName FROM ( SELECT c.*, club.name AS awayClubName FROM (SELECT b.*, club.name AS homeClubName FROM (SELECT a.*, team.name AS awayTeam, team.club AS awayClub, team.division FROM (SELECT team.name AS homeTeam, team.id as homeTeamId, team.club AS homeClub, fixture.id AS fixtureId, fixture.date AS date, fixture.awayTeam AS awayTeamId, fixture.status, fixture.homeScore, fixture.awayScore FROM fixture JOIN team'+seasonName+' WHERE team.id = fixture.homeTeam) AS a JOIN team'+seasonName+' WHERE team.id = a.awayTeamId) AS b JOIN club'+clubSeasonName+' WHERE club.id = b.homeClub) AS c JOIN club'+clubSeasonName+' WHERE club.id = c.awayClub) AS d join division on division.id = d.division) as e JOIN season'+ conditions +' ORDER BY e.date',sqlArray, function (err, result){
      console.log(this.sql)
      if (err) {
        //console.log(this.sql)
        return done(err);
      }
      done(null, result);
    })
  
}

exports.getFixtureDetails = function(searchObj, done){
  const filterArray = ['season','division','club','team']
  console.log("passed to getFixtureDetails")
  console.log(searchObj)
  let fixtureObj = {}
  let searchTerms = [];
  let sqlArray = []
  let titleString = ""
  if (searchObj !== undefined){
    for (filter of filterArray){
      //console.log(filter)
      //console.log(Object.entries(searchObj))
      let sqlParams = Object.entries(searchObj).filter(obj => obj[0] === filter)
      if (sqlParams.length > 0){
        fixtureObj[filter] = sqlParams[0][1]
        titleString += sqlParams[0][1]
        //console.log(sqlParams)
      }
    }
    
  }
  
  let season = ""
  let seasonString = SEASON
  let whereTerms = ""
  searchArray = []
  const checkSeason = function(season){
    let firstYear = parseInt(season.slice(0,4))
    let secondYear = parseInt(season.slice(4))
    console.log(firstYear+ " "+ secondYear)
    if (secondYear - firstYear != 1){
      return false
    }
    else {
      if (firstYear < 2012 || season == SEASON){
        return false
      }
      else return true
    }
  }
  if (fixtureObj.season === undefined || !checkSeason(fixtureObj.season)){
    sqlArray.push(SEASON)
  }
  else {
    season = fixtureObj.season
    seasonString = fixtureObj.season
    sqlArray.push(fixtureObj.season)
  }
  if (fixtureObj.division !== undefined){
    searchTerms.push('homeTeam.division = ?')
    sqlArray.push(fixtureObj.division)
  }
  if (fixtureObj.club !== undefined){
    searchTerms.push('(homeClub.name = ? OR awayClub.name = ?)')
    sqlArray.push(fixtureObj.club)
    sqlArray.push(fixtureObj.club)
  }
  if (fixtureObj.team !== undefined){
    searchTerms.push('(homeTeam.name = ? OR awayTeam.name = ?)')
    sqlArray.push(fixtureObj.team)
    sqlArray.push(fixtureObj.team)
  }
  if (sqlArray.length > 1){
    whereTerms = " AND " + searchTerms.join(" AND ")
  }
  else {
    whereTerms = ""
  }
  //console.log(fixtureObj)
  

  
    db.get().query("select fixture.id, fixture.date, homeTeam.name as homeTeam, homeClub.name as homeClub, awayTeam.name as awayTeam, awayClub.name as awayClub, homeTeam.division as division, venue.address as venueName, venue.gMapUrl as venueLink, fixture.status, fixture.homeScore, fixture.awayScore from fixture join team"+season+" homeTeam on fixture.homeTeam = homeTeam.id join club"+season+" homeClub on homeTeam.club = homeClub.id join venue ON homeTeam.venue = venue.id join team"+season+" awayTeam on fixture.awayTeam = awayTeam.id join club"+season+" awayClub on awayTeam.club = awayClub.id join season on (fixture.date > season.startDate and fixture.date < season.endDate ) where fixture.status in ('complete','outstanding','rearranging','rearranged','conceded') AND season.name = ?"+whereTerms,sqlArray, function (err, result){
      // console.log(this.sql)
      if (err) {
        console.log(this.sql)
        // logger.log(this.sql)
        return done(err);
      }
      // result.push({"id":99999,"date":"2023-11-11T23:00:00.000Z","homeTeam":"Open Tournament","homeClub":"No Club","awayTeam":"@ Seal Road","awayClub":"No Club","division":7,"venueName":"Bramhall Recreation Centre, Seal Road, Bramhall, SK7 2JR","venueLink":"https://goo.gl/maps/yeggUEJj3n42","status":"completed","homeScore":null,"awayScore":null})
      // result.push({"id":99999,"date":"2023-11-18T23:00:00.000Z","homeTeam":"Open Tournament","homeClub":"No Club","awayTeam":"@ Seal Road","awayClub":"No Club","division":7,"venueName":"Bramhall Recreation Centre, Seal Road, Bramhall, SK7 2JR","venueLink":"https://goo.gl/maps/yeggUEJj3n42","status":"completed","homeScore":null,"awayScore":null})
      result.push({"id":99999,"date":"2024-03-02T23:00:00.000Z","homeTeam":"Handicap Tournament","homeClub":"No Club","awayTeam":"@ Didsbury High School","awayClub":"No Club","division":7,"venueName":"Didsbury High School, 4 The Avenue, Manchester, M20 2ET","venueLink":"https://maps.app.goo.gl/RPR5LdJkCoRXQBPR8","status":"outstanding","homeScore":null,"awayScore":null})
      result.push({"id":99999,"date":"2024-03-09T23:00:00.000Z","homeTeam":"Handicap Tournament","homeClub":"No Club","awayTeam":"@ Didsbury High School","awayClub":"No Club","division":7,"venueName":"Didsbury High School, 4 The Avenue, Manchester, M20 2ET","venueLink":"https://maps.app.goo.gl/RPR5LdJkCoRXQBPR8","status":"outstanding","homeScore":null,"awayScore":null})
      result.push({"id":99999,"date":"2024-04-17T23:00:00.000Z","homeTeam":"Messer Section Finals","homeClub":"No Club","awayTeam":"@ Everybody Sports Centre, Alderley Park","awayClub":"No Club","division":7,"venueName":"Everybody Sports Centre, Alderley Park, Congleton Rd, Macclesfield SK10 4TG","venueLink":"https://maps.app.goo.gl/m9oWy4aJG8Zatww98","status":"outstanding","homeScore":null,"awayScore":null})
      result.push({"id":99999,"date":"2024-04-24T23:00:00.000Z","homeTeam":"Messer Section Finals","homeClub":"No Club","awayTeam":"@ Everybody Sports Centre, Alderley Park","awayClub":"No Club","division":7,"venueName":"Everybody Sports Centre, Alderley Park, Congleton Rd, Macclesfield SK10 4TG","venueLink":"https://maps.app.goo.gl/m9oWy4aJG8Zatww98","status":"outstanding","homeScore":null,"awayScore":null})
      result.push({"id":99999,"date":"2024-05-01T23:00:00.000Z","homeTeam":"Messer Finals","homeClub":"No Club","awayTeam":"@ Everybody Sports Centre, Alderley Park","awayClub":"No Club","division":7,"venueName":"Everybody Sports Centre, Alderley Park, Congleton Rd, Macclesfield SK10 4TG","venueLink":"https://maps.app.goo.gl/m9oWy4aJG8Zatww98","status":"outstanding","homeScore":null,"awayScore":null})
      // console.log(result)
      done(null, result);
    })
  }

exports.getFixtureDetailsById = function(fixtureId,done){
  db.get().query('Select a.fixtureId, a.date, a.homeTeam,  team.name as awayTeam, a.status, a.homeScore, a.awayScore from (select team.name as homeTeam, fixture.id as fixtureId, fixture.date as date, fixture.awayTeam, fixture.status, fixture.homeScore,fixture.awayScore from  fixture join team where team.id = fixture.homeTeam) as a join team where team.id = a.awayTeam AND fixtureId = ? ',fixtureId,function(err,rows){
    if (err) return done(err);
    done(null,rows)
  })
}

exports.getScorecardDataById = function(fixtureId,done){
  db.get().query("select date, homeTeam, awayTeam, concat(homePlayer1.first_name, ' ', homePlayer1.family_name) as homePlayer1, concat(homePlayer2.first_name, ' ', homePlayer2.family_name) as homePlayer2, concat(awayPlayer1.first_name, ' ', awayPlayer1.family_name) as awayPlayer1, concat(awayPlayer2.first_name, ' ', awayPlayer2.family_name) as awayPlayer2, homeScore, awayScore, totalHomeScore, totalAwayScore from (SELECT date, homeTeam.name as homeTeam, awayTeam.name as awayTeam, homePlayer1, homePlayer2, awayPlayer1, awayPlayer2, homeScore, awayScore, totalHomeScore, totalAwayScore FROM (SELECT fixture.date, fixture.homeTeam, fixture.awayTeam, fixture.homeScore as totalHomeScore, fixture.awayScore as totalAwayScore, thisGame.homePlayer1, thisGame.homePlayer2, thisGame.awayPlayer1, thisGame.awayPlayer2, thisGame.homeScore, thisGame.awayScore FROM (SELECT * FROM game WHERE fixture = ?) AS thisGame JOIN fixture WHERE fixture.id = thisGame.fixture) as thisFixture JOIN team homeTeam ON thisFixture.homeTeam = homeTeam.id JOIN team awayTeam ON thisFixture.awayTeam = awayTeam.id) as teamFixture JOIN player homePlayer1 ON teamFixture.homePlayer1 = homePlayer1.id JOIN player homePlayer2 ON teamFixture.homePlayer2 = homePlayer2.id JOIN player awayPlayer1 ON teamFixture.awayPlayer1 = awayPlayer1.id JOIN player awayPlayer2 ON teamFixture.awayPlayer2 = awayPlayer2.id",fixtureId,function(err,rows){
    if (err) return done(err);
    done(null,rows)
  })
}


// GET
exports.getById = function(fixtureId,done){
  db.get().query('SELECT * FROM `fixture` WHERE `id` = ?',fixtureId, function (err, rows){
    if (err) return done(err);
    done(null,rows);
  })
}

// DELETE
exports.deleteById = function(fixtureId,done){
  db.get().query('DELETE FROM `fixture` WHERE `id` = ?',fixtureId, function (err, rows){
    if (err) return done(err);
    done(null,rows);
  })
}

exports.getFixtureIdFromTeamNames = function(obj,done){
  if(db.isObject(obj)){
    var sql = 'SELECT status, fixtureId, homeTeamName, team.name AS awayTeamName, homeTeamId, team.id AS awayTeamId FROM (SELECT status, fixtureId, team.name AS homeTeamName, team.id AS homeTeamId, homeTeam, awayTeam FROM (SELECT fixture.status, fixture.id AS fixtureId, fixture.homeTeam, fixture.awayTeam FROM fixture JOIN season WHERE season.id = 2 AND fixture.date > season.startDate) AS a JOIN team WHERE team.id = a.homeTeam AND team.name = ?) AS b JOIN team WHERE awayTeam = team.id AND team.name = ? AND status != "rearranged"';
    db.get().query(sql,[obj.homeTeam, obj.awayTeam],function(err,result){
      if (err){
        return done(err)
      }
      else {
        done(null,result);
      }
    })
  }
  else {
    return done(err);
  }
}

exports.getFixtureId = function(obj,done){
  if(db.isObject(obj)){
    var sql = 'select id from (select fixture.id, homeTeam, awayTeam from fixture join season where season.name=? AND fixture.date > season.startDate) as a where awayTeam = ? AND homeTeam = ?';
    // console.log(obj);
    db.get().query(sql,[SEASON,obj.awayTeam, obj.homeTeam],function(err,result){
      console.log(this.sql);
      if (err){
        return done(err)
      }
      else {
        // console.log(result);
        done(null,result);
      }
    })
  }
  else {
    return done(err);
  }
}



exports.getOutstandingFixtureId = function(obj,done){
  if(db.isObject(obj)){
    // var sql = 'select id from (select fixture.id, homeTeam, awayTeam, status from fixture join season where season.name=? AND fixture.date > season.startDate) as a where awayTeam = ? AND homeTeam = ? AND status = "outstanding"';
    var sql = 'select a.id, division.name from (SELECT id, homeTeam FROM (SELECT fixture.id, homeTeam, awayTeam, status FROM fixture JOIN season WHERE season.name = ? AND fixture.date > season.startDate) AS a WHERE awayTeam = ? AND homeTeam = ? AND status = "outstanding") as a join team on a.homeTeam = team.id join division on team.division = division.id';
    // console.log(obj);
    db.get().query(sql,[SEASON,obj.awayTeam, obj.homeTeam],function(err,result){
      console.log(this.sql);
      if (err){
        return done(err)
      }
      else if (!result.length){
        return done("no matching fixtures")
      }
      else if (!result[0].id){
        return done("no matching fixtures")
      }
      else {
        // console.log(result);
        done(null,result);
      }
    })
  }
  else {
    return done(err);
  }
}

exports.rearrangeByTeamNames = function(updateObj,done){
  if(db.isObject(updateObj)){
    if (updateObj.date == null || updateObj.date == ""){
      var sql = 'UPDATE fixture SET status = "rearranging" WHERE id = (SELECT b.id FROM (SELECT a.id, a.homeTeam, a.awayTeam, a.awayTeamName, team.name AS HomeTeamName FROM (SELECT c.id, c.homeTeam, c.awayTeam, team.name AS awayTeamName FROM (SELECT fixture.id, fixture.homeTeam, fixture.awayTeam FROM fixture JOIN season WHERE season.name = '+SEASON+' AND fixture.date > season.startDate) AS c JOIN team WHERE c.awayTeam = team.id) AS a JOIN team WHERE a.homeTeam = team.id) AS b WHERE (b.awayTeamName = ? AND b.homeTeamName = ?) order by id desc limit 0,1);'
      var sqlArray = [updateObj.awayTeam,updateObj.homeTeam]
    }
    else {
      var sqlArray = [updateObj.awayTeam,updateObj.homeTeam,updateObj.homeTeam,updateObj.awayTeam,updateObj.date]
      var sql = 'UPDATE fixture SET status = "rearranged" WHERE id = (SELECT b.id FROM (SELECT a.id, a.homeTeam, a.awayTeam, a.awayTeamName, team.name AS HomeTeamName FROM (SELECT c.id, c.homeTeam, c.awayTeam, team.name AS awayTeamName FROM (SELECT fixture.id, fixture.homeTeam, fixture.awayTeam FROM fixture JOIN season WHERE season.name = '+SEASON+' AND fixture.date > season.startDate) AS c JOIN team WHERE c.awayTeam = team.id) AS a JOIN team WHERE a.homeTeam = team.id) AS b WHERE (b.awayTeamName = ? AND b.homeTeamName = ?) order by id desc limit 0,1); INSERT INTO fixture (`id`, `homeTeam`, `awayTeam`, `date`, `status`) VALUES (NULL, (Select id from team where name = ?), (SELECT id from team where name = ?), ?, "outstanding");'
    }

    db.get().query(sql,sqlArray,function(err,result,fields){
      console.log(this.sql)
      if (err) {
        return done(err);
      }
      else{
        done(null,result);
      }
    })
  }
  else {
    return done(err);
  }
}

exports.updateByTeamNames = function(updateObj,done){
  if(db.isObject(updateObj)){
    var sql = 'update fixture set homeScore = ?, awayScore = ? Where id = (Select b.id from (Select a.id, a.homeTeam, a.awayTeam, a.awayTeamName, team.name as HomeTeamName from (SELECT fixture.id, fixture.homeTeam, fixture.awayTeam, team.name as awayTeamName  FROM fixture JOIN team WHERE fixture.awayTeam = team.id) as a Join team where a.homeTeam = team.id) as b Where (b.awayTeamName = ? AND b.homeTeamName = ?))'

    db.get().query(sql,[updateObj.homeScore,updateObj.awayScore,updateObj.awayTeam,updateObj.homeTeam],function(error,result,fields){
      if (error) {
        return done(error);
      }
      else{
        // console.log(result);
        if(result['affectedRows'] == 1 && result['changedRows'] ==1) {
          var options = {
            method:'POST',
            url:'https://hook.integromat.com/uihmc7g54i8xrvdvpsec2f6ejfqul70g',
            headers:{
              'content-type':'application/json'
            },
            body:{
              "message" : "Result: "+updateObj.homeTeam+" vs "+updateObj.awayTeam+" : "+updateObj.homeScore+"-"+updateObj.awayScore+" ##stockport #sdbl #result https://stockport-co.uk"
            },
            json:true
          };
          request(options,function(err,res,body){
            if(err){
              return done(err);
            }
            else {
              return done(null,result)
            }

          })
        }
        else {
          return done("nothing updated - teams probably didn't match up or the result was already entered ");
        }
      }
    })
  }
  else {
    console.log("updateObj is not an object")
    return done("updateObj is not an object");
  }
}

exports.sendResultZap = function(zapObject,done){
  if (db.isObject(zapObject) && (zapObject.host !== '127.0.0.1:3000' || typeof zapObject.host === 'undefined')){
    var options = {
      method:'POST',
      url:'https://hook.integromat.com/uihmc7g54i8xrvdvpsec2f6ejfqul70g',
      headers:{
        'content-type':'application/json'
      },
      body:{
        "message" : "Result: "+zapObject.homeTeam+" vs "+zapObject.awayTeam+" : "+zapObject.homeScore+"-"+zapObject.awayScore+" #stockport #badminton #sdbl #result #bulutangkis #badminton🏸 #badmintonclub https://stockport-badminton.co.uk",
        "imgUrl":"http://stockport-badminton.co.uk/static/beta/images/generated/"+ zapObject.homeTeam.replace(/([\s]{1,})/g,'-') + zapObject.awayTeam.replace(/([\s]{1,})/g,'-') +".jpg"
      },
      json:true
    };
    request(options,function(err,res,body){
      if(err){
        // console.log(err)
        return done(err);
      }
      else { 
          // console.log(body); 
          const { createCanvas, loadImage } = require('canvas')
          const canvas = createCanvas(1080, 1350)
          const ctx = canvas.getContext('2d')
          console.log(zapObject);
          baseImages = ['social.png','social2.jpg','social3.jpg','social3.jpg']
          loadImage('static/beta/images/bg/social-'+zapObject.division.replace(/([\s]{1,})/g,'-')+'.png').then((image) => {
            ctx.drawImage(image, 0,0,1080, 1350)
            ctx.font = 'bold 60px Arial'
            ctx.fillStyle = 'White'
            ctx.textAlign = 'right'
            var text = "Result: "+zapObject.homeTeam+" vs <br> "+zapObject.awayTeam+" <br> "+zapObject.homeScore+"-"+zapObject.awayScore+" <br> #stockport #badminton #sdbl #result https://stockport-badminton.co.uk"
            var words = text.split(' ');
            var line = '';
            var y = canvas.height/2 + canvas.width/4;
            var x = (canvas.width - 100);
            var lineHeight = 80;
            for(var n = 0; n < words.length; n++) {
              if (line.indexOf('#') > -1 || line.indexOf('http') > -1){
                ctx.font = 'normal 30px Arial';
                lineHeight = 40;
              }
              if (words[n] == '<br>'){
                ctx.fillText(line, x, y);
                line = '';
                y += lineHeight;
              }
              else {
                var testLine = line + words[n] + ' ';
                var metrics = ctx.measureText(testLine);
                var testWidth = metrics.width;
                if (testWidth > 900 && n > 0) {
                  ctx.fillText(line, x, y);
                  line = words[n] + ' ';
                  y += lineHeight;
                }
                else {
                  line = testLine;
                }
              }
            }
            ctx.fillText(line, x, y);
            const fs = require('fs')
            const out = fs.createWriteStream('static/beta/images/generated/'+ zapObject.homeTeam.replace(/([\s]{1,})/g,'-') + zapObject.awayTeam.replace(/([\s]{1,})/g,'-') +'.jpg')
            const stream = canvas.createJPEGStream()
            stream.pipe(out)
            out.on('finish', () =>  console.log('The Jpg file was created.'))
          })
            
            // console.log('<img src="' + canvas.toDataURL() + '" />')
          
          return done(null,body)
          //return done(null)
        }
     })
  }
  else if (zapObject.host == '127.0.0.1:3000'){
    console.log("zap not sent!");
    return done(null,'test env');
  }
  else {
    return done("you've not supplied an object");
  }
}

// PATCH
exports.updateById = function(fixtureObj,fixtureId,done){
  if (db.isObject(fixtureObj)){
    var sql = 'UPDATE `fixture` SET ';
    var updateArray = [];
    var updateArrayVars = [];
    for (x in fixtureObj){
      // console.log(fixtureObj[x]);
      updateArray.push('`'+ x +'` = ?');
      updateArrayVars.push(fixtureObj[x]);
    }
    var updateVars = updateArray.join(', ');
    updateArrayVars.push(fixtureId);
    // console.log(updateVars);
    sql = sql + updateVars + ' where `id` = ?'
    db.get().query(sql,updateArrayVars, function (err, rows){
      console.log(this.sql);
      if (err) return done(err);
      // console.log(rows);
      return done(null,rows);
    })
  }
  else {
    return done(err);
  }

}
