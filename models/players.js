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

exports.getNamesClubsTeams = function(searchTerms,done){
  var whereTerms = [];
  var whereValue = []
  if (!searchTerms.club){
    // console.log("no club name");
  }
  else {
    whereTerms.push('`clubName` = ?');
    whereValue.push(searchTerms.club)
  }
  if (!searchTerms.team){
    // console.log("no team name");
  }
  else {
    whereTerms.push('`teamName` = ?');
    whereValue.push(searchTerms.team)
  }
  if (!searchTerms.gender){
    // console.log("no gender");
  }
  else {
    whereTerms.push('`gender` = ?');
    whereValue.push(searchTerms.gender)
  }
  // console.log(whereTerms)

  if (whereTerms.length > 0) {
    var conditions = whereTerms.join(' AND ');
    // console.log(conditions);
    conditions = ' WHERE '+ conditions
    db.get().query("select * from (select playerId, a.name, gender, date_of_registration, club.name as clubName, teamName from (SELECT player.id as playerID, concat(first_name, ' ', family_name) as name, gender, date_of_registration, team.name as teamName, player.club as clubId from player join team where team.id = player.team) as a join club where a.clubId = club.id ) as b"+conditions,whereValue,function(err,rows){
      // console.log(this.sql);
      if (err) return done(err);
      done(null,rows);
    })
  }
  else {
    db.get().query("select playerId, a.name, gender, date_of_registration, club.name as clubName, teamName from (SELECT player.id as playerID, concat(first_name, ' ', family_name) as name, gender, date_of_registration, team.name as teamName, player.club as clubId from player join team where team.id = player.team) as a join club where a.clubId = club.id",function(err,rows){
      if (err) return done(err);
      done(null,rows);
    })
  }
}

exports.getPlayerGameData = function(id,done){
  db.get().query("Select date, gamesData.id, concat(player1.first_name,' ',player1.family_name) as playerName, concat(player2.first_name,' ',player2.family_name) as partnerName, concat(player3.first_name,' ',player3.family_name) as oppName1, concat(player4.first_name,' ',player4.family_name) as oppName2, gamesData.score, gamesData.vsScore, gameType from (Select fixture.date, allPlayedGames.id, playerId, partnerId, oppPlayer1, oppPlayer2, allPlayedGames.score, allPlayedGames.vsScore, gameType from (select id, homePlayer1 as playerId, homePlayer2 as partnerId, awayPlayer1 as oppPlayer1, awayPlayer2 as oppPlayer2, homeScore as score, awayScore as vsScore, fixture, gameType from game where homePlayer1 = ? UNION ALL select id, homePlayer2 as playerId, homePlayer1 as partnerId, awayPlayer1 as oppPlayer1, awayPlayer2 as oppPlayer2, homeScore as score, awayScore as vsScore, fixture, gameType from game where homePlayer2 = ? UNION ALL select id, awayPlayer1 as playerId, awayPlayer2 as partnerId, homePlayer1 as oppPlayer1, homePlayer2 as oppPlayer2, awayScore as score, homeScore as vsScore, fixture, gameType from game where awayPlayer1 = ? UNION ALL select id, awayPlayer2 as playerId, awayPlayer1 as partnerId, homePlayer1 as oppPlayer1, homePlayer2 as oppPlayer2, awayScore as score, homeScore as vsScore, fixture, gameType from game where awayPlayer2 = ?) as allPlayedGames join fixture where allPlayedGames.fixture = fixture.id order by date) as gamesData join player player1 on playerId = player1.id join player player2 on partnerId = player2.id join player player3 on oppPlayer1 = player3.id join player player4 on oppPlayer2 = player4.id order by date, gameType ",[id,id,id,id],function(err,rows){
    if(err) return done(err)
    done(null,rows)
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

exports.findElgiblePlayersFromTeamIdAndSelected = function(teamName,gender, first, second, third,done){
  db.get().query('SELECT player.id, player.first_name, player.family_name, CASE WHEN LEVENSHTEIN(CONCAT(player.first_name, " ", player.family_name), ?) < 6 THEN TRUE ELSE FALSE END AS first, CASE WHEN LEVENSHTEIN(CONCAT(player.first_name, " ", player.family_name), ?) < 6 THEN TRUE ELSE FALSE END AS second, CASE WHEN LEVENSHTEIN(CONCAT(player.first_name, " ", player.family_name), ?) < 6 THEN TRUE ELSE FALSE END AS third FROM (SELECT team.id, team.name, team.rank FROM (SELECT club.id, club.name, team.rank AS originalRank FROM team JOIN club WHERE team.club = club.id AND levenshtein(team.name,?) < 1) AS a JOIN team WHERE a.id = team.club AND team.rank >= originalRank) AS b JOIN player WHERE player.team = b.id AND player.gender = ?',[first, second, third, teamName, gender],function(err,rows){
    if(err) return done(err)
    done(null,rows)
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
exports.getByName = function(playerName,done){
  db.get().query('SELECT * FROM player where levenshtein(concat(first_name," ",family_name), ?) < 4',playerName, function (err, rows){
    if (err) return done(err);
    done(null,rows);
  })
}

exports.getByNameAndTeam = function(playerName,teamId,distance,done){
  db.get().query('select * from (select player.id as playerId, concat(first_name," ",family_name) as playerName, team.id as teamId, team.name as teamName from player join team where player.team = team.id) as playerClub where teamId=? AND levenshtein(playerName,?) < ?',[teamid,playerName,distance], function (err, rows){
    if (err) return done(err);
    done(null,rows);
  })
}

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
