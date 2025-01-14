var db = require('../db_connect.js');

// POST
exports.create = async function(name,venue,done){
  try {
		 let [result] = await (await db.otherConnect()).query('INSERT INTO `club` (`name`,`venue`) VALUES (?,?)',[name,venue])
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
		 let [result] = await (await db.otherConnect()).query('SELECT * FROM `club` order by name asc')
		done(null,result)
	}
	catch (err) {
		return done (err);
}
}

exports.clubDetail = async function(done){
  try {
		 let [result] = await (await db.otherConnect()).query(`select
  club.id as clubId,
  club.name,
  team.name as teamName,
  team.matchDay as matchDay,
  venue.name as clubvenue,
  venue.gMapUrl as clubgmap,
  venue.address as clubaddress,
  club.matchNightText,
  club.clubNightText,
  club.clubWebsite,
  club.matchVenue,
  teamvenue.name as teammatchvenue,
  teamvenue.gMapUrl as teamgmap,
  teamvenue.address as teamaddress
from
  club
  join team on team.club = club.id
  join venue on venue.id = club.venue
  join venue teamvenue on teamvenue.id = team.venue
order by
  name,teamName
`)
		done(null,result)
	}
	catch (err) {
		return done (err);
}
}

exports.clubDetailbyId = async function(clubId,done){
  try {
		 let [result] = await (await db.otherConnect()).query('SELECT a.clubId, a.name, a.venue, a.address, a.gMapURL AS clubVenueURL, a.matchNightText,a.clubNightText, a.clubWebsite, venue.name AS matchVenueName, venue.gMapUrl AS matchVenueURL, venue.Lat, venue.Lng FROM (SELECT club.id as clubId, club.name, venue.name AS venue, venue.gMapUrl,venue.address, club.matchNightText, club.clubNightText, club.clubWebsite,club.matchVenue FROM club JOIN venue WHERE venue.id =club.venue) AS a JOIN venue WHERE (a.matchVenue = venue.id OR a.matchVenue = NULL) ORDER BY a.name')
		done(null,result)
	}
	catch (err) {
		return done (err);
}
}


exports.getContactDetailsById = async function(clubId,done){
  try {
		 let [result] = await (await db.otherConnect()).query('SELECT club.name AS clubName, team.name AS teamName, venue.id AS venueId, venue.name AS venueName, venue.address AS address, matchVenue.id AS matchVenueId, matchVenue.name AS matchVenueName, matchVenue.address AS matchVenueAddress, matchNightText AS matchNight, CONCAT(matchSec.first_name, " ", matchSec.family_name) AS matchSecretary, CAST(AES_DECRYPT(matchSec.playerTel, "euvbdijnyvshmcf") AS CHAR) AS matchSecTel, CAST(AES_DECRYPT(matchSec.playerEmail, "euvbdijnyvshmcf") AS CHAR) AS matchSecEmail, CONCAT(clubSec.first_name, " ", clubSec.family_name) AS clubSecretary, CAST(AES_DECRYPT(clubSec.playerTel, "euvbdijnyvshmcf") AS CHAR) AS clubSecTel, CAST(AES_DECRYPT(clubSec.playerEmail, "euvbdijnyvshmcf") AS CHAR) AS clubSecEmail, CONCAT(teamCaptain.first_name, " ", teamCaptain.family_name) AS teamCaptain, CAST(AES_DECRYPT(teamCaptain.playerTel, "euvbdijnyvshmcf") AS CHAR) AS teamCaptainTel, CAST(AES_DECRYPT(teamCaptain.playerEmail, "euvbdijnyvshmcf") AS CHAR) AS teamCaptainEmail FROM club JOIN team ON team.club = club.id JOIN venue ON club.venue = venue.id JOIN venue matchVenue ON club.matchVenue = matchVenue.id JOIN player matchSec ON club.id = matchSec.club and matchSec.matchSecrertary = 1 JOIN player clubSec ON ((club.id = clubSec.club and clubSec.clubSecretary = 1) OR (club.clubSec = clubSec.id)) JOIN player teamCaptain ON ((team.id = teamCaptain.team and teamCaptain.teamCaptain = 1) OR (team.captain = teamCaptain.id)) WHERE club.id = ? group by teamCaptain order by teamName',clubId)
		done(null,result)
	}
	catch (err) {
		return done (err);
}
}





// GET
exports.getById = async function(clubId,done){
  try {
		 let [result] = await (await db.otherConnect()).query('SELECT * FROM `club` WHERE `id` = ?',clubId)
		done(null,result)
	}
	catch (err) {
		return done (err);
}
}

// DELETE
exports.deleteById = async function(clubId,done){
  try {
		 let [result] = await (await db.otherConnect()).query('DELETE FROM `club` WHERE `id` = ?',clubId)
		done(null,result)
	}
	catch (err) {
		return done (err);
}
}

// PATCH
exports.updateById = async function(name, venue, clubId,done){
  try {
		 let [result] = await (await db.otherConnect()).query('UPDATE `club` SET `name` = ?, `venue` = ? WHERE `id` = ?',[name, venue, clubId])
		done(null,result)
	}
	catch (err) {
		return done (err);
}
}
