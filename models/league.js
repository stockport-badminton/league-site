var db = require('../db_connect.js');


var SEASON = '';
if (new Date().getMonth() < 7){
  SEASON = '' + new Date().getFullYear()-1 +''+ new Date().getFullYear();
}
else {
  SEASON = '' + new Date().getFullYear() +''+ (new Date().getFullYear()+1);
}

// POST
exports.create = function(name,admin,url,done){
  db.get().query('INSERT INTO `league` (`name`,`admin`,`url`) VALUES (?,?,?)',[name,admin,url],function(err,result){
    if (err) return done(err);
    done(null,result.insertId);
  });

}

// GET
exports.getAll = function(done){
  db.get().query('SELECT * FROM `league`', function (err, rows){
    if (err) return done(err);
    done(null, rows);
  })
}

// GET
exports.getById = function(leagueId,done){
  db.get().query('SELECT * FROM `league` WHERE `id` = ?',leagueId, function (err, rows){
    if (err) return done(err);
    done(null,rows);
  })
}

// DELETE
exports.deleteById = function(leagueId,done){
  db.get().query('DELETE FROM `league` WHERE `id` = ?',leagueId, function (err, rows){
    if (err) return done(err);
    done(null,rows);
  })
}

// PATCH
exports.updateById = function(name, admin, url, leagueId,done){
  db.get().query('UPDATE `league` SET `name` = ?, `admin` = ?, `url` = ? WHERE `id` = ?',[name, admin, url, leagueId], function (err, rows){
    if (err) return done(err);
    //console.log(rows);
    done(null,rows);
  })
}

exports.getLeagueTable = function(division,season,done){
  if (season === undefined){
    seasonName = ''
    season = SEASON;
  }
  else {
    seasonName = season + ' as team'
  }
  division = division.replace('-',' ');
  db.get().query('SELECT c.name, c.played, c.pointsFor, c.pointsAgainst FROM (SELECT team.name, b.played, b.pointsFor - team.penalties as pointsFor, b.pointsAgainst, team.division FROM (SELECT a.date, SUM(a.played) AS played, SUM(a.pointsFor) AS pointsFor, SUM(a.pointsAgainst) AS pointsAgainst, a.teamId FROM (SELECT fixture.date, CASE WHEN fixture.homeScore IS NOT NULL THEN 1 ELSE 0 END AS played, CASE WHEN fixture.homeScore > 9 THEN 1 ELSE 0 END AS gamesWon, CASE WHEN fixture.homeScore = 9 THEN 1 ELSE 0 END AS gamesDrawn, homeScore AS pointsFor, awayScore AS pointsAgainst, fixture.homeTeam AS teamId FROM fixture join season where season.name = ? AND fixture.date > season.startDate AND fixture.date < season.endDate UNION ALL SELECT fixture.date, CASE WHEN fixture.awayScore IS NOT NULL THEN 1 ELSE 0 END AS played, CASE WHEN fixture.awayScore > 9 THEN 1 ELSE 0 END AS gamesWon, CASE WHEN fixture.awayScore = 9 THEN 1 ELSE 0 END AS gamesDrawn, awayScore AS pointsFor, homeScore AS pointsAgainst, fixture.awayTeam AS teamId FROM fixture join season where season.name = ? AND fixture.date > season.startDate AND fixture.date < season.endDate) AS a GROUP BY a.teamid) AS b JOIN team'+seasonName+' WHERE team.id = b.teamId) AS c JOIN division WHERE c.division = division.id AND division.name = ? AND division.league = 1 ORDER BY pointsFor DESC',[season,season,division],function(err,result){
    console.log(this.sql);
    if (err){
      // console.log(this.sql)
      return done(err);
    }
    else {
      // console.log(this.sql)
      // console.log(result);
      done(null,result);
    }
  })
}

exports.getAllLeagueTables = function(season,done){
  if (season === undefined){
    seasonName = ''
    divisionSeason = ''
    season = SEASON
  }
  else {
    seasonName = season + ' as team'
    divisionSeason = season + ' as division'
  }
  db.get().query('SELECT division.name AS divisionName, id AS division, c.name, c.played, c.pointsFor, c.pointsAgainst, c.divRank FROM (SELECT team.name, b.played, b.pointsFor - team.penalties as pointsFor, b.pointsAgainst, team.division, team.divRank FROM (SELECT SUM(a.played) AS played, SUM(a.pointsFor) AS pointsFor, SUM(a.pointsAgainst) AS pointsAgainst, a.teamId FROM (SELECT fixture.date, CASE WHEN fixture.homeScore IS NOT NULL THEN 1 ELSE 0 END AS played, CASE WHEN fixture.homeScore > 9 THEN 1 ELSE 0 END AS gamesWon, CASE WHEN fixture.homeScore = 9 THEN 1 ELSE 0 END AS gamesDrawn, homeScore AS pointsFor, awayScore AS pointsAgainst, fixture.homeTeam AS teamId FROM fixture JOIN season WHERE season.name = ? AND fixture.date > season.startDate AND fixture.date < season.endDate UNION ALL SELECT fixture.date, CASE WHEN fixture.awayScore IS NOT NULL THEN 1 ELSE 0 END AS played, CASE WHEN fixture.awayScore > 9 THEN 1 ELSE 0 END AS gamesWon, CASE WHEN fixture.awayScore = 9 THEN 1 ELSE 0 END AS gamesDrawn, awayScore AS pointsFor, homeScore AS pointsAgainst, fixture.awayTeam AS teamId FROM fixture JOIN season WHERE season.name = ? AND fixture.date > season.startDate AND fixture.date < season.endDate) AS a GROUP BY a.teamid) AS b JOIN team'+seasonName+' WHERE team.id = b.teamId) AS c JOIN division'+divisionSeason+' WHERE c.division = division.id AND division.league = 1 ORDER BY division , pointsFor DESC , divRank',[season,season],function(err,result){
    console.log(this.sql)
    if (err) return done(err);
    done(null,result);
  })
}



