var db = require('../db_connect.js');

// POST
exports.create = function(fixtureObj,done){
  if (db.isObject(fixtureObj)){
    var sql = 'INSERT INTO `fixture` (';
    var updateArray = [];
    var updateArrayVars = [];
    var updateArrayValues = []
    for (x in fixtureObj){
      console.log(fixtureObj[x]);
      updateArray.push('`'+ x +'`');
      updateArrayVars.push(fixtureObj[x]);
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

exports.createBatch = function(tablename,BatchObj,done){
  if(db.isObject(BatchObj)){
    var sql = 'INSERT INTO `'+tablename+'` (';
    var containerArray = [];
    var updateArray = [];
    var updateArrayVars = [];
    var updateArrayValues = [];
    for (x in BatchObj){
      console.log(BatchObj[x]);
      updateArray = [];
      for (y in BatchObj[x]){
        updateArray.push(BatchObj[x][y]);
      }
      containerArray.push(updateArray)
    }
    console.log(containerArray);
    done(null,containerArray);
  }
  else{
    return done(err);
  }
}

// GET
exports.getAll = function(done){
  db.get().query('SELECT * FROM `fixture`', function (err, rows){
    if (err) return done(err);
    done(null, rows);
  })
}

// GET
exports.getById = function(fixtureId,done){
  db.get().query('SELECT * FROM `fixture` WHERE `id` = ?',fixtureId, function (err, rows){
    if (err) return done(err);
    done(null,rows);
  })
}

// DELETE
exports.deleteById = function(fixtureId,done){
  db.get().query('DELETE FROM `fixture` WHERE `id` = ?',fixtureId, function (err, rows){
    if (err) return done(err);
    done(null,rows);
  })
}

// PATCH
exports.updateById = function(fixtureObj,fixtureId,done){
  if (db.isObject(fixtureObj)){
    var sql = 'UPDATE `fixture` SET ';
    var updateArray = [];
    var updateArrayVars = [];
    for (x in fixtureObj){
      console.log(fixtureObj[x]);
      updateArray.push('`'+ x +'` = ?');
      updateArrayVars.push(fixtureObj[x]);
    }
    var updateVars = updateArray.join(', ');
    updateArrayVars.push(fixtureId);
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
