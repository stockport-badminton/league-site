var db = require('../db_connect.js');

// POST
exports.create = function(name,starttime,endtime,matchDay,venue,courtspace,club,division,rank,done){
  db.get().query('INSERT INTO `team` (`name`,`starttime`,`endtime`,`matchDay`,`venue`,`courtspace`,`club`,`division`,`rank`) VALUES (?,?,?,?,?,?,?,?,?)',[name,starttime,endtime,matchDay,venue,courtspace,club,division,rank],function(err,result){
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
  db.get().query('SELECT * FROM `team`', function (err, rows){
    if (err) return done(err);
    done(null, rows);
  })
}

// GET
exports.getById = function(teamId,done){
  db.get().query('SELECT * FROM `team` WHERE `id` = ?',teamId, function (err, rows){
    if (err) return done(err);
    done(null,rows);
  })
}

// DELETE
exports.deleteById = function(teamId,done){
  db.get().query('DELETE FROM `team` WHERE `id` = ?',teamId, function (err, rows){
    if (err) return done(err);
    done(null,rows);
  })
}

// PATCH
exports.updateById = function(teamObj,teamId,done){
  if (db.isObject(teamObj)){
    var sql = 'UPDATE `team` SET ';
    var updateArray = [];
    var updateArrayVars = [];
    for (x in teamObj){
      console.log(teamObj[x]);
      updateArray.push('`'+ x +'` = ?');
      updateArrayVars.push(teamObj[x]);
    }
    var updateVars = updateArray.join(', ');
    updateArrayVars.push(teamId);
    //console.log(updateVars);
    sql = sql + updateVars + ' where `id` = ?'
    console.log(sql);
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
