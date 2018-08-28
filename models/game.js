var db = require('../db_connect.js');

// POST
exports.create = function(gameObj,done){
  if (db.isObject(gameObj)){
    var sql = 'INSERT INTO `game` (';
    var updateArray = [];
    var updateArrayVars = [];
    var updateArrayValues = []
    for (x in gameObj){
      console.log(gameObj[x]);
      updateArray.push('`'+ x +'`');
      updateArrayVars.push(gameObj[x]);
      updateArrayValues.push('?');
    }
    var updateVars = updateArray.join(',');
    var updateValues = updateArrayValues.join(',');
    console.log(updateVars);
    sql = sql + updateVars + ') VALUES (' + updateValues + ')';
    console.log(sql);
    db.get().query(sql,updateArrayVars,function(err,result){
      if (err) return done(err);
      done(null,result);
    });
  }
  else {
    return done(err);
  }
}

// GET
exports.getAll = function(done){
  db.get().query('SELECT * FROM `game`', function (err, rows){
    if (err) return done(err);
    done(null, rows);
  })
}

// GET
exports.getById = function(gameId,done){
  db.get().query('SELECT * FROM `game` WHERE `id` = ?',gameId, function (err, rows){
    if (err) return done(err);
    done(null,rows);
  })
}

// DELETE
exports.deleteById = function(gameId,done){
  db.get().query('DELETE FROM `game` WHERE `id` = ?',gameId, function (err, rows){
    if (err) return done(err);
    done(null,rows);
  })
}

// PATCH
exports.updateById = function(gameObj,gameId,done){
  if (db.isObject(gameObj)){
    var sql = 'UPDATE `game` SET ';
    var updateArray = [];
    var updateArrayVars = [];
    for (x in gameObj){
      console.log(gameObj[x]);
      updateArray.push('`'+ x +'` = ?');
      updateArrayVars.push(gameObj[x]);
    }
    var updateVars = updateArray.join(', ');
    updateArrayVars.push(gameId);
    console.log(updateVars);
    sql = sql + updateVars + ' where `id` = ?'
    db.get().query(sql,updateArrayVars, function (err, rows){
      if (err) return done(err);
      console.log(rows);
      done(null,rows);
    })
  }
  else {
    return done(err);
  }

}
