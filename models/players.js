var db = require('../db_connect.js');
var logger = require('logzio-nodejs').createLogger({
  token: process.env.LOGZ_SECRET,
  host: 'listener-uk.logz.io'
 });
const levenshtein = require('js-levenshtein');
var SEASON = '';
if (new Date().getMonth() < 7){
  SEASON = '' + new Date().getFullYear()-1 +''+ new Date().getFullYear();
}
else {
  SEASON = '' + new Date().getFullYear() +''+ (new Date().getFullYear()+1);
}


// POST
exports.create = function(first_name,family_name,team,club,gender,done){
  var date_of_registration = new Date();
  db.get().query('INSERT INTO `player` (`first_name`,`family_name`,`date_of_registration`,`team`,`club`,`gender`) VALUES (?,?,?,?,?,?)',[first_name,family_name,date_of_registration,team,club,gender],function(err,result){
    if (err) return done(err);
    console.log(this.sql);
    console.log(result)
    done(null,result);
  });

}

exports.createByName = function(obj,done){
  if(db.isObject(obj)){
    sql = 'insert into player (first_name, family_name, gender, club, team, date_of_registration) values (?, ?, ?,(select id from club where name = ?),(select id from team where name = ?),?)'
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

exports.updateBulk = function(BatchObj,done){
  if(db.isObject(BatchObj)){
    console.log(BatchObj);
    
    // console.log(sql);
    var containerArray = [];
    var updateArray = [];
    var updateValuesString = '';
    for (x in BatchObj.data){
      var sql = 'UPDATE `'+BatchObj.tablename+'` SET ';
      updateArray = [];
      for (y in BatchObj.data[x]){
        console.log(BatchObj.data[x][y])
        if (BatchObj.fields[y] == 'id'){
          var whereCondition = ' where `id` = ' + BatchObj.data[x][y]
          continue;
        }
        else if (BatchObj.fields[y] == 'playerTel' || BatchObj.fields[y] == 'playerEmail'){
          updateArray.push('`'+BatchObj.fields[y]+'` = aes_encrypt("'+ BatchObj.data[x][y] +'","'+ process.env.DB_PI_KEY +'")');    
        }
        else {
          updateArray.push('`'+BatchObj.fields[y]+'` = "'+ BatchObj.data[x][y] +'"');
        }
      }
      updateValuesString = updateArray.join(',')

      containerArray.push(sql + updateValuesString + whereCondition) 
    }
    // console.log(containerArray);
    sql = containerArray.join(';')
    console.log(sql);
    // done(null,sql)
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
  db.get().query('SELECT * FROM `player`', function (err, rows){
    if (err) return done(err);
    done(null, rows);
  })
}

// GET
exports.getNominatedPlayers = function(teamName,done){
  db.get().query("SELECT CONCAT(first_name, ' ', family_name) AS name, gender FROM player JOIN team WHERE team.id = player.team AND team.name = ? AND player.rank IS NOT NULL ORDER BY gender , player.rank",teamName, function (err, rows){
    logger.log(this.sql)
    if (err) return done(err);
    done(null, rows);
  })
}

exports.getMatchStats = function(fixtureId,done){
  db.get().query("SET @fixtureId = ?; SELECT concat(player.first_name,' ',player.family_name) AS name ,team.name AS teamName ,b.avgPtsFor ,b.avgPtsAgainst ,gamesWon FROM ( SELECT playerId ,AVG(ptsFor) AS avgPtsFor ,AVG(ptsAgainst) AS avgPtsAgainst ,SUM(won) AS gamesWon FROM ( SELECT homePlayer1 AS playerId ,homeScore AS ptsFor ,awayScore AS ptsAgainst ,CASE WHEN homeScore > awayScore THEN 1 ELSE 0 END AS won FROM game WHERE fixture = @fixtureId AND (awayPlayer1 !=0 AND awayPlayer2 != 0 AND homePlayer2 != 0 AND homePlayer1 !=0) UNION ALL SELECT homePlayer2 AS playerId ,homeScore AS ptsFor ,awayScore AS ptsAgainst ,CASE WHEN homeScore > awayScore THEN 1 ELSE 0 END AS won FROM game WHERE fixture = @fixtureId AND (awayPlayer1 !=0 AND awayPlayer2 != 0 AND homePlayer2 != 0 AND homePlayer1 !=0) UNION ALL SELECT awayPlayer1 AS playerId ,awayScore AS ptsFor ,homeScore AS ptsAgainst ,CASE WHEN homeScore < awayScore THEN 1 ELSE 0 END AS won FROM game WHERE fixture = @fixtureId AND (awayPlayer1 !=0 AND awayPlayer2 != 0 AND homePlayer2 != 0 AND homePlayer1 !=0) UNION ALL SELECT awayPlayer2 AS playerId ,awayScore AS ptsFor ,homeScore AS ptsAgainst ,CASE WHEN homeScore < awayScore THEN 1 ELSE 0 END AS won FROM game WHERE fixture = @fixtureId AND (awayPlayer1 !=0 AND awayPlayer2 != 0 AND homePlayer2 != 0 AND homePlayer1 !=0) ) AS a GROUP BY playerId ) AS b JOIN player ON b.playerId = player.id JOIN team ON player.team = team.id ORDER BY teamName, gamesWon desc, avgPtsAgainst asc",fixtureId,function(err,rows){
    console.log(this.sql)
    if (err) return done(err);
    done (null,rows)
  })
}


exports.getNamesClubsTeams = function(searchTerms,done){
  var whereTerms = [];
  var whereValue = [];
  var nameMatch = ""
  if (!searchTerms.name){
    console.log("no name search");
  }
  else {
    var letter = searchTerms.name.substr(0,1);
    nameMatch = "AND (player.first_name like '"+letter+"%' OR player.family_name like '"+letter+"%')" 
  }
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
    db.get().query("select * from (select playerId, a.name, gender, date_of_registration, a.rank, club.id as clubId, club.name as clubName, teamName, teamId from (SELECT player.id as playerID, concat(first_name, ' ', family_name) as name, gender, date_of_registration, player.rank, team.id as teamId, team.name as teamName, player.club as clubId from player join team where team.id = player.team "+ nameMatch +") as a join club where a.clubId = club.id ) as b"+conditions+" order by teamName, gender, rank",whereValue,function(err,rows){
      console.log(this.sql);
      if (err) return done(err);
      done(null,rows);
    })
  }
  else {
    db.get().query("select playerId, a.name, gender, date_of_registration, a.rank, club.id as clubId, club.name as clubName, teamName, teamId from (SELECT player.id as playerID, concat(first_name, ' ', family_name) as name, gender, date_of_registration, player.rank, team.id as teamId, team.name as teamName, player.club as clubId from player join team where team.id = player.team "+ nameMatch +") as a join club where a.clubId = club.id order by teamName, gender, rank",function(err,rows){
      console.log(this.sql);
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
  console.log(searchTerms);

  var whereTerms = [];
  var whereValue = []
  var conditions = "";
  var season = ""
  var seasonVal = SEASON

  if (!searchTerms.season){
    console.log("no season");
  }
  else {
    season = searchTerms.season;
    seasonVal = searchTerms.season;
  }
  if (!searchTerms.gender){
    console.log("no gender");
    whereValue.push('%');
  }
  else {
    whereTerms.push('`gender` = ?');
    whereValue.push(searchTerms.gender)
  }
  if (!searchTerms.team){
    console.log("no team");
    whereValue.push("%");
  }
  else {
    whereValue.push(searchTerms.team)
  }
  if (!searchTerms.club){
    console.log("no club");
    whereValue.push("%");
  }
  else {
    whereValue.push(searchTerms.club)
  }
  if (!searchTerms.gameType){
    console.log("no gameType");
    whereValue.push("%");
  }
  else {
    whereTerms.push('`gameType` = ?');
    whereValue.push(searchTerms.gameType)
  }
  if (!searchTerms.divisionId){
    console.log("no division id");
    whereValue.push("%");
  }
  else {
    whereTerms.push('`division` = ?');
    whereValue.push(searchTerms.divisionId)
  }
  console.log(whereTerms)
  console.log(whereValue);

  if (whereTerms.length > 0) {
    var conditions = whereTerms.join(' AND ');
    console.log(conditions);
    conditions = ' WHERE '+ conditions
  }
  var seasonArray = [seasonVal,seasonVal,seasonVal,seasonVal]
  whereValue = seasonArray.concat(whereValue)
  console.log(whereValue)
  
  var sql = "DROP TABLE IF EXISTS gameSummary; CREATE TEMPORARY TABLE gameSummary AS SELECT b.id ,b.homePlayer1 AS playerId ,b.playergender ,b.homeScore AS forPoints ,b.awayScore AS againstPoints ,CASE WHEN b.homeScore > b.awayScore THEN 1 ELSE 0 END AS gamesWon ,CASE WHEN b.homeScore IS NOT NULL THEN 1 ELSE 0 END AS gamesPlayed ,b.fixture ,b.homeTeam AS team ,b.awayTeam AS opposition ,b.gameType ,team.division FROM ( SELECT a.* ,CASE WHEN homePlayer1.gender = homePlayer2.gender AND homePlayer1.gender = 'Male' THEN 'Mens' WHEN homePlayer1.gender = homePlayer2.gender AND homePlayer1.gender = 'Female' THEN 'Ladies' ELSE 'Mixed' END AS gameType ,homePlayer1.gender AS playergender FROM ( SELECT game.id ,game.homePlayer1 ,game.homePlayer2 ,game.awayPlayer1 ,game.awayPlayer2 ,game.homeScore ,game.awayScore ,game.fixture ,seasonFixtures.homeTeam ,seasonFixtures.awayTeam FROM ( SELECT fixture.id ,fixture.homeTeam ,fixture.awayTeam FROM fixture JOIN season WHERE season.name = ? AND fixture.date > season.startDate AND fixture.date < season.endDate ) AS seasonFixtures JOIN game WHERE game.fixture = seasonFixtures.id AND (game.homePlayer1 != 0 OR game.homePlayer2 != 0 or game.awayPlayer1 !=0 or game.awayPlayer2 !=0) ) AS a JOIN player"+ season + " homePlayer1 ON a.homePlayer1 = homePlayer1.id AND a.homePlayer1 !=0 JOIN player"+ season + " homePlayer2 ON a.homePlayer2 = homePlayer2.id AND a.homePlayer2 != 0 ) AS b JOIN team"+ season + " team WHERE homeTeam = team.id UNION ALL SELECT b.id ,b.homePlayer2 AS playerId ,b.playergender ,b.homeScore AS forPoints ,b.awayScore AS againstPoints ,CASE WHEN b.homeScore > b.awayScore THEN 1 ELSE 0 END AS gamesWon ,CASE WHEN b.homeScore IS NOT NULL THEN 1 ELSE 0 END AS gamesPlayed ,b.fixture ,b.homeTeam AS team ,b.awayTeam AS opposition ,b.gameType ,team.division FROM ( SELECT a.* ,CASE WHEN homePlayer1.gender = homePlayer2.gender AND homePlayer1.gender = 'Male' THEN 'Mens' WHEN homePlayer1.gender = homePlayer2.gender AND homePlayer1.gender = 'Female' THEN 'Ladies' ELSE 'Mixed' END AS gameType ,homePlayer1.gender AS playergender FROM ( SELECT game.id ,game.homePlayer1 ,game.homePlayer2 ,game.awayPlayer1 ,game.awayPlayer2 ,game.homeScore ,game.awayScore ,game.fixture ,seasonFixtures.homeTeam ,seasonFixtures.awayTeam FROM ( SELECT fixture.id ,fixture.homeTeam ,fixture.awayTeam FROM fixture JOIN season WHERE season.name = ? AND fixture.date > season.startDate AND fixture.date < season.endDate ) AS seasonFixtures JOIN game WHERE game.fixture = seasonFixtures.id AND (game.homePlayer1 != 0 OR game.homePlayer2 != 0 or game.awayPlayer1 !=0 or game.awayPlayer2 !=0) ) AS a JOIN player"+ season + " homePlayer1 ON a.homePlayer1 = homePlayer1.id AND a.homePlayer1 !=0 JOIN player"+ season + " homePlayer2 ON a.homePlayer2 = homePlayer2.id AND a.homePlayer2 != 0 ) AS b JOIN team"+ season + " team WHERE homeTeam = team.id UNION ALL SELECT b.id ,b.awayPlayer1 AS playerId ,b.playergender ,b.awayScore AS forPoints ,b.homeScore AS againstPoints ,CASE WHEN b.awayScore > b.homeScore THEN 1 ELSE 0 END AS gamesWon ,CASE WHEN b.homeScore IS NOT NULL THEN 1 ELSE 0 END AS gamesPlayed ,b.fixture ,b.awayTeam AS team ,b.homeTeam AS opposition ,b.gameType ,team.division FROM ( SELECT a.* ,CASE WHEN homePlayer1.gender = homePlayer2.gender AND homePlayer1.gender = 'Male' THEN 'Mens' WHEN homePlayer1.gender = homePlayer2.gender AND homePlayer1.gender = 'Female' THEN 'Ladies' ELSE 'Mixed' END AS gameType ,homePlayer1.gender AS playergender FROM ( SELECT game.id ,game.homePlayer1 ,game.homePlayer2 ,game.awayPlayer1 ,game.awayPlayer2 ,game.homeScore ,game.awayScore ,game.fixture ,seasonFixtures.homeTeam ,seasonFixtures.awayTeam FROM ( SELECT fixture.id ,fixture.homeTeam ,fixture.awayTeam FROM fixture JOIN season WHERE season.name = ? AND fixture.date > season.startDate AND fixture.date < season.endDate ) AS seasonFixtures JOIN game WHERE game.fixture = seasonFixtures.id AND (game.homePlayer1 != 0 OR game.homePlayer2 != 0 or game.awayPlayer1 !=0 or game.awayPlayer2 !=0) ) AS a JOIN player"+ season + " homePlayer1 ON a.homePlayer1 = homePlayer1.id AND a.homePlayer1 !=0 JOIN player"+ season + " homePlayer2 ON a.homePlayer2 = homePlayer2.id AND a.homePlayer2 != 0 ) AS b JOIN team"+ season + " team ON homeTeam = team.id UNION ALL SELECT b.id ,b.awayPlayer2 AS playerId ,b.playergender ,b.awayScore AS forPoints ,b.homeScore AS againstPoints ,CASE WHEN b.awayScore > b.homeScore THEN 1 ELSE 0 END AS gamesWon ,CASE WHEN b.homeScore IS NOT NULL THEN 1 ELSE 0 END AS gamesPlayed ,b.fixture ,b.awayTeam AS team ,b.homeTeam AS opposition ,b.gameType ,team.division FROM ( SELECT a.* ,CASE WHEN homePlayer1.gender = homePlayer2.gender AND homePlayer1.gender = 'Male' THEN 'Mens' WHEN homePlayer1.gender = homePlayer2.gender AND homePlayer1.gender = 'Female' THEN 'Ladies' ELSE 'Mixed' END AS gameType ,homePlayer1.gender AS playergender FROM ( SELECT game.id ,game.homePlayer1 ,game.homePlayer2 ,game.awayPlayer1 ,game.awayPlayer2 ,game.homeScore ,game.awayScore ,game.fixture ,seasonFixtures.homeTeam ,seasonFixtures.awayTeam FROM ( SELECT fixture.id ,fixture.homeTeam ,fixture.awayTeam FROM fixture JOIN season WHERE season.name = ? AND fixture.date > season.startDate AND fixture.date < season.endDate ) AS seasonFixtures JOIN game WHERE game.fixture = seasonFixtures.id AND (game.homePlayer1 != 0 OR game.homePlayer2 != 0 or game.awayPlayer1 !=0 or game.awayPlayer2 !=0) ) AS a JOIN player"+ season + " homePlayer1 ON a.homePlayer1 = homePlayer1.id AND a.homePlayer1 !=0 JOIN player"+ season + " homePlayer2 ON a.homePlayer2 = homePlayer2.id AND a.homePlayer2 != 0 ) AS b JOIN team"+ season + " team ON homeTeam = team.id; SELECT CONCAT(player.first_name,' ',player.family_name) AS name ,playerId ,playergender, gameType, a.division ,SUM(forPoints) AS forPoints ,SUM(againstPoints) AS againstPoints ,SUM(gamesWon) AS gamesWon ,SUM(gamesPlayed) AS gamesPlayed ,(sum(gamesPlayed) + sum(gamesWon)) - (sum(gamesPlayed) - sum(gamesWon)) as Points, club.name AS clubName ,team.name AS teamName FROM ( SELECT * FROM gameSummary ) AS a JOIN player"+ season + " player ON playerId = player.id AND player.gender Like ? JOIN team"+ season + " team ON team.id = player.team AND team.name LIKE ? JOIN club"+ season + " club ON club.id = player.club AND club.name LIKE ? where gameType like ? AND a.division like ? GROUP BY playerId ORDER BY Points DESC;"
    db.get().query(sql,whereValue,function (err,rows){
      console.log(this.sql)
      logger.log(this.sql);
      if (err){
        console.log("getPlayerStats model error")
        console.log(err)
        return done(err)
      }
      else{
        console.log(this.sql)
        // console.log("getPlayerStats model success")
        //console.log(rows[2])
        done(null,rows[2])
      }
    })


}

exports.getPairStats = function(searchTerms,done){
  // console.log(searchTerms);

  var whereTerms = [];
  var whereValue = []
  var conditions = "";
  var season = ""
  var seasonVal = SEASON

  if (!searchTerms.season){
    console.log("no season");
  }
  else {
    season = searchTerms.season;
    seasonVal = searchTerms.season;
  }
  if (!searchTerms.divisionId){
    console.log("no division id");
  }
  else {
    whereTerms.push('`division` = ?');
    whereValue.push(searchTerms.divisionId)
  }
  if (!searchTerms.team){
    console.log("no team");
    whereValue.push("%");
  }
  else {
    whereValue.push(searchTerms.team)
  }
  if (!searchTerms.club){
    console.log("no club");
    whereValue.push("%");
  }
  else {
    whereValue.push(searchTerms.club)
  }
  if (!searchTerms.gameType){
    console.log("no gameType");
    whereValue.push("%");
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
  }
  var seasonArray = [seasonVal,seasonVal]
  whereValue = seasonArray.concat(whereValue)
  
  var sql = "DROP TABLE IF EXISTS PairsgameSummary; CREATE TEMPORARY TABLE PairsgameSummary AS SELECT b.id, least(b.homePlayer1,b.homePlayer2) AS player1Id, greatest(b.homePlayer1,b.homePlayer2) AS player2Id, b.homeScore AS forPoints ,b.awayScore AS againstPoints ,CASE WHEN b.homeScore > b.awayScore THEN 1 ELSE 0 END AS gamesWon ,CASE WHEN b.homeScore IS NOT NULL THEN 1 ELSE 0 END AS gamesPlayed ,b.fixture ,b.homeTeam AS team ,b.awayTeam AS opposition ,b.gameType ,team.division FROM ( SELECT a.* ,CASE WHEN homePlayer1.gender = homePlayer2.gender AND homePlayer1.gender = 'Male' THEN 'Mens' WHEN homePlayer1.gender = homePlayer2.gender AND homePlayer1.gender = 'Female' THEN 'Ladies' ELSE 'Mixed' END AS gameType ,homePlayer1.gender AS playergender FROM ( SELECT game.id ,game.homePlayer1 ,game.homePlayer2 ,game.awayPlayer1 ,game.awayPlayer2 ,game.homeScore ,game.awayScore ,game.fixture ,seasonFixtures.homeTeam ,seasonFixtures.awayTeam FROM ( SELECT fixture.id ,fixture.homeTeam ,fixture.awayTeam FROM fixture JOIN season ON season.name = ? AND fixture.date > season.startDate AND fixture.date < season.endDate ) AS seasonFixtures JOIN game ON game.fixture = seasonFixtures.id AND (game.homePlayer1 != 0 OR game.homePlayer2 != 0 or game.awayPlayer1 !=0 or game.awayPlayer2 !=0) ) AS a JOIN player" + season +" homePlayer1 ON a.homePlayer1 = homePlayer1.id AND a.homePlayer1 !=0 JOIN player" + season +" homePlayer2 ON a.homePlayer2 = homePlayer2.id AND a.homePlayer2 != 0 AND homePlayer2 !=0 ) AS b JOIN team" + season +" team ON homeTeam = team.id UNION ALL SELECT b.id, least(b.awayPlayer1,b.awayPlayer2) AS player1Id, greatest(b.awayPlayer2,b.awayPlayer1) AS player2Id, b.awayScore AS forPoints ,b.homeScore AS againstPoints ,CASE WHEN b.awayScore > b.homeScore THEN 1 ELSE 0 END AS gamesWon ,CASE WHEN b.homeScore IS NOT NULL THEN 1 ELSE 0 END AS gamesPlayed ,b.fixture ,b.awayTeam AS team ,b.homeTeam AS opposition ,b.gameType ,team.division FROM ( SELECT a.* ,CASE WHEN homePlayer1.gender = homePlayer2.gender AND homePlayer1.gender = 'Male' THEN 'Mens' WHEN homePlayer1.gender = homePlayer2.gender AND homePlayer1.gender = 'Female' THEN 'Ladies' ELSE 'Mixed' END AS gameType ,homePlayer1.gender AS playergender FROM ( SELECT game.id ,game.homePlayer1 ,game.homePlayer2 ,game.awayPlayer1 ,game.awayPlayer2 ,game.homeScore ,game.awayScore ,game.fixture ,seasonFixtures.homeTeam ,seasonFixtures.awayTeam FROM ( SELECT fixture.id ,fixture.homeTeam ,fixture.awayTeam FROM fixture JOIN season ON season.name = ? AND fixture.date > season.startDate AND fixture.date < season.endDate ) AS seasonFixtures JOIN game ON game.fixture = seasonFixtures.id AND (game.homePlayer1 != 0 OR game.homePlayer2 != 0 or game.awayPlayer1 !=0 or game.awayPlayer2 !=0) ) AS a JOIN player" + season +" homePlayer1 ON a.homePlayer1 = homePlayer1.id AND a.homePlayer1 !=0 JOIN player" + season +" homePlayer2 ON a.homePlayer2 = homePlayer2.id AND a.homePlayer2 != 0 AND homePlayer2 !=0 ) AS b JOIN team" + season +" team ON homeTeam = team.id; SELECT concat(Player1.first_name,' ', Player1.family_name, ' & ', Player2.first_name, ' ', Player2.family_name) as Pairing ,player1Id ,player2Id ,SUM(forPoints) AS forPoints ,SUM(againstPoints) AS againstPoints ,SUM(gamesWon) AS gamesWon ,SUM(gamesPlayed) AS gamesPlayed ,SUM(gamesWon) / SUM(gamesPlayed) As winRate, (sum(gamesWon) + sum(gamesPlayed)) - (sum(gamesPlayed) - sum(gamesWon)) as Points, club.name AS clubName ,team.name AS teamName ,gameType FROM ( SELECT * FROM PairsgameSummary ) AS a JOIN player" + season +" Player1 ON Player1.id = a.player1Id JOIN player" + season +" Player2 ON Player2.id = a.player2Id JOIN team" + season +" team ON team.id = Player1.team AND team.name LIKE ? JOIN club" + season +" club ON club.id = Player1.club AND club.name LIKE ? AND gameType like ? GROUP BY Pairing ORDER BY winRate DESC, Points DESC;"
    console.log(sql);
    db.get().query(sql,whereValue,function (err,rows){
      console.log(this.sql)
      logger.log(this.sql);
      if (err){
        console.log("getPairStats model error")
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

exports.getEmails = async function(searchTerms,done){
  console.log(searchTerms);
  var sql = "SELECT DISTINCT b.playerEmail FROM (SELECT a.*, CAST(AES_DECRYPT(player.playerEmail, '"+process.env.DB_PI_KEY+"') AS CHAR) AS playerEmail FROM (SELECT club.id, club.name AS clubName, team.id AS teamId, team.name AS teamName, club.matchSec, club.clubSec, team.captain, team.division, 'match Sec' AS role FROM club JOIN team ON team.club = club.id) AS a JOIN player ON a.matchSec = player.id OR (player.matchSecrertary = 1 AND a.id = player.club) UNION ALL SELECT a.*, CAST(AES_DECRYPT(player.playerEmail, '"+process.env.DB_PI_KEY+"') AS CHAR) AS playerEmail FROM (SELECT club.id, club.name AS clubName, team.id AS teamId, team.name AS teamName, club.matchSec, club.clubSec, team.captain, team.division, 'club Sec' AS role FROM club JOIN team ON team.club = club.id) AS a JOIN player ON a.clubSec = player.id OR (player.clubSecretary = 1 AND a.id = player.club) UNION ALL SELECT a.*, CAST(AES_DECRYPT(player.playerEmail, '"+process.env.DB_PI_KEY+"') AS CHAR) AS playerEmail FROM (SELECT club.id, club.name AS clubName, team.id AS teamId, team.name AS teamName, club.matchSec, club.clubSec, team.captain, team.division, 'team Captain' AS role FROM club JOIN team ON team.club = club.id) AS a JOIN player ON (player.teamCaptain = 1 AND a.teamId = player.team) or a.captain = player.id UNION ALL SELECT a.*, CAST(AES_DECRYPT(player.playerEmail, '"+process.env.DB_PI_KEY+"') AS CHAR) AS playerEmail FROM (SELECT club.id, club.name AS clubName, team.id AS teamId, team.name AS teamName, club.matchSec, club.clubSec, team.captain, team.division, 'treasurer' AS role FROM club JOIN team ON team.club = club.id) AS a JOIN player ON (player.treasurer = 1 AND a.teamId = player.team) UNION ALL SELECT a.*, CAST(AES_DECRYPT(player.playerEmail, '"+process.env.DB_PI_KEY+"') AS CHAR) AS playerEmail FROM (SELECT club.id, club.name AS clubName, team.id AS teamId, team.name AS teamName, club.matchSec, club.clubSec, team.captain, team.division, 'otherComms' AS role FROM club JOIN team ON team.club = club.id) AS a JOIN player ON (player.otherComms = 1 AND a.teamId = player.team)) AS b"
  var whereTerms = [];
  if (!searchTerms.role){
    console.log("no role selected");
  }
  else {
    whereTerms.push('b.role = "'+searchTerms.role+'"');
  }
  if (!searchTerms.division){
    console.log("no division");
  }
  else {
    whereTerms.push('b.division = '+searchTerms.division );
  }
  if (!searchTerms.club){
    console.log("no club id");
  }
  else {
    whereTerms.push('b.id = "'+searchTerms.club + '"');
  }
  if (!searchTerms.teamName){
    console.log("no teamName");
  }
  else {
    whereTerms.push('b.teamName = "'+searchTerms.teamName + '"');
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
    conditions = ' WHERE ' + conditions + ' order by teamName,gender,rank';
    // console.log(conditions);
    sql = sql + conditions
  }
  db.get().query(sql, function (err, rows){
    if (err) return done(err);
    done(null, rows);
  })
}

exports.findElgiblePlayersFromTeamId = function(id,gender,done){
  db.get().query('select player.id, player.first_name, player.family_name, b.rank as teamRank, player.rank as playerRank from (select team.id, team.name, team.rank from (SELECT club.id, club.name, team.rank as originalRank FROM team JOIN club WHERE team.club = club.id AND team.id = ?) as a join team where a.id = team.club AND team.rank >= originalRank) as b join player where player.team = b.id AND player.gender= ? order by b.rank asc,player.rank desc, player.family_name',[id,gender],function(err,result){
    console.log(this.sql);
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
    logger.log(this.sql);
    if(err) return done(err)
    done(null,rows)
  })
}

exports.getEligiblePlayersAndSelectedById = function(first, second, third, teamId,gender,done){
  db.get().query('SELECT player.id ,player.first_name ,player.family_name, case when player.id = ? then 1 else 0 end as first, case when player.id = ? then 1 else 0 end as second, case when player.id = ? then 1 else 0 end as third FROM ( SELECT team.id ,team.name ,team.rank FROM ( SELECT club.id ,club.name ,team.rank AS originalRank FROM team JOIN club WHERE team.club = club.id AND team.id like ? ) AS a JOIN team WHERE a.id = team.club AND team.rank >= originalRank ) AS b JOIN player WHERE player.team = b.id AND player.gender = ?',[first, second, third, teamId,gender],function(err,rows){
    logger.log(this.sql);
    if (err) return done(err);
    done(null,rows);
  })
}

exports.findElgiblePlayersFromTeamNameAndSelectedSansLevenshtein = function(teamName,gender,first, second,third,done){
  db.get().query('SELECT player.id ,player.first_name ,player.family_name FROM ( SELECT team.id ,team.name ,team.rank FROM ( SELECT club.id ,club.name ,team.rank AS originalRank FROM team JOIN club WHERE team.club = club.id AND team.name like ? ) AS a JOIN team WHERE a.id = team.club AND team.rank >= originalRank ) AS b JOIN player WHERE player.team = b.id AND player.gender = ?',[teamName, gender],function(err,rows){
    logger.log(this.sql);
    if(err) return done(err)
    else {
      rows[0].first = 1;
      rows[0].second = 1;
      rows[0].third = 1;
      let lowestFirstIndex = [0,levenshtein(rows[0].first_name + " " + rows[0].family_name,first)];
      let lowestSecondIndex = [0,levenshtein(rows[0].first_name + " " + rows[0].family_name,second)];
      let lowestThirdIndex = [0,levenshtein(rows[0].first_name + " " + rows[0].family_name,third)]
      for (let i = 1; i < rows.length; i++){ 
        rowFirstLevenshtein = levenshtein(rows[i].first_name + " " + rows[i].family_name,first);
        rowSecondLevenshtein = levenshtein(rows[i].first_name + " " + rows[i].family_name,second);
        rowThirdLevenshtein = levenshtein(rows[i].first_name + " " + rows[i].family_name,third);
        if (lowestFirstIndex[1] > rowFirstLevenshtein) {
          rows[lowestFirstIndex[0]].first = 0;
          rows[i].first = 1;
          lowestFirstIndex[0] = i;
          lowestFirstIndex[1] = rowFirstLevenshtein;
        } 
        else {
          rows[i].first = 0;
        }
        if (lowestSecondIndex[1] > rowSecondLevenshtein) {
          rows[lowestSecondIndex[0]].second = 0;
          rows[i].second = 1;
          lowestSecondIndex[0] = i;
          lowestSecondIndex[1] = rowSecondLevenshtein;
        } 
        else {
          rows[i].second = 0;
        }

        if (lowestThirdIndex[1] > rowThirdLevenshtein) {
          rows[lowestThirdIndex[0]].third = 0;
          rows[i].third = 1;
          lowestThirdIndex[0] = i;
          lowestThirdIndex[1] = rowThirdLevenshtein;
        } 
        else {
          rows[i].third = 0;
        }
      }
      
      done(null,rows)
    }
    
  })
}

exports.findElgiblePlayersFromTeamIdAndSelectedNew = function(teamName,gender, first, second, third,done){
  db.get().query("SELECT player.id, player.first_name, player.family_name, LEVENSHTEIN(CONCAT(player.first_name, ' ', player.family_name), ?) AS first, LEVENSHTEIN(CONCAT(player.first_name, ' ', player.family_name), ?) AS second, LEVENSHTEIN(CONCAT(player.first_name, ' ', player.family_name), ?) AS third, (LEVENSHTEIN(CONCAT(player.first_name,' ',player.family_name),?) + LEVENSHTEIN(CONCAT(player.first_name,' ',player.family_name),?) + LEVENSHTEIN(CONCAT(player.first_name,' ',player.family_name),?)) as totalLev FROM (SELECT team.id, team.name, team.rank FROM (SELECT club.id, club.name, team.rank AS originalRank FROM team JOIN club WHERE team.club = club.id AND LEVENSHTEIN(team.name, ?) < 1) AS a JOIN team WHERE a.id = team.club AND team.rank >= originalRank) AS b JOIN player WHERE player.team = b.id AND player.gender = ? Order by totalLev asc, first asc, second asc, third asc",[first, second, third, first, second, third,teamName, gender],function(err,rows){
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
