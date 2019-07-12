var db = require('../db_connect.js');

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

exports.getLeagueTable = function(division,done){
  db.get().query('Select c.name, c.played, c.pointsFor, c.pointsAgainst from (Select team.name, b.played, b.pointsFor, b.pointsAgainst, team.division from (select a.date, sum(a.played) as played, sum(a.pointsFor) as pointsFor, sum(a.pointsAgainst) as pointsAgainst, a.teamId from (select fixture.date, CASE WHEN fixture.homeScore is not null Then 1 ELSE 0 END as played, CASE WHEN fixture.homeScore > 9 Then 1 ELSE 0 END as gamesWon, CASE WHEN fixture.homeScore = 9 Then 1 ELSE 0 END as gamesDrawn, homeScore as pointsFor, awayScore as pointsAgainst, fixture.homeTeam as teamId FROM badminton.fixture UNION ALL select fixture.date, CASE WHEN fixture.awayScore is not null Then 1 ELSE 0 END as played, CASE WHEN fixture.awayScore > 9 Then 1 ELSE 0 END as gamesWon, CASE WHEN fixture.awayScore = 9 Then 1 ELSE 0 END as gamesDrawn, awayScore as pointsFor, homeScore as pointsAgainst, fixture.awayTeam as teamId FROM badminton.fixture ) as a group by a.teamid) as b join badminton.team where team.id = b.teamId) as c join badminton.division where c.division = division.id AND division.name = "'+ division.replace('-',' ') +'" AND division.league = 1 ORDER BY pointsFor DESC',function(err,result){
    if (err){
      return done(err);
    }
    else {
      // console.log(result);
      done(null,result);
    }
  })
}

exports.getAllLeagueTables = function(done){
  db.get().query('SELECT division.name AS divisionName, id AS division, c.name, c.played, c.pointsFor, c.pointsAgainst, c.divRank FROM (SELECT team.name, b.played, b.pointsFor, b.pointsAgainst, team.division, team.divRank FROM (SELECT SUM(a.played) AS played, SUM(a.pointsFor) AS pointsFor, SUM(a.pointsAgainst) AS pointsAgainst, a.teamId FROM (SELECT fixture.date, CASE WHEN fixture.homeScore IS NOT NULL THEN 1 ELSE 0 END AS played, CASE WHEN fixture.homeScore > 9 THEN 1 ELSE 0 END AS gamesWon, CASE WHEN fixture.homeScore = 9 THEN 1 ELSE 0 END AS gamesDrawn, homeScore AS pointsFor, awayScore AS pointsAgainst, fixture.homeTeam AS teamId FROM badminton.fixture UNION ALL SELECT fixture.date, CASE WHEN fixture.awayScore IS NOT NULL THEN 1 ELSE 0 END AS played, CASE WHEN fixture.awayScore > 9 THEN 1 ELSE 0 END AS gamesWon, CASE WHEN fixture.awayScore = 9 THEN 1 ELSE 0 END AS gamesDrawn, awayScore AS pointsFor, homeScore AS pointsAgainst, fixture.awayTeam AS teamId FROM badminton.fixture) AS a GROUP BY a.teamid) AS b JOIN badminton.team WHERE team.id = b.teamId) AS c JOIN badminton.division WHERE c.division = division.id AND division.league = 1 ORDER BY division , pointsFor DESC, divRank',function(err,result){
    if (err) return done(err);
    done(null,result);
  })
}



