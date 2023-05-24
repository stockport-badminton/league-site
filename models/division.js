var db = require('../db_connect.js');

// POST
exports.create = function(name,league,rank,done){
  db.get().query('INSERT INTO `division` (`name`,`league`,`rank`) VALUES (?,?,?)',[name,league,rank],function(err,result){
    if (err) return done(err);
    done(null,result);
  });

}

exports.createBatch = function(BatchObj,done){
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
    db.get().query(sql,function(err,result){
      if (err) return done(err);
      done(null,result)
    })
  }
  else{
    return done('not object');
  }
}

// GET
exports.getAll = function(done){
  db.get().query('SELECT * FROM `division`', function (err, rows){
    if (err) return done(err);
    done(null, rows);
  })
}

// GET
exports.getAllByLeague = function(leagueId,done){
  db.get().query('SELECT * FROM `division` where league = ?',leagueId, function (err, rows){
    if (err) return done(err);
    done(null, rows);
  })
}

// GET
exports.getById = function(divisionId,done){
  db.get().query('SELECT * FROM `division` WHERE `id` = ?',divisionId, function (err, rows){
    if (err) return done(err);
    done(null,rows);
  })
}

exports.getByName = function(divisionName,done){
  db.get().query('SELECT * FROM `division` WHERE name = ?',divisionName, function (err, rows){
    if (err) return done(err);
    done(null,rows);
  })
}


exports.getIdByURLParam = function(divisionName,done){
  divisionName = divisionName.replace('-',' ');
  db.get().query('SELECT id FROM `division` WHERE name = ?',divisionName, function (err, rows){
    // console.log(this.sql)
    if (err) return done(err);
    done(null,rows);
  })
}

exports.getAllAndSelectedByName = function(leagueId,divisionName,done){
  db.get().query('select *, CASE WHEN division.name = ? THEN true ELSE false END as selected from division WHERE league = ?',[divisionName,leagueId],function(err,rows){
    if (err) return done(err);
    done(null,rows);
  })
}

exports.getAllAndSelectedById = function(leagueId,divisionId,done){
  db.get().query('select *, CASE WHEN division.id = ? THEN true ELSE false END as selected from division WHERE league = ?',[divisionId,leagueId],function(err,rows){
    if (err) return done(err);
    done(null,rows);
  })
}

// DELETE
exports.deleteById = function(divisionId,done){
  db.get().query('DELETE FROM `division` WHERE `id` = ?',divisionId, function (err, rows){
    if (err) return done(err);
    done(null,rows);
  })
}

// PATCH
exports.updateById = function(name, league, rank, divisionId,done){
  db.get().query('UPDATE `division` SET `name` = ?, `league` = ?, `rank` = ? WHERE `id` = ?',[name, league, rank, divisionId], function (err, rows){
    if (err) return done(err);
    // console.log(rows);
    done(null,rows);
  })
}
