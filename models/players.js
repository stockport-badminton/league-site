var db = require('../db_connect.js');

// POST
exports.create = function(first_name,family_name,team,club,gender,done){
  var date_of_registration = new Date();
  db.get().query('INSERT INTO `player` (`first_name`,`family_name`,`date_of_registration`,`team`,`club`,`gender`) VALUES (?,?,?,?,?,?)',[first_name,family_name,date_of_registration,team,club,gender],function(err,result){
    if (err) return done(err);
    done(null,result);
  });

}

exports.createByName = function(obj,done){
  if(db.isObject(obj)){
    sql = 'insert into badminton.player (first_name, family_name, gender, club, team, date_of_registration) values (?, ?, ?,(select id from club where name = ?),(select id from team where name = ?),?)'
    // console.log(JSON.stringify(obj));
    db.get().query(sql,[obj.first_name, obj.family_name, obj.gender,obj.clubName, obj.teamName, obj.date],function(err,result){
      if (err){
        return done(err);
      }
      else {
        done(null,result);
      }
    })
  }
  else {
    return done('not object');
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

// PATCH
exports.updateById = function(first_name,family_name,team,club,gender,playerId,done){
  db.get().query('UPDATE `player` SET `first_name` = ?, `family_name` = ?, `team` = ?, `club` = ?, `gender` = ? WHERE `id` = ?',[first_name,family_name,team,club,gender,playerId], function (err, rows){
    if (err) return done(err);
    // console.log(rows);
    done(null,rows);
  })
}

// GET
exports.getAll = function(done){
  db.get().query('SELECT * FROM `player`', function (err, rows){
    if (err) return done(err);
    done(null, rows);
  })
}

exports.getPlayerStats = function(searchTerms,done){
  // console.log(searchTerms);

  var whereTerms = [];
  var whereValue = []
  if (!searchTerms.divisionId){
    console.log("no division id");
  }
  else {
    whereTerms.push('`division` = ?');
    whereValue.push(searchTerms.divisionId)
  }
  if (!searchTerms.gameType){
    console.log("no gameType");
  }
  else {
    whereTerms.push('`gameType` = ?');
    whereValue.push(searchTerms.gameType)
  }
  console.log(whereTerms)

  if (whereTerms.length > 0) {
    var conditions = whereTerms.join(' AND ');
    console.log(conditions);
    conditions = ' WHERE '+ conditions
    var sql = "DROP TABLE IF EXISTS gameSummary; CREATE TABLE gameSummary as SELECT b.id, b.homePlayer1 AS playerId, b.homeScore as forPoints, b.awayScore as againstPoints, CASE WHEN b.homeScore > b.awayScore THEN 1 ELSE 0 END AS gamesWon, CASE WHEN b.homeScore IS NOT NULL THEN 1 ELSE 0 END AS gamesPlayed, b.fixture, b.homeTeam AS team, b.awayTeam AS opposition, b.gameType, team.division FROM (SELECT a.*, CASE WHEN homePlayer1.gender = homePlayer2.gender AND homePlayer1.gender = 'Male' THEN 'Mens' WHEN homePlayer1.gender = homePlayer2.gender AND homePlayer1.gender = 'Female' THEN 'Ladies' ELSE 'Mixed' END AS gameType FROM (SELECT game.id, game.homePlayer1, game.homePlayer2, game.awayPlayer1, game.awayPlayer2, game.homeScore, game.awayScore, game.fixture, fixture.homeTeam, fixture.awayTeam FROM game JOIN fixture WHERE game.fixture = fixture.id) AS a JOIN player homePlayer1 ON a.homePlayer1 = homePlayer1.id JOIN player homePlayer2 ON a.homePlayer2 = homePlayer2.id) AS b JOIN team WHERE homeTeam = team.id UNION ALL SELECT b.id, b.homePlayer2 AS playerId, b.homeScore as forPoints, b.awayScore as againstPoints, CASE WHEN b.homeScore > b.awayScore THEN 1 ELSE 0 END AS gamesWon, CASE WHEN b.homeScore IS NOT NULL THEN 1 ELSE 0 END AS gamesPlayed, b.fixture, b.homeTeam AS team, b.awayTeam AS opposition, b.gameType, team.division FROM (SELECT a.*, CASE WHEN homePlayer1.gender = homePlayer2.gender AND homePlayer1.gender = 'Male' THEN 'Mens' WHEN homePlayer1.gender = homePlayer2.gender AND homePlayer1.gender = 'Female' THEN 'Ladies' ELSE 'Mixed' END AS gameType FROM (SELECT game.id, game.homePlayer1, game.homePlayer2, game.awayPlayer1, game.awayPlayer2, game.homeScore, game.awayScore, game.fixture, fixture.homeTeam, fixture.awayTeam FROM game JOIN fixture WHERE game.fixture = fixture.id) AS a JOIN player homePlayer1 ON a.homePlayer1 = homePlayer1.id JOIN player homePlayer2 ON a.homePlayer2 = homePlayer2.id) AS b JOIN team WHERE homeTeam = team.id UNION ALL SELECT b.id, b.awayPlayer1 AS playerId, b.awayScore as forPoints, b.homeScore as againstPoints, CASE WHEN b.awayScore > b.homeScore THEN 1 ELSE 0 END AS gamesWon, CASE WHEN b.homeScore IS NOT NULL THEN 1 ELSE 0 END AS gamesPlayed, b.fixture, b.awayTeam AS team, b.homeTeam AS opposition, b.gameType, team.division FROM (SELECT a.*, CASE WHEN homePlayer1.gender = homePlayer2.gender AND homePlayer1.gender = 'Male' THEN 'Mens' WHEN homePlayer1.gender = homePlayer2.gender AND homePlayer1.gender = 'Female' THEN 'Ladies' ELSE 'Mixed' END AS gameType FROM (SELECT game.id, game.homePlayer1, game.homePlayer2, game.awayPlayer1, game.awayPlayer2, game.homeScore, game.awayScore, game.fixture, fixture.homeTeam, fixture.awayTeam FROM game JOIN fixture WHERE game.fixture = fixture.id) AS a JOIN player homePlayer1 ON a.homePlayer1 = homePlayer1.id JOIN player homePlayer2 ON a.homePlayer2 = homePlayer2.id) AS b JOIN team ON homeTeam = team.id UNION ALL SELECT b.id, b.awayPlayer2 AS playerId, b.awayScore as forPoints, b.homeScore as againstPoints, CASE WHEN b.awayScore > b.homeScore THEN 1 ELSE 0 END AS gamesWon, CASE WHEN b.homeScore IS NOT NULL THEN 1 ELSE 0 END AS gamesPlayed, b.fixture, b.awayTeam AS team, b.homeTeam AS opposition, b.gameType, team.division FROM (SELECT a.*, CASE WHEN homePlayer1.gender = homePlayer2.gender AND homePlayer1.gender = 'Male' THEN 'Mens' WHEN homePlayer1.gender = homePlayer2.gender AND homePlayer1.gender = 'Female' THEN 'Ladies' ELSE 'Mixed' END AS gameType FROM (SELECT game.id, game.homePlayer1, game.homePlayer2, game.awayPlayer1, game.awayPlayer2, game.homeScore, game.awayScore, game.fixture, fixture.homeTeam, fixture.awayTeam FROM game JOIN fixture ON game.fixture = fixture.id) AS a JOIN player homePlayer1 ON a.homePlayer1 = homePlayer1.id JOIN player homePlayer2 ON a.homePlayer2 = homePlayer2.id) AS b JOIN team ON homeTeam = team.id; SELECT CONCAT(player.first_name, ' ', player.family_name) AS name, playerId, SUM(forPoints) AS forPoints, SUM(againstPoints) AS againstPoints, SUM(gamesWon) AS gamesWon, SUM(gamesPlayed) AS gamesPlayed, club.name AS clubName, team.name AS teamName FROM (select * from gameSummary "+ conditions +") as a JOIN player ON playerId = player.id JOIN team ON team.id = player.team JOIN club ON club.id = player.club GROUP BY playerId;"
    db.get().query(sql, whereValue,function (err,rows){
      if (err){
        console.log("getPlayerStats model error")
        console.log(err)
        return done(err)
      }
      else{
        // console.log(this.sql)
        // console.log("getPlayerStats model success")
        // console.log(rows[2])
        done(null,rows[2])
      }
    })
  }
  else {
    var sql = "DROP TABLE IF EXISTS gameSummary; CREATE TABLE gameSummary as SELECT b.id, b.homePlayer1 AS playerId, b.homeScore as forPoints, b.awayScore as againstPoints, CASE WHEN b.homeScore > b.awayScore THEN 1 ELSE 0 END AS gamesWon, CASE WHEN b.homeScore IS NOT NULL THEN 1 ELSE 0 END AS gamesPlayed, b.fixture, b.homeTeam AS team, b.awayTeam AS opposition, b.gameType, team.division FROM (SELECT a.*, CASE WHEN homePlayer1.gender = homePlayer2.gender AND homePlayer1.gender = 'Male' THEN 'Mens' WHEN homePlayer1.gender = homePlayer2.gender AND homePlayer1.gender = 'Female' THEN 'Ladies' ELSE 'Mixed' END AS gameType FROM (SELECT game.id, game.homePlayer1, game.homePlayer2, game.awayPlayer1, game.awayPlayer2, game.homeScore, game.awayScore, game.fixture, fixture.homeTeam, fixture.awayTeam FROM game JOIN fixture WHERE game.fixture = fixture.id) AS a JOIN player homePlayer1 ON a.homePlayer1 = homePlayer1.id JOIN player homePlayer2 ON a.homePlayer2 = homePlayer2.id) AS b JOIN team WHERE homeTeam = team.id UNION ALL SELECT b.id, b.homePlayer2 AS playerId, b.homeScore as forPoints, b.awayScore as againstPoints, CASE WHEN b.homeScore > b.awayScore THEN 1 ELSE 0 END AS gamesWon, CASE WHEN b.homeScore IS NOT NULL THEN 1 ELSE 0 END AS gamesPlayed, b.fixture, b.homeTeam AS team, b.awayTeam AS opposition, b.gameType, team.division FROM (SELECT a.*, CASE WHEN homePlayer1.gender = homePlayer2.gender AND homePlayer1.gender = 'Male' THEN 'Mens' WHEN homePlayer1.gender = homePlayer2.gender AND homePlayer1.gender = 'Female' THEN 'Ladies' ELSE 'Mixed' END AS gameType FROM (SELECT game.id, game.homePlayer1, game.homePlayer2, game.awayPlayer1, game.awayPlayer2, game.homeScore, game.awayScore, game.fixture, fixture.homeTeam, fixture.awayTeam FROM game JOIN fixture WHERE game.fixture = fixture.id) AS a JOIN player homePlayer1 ON a.homePlayer1 = homePlayer1.id JOIN player homePlayer2 ON a.homePlayer2 = homePlayer2.id) AS b JOIN team WHERE homeTeam = team.id UNION ALL SELECT b.id, b.awayPlayer1 AS playerId, b.awayScore as forPoints, b.homeScore as againstPoints, CASE WHEN b.awayScore > b.homeScore THEN 1 ELSE 0 END AS gamesWon, CASE WHEN b.homeScore IS NOT NULL THEN 1 ELSE 0 END AS gamesPlayed, b.fixture, b.awayTeam AS team, b.homeTeam AS opposition, b.gameType, team.division FROM (SELECT a.*, CASE WHEN homePlayer1.gender = homePlayer2.gender AND homePlayer1.gender = 'Male' THEN 'Mens' WHEN homePlayer1.gender = homePlayer2.gender AND homePlayer1.gender = 'Female' THEN 'Ladies' ELSE 'Mixed' END AS gameType FROM (SELECT game.id, game.homePlayer1, game.homePlayer2, game.awayPlayer1, game.awayPlayer2, game.homeScore, game.awayScore, game.fixture, fixture.homeTeam, fixture.awayTeam FROM game JOIN fixture WHERE game.fixture = fixture.id) AS a JOIN player homePlayer1 ON a.homePlayer1 = homePlayer1.id JOIN player homePlayer2 ON a.homePlayer2 = homePlayer2.id) AS b JOIN team ON homeTeam = team.id UNION ALL SELECT b.id, b.awayPlayer2 AS playerId, b.awayScore as forPoints, b.homeScore as againstPoints, CASE WHEN b.awayScore > b.homeScore THEN 1 ELSE 0 END AS gamesWon, CASE WHEN b.homeScore IS NOT NULL THEN 1 ELSE 0 END AS gamesPlayed, b.fixture, b.awayTeam AS team, b.homeTeam AS opposition, b.gameType, team.division FROM (SELECT a.*, CASE WHEN homePlayer1.gender = homePlayer2.gender AND homePlayer1.gender = 'Male' THEN 'Mens' WHEN homePlayer1.gender = homePlayer2.gender AND homePlayer1.gender = 'Female' THEN 'Ladies' ELSE 'Mixed' END AS gameType FROM (SELECT game.id, game.homePlayer1, game.homePlayer2, game.awayPlayer1, game.awayPlayer2, game.homeScore, game.awayScore, game.fixture, fixture.homeTeam, fixture.awayTeam FROM game JOIN fixture ON game.fixture = fixture.id) AS a JOIN player homePlayer1 ON a.homePlayer1 = homePlayer1.id JOIN player homePlayer2 ON a.homePlayer2 = homePlayer2.id) AS b JOIN team ON homeTeam = team.id; SELECT CONCAT(player.first_name, ' ', player.family_name) AS name, playerId, SUM(forPoints) AS forPoints, SUM(againstPoints) AS againstPoints, SUM(gamesWon) AS gamesWon, SUM(gamesPlayed) AS gamesPlayed, club.name AS clubName, team.name AS teamName FROM (select * from gameSummary) as a JOIN player ON playerId = player.id JOIN team ON team.id = player.team JOIN club ON club.id = player.club GROUP BY playerId;"
    db.get().query(sql,function (err,rows){
      if (err){
        console.log("getPlayerStats model error")
        console.log(err)
        return done(err)
      }
      else{
        // console.log(this.sql)
        // console.log("getPlayerStats model success")
        //console.log(rows[2])
        done(null,rows[2])
      }
    })
  }


}

exports.search = function(searchTerms,done){
  console.log(searchTerms);
  var sql = 'SELECT * FROM `player`';
  var whereTerms = [];
  if (!searchTerms.teamid){
    console.log("no team id");
  }
  else {
    whereTerms.push('`team` = '+searchTerms.teamid);
  }
  if (!searchTerms.gender){
    console.log("no gender");
  }
  else {
    whereTerms.push('`gender` = "'+searchTerms.gender + '"');
  }
  if (!searchTerms.clubid){
    console.log("no club id");
  }
  else {
    whereTerms.push('`club` = '+searchTerms.clubid);
  }
  console.log(whereTerms)

  if (whereTerms.length > 0) {
    var conditions = whereTerms.join(' AND ');
    conditions = ' WHERE ' + conditions;
    // console.log(conditions);
    sql = sql + conditions
  }
  db.get().query(sql, function (err, rows){
    if (err) return done(err);
    done(null, rows);
  })
}

exports.findElgiblePlayersFromTeamId = function(id,gender,done){
  db.get().query('select player.id, player.first_name, player.family_name from (select team.id, team.name, team.rank from (SELECT club.id, club.name, team.rank as originalRank FROM team JOIN club WHERE team.club = club.id AND team.id = ?) as a join team where a.id = team.club AND team.rank >= originalRank) as b join player where player.team = b.id AND player.gender= ?',[id,gender],function(err,result){
    if (err){
      return done(err)
    }
    else{
      done(null,result);
    }
  })
}

exports.count = function(searchTerm,done){
  if (searchTerm == ""){
    db.get().query('SELECT COUNT(*) as `players` FROM `player`', function (err,result){
      if (err) return done(err);
      // console.log(searchTerm + " model:" + JSON.stringify(result));
      done(null,result);
    })
  }
  else {
    db.get().query('SELECT COUNT(*) as `players` FROM `player` WHERE `gender` = ?',searchTerm, function (err,result){
      if (err) return done(err);
      // console.log(searchTerm + " model:" + JSON.stringify(result));
      done(null,result);
    })
  }
}

// GET
exports.getById = function(playerId,done){
  db.get().query('SELECT * FROM `player` WHERE `id` = ?',playerId, function (err, rows){
    if (err) return done(err);
    done(null,rows);
  })
}

exports.getPlayerClubandTeamById = function(playerId,done){
  db.get().query("select playerId, playerName, clubName, team.name as teamName, date_of_registration from (select playerId, playerName, club.name as clubName, teamId, date_of_registration from (select player.id as playerId, concat(player.first_name, ' ', player.family_name) as playerName, player.club as clubID, player.team as teamId, player.date_of_registration from player where id = ?) as a join club where clubId = club.id) as b join team where teamId = team.id",[playerId],function(err, rows){
    if (err){
      return done(err)
    }
    else{
      done(null,rows)
    }
  })
}

// GET
exports.findByName = function(searchObject,done){
  db.get().query('SELECT * FROM `player` WHERE `id` = ?',playerId, function (err, rows){
    if (err) return done(err);
    done(null,rows);
  })
}

// DELETE
exports.deleteById = function(playerId,done){
  db.get().query('DELETE FROM `player` WHERE `id` = ?',playerId, function (err, rows){
    if (err) return done(err);
    done(null,rows);
  })
}
