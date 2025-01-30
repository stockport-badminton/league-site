var db = require('../db_connect.js');

// POST
exports.create = async function(gameObj,done){
  if (db.isObject(gameObj)){
    var sql = 'INSERT INTO `game` (';
    var updateArray = [];
    var updateArrayVars = [];
    var updateArrayValues = []
    for (x in gameObj){
      // console.log(gameObj[x]);
      updateArray.push('`'+ x +'`');
      updateArrayVars.push(gameObj[x]);
      updateArrayValues.push('?');
    }
    var updateVars = updateArray.join(',');
    var updateValues = updateArrayValues.join(',');
    // console.log(updateVars);
    sql = sql + updateVars + ') VALUES (' + updateValues + ')';
    // console.log(sql);
    try {
		 let [result] = await (await db.otherConnect()).query(sql,updateArrayVars)
		 done(null,result);
	  }
      catch (err) {
		  return done(err);
	  }
  }
  else {
    return done('not game object');
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
		 done(null,result);
	 }
      catch (err) {
		 return done(err);
	}
  }
  else{
    return done('not object');
  }
}

// GET
exports.getAll = async  function(done){
  try {
		 let [result] = await (await db.otherConnect()).query('SELECT * FROM `game`')
		 done(null,result);
	 }
    catch (err) {
		 return done(err);
	}
}

// GET
exports.getById = async function(gameId,done){
  try {
		 let [result] = await (await db.otherConnect()).query('SELECT * FROM `game` WHERE `id` = ?',gameId)
		 done(null,result);
	 }
    catch (err) {
		 return done(err);
	}
}

// GET
exports.getByFixture = async function(fixtureId,done){
  try {
		 let [result] = await (await db.otherConnect()).query('SELECT * FROM game WHERE fixture = ? order by id asc',fixtureId)

		 done(null,result);
	 }
    catch (err) {
		 return done(err);
	}
}

// DELETE
exports.deleteById =  async function(gameId,done){
  try {
		 let [result] = await (await db.otherConnect()).query('DELETE FROM `game` WHERE `id` = ?',gameId)
		 done(null,result);
	 }
    catch (err) {
		 return done(err);
	}
}

// PATCH
exports.updateById = async function(gameObj,gameId,done){
  if (db.isObject(gameObj)){
    var sql = 'UPDATE `game` SET ';
    var updateArray = [];
    var updateArrayVars = [];
    for (x in gameObj){
      // console.log(gameObj[x]);
      updateArray.push('`'+ x +'` = ?');
      updateArrayVars.push(gameObj[x]);
    }
    var updateVars = updateArray.join(', ');
    updateArrayVars.push(gameId);
    // console.log(updateVars);
    sql = sql + updateVars + ' where `id` = ?'
    try {
      let [result] = await (await db.otherConnect()).query(sql,updateArrayVars)
      done(null,result);
	  }
    catch (err) {
		  return done(err);
	  }
  }
  else {
    return done('not valid object');
  }

}

exports.calculateRating = async function(game,fixturePlayers,endDate,division,done){
    
  // console.log(homePlayer1Start)
  if (game.fixture == 5731 || game.fixture == 5730){
     console.log(`calculate Rating game: ${JSON.stringify(game)}`)
     console.log(`calculate Rating fixturePlauers: ${JSON.stringify(fixturePlayers)}`)  
  }
  // console.log(`calculate Rating game: ${JSON.stringify(game)}`)
  // console.log(`calculate Rating fixturePlauers: ${JSON.stringify(fixturePlayers)}`)
  let updateObj = {}
  let prevRatingDates = {}
  if (game.homePlayer1 == 0 || game.homePlayer2 == 0 || game.awayPlayer1 == 0 || game.awayPlayer2 == 0 ){

    updateObj = {
      "homePlayer1Start":(typeof fixturePlayers[game.homePlayer1] !== 'undefined' ? fixturePlayers[game.homePlayer1].rating : 1500),
      "homePlayer2Start":(typeof fixturePlayers[game.homePlayer2] !== 'undefined' ? fixturePlayers[game.homePlayer2].rating : 1500),
      "awayPlayer1Start":(typeof fixturePlayers[game.awayPlayer1] !== 'undefined' ? fixturePlayers[game.awayPlayer1].rating : 1500),
      "awayPlayer2Start":(typeof fixturePlayers[game.awayPlayer2] !== 'undefined' ? fixturePlayers[game.awayPlayer2].rating : 1500),
      "homePlayer1End":(typeof fixturePlayers[game.homePlayer1] !== 'undefined' ? fixturePlayers[game.homePlayer1].rating : 1500),
      "homePlayer2End":(typeof fixturePlayers[game.homePlayer2] !== 'undefined' ? fixturePlayers[game.homePlayer2].rating : 1500),
      "awayPlayer1End":(typeof fixturePlayers[game.awayPlayer1] !== 'undefined' ? fixturePlayers[game.awayPlayer1].rating : 1500),
      "awayPlayer2End":(typeof fixturePlayers[game.awayPlayer2] !== 'undefined' ? fixturePlayers[game.awayPlayer2].rating : 1500)
    }
    prevRatingDates = {
      "homePlayer1Start":(typeof fixturePlayers[game.homePlayer1] !== 'undefined' ? fixturePlayers[game.homePlayer1].date : "2020-01-01T00:00:00.000Z"),
      "homePlayer2Start":(typeof fixturePlayers[game.homePlayer2] !== 'undefined' ? fixturePlayers[game.homePlayer2].date : "2020-01-01T00:00:00.000Z"),
      "awayPlayer1Start":(typeof fixturePlayers[game.awayPlayer1] !== 'undefined' ? fixturePlayers[game.awayPlayer1].date : "2020-01-01T00:00:00.000Z"),
      "awayPlayer2Start":(typeof fixturePlayers[game.awayPlayer2] !== 'undefined' ? fixturePlayers[game.awayPlayer1].date : "2020-01-01T00:00:00.000Z"),
    }

  }
  else {
    /* console.log(`homePlayer1 ${game.homePlayer1} : ${fixturePlayers[game.homePlayer1].rating}`)
    console.log(`homePlayer2 ${game.homePlayer2} : ${fixturePlayers[game.homePlayer2].rating}`)
    console.log(`awayPlayer1 ${game.awayPlayer1} : ${fixturePlayers[game.awayPlayer1].rating}`)
    console.log(`awayPlayer2 ${game.awayPlayer2} : ${fixturePlayers[game.awayPlayer2].rating}`) */
    let homePairStart = ((1*fixturePlayers[game.homePlayer1].rating + ((1*fixturePlayers[game.awayPlayer1].rank - division)*500)) + (1*fixturePlayers[game.homePlayer2].rating + ((1*fixturePlayers[game.awayPlayer2].rank - division)*500)))/2
    let awayPairStart = ((1*fixturePlayers[game.awayPlayer1].rating + ((1*fixturePlayers[game.homePlayer1].rank - division)*500)) + (1*fixturePlayers[game.awayPlayer2].rating + ((1*fixturePlayers[game.homePlayer2].rank - division)*500)))/2
    let awayAdjustment = 0
    let homeAdjustment = 0
    let homeExpectOutcome = 1 / (1 + Math.pow(10,((awayPairStart - homePairStart)/400)))
    let awayExpectOutcome = 1 / (1 + Math.pow(10,((homePairStart - awayPairStart)/400)))
    if (1*game.homeScore > 1*game.awayScore){
      homeAdjustment = Math.round(32 * (1 - homeExpectOutcome))
      awayAdjustment = Math.round(32 * (0 - awayExpectOutcome))
      if (game.fixture == 5731 || game.fixture == 5730){
        console.log(`home win: ${ homeAdjustment } : ${awayAdjustment} : ${game.homeScore} - ${game.awayScore}`)
      }
      
    }
    else {
      homeAdjustment = Math.round(32 * (0 - homeExpectOutcome))
      awayAdjustment = Math.round(32 * (1 - awayExpectOutcome))
      if (game.fixture == 5731 || game.fixture == 5730){
        console.log(`away win: ${ homeAdjustment } : ${awayAdjustment} : ${game.homeScore} - ${game.awayScore}`)
      }
    }

    let homePlayer1End = 1*fixturePlayers[game.homePlayer1].rating + 1*homeAdjustment
    let homePlayer2End = 1*fixturePlayers[game.homePlayer2].rating + 1*homeAdjustment
    let awayPlayer1End = 1*fixturePlayers[game.awayPlayer1].rating + 1*awayAdjustment
    let awayPlayer2End = 1*fixturePlayers[game.awayPlayer2].rating + 1*awayAdjustment
    updateObj = {
      "homePlayer1Start":fixturePlayers[game.homePlayer1].rating,
      "homePlayer2Start":fixturePlayers[game.homePlayer2].rating,
      "awayPlayer1Start":fixturePlayers[game.awayPlayer1].rating,
      "awayPlayer2Start":fixturePlayers[game.awayPlayer2].rating,
      "homePlayer1End":homePlayer1End,
      "homePlayer2End":homePlayer2End,
      "awayPlayer1End":awayPlayer1End,
      "awayPlayer2End":awayPlayer2End,
    }
    prevRatingDates = {
      "homePlayer1Start":fixturePlayers[game.homePlayer1].date,
      "homePlayer2Start":fixturePlayers[game.homePlayer2].date,
      "awayPlayer1Start":fixturePlayers[game.awayPlayer1].date,
      "awayPlayer2Start":fixturePlayers[game.awayPlayer2].date,
    }
  }  
  // console.log(`${JSON.stringify(updateObj)}`)
  if (updateObj.homePlayer1Start == 0 || updateObj.homePlayer1Start == 0 || updateObj.awayPlayer1Start == 0 || updateObj.awayPlayer2Start == 0){
    // console.log(`calculate Rating game: ${JSON.stringify(game)}`)
    // console.log(`calculate Rating fixturePlauers: ${JSON.stringify(fixturePlayers)}`)
  }
  done(null, {updateObj,prevRatingDates})
}
