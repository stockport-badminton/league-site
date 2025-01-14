var db = require('../db_connect.js');

// POST
exports.create = async function(name,address,gMapUrl,done){
  try {
		 let [result] = await (await db.otherConnect()).query('INSERT INTO `venue` (`name`,`address`,`gMapUrl`) VALUES (?,?,?)',[name,address,gMapUrl])
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
		 let [result] = await (await db.otherConnect()).query('SELECT * FROM `venue`')
		done(null,result)
	}
	catch (err) {
		return done (err);
}
}

exports.getVenueClubs = async function(done){
  try {
		 let [result] = await (await db.otherConnect()).query("select venueName, Lat, Lng, group_concat(venueClubsHTML SEPARATOR '<br />' ) as venueInfoBox FROM (Select venueName, Lat, Lng, concat('<strong id=\"firstHeading\" class=\"firstHeading\"><a href=\"',clubWebsite,'\">',clubName,'</a></strong><div id=\"bodyContent\"><p>Match Night:',matchNightText,'<br />Club Night:',clubNightText,'<br />Address:<a href=\"',gMapUrl,'\">',address,'</a></p></div>') as venueClubsHTML FROM (SELECT venue.name AS venueName, venue.address, venue.gMapURL, venue.Lat, venue.Lng, club.name AS clubName, club.matchNightText, club.clubNightText, club.clubWebsite FROM venue JOIN club WHERE venue.id = club.venue UNION SELECT venue.name AS venueName, venue.address, venue.gMapURL, venue.Lat, venue.Lng, club.name AS clubName, club.matchNightText, club.clubNightText, club.clubWebsite FROM venue JOIN club WHERE venue.id = club.matchVenue) as venueInfo) as groupedVenueInfo group by venueName,Lat,Lng")
		done(null,result)
	}
	catch (err) {
		return done (err);
}
}

// GET
exports.getById = async function(venueId,done){
  try {
		 let [result] = await (await db.otherConnect()).query('SELECT * FROM `venue` WHERE `id` = ?',venueId)
		done(null,result)
	}
	catch (err) {
		return done (err);
}
}

// DELETE
exports.deleteById = async function(venueId,done){
  try {
		 let [result] = await (await db.otherConnect()).query('DELETE FROM `venue` WHERE `id` = ?',venueId)
		done(null,result)
	}
	catch (err) {
		return done (err);
}
}

// PATCH
exports.updateById = async function(name,address,gMapUrl, venueId,done){
  try {
		 let [result] = await (await db.otherConnect()).query('UPDATE `venue` SET `name` = ?, `address` = ?, `gMapUrl` = ? WHERE `id` = ?',[name,address,gMapUrl, venueId])
		done(null,result)
	}
	catch (err) {
		return done (err);
}
}
