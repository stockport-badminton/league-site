var db = require('../db_connect.js');

// POST
exports.create = function(name,venue,done){
  db.get().query('INSERT INTO `club` (`name`,`venue`) VALUES (?,?)',[name,venue],function(err,result){
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
  db.get().query('SELECT * FROM `club`', function (err, rows){
    if (err) return done(err);
    done(null, rows);
  })
}

exports.clubDetail = function(done){
  db.get().query('SELECT a.name, a.venue, a.address, a.gMapURL AS clubVenueURL, a.matchNightText,a.clubNightText, a.clubWebsite, venue.name AS matchVenueName, venue.gMapUrl AS matchVenueURL, venue.Lat, venue.Lng FROM (SELECT club.name, venue.name AS venue, venue.gMapUrl,venue.address, club.matchNightText, club.clubNightText, club.clubWebsite,club.matchVenue FROM badminton.club JOIN badminton.venue WHERE venue.id =club.venue) AS a JOIN badminton.venue WHERE (a.matchVenue = venue.id OR a.matchVenue = NULL) ORDER BY a.name', function (err, rows){
    if (err) {
      return done(err);
    }
    else{
      // console.log(rows);
      done(null, rows);
    }

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
    // console.log(rows);
    done(null,rows);
  })
}
