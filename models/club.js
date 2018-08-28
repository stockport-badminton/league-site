var db = require('../db_connect.js');

// POST
exports.create = function(name,venue,done){
  db.get().query('INSERT INTO `club` (`name`,`venue`) VALUES (?,?)',[name,venue],function(err,result){
    if (err) return done(err);
    done(null,result);
  });

}

// GET
exports.getAll = function(done){
  db.get().query('SELECT * FROM `club`', function (err, rows){
    if (err) return done(err);
    done(null, rows);
  })
}

// GET
exports.getById = function(clubId,done){
  db.get().query('SELECT * FROM `club` WHERE `id` = ?',clubId, function (err, rows){
    if (err) return done(err);
    done(null,rows);
  })
}

// DELETE
exports.deleteById = function(clubId,done){
  db.get().query('DELETE FROM `club` WHERE `id` = ?',clubId, function (err, rows){
    if (err) return done(err);
    done(null,rows);
  })
}

// PATCH
exports.updateById = function(name, venue, clubId,done){
  db.get().query('UPDATE `club` SET `name` = ?, `venue` = ? WHERE `id` = ?',[name, venue, clubId], function (err, rows){
    if (err) return done(err);
    console.log(rows);
    done(null,rows);
  })
}
