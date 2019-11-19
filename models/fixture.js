var db = require('../db_connect.js');
var request = require('request');

var logger = require('logzio-nodejs').createLogger({
  token: process.env.LOGZ_SECRET,
  host: 'listener.logz.io'
});

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
  if (!fixtureObj.season || fixtureObj.season == '20192020'){
    console.log("no season");
    searchTerms.push('season.name = ? AND c.date > season.startDate AND c.date < season.endDate');
    sqlArray.push('20192020');
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
  db.get().query('select c.* from( SELECT fixturePlayers.*, club'+seasonName+'.name FROM (SELECT playerNames.id, homeTeam.name as teamName, homeTeam.club as clubId, awayTeam.name as oppositionName, playerNames.date, playerNames.Man1, playerNames.Man2, playerNames.Man3, playerNames.Lady1, playerNames.Lady2, playerNames.Lady3 FROM (SELECT fixture.id, fixture.date, fixture.homeTeam AS Team, fixture.awayTeam AS Opposition, CONCAT(homeMan1.first_name, " ", homeMan1.family_name) AS Man1, CONCAT(homeMan2.first_name, " ", homeMan2.family_name) AS Man2, CONCAT(homeMan3.first_name, " ", homeMan3.family_name) AS Man3, CONCAT(homeLady1.first_name, " ", homeLady1.family_name) AS Lady1, CONCAT(homeLady2.first_name, " ", homeLady2.family_name) AS Lady2, CONCAT(homeLady3.first_name, " ", homeLady3.family_name) AS Lady3 FROM fixture JOIN player homeMan1 ON fixture.homeMan1 = homeMan1.id JOIN player homeMan2 ON fixture.homeMan2 = homeMan2.id JOIN player homeMan3 ON fixture.homeMan3 = homeMan3.id JOIN player homeLady1 ON fixture.homeLady1 = homeLady1.id JOIN player homeLady2 ON fixture.homeLady2 = homeLady2.id JOIN player homeLady3 ON fixture.homeLady3 = homeLady3.id UNION ALL SELECT fixture.id, fixture.date, fixture.awayTeam AS Team, fixture.homeTeam AS Opposition, CONCAT(awayMan1.first_name, " ", awayMan1.family_name) AS Man1, CONCAT(awayMan2.first_name, " ", awayMan2.family_name) AS Man2, CONCAT(awayMan3.first_name, " ", awayMan3.family_name) AS Man3, CONCAT(awayLady1.first_name, " ", awayLady1.family_name) AS Lady1, CONCAT(awayLady2.first_name, " ", awayLady2.family_name) AS Lady2, CONCAT(awayLady3.first_name, " ", awayLady3.family_name) AS Lady3 FROM fixture JOIN player awayMan1 ON fixture.awayMan1 = awayMan1.id JOIN player awayMan2 ON fixture.awayMan2 = awayMan2.id JOIN player awayMan3 ON fixture.awayMan3 = awayMan3.id JOIN player awayLady1 ON fixture.awayLady1 = awayLady1.id JOIN player awayLady2 ON fixture.awayLady2 = awayLady2.id JOIN player awayLady3 ON fixture.awayLady3 = awayLady3.id) AS playerNames JOIN team'+seasonName+' homeTeam ON playerNames.Team = homeTeam.id JOIN team'+seasonName+' awayTeam ON playerNames.Opposition = awayTeam.id) AS fixturePlayers JOIN club'+seasonName+' on club'+seasonName+'.id = clubId) as c '+conditions+' ORDER BY name , date',sqlArray,function(err,rows){
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
  othersql = "select a.date, a.homeTeam, team.name as awayTeam, a.homeScore, a.awayScore from  (select fixture.date, team.name as homeTeam, fixture.homeScore, fixture.awayScore, fixture.awayTeam from fixture join team where fixture.homeTeam = team.id) as a join team where a.awayTeam = team.id AND homeScore is not null AND date between adddate(now(),-7) and now() order by date";
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
  othersql = "select a.fixId, a.date, a.status, a.homeTeam, a.homeTeamId, team.id as awayTeamId, team.name as awayTeam, a.homeScore, a.awayScore from  (select fixture.id as fixId, fixture.date, fixture.status,team.id as homeTeamId, team.name as homeTeam, fixture.homeScore, fixture.awayScore, fixture.awayTeam from fixture join team where fixture.homeTeam = team.id) as a join team where a.awayTeam = team.id AND homeScore is null AND status not in ('rearranged','rearranging') AND date between adddate(now(),-1) and adddate(now(),7) order by date";
  db.get().query(othersql,function(err,result){
    // logger.log(this.sql)
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
    searchTerms.push('(d.homeClubName = ? OR d.awayClubName = ?)');
    sqlArray.push(fixtureObj.club);
    sqlArray.push(fixtureObj.club);
  }
  if (!fixtureObj.team){
    console.log("no team name");
  }
  else {
    searchTerms.push('(d.homeTeam = ? OR d.awayTeam = ?)');
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
    searchTerms.push('season.name = ? AND d.date > season.startDate AND d.date < season.endDate');
    sqlArray.push('20192020');
  }
  else {
    searchTerms.push('season.name = ? AND d.date > season.startDate AND d.date < season.endDate');
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
    fixtureObj.season = '20192020'
  }
  else {
    var seasonName = season + ' as team'
  } */

  db.get().query('SELECT d.* FROM (SELECT c.*, club.name AS awayClubName FROM (SELECT b.*, club.name AS homeClubName FROM (SELECT a.*, team.name AS awayTeam, team.club AS awayClub, team.division FROM (SELECT team.name AS homeTeam, team.club AS homeClub, fixture.id AS fixtureId, fixture.date AS date, fixture.awayTeam AS awayTeamId, fixture.status, fixture.homeScore, fixture.awayScore FROM fixture JOIN team'+seasonName+' WHERE team.id = fixture.homeTeam) AS a JOIN team'+seasonName+' WHERE team.id = a.awayTeamId) AS b JOIN club'+clubSeasonName+' WHERE club.id = b.homeClub) AS c JOIN club'+clubSeasonName+' WHERE club.id = c.awayClub) AS d JOIN season'+ conditions +' ORDER BY d.date',sqlArray, function (err, result){
      // console.log(this.sql)
      if (err) {
        //console.log(this.sql)
        return done(err);
      }
      done(null, result);
    })
  
}

exports.getFixtureDetails = function(division,season, done){
  if (season === undefined){
    seasonName = ''
    season = '20192020'
  }
  else {
    seasonName = season + ' as team'
  }
  if (division == 0){

  
    db.get().query('select b.* from (SELECT a.fixtureId, a.date, a.homeTeam, team.name AS awayTeam, a.status, a.homeScore, a.awayScore FROM (SELECT team.name AS homeTeam, fixture.id AS fixtureId, fixture.date AS date, fixture.awayTeam, fixture.status, fixture.homeScore, fixture.awayScore FROM fixture JOIN team'+seasonName+' WHERE team.id = fixture.homeTeam) AS a JOIN team WHERE team.id = a.awayTeam ) as b join season where season.name = ? AND b.date > season.startDate AND b.date < season.endDate ORDER BY b.date',season, function (err, result){
      if (err) {
        //console.log(this.sql)
        logger.log(this.sql)
        return done(err);
      }
      done(null, result);
    })
  }
  else{
    var sql = 
    db.get().query('select b.* from (SELECT a.fixtureId, a.date, a.homeTeam, team.name AS awayTeam, a.status, a.homeScore, a.awayScore FROM (SELECT team.name AS homeTeam, fixture.id AS fixtureId, fixture.date AS date, fixture.awayTeam, fixture.status, fixture.homeScore, fixture.awayScore FROM fixture JOIN team'+seasonName+' WHERE team.id = fixture.homeTeam) AS a JOIN team'+seasonName+' WHERE team.id = a.awayTeam AND team.division = ?) as b join season where season.name = ? AND b.date > season.startDate AND b.date < season.endDate ORDER BY b.date',[division,season], function (err, result){
      logger.log(this.sql)
      if (err) {
        //console.log(this.sql)
        return done(err);
      }
      done(null, result);
    })
  }
  
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
    var sql = 'select id from (select fixture.id, homeTeam, awayTeam from fixture join season where season.name="20192020" AND fixture.date > season.startDate) as a where awayTeam = ? AND homeTeam = ?';
    // console.log(obj);
    db.get().query(sql,[obj.awayTeam, obj.homeTeam],function(err,result){
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
    var sql = 'select id from (select fixture.id, homeTeam, awayTeam, status from fixture join season where season.name="20192020" AND fixture.date > season.startDate) as a where awayTeam = ? AND homeTeam = ? AND status = "outstanding"';
    // console.log(obj);
    db.get().query(sql,[obj.awayTeam, obj.homeTeam],function(err,result){
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

exports.rearrangeByTeamNames = function(updateObj,done){
  if(db.isObject(updateObj)){
    if (updateObj.date == null ){
      var sql = 'UPDATE fixture SET status = "rearranging" WHERE id = (SELECT b.id FROM (SELECT a.id, a.homeTeam, a.awayTeam, a.awayTeamName, team.name AS HomeTeamName FROM (SELECT c.id, c.homeTeam, c.awayTeam, team.name AS awayTeamName FROM (SELECT fixture.id, fixture.homeTeam, fixture.awayTeam FROM fixture JOIN season WHERE season.id = 2 AND fixture.date > season.startDate) AS c JOIN team WHERE c.awayTeam = team.id) AS a JOIN team WHERE a.homeTeam = team.id) AS b WHERE (b.awayTeamName = ? AND b.homeTeamName = ?) order by id desc limit 0,1);'
      var sqlArray = [updateObj.awayTeam,updateObj.homeTeam]
    }
    else {
      var sqlArray = [updateObj.awayTeam,updateObj.homeTeam,updateObj.homeTeam,updateObj.awayTeam,updateObj.date]
      var sql = 'UPDATE fixture SET status = "rearranged" WHERE id = (SELECT b.id FROM (SELECT a.id, a.homeTeam, a.awayTeam, a.awayTeamName, team.name AS HomeTeamName FROM (SELECT c.id, c.homeTeam, c.awayTeam, team.name AS awayTeamName FROM (SELECT fixture.id, fixture.homeTeam, fixture.awayTeam FROM fixture JOIN season WHERE season.id = 2 AND fixture.date > season.startDate) AS c JOIN team WHERE c.awayTeam = team.id) AS a JOIN team WHERE a.homeTeam = team.id) AS b WHERE (b.awayTeamName = ? AND b.homeTeamName = ?) order by id desc limit 0,1); INSERT INTO fixture (`id`, `homeTeam`, `awayTeam`, `date`, `status`) VALUES (NULL, (Select id from team where name = ?), (SELECT id from team where name = ?), ?, "outstanding");'
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
            url:'https://hooks.zapier.com/hooks/catch/3751975/qz5xbm/',
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
  if (db.isObject(zapObject)){
    var options = {
      method:'POST',
      url:'https://hooks.zapier.com/hooks/catch/3751975/qz5xbm/',
      headers:{
        'content-type':'application/json'
      },
      body:{
        "message" : "Result: "+zapObject.homeTeam+" vs "+zapObject.awayTeam+" : "+zapObject.homeScore+"-"+zapObject.awayScore+" ##stockport #sdbl #result https://stockport-co.uk"
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
        return done(null,body)
      }

    })
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
      if (err) return done(err);
      // console.log(rows);
      return done(null,rows);
    })
  }
  else {
    return done(err);
  }

}
