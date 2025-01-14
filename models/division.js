var db = require('../db_connect.js');

// POST
exports.create = async function(name,league,rank,done){
  try {
		 let [result] = await (await db.otherConnect()).query('INSERT INTO `division` (`name`,`league`,`rank`) VALUES (?,?,?)',[name,league,rank])
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
		 let [result] = await (await db.otherConnect()).query('SELECT * FROM `division`')
		done(null,result)
	}
	catch (err) {
		return done (err);
}
}

// GET
exports.getAllByLeague = async function(leagueId,done){
  try {
		 let [result] = await (await db.otherConnect()).query('SELECT * FROM `division` where league = ?',leagueId)
		done(null,result)
	}
	catch (err) {
		return done (err);
}
}

// GET
exports.getById = async function(divisionId,done){
  try {
		 let [result] = await (await db.otherConnect()).query('SELECT * FROM `division` WHERE `id` = ?',divisionId)
		done(null,result)
	}
	catch (err) {
		return done (err);
}
}

exports.getByName = async function(divisionName,done){
  try {
		 let [result] = await (await db.otherConnect()).query('SELECT * FROM `division` WHERE name = ?',divisionName)
		done(null,result)
	}
	catch (err) {
		return done (err);
}
}


exports.getIdByURLParam = async function(divisionName,done){
  divisionName = divisionName.replace('-',' ');
  try {
		 let [result] = await (await db.otherConnect()).query('SELECT id FROM `division` WHERE name = ?',divisionName)
		done(null,result)
	}
	catch (err) {
		return done (err);
}
}

exports.getAllAndSelectedByName = async function(leagueId,divisionName,done){
  try {
		 let [result] = await (await db.otherConnect()).query('select *, CASE WHEN division.name = ? THEN true ELSE false END as selected from division WHERE league = ?',[divisionName,leagueId])
		done(null,result)
	}
	catch (err) {
		return done (err);
}
}

exports.getAllAndSelectedById = async function(leagueId,divisionId,done){
  try {
		 let [result] = await (await db.otherConnect()).query('select *, CASE WHEN division.id = ? THEN true ELSE false END as selected from division WHERE league = ?',[divisionId,leagueId])
		done(null,result)
	}
	catch (err) {
		return done (err);
}
}

// DELETE
exports.deleteById = async function(divisionId,done){
  try {
		 let [result] = await (await db.otherConnect()).query('DELETE FROM `division` WHERE `id` = ?',divisionId)
		done(null,result)
	}
	catch (err) {
		return done (err);
}
}

// PATCH
exports.updateById = async function(name, league, rank, divisionId,done){
  try {
		 let [result] = await (await db.otherConnect()).query('UPDATE `division` SET `name` = ?, `league` = ?, `rank` = ? WHERE `id` = ?',[name, league, rank, divisionId])
		done(null,result)
	}
	catch (err) {
		return done (err);
}
}
