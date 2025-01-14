var db = require('../db_connect.js');


var SEASON = '';
if (new Date().getMonth() < 6){
  SEASON = '' + new Date().getFullYear()-1 +''+ new Date().getFullYear();
}
else {
  SEASON = '' + new Date().getFullYear() +''+ (new Date().getFullYear()+1);
}

// POST
exports.create = async function(name,admin,url,done){
  try {
		 let [result] = await (await db.otherConnect()).query('INSERT INTO `league` (`name`,`admin`,`url`) VALUES (?,?,?)',[name,admin,url])
		done(null,result)
	}
	catch (err) {
		return done (err);
}

}

// GET
exports.getAll = async function(done){
  try {
		 let [result] = await (await db.otherConnect()).query('SELECT * FROM `league`')
		done(null,result)
	}
	catch (err) {
		return done (err);
}
}

// GET
exports.getById = async function(leagueId,done){
  try {
		 let [result] = await (await db.otherConnect()).query('SELECT * FROM `league` WHERE `id` = ?',leagueId)
		done(null,result)
	}
	catch (err) {
		return done (err);
}
}

// DELETE
exports.deleteById = async function(leagueId,done){
  try {
		 let [result] = await (await db.otherConnect()).query('DELETE FROM `league` WHERE `id` = ?',leagueId)
		done(null,result)
	}
	catch (err) {
		return done (err);
}
}

// PATCH
exports.updateById = async function(name, admin, url, leagueId,done){
  try {
		 let [result] = await (await db.otherConnect()).query('UPDATE `league` SET `name` = ?, `admin` = ?, `url` = ? WHERE `id` = ?',[name, admin, url, leagueId])
		done(null,result)
	}
	catch (err) {
		return done (err);
}
}

exports.getLeagueTable = async function(division,season,done){
  if (season === undefined){
    seasonName = ''
    season = SEASON;
  }
  else {
    seasonName = season + ' as team'
  }
  division = division.replace('-',' ');
  try {
		 let [result] = await (await db.otherConnect()).query('SELECT c.name, c.played, c.pointsFor, c.pointsAgainst FROM (SELECT team.name, b.played, b.pointsFor - team.penalties as pointsFor, b.pointsAgainst, team.division FROM (SELECT a.date, SUM(a.played) AS played, SUM(a.pointsFor) AS pointsFor, SUM(a.pointsAgainst) AS pointsAgainst, a.teamId FROM (SELECT fixture.date, CASE WHEN fixture.homeScore IS NOT NULL THEN 1 ELSE 0 END AS played, CASE WHEN fixture.homeScore > 9 THEN 1 ELSE 0 END AS gamesWon, CASE WHEN fixture.homeScore = 9 THEN 1 ELSE 0 END AS gamesDrawn, homeScore AS pointsFor, awayScore AS pointsAgainst, fixture.homeTeam AS teamId FROM fixture join season where season.name = ? AND fixture.date > season.startDate AND fixture.date < season.endDate UNION ALL SELECT fixture.date, CASE WHEN fixture.awayScore IS NOT NULL THEN 1 ELSE 0 END AS played, CASE WHEN fixture.awayScore > 9 THEN 1 ELSE 0 END AS gamesWon, CASE WHEN fixture.awayScore = 9 THEN 1 ELSE 0 END AS gamesDrawn, awayScore AS pointsFor, homeScore AS pointsAgainst, fixture.awayTeam AS teamId FROM fixture join season where season.name = ? AND fixture.date > season.startDate AND fixture.date < season.endDate) AS a GROUP BY a.teamid) AS b JOIN team'+seasonName+' WHERE team.id = b.teamId) AS c JOIN division WHERE c.division = division.id AND division.name = ? AND division.league = 1 ORDER BY pointsFor DESC',[season,season,division])
		done(null,result)
	}
	catch (err) {
		return done (err);
}
}

exports.getAllLeagueTables = async function(season,done){
  if (season === undefined){
    seasonName = ''
    divisionSeason = ''
    season = SEASON
  }
  else {
    seasonName = season + ' as team'
    divisionSeason = season + ' as division'
  }
  try {
		 let [result] = await (await db.otherConnect()).query('SELECT division.name AS divisionName, id AS division, c.name, c.played, c.pointsFor, c.pointsAgainst, c.divRank FROM (SELECT team.name, b.played, b.pointsFor - team.penalties as pointsFor, b.pointsAgainst, team.division, team.divRank FROM (SELECT SUM(a.played) AS played, SUM(a.pointsFor) AS pointsFor, SUM(a.pointsAgainst) AS pointsAgainst, a.teamId FROM (SELECT fixture.date, CASE WHEN fixture.homeScore IS NOT NULL THEN 1 ELSE 0 END AS played, CASE WHEN fixture.homeScore > 9 THEN 1 ELSE 0 END AS gamesWon, CASE WHEN fixture.homeScore = 9 THEN 1 ELSE 0 END AS gamesDrawn, homeScore AS pointsFor, awayScore AS pointsAgainst, fixture.homeTeam AS teamId FROM fixture JOIN season WHERE season.name = ? AND fixture.date > season.startDate AND fixture.date < season.endDate AND fixture.status in ("conceded","complete",NULL,"","outstanding") UNION ALL SELECT fixture.date, CASE WHEN fixture.awayScore IS NOT NULL THEN 1 ELSE 0 END AS played, CASE WHEN fixture.awayScore > 9 THEN 1 ELSE 0 END AS gamesWon, CASE WHEN fixture.awayScore = 9 THEN 1 ELSE 0 END AS gamesDrawn, awayScore AS pointsFor, homeScore AS pointsAgainst, fixture.awayTeam AS teamId FROM fixture JOIN season WHERE season.name = ? AND fixture.date > season.startDate AND fixture.date < season.endDate AND fixture.status in ("conceded","complete",NULL,"","outstanding")) AS a GROUP BY a.teamid) AS b JOIN team'+seasonName+' WHERE team.id = b.teamId) AS c JOIN division'+divisionSeason+' WHERE c.division = division.id AND division.league = 1 ORDER BY division , pointsFor DESC , divRank',[season,season])
		done(null,result)
	}
	catch (err) {
		return done (err);
}
}



