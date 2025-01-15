const { BuilderElement } = require('docx');
const { player_update_get } = require('../controllers/playerController.js');
var db = require('../db_connect.js');
const levenshtein = require('js-levenshtein');
var SEASON = '';
if (new Date().getMonth() < 7){
  SEASON = '' + new Date().getFullYear()-1 +''+ new Date().getFullYear();
}
else {
  SEASON = '' + new Date().getFullYear() +''+ (new Date().getFullYear()+1);
}


// POST
exports.create = async function(first_name,family_name,team,club,gender,done){
  var date_of_registration = new Date();
  try {
		let [result] = await (await db.otherConnect()).query('INSERT INTO `player` (`first_name`,`family_name`,`date_of_registration`,`team`,`club`,`gender`) VALUES (?,?,?,?,?,?)',[first_name,family_name,date_of_registration,team,club,gender])
    done(null,result)
  }
  catch (err) {
    return done (err);
  }
}

exports.createByName = async function(obj,done){
  if(db.isObject(obj)){
    sql = 'insert into player (first_name, family_name, gender, club, team, date_of_registration) values (?, ?, ?,(select id from club where name = ?),(select id from team where name = ?),?)'
    // console.log(JSON.stringify(obj));
    try {
		 let [result] = await (await db.otherConnect()).query(sql,[obj.first_name, obj.family_name, obj.gender,obj.clubName, obj.teamName, obj.date])
      done(null,result)
    }
    catch (err) {
        return done (err);
    }
    
  }
  else {
    return done('not object');
  }
}

exports.createBatch = async function(BatchObj,done){
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
    try {
		  let [result] = await (await db.otherConnect()).query(sql)
      done(null,result)
    }
    catch (err) {
        return done (err);
    }
  }
  else{
    return done('not object');
  }
}

// PATCH
exports.updateById = async function(first_name,family_name,team,club,gender,playerId,done){
  try {
		let [result] = await (await db.otherConnect()).query('UPDATE `player` SET `first_name` = ?, `family_name` = ?, `team` = ?, `club` = ?, `gender` = ? WHERE `id` = ?',[first_name,family_name,team,club,gender,playerId])
    done(null,result)
  }
  catch (err) {
      return done (err);
  }
}

exports.updateBulk = async function(BatchObj,done){
  if(db.isObject(BatchObj)){
     //console.log("inside players model.js")
     //console.log(BatchObj);
    
    // console.log(sql);
    var containerArray = [];
    var updateArray = [];
    var updateValuesString = '';
    for (x in BatchObj.data){
      var sql = 'UPDATE `'+BatchObj.tablename+'` SET ';
      updateArray = [];
      for (y in BatchObj.data[x]){
         //console.log(BatchObj.data[x][y])
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
     //console.log(sql);
    // done(null,sql)
    try {
  		let [result] = await (await db.otherConnect()).query(sql)
      done(null,result)
    }
    catch (err) {
        return done (err);
    }
  }
  else{
    return done('not object');
  }
}

// GET
exports.getAll = async function(done){
  try {
		let [result] = await (await db.otherConnect()).query('SELECT * FROM `player`')
    done(null,result)
  }
  catch (err) {
      return done (err);
  }
}

// GET
exports.getNominatedPlayers = async function(teamName,done){
  try {
		 let [result] = await (await db.otherConnect()).query("SELECT CONCAT(first_name, ' ', family_name) AS name, gender FROM player JOIN team WHERE team.id = player.team AND team.name = ? AND player.rank IS NOT NULL ORDER BY gender , player.rank",teamName)
done(null,result)
}
catch (err) {
		 return done (err);
}
}

exports.getMatchStats = async function(fixtureId,done){
  try {
		 let [result] = await (await db.otherConnect()).query("SET @fixtureId = ?; SELECT concat(player.first_name,' ',player.family_name) AS name ,team.name AS teamName ,b.avgPtsFor ,b.avgPtsAgainst ,gamesWon FROM ( SELECT playerId ,AVG(ptsFor) AS avgPtsFor ,AVG(ptsAgainst) AS avgPtsAgainst ,SUM(won) AS gamesWon FROM ( SELECT homePlayer1 AS playerId ,homeScore AS ptsFor ,awayScore AS ptsAgainst ,CASE WHEN homeScore > awayScore THEN 1 ELSE 0 END AS won FROM game WHERE fixture = @fixtureId AND (awayPlayer1 !=0 AND awayPlayer2 != 0 AND homePlayer2 != 0 AND homePlayer1 !=0) UNION ALL SELECT homePlayer2 AS playerId ,homeScore AS ptsFor ,awayScore AS ptsAgainst ,CASE WHEN homeScore > awayScore THEN 1 ELSE 0 END AS won FROM game WHERE fixture = @fixtureId AND (awayPlayer1 !=0 AND awayPlayer2 != 0 AND homePlayer2 != 0 AND homePlayer1 !=0) UNION ALL SELECT awayPlayer1 AS playerId ,awayScore AS ptsFor ,homeScore AS ptsAgainst ,CASE WHEN homeScore < awayScore THEN 1 ELSE 0 END AS won FROM game WHERE fixture = @fixtureId AND (awayPlayer1 !=0 AND awayPlayer2 != 0 AND homePlayer2 != 0 AND homePlayer1 !=0) UNION ALL SELECT awayPlayer2 AS playerId ,awayScore AS ptsFor ,homeScore AS ptsAgainst ,CASE WHEN homeScore < awayScore THEN 1 ELSE 0 END AS won FROM game WHERE fixture = @fixtureId AND (awayPlayer1 !=0 AND awayPlayer2 != 0 AND homePlayer2 != 0 AND homePlayer1 !=0) ) AS a GROUP BY playerId ) AS b JOIN player ON b.playerId = player.id JOIN team ON player.team = team.id ORDER BY teamName, gamesWon desc, avgPtsAgainst asc",fixtureId)
  done(null,result)
  }
  catch (err) {
      return done (err);
  }
}


exports.getNamesClubsTeams = async function(searchTerms,done){
  var whereTerms = [];
  var whereValue = [];
  var nameMatch = ""
  if (!searchTerms.name){
     //console.log("no name search");
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
    try {
		 let [result] = await (await db.otherConnect()).query("select * from (select playerId, a.name, gender, date_of_registration, a.rank, club.id as clubId, club.name as clubName, teamName, teamId from (SELECT player.id as playerID, concat(first_name, ' ', family_name) as name, gender, date_of_registration, player.rank, team.id as teamId, team.name as teamName, player.club as clubId from player join team where team.id = player.team "+ nameMatch +") as a join club where a.clubId = club.id ) as b"+conditions+" order by teamName, gender,`rank`",whereValue)
    done(null,result)
    }
    catch (err) {
        return done (err);
    }
  }
  else {
    try {
		  let [result] = await (await db.otherConnect()).query("select playerId, a.name, gender, date_of_registration, a.rank, club.id as clubId, club.name as clubName, teamName, teamId from (SELECT player.id as playerID, concat(first_name, ' ', family_name) as name, gender, date_of_registration, player.rank, team.id as teamId, team.name as teamName, player.club as clubId from player join team where team.id = player.team "+ nameMatch +") as a join club where a.clubId = club.id order by teamName, gender, `rank`")
      done(null,result)
    }
    catch (err) {
      return done (err);
    }
  }
}

exports.getPlayerGameData = async function(id,done){
  let sql = `with playerGames as (select game.*, fixture.date from game 
join fixture on game.fixture = fixture.id 
where 
(? in(homePlayer1,homePlayer2,awayPlayer1,awayPlayer2) and (
  homePlayer1End is not null and
  homePlayer2End is not null and
  awayPlayer1End is not null and
  awayPlayer2End is not null
))
order by date desc, id),
allGames as (
  select 
  id,
  date,
  case when homePlayer1 = ? then homePlayer1
  when homePlayer2 = ? then homePlayer2
  when awayPlayer1 = ? then awayPlayer1
  when awayPlayer2 = ? then awayPlayer2
  end as playerName,
  case when homePlayer1 = ? then homePlayer2
  when homePlayer2 = ? then homePlayer1
  when awayPlayer1 = ? then awayPlayer2
  when awayPlayer2 = ? then awayPlayer1
  end as partner,
  case when homePlayer1 = ? then awayPlayer1
  when homePlayer2 = ? then awayPlayer1
  when awayPlayer1 = ? then homePlayer1
  when awayPlayer2 = ? then homePlayer1
  end as oppo1,
  case when homePlayer1 = ? then awayPlayer2
  when homePlayer2 = ? then awayPlayer2
  when awayPlayer1 = ? then homePlayer2
  when awayPlayer2 = ? then homePlayer2
  end as oppo2,
  case when homePlayer1 = ? then homeScore
  when homePlayer2 = ? then homeScore
  when awayPlayer1 = ? then awayScore
  when awayPlayer2 = ? then awayScore
  end as score,
  case when homePlayer1 = ? then awayScore
  when homePlayer2 = ? then awayScore
  when awayPlayer1 = ? then homeScore
  when awayPlayer2 = ? then homeScore
  end as vsScore,
  gameType,
  case when homePlayer1 = ? then homePlayer1Start
  when homePlayer2 = ? then homePlayer2Start
  when awayPlayer1 = ? then awayPlayer1Start
  when awayPlayer2 = ? then awayPlayer2Start
  end as beforeVal,
  case when homePlayer1 = ? then homePlayer1End
  when homePlayer2 = ? then homePlayer2End
  when awayPlayer1 = ? then awayPlayer1End
  when awayPlayer2 = ? then awayPlayer2End
  end as after,
  case when homePlayer1 = ? then homePlayer1End - homePlayer1Start
  when homePlayer2 = ? then homePlayer2End - homePlayer2Start
  when awayPlayer1 = ? then awayPlayer1End - awayPlayer1Start
  when awayPlayer2 = ? then awayPlayer2End - awayPlayer2Start
  end as adjustment
  from playerGames
)
select
allGames.id,
date, 
concat(player.first_name,' ',player.family_name) as playerName,
concat(partner.first_name,' ',partner.family_name) as partnerName,
concat(oppo1.first_name,' ',oppo1.family_name) as oppName1,
concat(oppo2.first_name,' ',oppo2.family_name) as oppName2,
score,
vsScore,
gameType,
beforeVal,
after,
adjustment
from allGames join 
player on player.id = allGames.playerName join
player partner on partner.id = allGames.partner join
player oppo1 on oppo1.id = allGames.oppo1  join
player oppo2 on oppo2.id = allGames.oppo2`

let idArray = Array(37).fill(id*1)

  try {
		let [result] = await (await db.otherConnect()).query(sql,idArray)
    // console.log(`playerStats result: ${JSON.stringify([result])}`)
    done(null,result)
  }
  catch (err) {
      return done (err);
  }
}



exports.newGetPlayerStats = async function(searchObj,done){
  const filterArray = ['season','division','club','team','gameType','gender']
  // console.log("passed to getFixtureDetails")
   //console.log(searchObj)
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
        // console.log(sqlParams)
      }
    }
    
  }
  
  let season = ""
  let seasonString = SEASON
  let whereTerms = ""
  let whereValue = []
  searchArray = []
  const checkSeason = async function(season){
    let firstYear = parseInt(season.slice(0,4))
    let secondYear = parseInt(season.slice(4))
     //console.log(firstYear+ " "+ secondYear)
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

  if (searchObj.season === undefined || !checkSeason(searchObj.season)){
    seasonVal = seasonString
     //console.log("no season");
  }
  else {
    season = searchObj.season;
    seasonVal = searchObj.season;
  }
  whereValue.push(seasonVal);
  if (!searchObj.gender){
     //console.log("no gender");
    whereValue.push('%');
  }
  else {
    whereValue.push(searchObj.gender)
  }
  if (!searchObj.team){
     //console.log("no team");
    whereValue.push("%");
  }
  else {
    whereValue.push(searchObj.team)
  }
  if (!searchObj.division){
     //console.log("no division id");
    // whereValue.push("%");
  }
  else {
    whereValue.push(searchObj.division)
  }
  if (!searchObj.club){
     //console.log("no club");
    whereValue.push("%");
  }
  else {
    whereValue.push(searchObj.club)
  }
  if (!searchObj.gameType){
     //console.log("no gameType");
    whereValue.push("%");
  }
  else {
    whereValue.push(searchObj.gameType)
  }
   //console.log(whereTerms)
   //console.log(whereValue);

  if (whereTerms.length > 0) {
    var conditions = whereTerms.join(' AND ');
     //console.log(conditions);
    conditions = ' WHERE '+ conditions
  }
  // var seasonArray = [seasonVal,seasonVal,seasonVal,seasonVal]
  // whereValue = seasonArray.concat(whereValue)
   //console.log(whereValue)

  var sql = `with
  seasonFixture as (
    SELECT
      fixture.id,
      fixture.homeTeam,
      fixture.awayTeam
    FROM
      fixture
      JOIN season ON season.name like ?
      AND fixture.date > season.startDate
      AND fixture.date < season.endDate
  ),
  seasonFixtureGame as (
    SELECT
      game.id,
      game.homePlayer1,
      game.homePlayer2,
      game.awayPlayer1,
      game.awayPlayer2,
      game.homeScore,
      game.awayScore,
      game.fixture,
      seasonFixture.homeTeam,
      seasonFixture.awayTeam
    FROM
      seasonFixture
      JOIN game ON game.fixture = seasonFixture.id
      AND (
        game.homePlayer1 != 0
        OR game.homePlayer2 != 0
        or game.awayPlayer1 != 0
        or game.awayPlayer2 != 0
      )
  ),
  gameTypeGender as (
    SELECT
      seasonFixtureGame.*,
      CASE
        WHEN homePlayer1.gender = homePlayer2.gender
        AND homePlayer1.gender = 'Male' THEN 'Mens'
        WHEN homePlayer1.gender = homePlayer2.gender
        AND homePlayer1.gender = 'Female' THEN 'Ladies'
        ELSE 'Mixed'
      END AS gameType
    FROM
      seasonFixtureGame
      JOIN player${ season } homePlayer1 ON seasonFixtureGame.homePlayer1 = homePlayer1.id
      AND seasonFixtureGame.homePlayer1 != 0
      JOIN player${ season } homePlayer2 ON seasonFixtureGame.homePlayer2 = homePlayer2.id
      AND seasonFixtureGame.homePlayer2 != 0
      AND homePlayer2 != 0
  ),
  gameSummary as (
    SELECT
      gameTypeGender.id,
      gameTypeGender.homePlayer1 AS playerId,
      gameTypeGender.homeScore AS forPoints,
      gameTypeGender.awayScore AS againstPoints,
      CASE
        WHEN gameTypeGender.homeScore > gameTypeGender.awayScore THEN 1
        ELSE 0
      END AS gamesWon,
      CASE
        WHEN gameTypeGender.homeScore IS NOT NULL THEN 1
        ELSE 0
      END AS gamesPlayed,
      gameTypeGender.fixture,
      gameTypeGender.homeTeam AS team,
      gameTypeGender.awayTeam AS opposition,
      gameTypeGender.gameType,
      team.division
    FROM
      gameTypeGender
      join team${ season } team on homeTeam = team.id
    UNION all
    SELECT
      gameTypeGender.id,
      gameTypeGender.homePlayer2 AS playerId,
      gameTypeGender.homeScore AS forPoints,
      gameTypeGender.awayScore AS againstPoints,
      CASE
        WHEN gameTypeGender.homeScore > gameTypeGender.awayScore THEN 1
        ELSE 0
      END AS gamesWon,
      CASE
        WHEN gameTypeGender.homeScore IS NOT NULL THEN 1
        ELSE 0
      END AS gamesPlayed,
      gameTypeGender.fixture,
      gameTypeGender.homeTeam AS team,
      gameTypeGender.awayTeam AS opposition,
      gameTypeGender.gameType,
      team.division
    FROM
      gameTypeGender
      join team${ season } team on homeTeam = team.id
    UNION all
    select
      gameTypeGender.id,
      gameTypeGender.awayPlayer1 AS playerId,
      gameTypeGender.awayScore AS forPoints,
      gameTypeGender.homeScore AS againstPoints,
      CASE
        WHEN gameTypeGender.awayScore > gameTypeGender.homeScore THEN 1
        ELSE 0
      END AS gamesWon,
      CASE
        WHEN gameTypeGender.homeScore IS NOT NULL THEN 1
        ELSE 0
      END AS gamesPlayed,
      gameTypeGender.fixture,
      gameTypeGender.awayTeam AS team,
      gameTypeGender.homeTeam AS opposition,
      gameTypeGender.gameType,
      team.division
    FROM
      gameTypeGender
      join team${ season } team on homeTeam = team.id
    UNION all
    select
      gameTypeGender.id,
      gameTypeGender.awayPlayer2 AS playerId,
      gameTypeGender.awayScore AS forPoints,
      gameTypeGender.homeScore AS againstPoints,
      CASE
        WHEN gameTypeGender.awayScore > gameTypeGender.homeScore THEN 1
        ELSE 0
      END AS gamesWon,
      CASE
        WHEN gameTypeGender.homeScore IS NOT NULL THEN 1
        ELSE 0
      END AS gamesPlayed,
      gameTypeGender.fixture,
      gameTypeGender.awayTeam AS team,
      gameTypeGender.homeTeam AS opposition,
      gameTypeGender.gameType,
      team.division
    FROM
      gameTypeGender
      join team${ season } team on homeTeam = team.id
  )
SELECT
  CONCAT(
    player.first_name,
    ' ',
    player.family_name
  ) AS playername,
  playerId,
  player.gender as playergender,
  group_concat(gameType, ','),
  gameSummary.division,
  SUM(forPoints) AS forPoints,
  SUM(againstPoints) AS againstPoints,
  SUM(gamesWon) AS gamesWon,
  SUM(gamesPlayed) AS gamesPlayed,
  (sum(gamesPlayed) + sum(gamesWon)) - (sum(gamesPlayed) - sum(gamesWon)) as Points,
  club.name AS clubName,
  team.name AS teamName,
  player.rating
FROM
  gameSummary
  JOIN player${ season } player ON playerId = player.id
  AND player.gender Like ?
  JOIN team${ season } team ON team.id = player.team
  AND team.name LIKE ? ${typeof searchObj.division !== 'undefined' ? 'AND team.division = ?' : ''}
  JOIN club${ season } club ON club.id = player.club
  AND club.name LIKE ?
WHERE
gameType like ?
 
GROUP BY
  playerId,
  playername,
  playergender,
  team.division,
  clubName,
  teamName,
  rating
ORDER BY
  Points DESC;`
    try {
		 let [result] = await (await db.otherConnect()).query(sql,whereValue)
done(null,result)
}
catch (err) {
		 return done (err);
}


}


exports.newGetPairStats = async function(searchObj,done){
  const filterArray = ['season','division','club','team','gameType','gender']
  // console.log("passed to getFixtureDetails")
   //console.log(searchObj)
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
        // console.log(sqlParams)
      }
    }
    
  }
  
  let season = ""
  let seasonString = SEASON
  let whereTerms = ""
  let divisionSql = ""
  let whereValue = []
  searchArray = []
  const checkSeason = async function(season){
    let firstYear = parseInt(season.slice(0,4))
    let secondYear = parseInt(season.slice(4))
     //console.log(firstYear+ " "+ secondYear)
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

  if (searchObj.season === undefined || !checkSeason(searchObj.season)){
    seasonVal = seasonString
     //console.log("no season");
  }
  else {
    season = searchObj.season;
    seasonVal = searchObj.season;
  }
  if (!searchObj.division){
     //console.log("no division id");
    divisionSql = ""
  }
  else {
    whereValue.push(searchObj.division)
    divisionSql = "AND team.division = ? "
  }
  if (!searchObj.team){
     //console.log("no team");
    whereValue.push("%");
  }
  else {
    whereValue.push(searchObj.team)
  }
  if (!searchObj.club){
     //console.log("no club");
    whereValue.push("%");
  }
  else {
    whereValue.push(searchObj.club)
  }
  if (!searchObj.gameType){
     //console.log("no gameType");
    whereValue.push("%");
  }
  else {
    whereValue.push(searchObj.gameType)
  }
   //console.log(whereTerms)

  if (whereTerms.length > 0) {
    var conditions = whereTerms.join(' AND ');
     //console.log(conditions);
    conditions = ' WHERE '+ conditions
  }
  var seasonArray = [seasonVal,seasonVal]
  whereValue = seasonArray.concat(whereValue)
   //console.log(whereValue)
  
  var sql = "DROP TABLE IF EXISTS PairsgameSummary; CREATE TEMPORARY TABLE PairsgameSummary AS SELECT b.id, least(b.homePlayer1,b.homePlayer2) AS player1Id, greatest(b.homePlayer1,b.homePlayer2) AS player2Id, b.homeScore AS forPoints ,b.awayScore AS againstPoints ,CASE WHEN b.homeScore > b.awayScore THEN 1 ELSE 0 END AS gamesWon ,CASE WHEN b.homeScore IS NOT NULL THEN 1 ELSE 0 END AS gamesPlayed ,b.fixture ,b.homeTeam AS team ,b.awayTeam AS opposition ,b.gameType ,team.division FROM ( SELECT a.* ,CASE WHEN homePlayer1.gender = homePlayer2.gender AND homePlayer1.gender = 'Male' THEN 'Mens' WHEN homePlayer1.gender = homePlayer2.gender AND homePlayer1.gender = 'Female' THEN 'Ladies' ELSE 'Mixed' END AS gameType ,homePlayer1.gender AS playergender FROM ( SELECT game.id ,game.homePlayer1 ,game.homePlayer2 ,game.awayPlayer1 ,game.awayPlayer2 ,game.homeScore ,game.awayScore ,game.fixture ,seasonFixtures.homeTeam ,seasonFixtures.awayTeam FROM ( SELECT fixture.id ,fixture.homeTeam ,fixture.awayTeam FROM fixture JOIN season ON season.name = ? AND fixture.date > season.startDate AND fixture.date < season.endDate ) AS seasonFixtures JOIN game ON game.fixture = seasonFixtures.id AND (game.homePlayer1 != 0 OR game.homePlayer2 != 0 or game.awayPlayer1 !=0 or game.awayPlayer2 !=0) ) AS a JOIN player" + season +" homePlayer1 ON a.homePlayer1 = homePlayer1.id AND a.homePlayer1 !=0 JOIN player" + season +" homePlayer2 ON a.homePlayer2 = homePlayer2.id AND a.homePlayer2 != 0 AND homePlayer2 !=0 ) AS b JOIN team" + season +" team ON homeTeam = team.id UNION ALL SELECT b.id, least(b.awayPlayer1,b.awayPlayer2) AS player1Id, greatest(b.awayPlayer2,b.awayPlayer1) AS player2Id, b.awayScore AS forPoints ,b.homeScore AS againstPoints ,CASE WHEN b.awayScore > b.homeScore THEN 1 ELSE 0 END AS gamesWon ,CASE WHEN b.homeScore IS NOT NULL THEN 1 ELSE 0 END AS gamesPlayed ,b.fixture ,b.awayTeam AS team ,b.homeTeam AS opposition ,b.gameType ,team.division FROM ( SELECT a.* ,CASE WHEN homePlayer1.gender = homePlayer2.gender AND homePlayer1.gender = 'Male' THEN 'Mens' WHEN homePlayer1.gender = homePlayer2.gender AND homePlayer1.gender = 'Female' THEN 'Ladies' ELSE 'Mixed' END AS gameType ,homePlayer1.gender AS playergender FROM ( SELECT game.id ,game.homePlayer1 ,game.homePlayer2 ,game.awayPlayer1 ,game.awayPlayer2 ,game.homeScore ,game.awayScore ,game.fixture ,seasonFixtures.homeTeam ,seasonFixtures.awayTeam FROM ( SELECT fixture.id ,fixture.homeTeam ,fixture.awayTeam FROM fixture JOIN season ON season.name = ? AND fixture.date > season.startDate AND fixture.date < season.endDate ) AS seasonFixtures JOIN game ON game.fixture = seasonFixtures.id AND (game.homePlayer1 != 0 OR game.homePlayer2 != 0 or game.awayPlayer1 !=0 or game.awayPlayer2 !=0) ) AS a JOIN player" + season +" homePlayer1 ON a.homePlayer1 = homePlayer1.id AND a.homePlayer1 !=0 JOIN player" + season +" homePlayer2 ON a.homePlayer2 = homePlayer2.id AND a.homePlayer2 != 0 AND homePlayer2 !=0 ) AS b JOIN team" + season +" team ON homeTeam = team.id; SELECT concat(Player1.first_name,' ', Player1.family_name, ' & ', Player2.first_name, ' ', Player2.family_name) as Pairing ,player1Id ,player2Id ,SUM(forPoints) AS forPoints ,SUM(againstPoints) AS againstPoints ,SUM(gamesWon) AS gamesWon ,SUM(gamesPlayed) AS gamesPlayed ,SUM(gamesWon) / SUM(gamesPlayed) As winRate, (sum(gamesWon) + sum(gamesPlayed)) - (sum(gamesPlayed) - sum(gamesWon)) as Points, club.name AS clubName ,team.name AS teamName ,gameType FROM ( SELECT * FROM PairsgameSummary ) AS a JOIN player" + season +" Player1 ON Player1.id = a.player1Id JOIN player" + season +" Player2 ON Player2.id = a.player2Id JOIN team" + season +" team ON team.id = Player1.team " + divisionSql + "AND team.name LIKE ? JOIN club" + season +" club ON club.id = Player1.club AND club.name LIKE ? AND gameType like ? GROUP BY Pairing ORDER BY winRate DESC, Points DESC;"
    // console.log(sql);
    try {
		 let [result] = await (await db.otherConnect()).query(sql,whereValue)
done(null,result)
}
catch (err) {
		 return done (err);
}


}

exports.getEmails = async function(searchTerms,done){
   //console.log(searchTerms);
  var sql = "SELECT DISTINCT b.playerEmail FROM (SELECT a.*, CAST(AES_DECRYPT(player.playerEmail, '"+process.env.DB_PI_KEY+"') AS CHAR) AS playerEmail FROM (SELECT club.id, club.name AS clubName, team.id AS teamId, team.name AS teamName, club.matchSec, club.clubSec, team.captain, team.division, 'match Sec' AS role FROM club JOIN team ON team.club = club.id) AS a JOIN player ON a.matchSec = player.id OR (player.matchSecrertary = 1 AND a.id = player.club) UNION ALL SELECT a.*, CAST(AES_DECRYPT(player.playerEmail, '"+process.env.DB_PI_KEY+"') AS CHAR) AS playerEmail FROM (SELECT club.id, club.name AS clubName, team.id AS teamId, team.name AS teamName, club.matchSec, club.clubSec, team.captain, team.division, 'club Sec' AS role FROM club JOIN team ON team.club = club.id) AS a JOIN player ON a.clubSec = player.id OR (player.clubSecretary = 1 AND a.id = player.club) UNION ALL SELECT a.*, CAST(AES_DECRYPT(player.playerEmail, '"+process.env.DB_PI_KEY+"') AS CHAR) AS playerEmail FROM (SELECT club.id, club.name AS clubName, team.id AS teamId, team.name AS teamName, club.matchSec, club.clubSec, team.captain, team.division, 'team Captain' AS role FROM club JOIN team ON team.club = club.id) AS a JOIN player ON (player.teamCaptain = 1 AND a.teamId = player.team) or a.captain = player.id UNION ALL SELECT a.*, CAST(AES_DECRYPT(player.playerEmail, '"+process.env.DB_PI_KEY+"') AS CHAR) AS playerEmail FROM (SELECT club.id, club.name AS clubName, team.id AS teamId, team.name AS teamName, club.matchSec, club.clubSec, team.captain, team.division, 'treasurer' AS role FROM club JOIN team ON team.club = club.id) AS a JOIN player ON (player.treasurer = 1 AND a.teamId = player.team) UNION ALL SELECT a.*, CAST(AES_DECRYPT(player.playerEmail, '"+process.env.DB_PI_KEY+"') AS CHAR) AS playerEmail FROM (SELECT club.id, club.name AS clubName, team.id AS teamId, team.name AS teamName, club.matchSec, club.clubSec, team.captain, team.division, 'otherComms' AS role FROM club JOIN team ON team.club = club.id) AS a JOIN player ON (player.otherComms = 1 AND a.teamId = player.team)) AS b"
  var whereTerms = [];
  if (!searchTerms.role){
     //console.log("no role selected");
  }
  else {
    whereTerms.push('b.role = "'+searchTerms.role+'"');
  }
  if (!searchTerms.division){
     //console.log("no division");
  }
  else {
    whereTerms.push('b.division = '+searchTerms.division );
  }
  if (!searchTerms.club){
     //console.log("no club id");
  }
  else {
    whereTerms.push('b.id = "'+searchTerms.club + '"');
  }
  if (!searchTerms.teamName){
     //console.log("no teamName");
  }
  else {
    whereTerms.push('b.teamName = "'+searchTerms.teamName + '"');
  }
   //console.log(whereTerms)

  if (whereTerms.length > 0) {
    var conditions = whereTerms.join(' AND ');
    conditions = ' WHERE ' + conditions;
    // console.log(conditions);
    sql = sql + conditions
  }
  try {
		let [result] = await (await db.otherConnect()).query(sql)
    var emailArray = result.map(row => {const {playerEmail} = row; return playerEmail})
    tempArray = emailArray
    emailArray = tempArray.filter(email => email.indexOf("@") != -1)
    done(null,emailArray)
  }
  catch (err) {
      return done (err);
  }
}

exports.search = async function(searchTerms,done){
   //console.log(searchTerms);
  var sql = 'SELECT * FROM `player`';
  var whereTerms = [];
  if (!searchTerms.teamid){
     //console.log("no team id");
  }
  else {
    whereTerms.push('`team` = '+searchTerms.teamid);
  }
  if (!searchTerms.gender){
     //console.log("no gender");
  }
  else {
    whereTerms.push('`gender` = "'+searchTerms.gender + '"');
  }
  if (!searchTerms.clubid){
     //console.log("no club id");
  }
  else {
    whereTerms.push('`club` = '+searchTerms.clubid);
  }
   //console.log(whereTerms)

  if (whereTerms.length > 0) {
    var conditions = whereTerms.join(' AND ');
    conditions = ' WHERE ' + conditions + ' order by teamName,gender,`rank`';
    // console.log(conditions);
    sql = sql + conditions
  }
  try {
		 let [result] = await (await db.otherConnect()).query(sql)
done(null,result)
}
catch (err) {
		 return done (err);
}
}

exports.findElgiblePlayersFromTeamId = async function(id,gender,done){
  try {
		 let [result] = await (await db.otherConnect()).query('select player.id, player.first_name, player.family_name, b.rank as teamRank, player.rank as playerRank from (select team.id, team.name, team.rank from (SELECT club.id, club.name, team.rank as originalRank FROM team JOIN club WHERE team.club = club.id AND team.id = ?) as a join team where a.id = team.club AND team.rank >= originalRank) as b join player where player.team = b.id AND player.gender= ? order by b.rank asc,player.rank desc, player.family_name',[id,gender])
done(null,result)
}
catch (err) {
		 return done (err);
}
}

exports.findElgiblePlayersFromTeamIdAndSelected = async function(teamName,gender, first, second, third,done){
  try {
		 let [result] = await (await db.otherConnect()).query('SELECT player.id, player.first_name, player.family_name, CASE WHEN LEVENSHTEIN(CONCAT(player.first_name, " ", player.family_name), ?) < 6 THEN TRUE ELSE FALSE END AS first, CASE WHEN LEVENSHTEIN(CONCAT(player.first_name, " ", player.family_name), ?) < 6 THEN TRUE ELSE FALSE END AS second, CASE WHEN LEVENSHTEIN(CONCAT(player.first_name, " ", player.family_name), ?) < 6 THEN TRUE ELSE FALSE END AS third FROM (SELECT team.id, team.name, team.rank FROM (SELECT club.id, club.name, team.rank AS originalRank FROM team JOIN club WHERE team.club = club.id AND levenshtein(team.name,?) < 1) AS a JOIN team WHERE a.id = team.club AND team.rank >= originalRank) AS b JOIN player WHERE player.team = b.id AND player.gender = ?',[first, second, third, teamName, gender])
done(null,result)
}
catch (err) {
		 return done (err);
}
}

exports.getEligiblePlayersAndSelectedById = async function(first, second, third, teamId,gender,done){
  try {
		 let [result] = await (await db.otherConnect()).query('SELECT player.id ,player.first_name ,player.family_name, case when player.id = ? then 1 else 0 end as first, case when player.id = ? then 1 else 0 end as second, case when player.id = ? then 1 else 0 end as third FROM ( SELECT team.id ,team.name ,team.rank FROM ( SELECT club.id ,club.name ,team.rank AS originalRank FROM team JOIN club WHERE team.club = club.id AND team.id like ? ) AS a JOIN team WHERE a.id = team.club AND team.rank >= originalRank ) AS b JOIN player WHERE player.team = b.id AND player.gender = ?',[first, second, third, teamId,gender])
done(null,result)
}
catch (err) {
		 return done (err);
}
}

exports.findElgiblePlayersFromTeamNameAndSelectedSansLevenshtein = async function(teamName,gender,first, second,third,done){
  try {
		let [rows] = await (await db.otherConnect()).query('SELECT player.id ,player.first_name ,player.family_name FROM ( SELECT team.id ,team.name ,team.rank FROM ( SELECT club.id ,club.name ,team.rank AS originalRank FROM team JOIN club WHERE team.club = club.id AND team.name like ? ) AS a JOIN team WHERE a.id = team.club AND team.rank >= originalRank ) AS b JOIN player WHERE player.team = b.id AND player.gender = ?',[teamName, gender])

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
  catch (err) {
      return done (err);
  }
}

exports.findElgiblePlayersFromTeamIdAndSelectedNew = async function(teamName,gender, first, second, third,done){
  try {
		 let [result] = await (await db.otherConnect()).query("SELECT player.id, player.first_name, player.family_name, LEVENSHTEIN(CONCAT(player.first_name, ' ', player.family_name), ?) AS first, LEVENSHTEIN(CONCAT(player.first_name, ' ', player.family_name), ?) AS second, LEVENSHTEIN(CONCAT(player.first_name, ' ', player.family_name), ?) AS third, (LEVENSHTEIN(CONCAT(player.first_name,' ',player.family_name),?) + LEVENSHTEIN(CONCAT(player.first_name,' ',player.family_name),?) + LEVENSHTEIN(CONCAT(player.first_name,' ',player.family_name),?)) as totalLev FROM (SELECT team.id, team.name, team.rank FROM (SELECT club.id, club.name, team.rank AS originalRank FROM team JOIN club WHERE team.club = club.id AND LEVENSHTEIN(team.name, ?) < 1) AS a JOIN team WHERE a.id = team.club AND team.rank >= originalRank) AS b JOIN player WHERE player.team = b.id AND player.gender = ? Order by totalLev asc, first asc, second asc, third asc",[first, second, third, first, second, third,teamName, gender])
done(null,result)
}
catch (err) {
		 return done (err);
}
}

exports.count = async function(searchTerm,done){
  if (searchTerm == ""){
    try {
		 let [result] = await (await db.otherConnect()).query('SELECT COUNT(*) as `players` FROM `player`')
done(null,result)
}
catch (err) {
		 return done (err);
}
  }
  else {
    try {
		 let [result] = await (await db.otherConnect()).query('SELECT COUNT(*) as `players` FROM `player` WHERE `gender` = ?',searchTerm)
done(null,result)
}
catch (err) {
		 return done (err);
}
      
  }
}

// GET
exports.getByName = async function(playerName,done){
  try {
		 let [result] = await (await db.otherConnect()).query('SELECT * FROM player where levenshtein(concat(first_name," ",family_name), ?) < 4',playerName)
done(null,result)
}
catch (err) {
		 return done (err);
}
}

exports.getByNameAndTeam = async function(playerName,teamId,distance,done){
  try {
		 let [result] = await (await db.otherConnect()).query('select * from (select player.id as playerId, concat(first_name," ",family_name) as playerName, team.id as teamId, team.name as teamName from player join team where player.team = team.id) as playerClub where teamId=? AND levenshtein(playerName,?) < ?',[teamid,playerName,distance])
done(null,result)
}
catch (err) {
		 return done (err);
}
}

exports.getById = async function(playerId,done){
   //console.log(playerId)
  try {
		 let [result] = await (await db.otherConnect()).query('SELECT id,first_name, family_name, gender,CAST(AES_DECRYPT(playerEmail, \''+process.env.DB_PI_KEY+'\') AS CHAR) as playerEmail, CAST(AES_DECRYPT(playerTel, \''+process.env.DB_PI_KEY+'\') AS CHAR) as playerTel,teamCaptain, clubSecretary,matchSecrertary,treasurer FROM player WHERE id = ?',playerId)
done(null,result)
}
catch (err) {
		 return done (err);
}
}

exports.getPlayerClubandTeamById = async function(playerId,done){
  try {
		 let [result] = await (await db.otherConnect()).query("select playerId, playerName, clubName, team.name as teamName, date_of_registration from (select playerId, playerName, club.name as clubName, teamId, date_of_registration from (select player.id as playerId, concat(player.first_name, ' ', player.family_name) as playerName, player.club as clubID, player.team as teamId, player.date_of_registration from player where id = ?) as a join club where clubId = club.id) as b join team where teamId = team.id",[playerId])
done(null,result)
}
catch (err) {
		 return done (err);
}
}

// GET
exports.findByName = async function(searchObject,done){
  try {
		 let [result] = await (await db.otherConnect()).query('SELECT * FROM `player` WHERE `id` = ?',playerId)
done(null,result)
}
catch (err) {
		 return done (err);
}
}

// DELETE
exports.deleteById = async function(playerId,done){
  try {
		 let [result] = await (await db.otherConnect()).query('DELETE FROM `player` WHERE `id` = ?',playerId)
done(null,result)
}
catch (err) {
		 return done (err);
}
}

exports.getPrevRating = async function(endDate,fixturePlayers,done){
  let playerArray = Object.entries(fixturePlayers)
  let sqlArray = []
  let sqlValsArray = []
  // console.log(`player Array: ${JSON.stringify(playerArray)}`)
  for (row of playerArray){
    // console.log(el)
    let i = row[0]
    
    let sql = `select * from (select 
case
    when homePlayer1 = ? then homePlayer1
    when homePlayer2 = ? then homePlayer2
    when awayPlayer1 = ? then awayPlayer1
    when awayPlayer2 = ? then awayPlayer2
    end as playerId,
case 
    when homePlayer1 = ? then homePlayer1End
    when homePlayer2 = ? then homePlayer2End
    when awayPlayer1 = ? then awayPlayer1End
    when awayPlayer2 = ? then awayPlayer2End
    end as rating,
fixture.date 
from game 
    join fixture on game.fixture = fixture.id 
    join season on (fixture.date > season.startDate and fixture.date < season.endDate and season.name = ?)
    where 
    (homePlayer1 = ? OR
    homePlayer2 = ? OR
    awayPlayer1 = ? OR
    awayPlayer2 = ?) and (
    homePlayer1End is not null and
    homePlayer2End is not null and
    awayPlayer1End is not null and
    awayPlayer2End is not null
    )
    and date < ?
    order by date desc, game.id desc
    limit 1) as a`
    sqlArray.push(sql)
    sqlValsArray = [...sqlValsArray,i*1,i*1,i*1,i*1,i*1,i*1,i*1,i*1,SEASON,i*1,i*1,i*1,i*1,endDate]
    
    
    /* 
    Player.getPrevRating(i,fixtureDate,fixturePlayers)
done(null,result)
}
catch (err) {
		 return done (err);
}
      if (err) console.error(`error: , player:${JSON.stringify(el)}`)
      fixturePlayers = row;
      // console.log(fixturePlayers[i])
    }) */
   
  }
  try {
		let rows = await (await db.otherConnect()).query(sqlArray.join(' union all '),sqlValsArray)
    if (rows[0].length > 0){
      console.log(`prev Rating Results rows > 1: ${JSON.stringify(rows[0])}`);
      for(player of playerArray){
        console.log(`player: ${JSON.stringify(player)}`)
        let filtered = rows[0].filter(i => i.playerId == player[0])
        if (filtered.length > 0){
          console.log(`filtered: ${JSON.stringify(filtered)}`)          
          player[1].rating = filtered[0].rating
          player[1].date = filtered[0].date
          console.log(`player: ${JSON.stringify(player)}`)
        }
        else {
          player[1].rating = 1500
          player[1].date = "2020-01-01 00:00:00"
        }
      }
    }
    else {
      for(player of playerArray){
          player[1].rating = 1500
          player[1].date = "2020-01-01 00:00:00"
      }
    }
    fixturePlayers = Object.fromEntries(playerArray)
    // console.log(`${JSON.stringify(fixturePlayers)}`)
    done(null, fixturePlayers)
  }
  catch (err) {
      return done (err);
  }

}