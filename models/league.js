var db = require('../db_connect.js');

// POST
exports.create = function(name,admin,url,done){
  db.get().query('INSERT INTO `league` (`name`,`admin`,`url`) VALUES (?,?,?)',[name,admin,url],function(err,result){
    if (err) return done(err);
    done(null,result.insertId);
  });

}

// GET
exports.getAll = function(done){
  db.get().query('SELECT * FROM `league`', function (err, rows){
    if (err) return done(err);
    done(null, rows);
  })
}

// GET
exports.getById = function(leagueId,done){
  db.get().query('SELECT * FROM `league` WHERE `id` = ?',leagueId, function (err, rows){
    if (err) return done(err);
    done(null,rows);
  })
}

// DELETE
exports.deleteById = function(leagueId,done){
  db.get().query('DELETE FROM `league` WHERE `id` = ?',leagueId, function (err, rows){
    if (err) return done(err);
    done(null,rows);
  })
}

// PATCH
exports.updateById = function(name, admin, url, leagueId,done){
  db.get().query('UPDATE `league` SET `name` = ?, `admin` = ?, `url` = ? WHERE `id` = ?',[name, admin, url, leagueId], function (err, rows){
    if (err) return done(err);
    console.log(rows);
    done(null,rows);
  })
}
