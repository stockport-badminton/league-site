var db = require('../db_connect.js');

// POST
exports.create = function(name,address,gMapUrl,done){
  db.get().query('INSERT INTO `venue` (`name`,`address`,`gMapUrl`) VALUES (?,?,?)',[name,address,gMapUrl],function(err,result){
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
  db.get().query('SELECT * FROM `venue`', function (err, rows){
    if (err) return done(err);
    done(null, rows);
  })
}

exports.getVenueClubs = function(done){
  db.get().query("select venueName, Lat, Lng, group_concat(venueClubsHTML SEPARATOR '<br />' ) as venueInfoBox FROM (Select venueName, Lat, Lng, concat('<strong id=\"firstHeading\" class=\"firstHeading\"><a href=\"',clubWebsite,'\">',clubName,'</a></strong><div id=\"bodyContent\"><p>Match Night:',matchNightText,'<br />Club Night:',clubNightText,'<br />Address:<a href=\"',gMapUrl,'\">',address,'</a></p></div>') as venueClubsHTML FROM (SELECT venue.name AS venueName, venue.address, venue.gMapURL, venue.Lat, venue.Lng, club.name AS clubName, club.matchNightText, club.clubNightText, club.clubWebsite FROM badminton.venue JOIN club WHERE venue.id = club.venue UNION SELECT venue.name AS venueName, venue.address, venue.gMapURL, venue.Lat, venue.Lng, club.name AS clubName, club.matchNightText, club.clubNightText, club.clubWebsite FROM badminton.venue JOIN club WHERE venue.id = club.matchVenue) as venueInfo) as groupedVenueInfo group by venueName",function(err,rows){
    if (err) return done(err)
    done(null,rows)
  })
}

// GET
exports.getById = function(venueId,done){
  db.get().query('SELECT * FROM `venue` WHERE `id` = ?',venueId, function (err, rows){
    if (err) return done(err);
    done(null,rows);
  })
}

// DELETE
exports.deleteById = function(venueId,done){
  db.get().query('DELETE FROM `venue` WHERE `id` = ?',venueId, function (err, rows){
    if (err) return done(err);
    done(null,rows);
  })
}

// PATCH
exports.updateById = function(name,address,gMapUrl, venueId,done){
  db.get().query('UPDATE `venue` SET `name` = ?, `address` = ?, `gMapUrl` = ? WHERE `id` = ?',[name,address,gMapUrl, venueId], function (err, rows){
    if (err) return done(err);
    // console.log(rows);
    done(null,rows);
  })
}
