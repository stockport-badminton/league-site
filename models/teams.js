var db = require('../db_connect.js');

var SEASON = '';
if (new Date().getMonth() < 7){
  SEASON = '' + new Date().getFullYear()-1 +''+ new Date().getFullYear();
}
else {
  SEASON = '' + new Date().getFullYear() +''+ (new Date().getFullYear()+1);
}

// POST
exports.create = async function(name,starttime,endtime,matchDay,venue,courtspace,club,division,rank,done){
  try {
		 let [result] = await (await db.otherConnect()).query('INSERT INTO `team` (`name`,`starttime`,`endtime`,`matchDay`,`venue`,`courtspace`,`club`,`division`,`rank`) VALUES (?,?,?,?,?,?,?,?,?)',[name,starttime,endtime,matchDay,venue,courtspace,club,division,rank])
		done(null,result)
	}
	catch (err) {
		return done (err);
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

// GET
exports.getAll = async function(done){
  try {
		 let [result] = await (await db.otherConnect()).query('SELECT * FROM `team`')
		done(null,result)
	}
	catch (err) {
		return done (err);
}
}

// GET
exports.getMesser = async function(searchTerms,done){
  var season = ""
  var seasonVal = SEASON

  if (!searchTerms.season){
     //console.log("no season");
  }
  else {
    season = searchTerms.season;
    seasonVal = searchTerms.season;
  }
  try {
		 let [result] = await (await db.otherConnect()).query(`SELECT 
    homeTeam.name as homeTeamName,
    homeTeam.handicap as homeTeamHandicap,
    awayTeam.name as awayTeamName,
    awayTeam.handicap as awayTeamHandicap,
    messer.homeScore,
    messer.awayScore,
    messer.drawPos
FROM
    team${season} homeTeam join
    team${season} awayTeam
        JOIN
    messer${season} messer ON messer.homeTeam = homeTeam.id and messer.awayTeam = awayTeam.id
    where messer.section like ?`,searchTerms.section)
		done(null,result)
	}
	catch (err) {
		return done (err);
}
}

// GET
exports.getTeams = async function(searchObject,done){
  if(db.isObject(searchObject)){
    // console.log(searchObject);
    var sql = 'SELECT * FROM `team`';
    var whereTerms = [];
    if (!searchObject.divisionId){
       //console.log("no division id");
    }
    else {
      whereTerms.push('`division` = '+searchObject.divisionId);
    }
    if (!searchObject.teamName){
       //console.log("no teamName");
    }
    else {
      whereTerms.push('`name` = "'+searchObject.teamName + '"');
    }
    if (!searchObject.clubid){
       //console.log("no club id");
    }
    else {
      whereTerms.push('`club` = '+searchObject.clubid);
    }
    if (!searchObject.section){
       //console.log("no section");
    }
    else {
      whereTerms.push('`section` = "'+searchObject.section+'"');
    }
    // console.log(whereTerms)

    if (whereTerms.length > 0) {
      if (whereTerms.length > 1){
        var conditions = whereTerms.join(' AND ');
      }
      else {
        var conditions = whereTerms[0];
      }
      conditions = ' WHERE ' + conditions;
      // console.log(conditions);
      sql = sql + conditions
       //console.log(sql)
    }
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
exports.getById = async function(teamId,done){
  try {
		 let [result] = await (await db.otherConnect()).query('SELECT * FROM `team` WHERE `id` = ?',teamId)
		done(null,result)
	}
	catch (err) {
		return done (err);
}
}

// GET
exports.getByName = async function(teamName,done){
  try {
		 let [result] = await (await db.otherConnect()).query('SELECT * FROM `team` WHERE `name` = ?',teamName)
		done(null,result)
	}
	catch (err) {
		return done (err);
}
}

exports.getAllAndSelectedByName = async function(teamName,divisionId,done){
  try {
		 let [result] = await (await db.otherConnect()).query('select *, CASE WHEN team.name = ? THEN true ELSE false END as selected from team WHERE division = ?',[teamName,divisionId])
		done(null,result)
	}
	catch (err) {
		return done (err);
}
}

exports.getAllAndSelectedById = async function(teamId,divisionId,done){
  try {
		 let [result] = await (await db.otherConnect()).query('select *, CASE WHEN team.id = ? THEN true ELSE false END as selected from team WHERE division = ?',[teamId,divisionId])
		done(null,result)
	}
	catch (err) {
		return done (err);
}
}

// DELETE
exports.deleteById = async function(teamId,done){
  try {
		 let [result] = await (await db.otherConnect()).query('DELETE FROM `team` WHERE `id` = ?',teamId)
		done(null,result)
	}
	catch (err) {
		return done (err);
}
}

// PATCH
exports.updateById = async function(teamObj,teamId,done){
  if (db.isObject(teamObj)){
    var sql = 'UPDATE `team` SET ';
    var updateArray = [];
    var updateArrayVars = [];
    for (x in teamObj){
      // console.log(teamObj[x]);
      updateArray.push('`'+ x +'` = ?');
      updateArrayVars.push(teamObj[x]);
    }
    var updateVars = updateArray.join(', ');
    updateArrayVars.push(teamId);
    //console.log(updateVars);
    sql = sql + updateVars + ' where `id` = ?'
    // console.log(sql);
    try {
		 let [result] = await (await db.otherConnect()).query(sql,updateArrayVars)
		done(null,result)
	}
	catch (err) {
		return done (err);
}
  }
  else {
    return done(err);
  }

}
