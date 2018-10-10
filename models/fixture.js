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
      console.log(fixtureObj[x]);
      updateArray.push('`'+ x +'`');
      updateArrayVars.push(fixtureObj[x]);
      updateArrayValues.push('?');
    }
    var updateVars = updateArray.join(',');
    var updateValues = updateArrayValues.join(',');
    console.log(updateVars);
    sql = sql + updateVars + ') VALUES (' + updateValues + ')';
    console.log(sql);
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

// GET
exports.getAll = function(done){
  db.get().query('SELECT * FROM `fixture`', function (err, rows){
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
      console.log(result);
      done(null,result);
    }
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
      console.log(result);
      done(null,result);
    }
  })
}

exports.getupComing = function(done){
  othersql = "select a.fixId, a.date, a.status, a.homeTeam, team.name as awayTeam, a.homeScore, a.awayScore from  (select fixture.id as fixId, fixture.date, fixture.status, team.name as homeTeam, fixture.homeScore, fixture.awayScore, fixture.awayTeam from badminton.fixture join badminton.team where fixture.homeTeam = team.id) as a join badminton.team where a.awayTeam = team.id AND homeScore is null AND date between adddate(now(),-1) and adddate(now(),7) order by date";
  db.get().query(othersql,function(err,result){
    if (err) {
      console.log(err);
      return done(err);
    }
    else {
      console.log(result);
      done(null,result);
    }
  })
}

exports.getFixtureDetails = function(division, done){
  db.get().query('Select a.date, a.homeTeam,  team.name as awayTeam, a.status, a.homeScore, a.awayScore from (select team.name as homeTeam, fixture.date as date, fixture.awayTeam, fixture.status, fixture.homeScore,fixture.awayScore from  badminton.fixture join badminton.team where team.id = fixture.homeTeam) as a join badminton.team where team.id = a.awayTeam AND team.division = '+ division +' ORDER BY a.date', function (err, result){
    if (err) return done(err);
    done(null, result);
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

exports.updateByTeamNames = function(updateObj,done){
  if(db.isObject(updateObj)){
    var sql = 'update badminton.fixture set homeScore = ?, awayScore = ? Where id = (Select b.id from (Select a.id, a.homeTeam, a.awayTeam, a.awayTeamName, team.name as HomeTeamName from (SELECT fixture.id, fixture.homeTeam, fixture.awayTeam, team.name as awayTeamName  FROM badminton.fixture JOIN badminton.team WHERE fixture.awayTeam = team.id) as a Join badminton.team where a.homeTeam = team.id) as b Where (b.awayTeamName = ? AND b.homeTeamName = ?))'

    db.get().query(sql,[updateObj.homeScore,updateObj.awayScore,updateObj.awayTeam,updateObj.homeTeam],function(err,result,fields){
      if (err) {
        return done(err);
      }
      else{
        console.log(result);
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
              throw new Error(err);
              return done(err);
            }
            else {
              console.log(body);
              return done(null,result)
            }

          })
        }
        else {
          throw new Error("nothing updated - teams probably didn't match up")
          return done("nothing updated - teams probably didn't match up ");
        }
      }
    })
  }
  else {
    return done(err);
  }
}

// PATCH
exports.updateById = function(fixtureObj,fixtureId,done){
  if (db.isObject(fixtureObj)){
    var sql = 'UPDATE `fixture` SET ';
    var updateArray = [];
    var updateArrayVars = [];
    for (x in fixtureObj){
      console.log(fixtureObj[x]);
      updateArray.push('`'+ x +'` = ?');
      updateArrayVars.push(fixtureObj[x]);
    }
    var updateVars = updateArray.join(', ');
    updateArrayVars.push(fixtureId);
    console.log(updateVars);
    sql = sql + updateVars + ' where `id` = ?'
    db.get().query(sql,updateArrayVars, function (err, rows){
      if (err) return done(err);
      console.log(rows);
      done(null,rows);
    })
  }
  else {
    return done(err);
  }

}
