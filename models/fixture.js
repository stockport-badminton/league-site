var db = require('../db_connect.js');
var request = require('request');

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

exports.getMatchPlayerOrderDetails = function(done){
  db.get().query('select playerNames.id, playerNames.date, team.name, playerNames.Man1, playerNames.Man2, playerNames.Man3, playerNames.Lady1, playerNames.Lady2, playerNames.Lady3 FROM (select fixture.id, fixture.date, fixture.homeTeam as Team, concat(homeMan1.first_name," ",homeMan1.family_name) as Man1, concat(homeMan2.first_name," ",homeMan2.family_name) as Man2, concat(homeMan3.first_name," ",homeMan3.family_name) as Man3, concat(homeLady1.first_name," ",homeLady1.family_name) as Lady1, concat(homeLady2.first_name," ",homeLady2.family_name) as Lady2, concat(homeLady3.first_name," ",homeLady3.family_name) as Lady3 from fixture join player homeMan1 on fixture.homeMan1 = homeMan1.id join player homeMan2 on fixture.homeMan2 = homeMan2.id join player homeMan3 on fixture.homeMan3 = homeMan3.id join player homeLady1 on fixture.homeLady1 = homeLady1.id join player homeLady2 on fixture.homeLady2 = homeLady2.id join player homeLady3 on fixture.homeLady3 = homeLady3.id UNION ALL select fixture.id, fixture.date, fixture.awayTeam as Team, concat(awayMan1.first_name," ",awayMan1.family_name) as Man1, concat(awayMan2.first_name," ",awayMan2.family_name) as Man2, concat(awayMan3.first_name," ",awayMan3.family_name) as Man3, concat(awayLady1.first_name," ",awayLady1.family_name) as Lady1, concat(awayLady2.first_name," ",awayLady2.family_name) as Lady2, concat(awayLady3.first_name," ",awayLady3.family_name) as Lady3 from fixture join player awayMan1 on fixture.awayMan1 = awayMan1.id join player awayMan2 on fixture.awayMan2 = awayMan2.id join player awayMan3 on fixture.awayMan3 = awayMan3.id join player awayLady1 on fixture.awayLady1 = awayLady1.id join player awayLady2 on fixture.awayLady2 = awayLady2.id join player awayLady3 on fixture.awayLady3 = awayLady3.id) as playerNames JOIN team where playerNames.Team = team.id order by name, date',function(err,rows){
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
  othersql = "select a.date, a.homeTeam, team.name as awayTeam, a.homeScore, a.awayScore from  (select fixture.date, team.name as homeTeam, fixture.homeScore, fixture.awayScore, fixture.awayTeam from badminton.fixture join badminton.team where fixture.homeTeam = team.id) as a join badminton.team where a.awayTeam = team.id AND homeScore is not null AND date between adddate(now(),-7) and now() order by date";
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

exports.getOutstandingResults = function(done){
  db.get().query("SELECT a.id, a.date, a.homeTeam, a.homeTeamId, team.name AS awayTeam, team.id as awayTeamId, a.homeScore, a.awayScore FROM (SELECT fixture.id, fixture.date, team.name AS homeTeam, team.id as homeTeamId, fixture.homeScore, fixture.awayScore, fixture.awayTeam FROM badminton.fixture JOIN badminton.team WHERE fixture.homeTeam = team.id) AS a JOIN badminton.team WHERE a.awayTeam = team.id AND homeScore IS NULL AND date BETWEEN ADDDATE(NOW(), - 7) AND ADDDATE(NOW(),1) ORDER BY date", function (err, rows){
    if (err) return done(err);
    done(null, rows);
  })
}




exports.getCardsDueToday = function(done){
  othersql = "select fixId, date, status, homeTeam, team.name as awayTeam, homeScore, awayScore from  (select fixture.id as fixId, fixture.date, fixture.status, team.name as homeTeam, fixture.homeScore, fixture.awayScore, fixture.awayTeam from badminton.fixture join badminton.team where fixture.homeTeam = team.id) as a join badminton.team where a.awayTeam = team.id AND homeScore is null AND date between adddate(now(),-7) and adddate(now(),-6) order by date";
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
  othersql = "select a.fixId, a.date, a.status, a.homeTeam, a.homeTeamId, team.id as awayTeamId, team.name as awayTeam, a.homeScore, a.awayScore from  (select fixture.id as fixId, fixture.date, fixture.status,team.id as homeTeamId, team.name as homeTeam, fixture.homeScore, fixture.awayScore, fixture.awayTeam from badminton.fixture join badminton.team where fixture.homeTeam = team.id) as a join badminton.team where a.awayTeam = team.id AND homeScore is null AND date between adddate(now(),-1) and adddate(now(),7) order by date";
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

exports.getFixtureDetails = function(division, done){
  if (division == 0){
    var sql = 'select b.* from (SELECT a.fixtureId, a.date, a.homeTeam, team.name AS awayTeam, a.status, a.homeScore, a.awayScore FROM (SELECT team.name AS homeTeam, fixture.id AS fixtureId, fixture.date AS date, fixture.awayTeam, fixture.status, fixture.homeScore, fixture.awayScore FROM badminton.fixture JOIN badminton.team WHERE team.id = fixture.homeTeam) AS a JOIN badminton.team WHERE team.id = a.awayTeam ) as b join season where season.id = 2 AND b.date > season.startDate ORDER BY b.date'
  }
  else{
    var sql = 'select b.* from (SELECT a.fixtureId, a.date, a.homeTeam, team.name AS awayTeam, a.status, a.homeScore, a.awayScore FROM (SELECT team.name AS homeTeam, fixture.id AS fixtureId, fixture.date AS date, fixture.awayTeam, fixture.status, fixture.homeScore, fixture.awayScore FROM badminton.fixture JOIN badminton.team WHERE team.id = fixture.homeTeam) AS a JOIN badminton.team WHERE team.id = a.awayTeam AND team.division = '+ division +') as b join season where season.id = 2 AND b.date > season.startDate ORDER BY b.date'
  }
  db.get().query(sql, function (err, result){
    if (err) return done(err);
    done(null, result);
  })
}

exports.getFixtureDetailsById = function(fixtureId,done){
  db.get().query('Select a.fixtureId, a.date, a.homeTeam,  team.name as awayTeam, a.status, a.homeScore, a.awayScore from (select team.name as homeTeam, fixture.id as fixtureId, fixture.date as date, fixture.awayTeam, fixture.status, fixture.homeScore,fixture.awayScore from  badminton.fixture join badminton.team where team.id = fixture.homeTeam) as a join badminton.team where team.id = a.awayTeam AND fixtureId = ? ',fixtureId,function(err,rows){
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
    var sql = 'select fixtureId, homeTeamName, team.name as awayTeamName, homeTeamId, team.id as awayTeamId from (select fixture.id as fixtureId, team.name as homeTeamName, team.id as homeTeamId, fixture.homeTeam, fixture.awayTeam from fixture join team where team.id = fixture.homeTeam and team.name = ?) as a join team where awayTeam = team.id and team.name = ?';
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
    var sql = 'select id from fixture where awayTeam = ? AND homeTeam = ?';
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
      var sql = 'update badminton.fixture set status = "rearranging" Where id = (Select b.id from (Select a.id, a.homeTeam, a.awayTeam, a.awayTeamName, team.name as HomeTeamName from (SELECT fixture.id, fixture.homeTeam, fixture.awayTeam, team.name as awayTeamName  FROM badminton.fixture JOIN badminton.team WHERE fixture.awayTeam = team.id) as a Join badminton.team where a.homeTeam = team.id) as b Where (b.awayTeamName = ? AND b.homeTeamName = ?))'
      var sqlArray = [updateObj.awayTeam,updateObj.homeTeam]
    }
    else {
      var sqlArray = [updateObj.date,updateObj.awayTeam,updateObj.homeTeam]
      var sql = 'update badminton.fixture set date = ?, status = "rearranged" Where id = (Select b.id from (Select a.id, a.homeTeam, a.awayTeam, a.awayTeamName, team.name as HomeTeamName from (SELECT fixture.id, fixture.homeTeam, fixture.awayTeam, team.name as awayTeamName  FROM badminton.fixture JOIN badminton.team WHERE fixture.awayTeam = team.id) as a Join badminton.team where a.homeTeam = team.id) as b Where (b.awayTeamName = ? AND b.homeTeamName = ?))'
    }

    db.get().query(sql,sqlArray,function(err,result,fields){
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
    var sql = 'update badminton.fixture set homeScore = ?, awayScore = ? Where id = (Select b.id from (Select a.id, a.homeTeam, a.awayTeam, a.awayTeamName, team.name as HomeTeamName from (SELECT fixture.id, fixture.homeTeam, fixture.awayTeam, team.name as awayTeamName  FROM badminton.fixture JOIN badminton.team WHERE fixture.awayTeam = team.id) as a Join badminton.team where a.homeTeam = team.id) as b Where (b.awayTeamName = ? AND b.homeTeamName = ?))'

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
              "message" : "Result: "+updateObj.homeTeam+" vs "+updateObj.awayTeam+" : "+updateObj.homeScore+"-"+updateObj.awayScore+" #badminton #stockport #sdbl #result https://stockport-badminton.co.uk"
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
        "message" : "Result: "+zapObject.homeTeam+" vs "+zapObject.awayTeam+" : "+zapObject.homeScore+"-"+zapObject.awayScore+" #badminton #stockport #sdbl #result https://stockport-badminton.co.uk"
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
