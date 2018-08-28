var db = require('../db_connect.js');

// POST
exports.create = function(name,league,rank,done){
  db.get().query('INSERT INTO `division` (`name`,`league`,`rank`) VALUES (?,?,?)',[name,league,rank],function(err,result){
    if (err) return done(err);
    done(null,result);
  });

}

// GET
exports.getAll = function(done){
  db.get().query('SELECT * FROM `division`', function (err, rows){
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
    console.log(rows);
    done(null,rows);
  })
}
