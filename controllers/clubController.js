var Club = require('../models/club');
var Venue = require('../models/venue');
var Team = require('../models/teams');
require('dotenv').config()


// Display list of all Clubs
exports.club_list = async function(req, res, next) {
  try {
    const rows = await Club.getAll();
    //console.log(rows);
    res.send(rows);
  } catch (err) {
    next(err);
  }
};

// Display list of all Clubs
exports.club_list_detail = async function(req, res, next) {
  //console.log(req.session)
  try {
    const [result, venueRows] = await Promise.all([
      Club.clubDetail(),
      Venue.getVenueClubs()
    ]);

    let newClubArray = []
    let newClubElem = {}
    let prevRowElem = {}
    let teamElem = {}
    for (row of result){
      if (row.clubId == prevRowElem.id ){
        teamElem = {}
        teamElem.name = row.teamName
        teamElem.venue = row.teammatchvenue
        teamElem.gMapUrl = row.teamgmap
        teamElem.address = row.teamaddress
        teamElem.matchDay = row.matchDay
        if (prevRowElem.teams[prevRowElem.teams.length -1].venue != row.teammatchvenue){
          prevRowElem.teams.push(teamElem)
        }
      }
      else {
        newClubElem = {}
        newClubElem.id = row.clubId
        newClubElem.name = row.name
        newClubElem.venue = row.clubvenue
        newClubElem.gMapUrl = row.clubgmap
        newClubElem.address = row.clubaddress
        newClubElem.matchNightText = row.matchNightText
        newClubElem.clubNightText = row.clubNightText
        newClubElem.clubWebsite = row.clubWebsite
        newClubElem.teams = []
        teamElem = {}
        teamElem.name = row.teamName
        teamElem.venue = row.teammatchvenue
        teamElem.gMapUrl = row.teamgmap
        teamElem.address = row.teamaddress
        teamElem.matchDay = row.matchDay
        newClubElem.teams.push(teamElem)
        if (prevRowElem != {}){
          newClubArray.push(prevRowElem)
        }
        prevRowElem = newClubElem
      }
    }
    newClubArray.push(newClubElem)
    newClubArray.shift()
    // console.log(JSON.stringify(newClubArray))
    console.log(newClubArray)
    console.log(JSON.stringify(venueRows))
    res.status(200);
    res.render('club-v2', {
         static_path: '/static',
         pageTitle : "Local Badminton Club Information",
         pageDescription : "Find your local badminton clubs, when they play, where they play.",
         result: newClubArray,
         error: false,
         recaptcha : process.env.RECAPTCHA,
         mapsApiKey: process.env.GMAPSAPIKEY,
         venues:JSON.stringify(venueRows),
         canonical:("https://" + req.get("host") + req.originalUrl).replace("www.'","").replace(".com",".co.uk").replace("-badders.herokuapp","-badminton")
     });
  } catch (err) {
    res.status(500);
    next(err);
  }
};

exports.club_detail_api = async function(req, res, next) {
  try {
    const clubrow = await Club.getContactDetailsById(req.params.id);
    if (typeof clubrow == 'undefined' || clubrow.length == 0) {
      res.status(500);
      return next(new Error('Club not found'));
    }
    res.send(clubrow);
  } catch (err) {
    res.status(500);
    next(err);
  }
};

// Display detail page for a specific Club
exports.club_detail = async function(req, res, next) {
  //console.log(req.session)
  try {
    const clubrow = await Club.getContactDetailsById(req.params.id);
    if (typeof clubrow == 'undefined' || clubrow.length == 0) {
      res.status(500);
      return next(new Error('Club not found'));
    }
    console.log("clubrow");
    for (row of clubrow){
      console.log(row)
       //console.log(row)
    }
    // console.log(JSON.stringify(clubrow));
    // console.log(clubrow)
    res.status(200);
    res.render('club-contact', {
        static_path: '/static',
        pageTitle : clubrow[0].clubname + " Contact information",
        pageDescription : clubrow[0].clubname + "'s Club / Team Contact information",
        clubrow: clubrow,
        error: false,
        mapsApiKey: process.env.GMAPSAPIKEY,
        canonical:("https://" + req.get("host") + req.originalUrl).replace("www.'","").replace(".com",".co.uk").replace("-badders.herokuapp","-badminton")
    });
  } catch (err) {
    res.status(500);
    next(err);
  }
};

// Display Club create form on GET
exports.club_create_get = function(req, res) {
    res.send('NOT IMPLEMENTED: Club create GET');
};

// Handle Club create on POST
exports.club_create_post = async function(req, res, next) {
  try {
    const row = await Club.create(req.body.name, req.body.venue);
    //console.log(req.body);
    //console.log(row);
    res.send(row);
  } catch (err) {
    next(err);
  }
};

exports.club_batch_create = async function(req, res, next) {
  try {
    const result = await Club.createBatch(req.body);
    // console.log(result)
    res.send(result);
  } catch (err) {
    res.send(err);
    //console.log(err);
  }
};

// Display Club delete form on GET
exports.club_delete_get = function(req, res) {
    res.send('NOT IMPLEMENTED: Club delete GET');
};

// Handle Club delete on POST
exports.club_delete_post = async function(req, res, next) {
  try {
    const row = await Club.deleteById(req.params.id);
    //console.log(req.params)
    //console.log(row);
    res.send(row);
  } catch (err) {
    next(err);
  }
};

// Display Club update form on GET
exports.club_update_get = function(req, res) {
    res.send('NOT IMPLEMENTED: Club update GET');
};

// Handle Club update on POST
exports.club_update_post = async function(req, res, next) {
  try {
    const row = await Club.updateById(req.body.name, req.body.venue, req.params.id);
    //console.log(req.body);
    //console.log(row);
    res.send(row);
  } catch (err) {
    next(err);
  }
};

// ---------------------------------------------------------------------------
// Superadmin admin UI — add / edit clubs (mirrors the homepage-content pattern)
// ---------------------------------------------------------------------------

function isSuperAdmin(req) {
  return !!(req.user && req.user._json && req.user._json['https://my-app.example.com/role'] === 'superadmin');
}

function canonicalFor(req) {
  return ("https://" + req.get("host") + req.originalUrl).replace("www.'", "").replace(".com", ".co.uk").replace("-badders.herokuapp", "-badminton");
}

// Build a {column: value} object from the club form. name is required; every
// other field becomes null when left blank so edits can clear values. FK/int
// columns are coerced to integers. matchSec/clubSec are intentionally excluded
// (player references — assignable later once the club has a roster).
function buildClubObj(body) {
  const obj = { name: (body.name || '').trim() };
  ['matchNightText', 'clubNightText', 'clubNight', 'clubWebsite', 'contactUs', 'facebook', 'instagram', 'twitter'].forEach(k => {
    const v = (body[k] || '').trim();
    obj[k] = v === '' ? null : v;
  });
  ['venue', 'matchVenue', 'clubNightCourts'].forEach(k => {
    const n = parseInt(body[k], 10);
    obj[k] = (body[k] == null || body[k] === '' || isNaN(n)) ? null : n;
  });
  return obj;
}

exports.admin_club_list = async function(req, res, next) {
  if (!isSuperAdmin(req)) return res.status(403).send('Forbidden');
  try {
    const clubs = await Club.getAll();
    res.render('admin/club-list', {
      static_path: '/static',
      pageTitle: 'Club Admin',
      pageDescription: 'Add and edit clubs',
      user: req.user,
      clubs,
      canonical: canonicalFor(req)
    });
  } catch (err) {
    next(err);
  }
};

exports.admin_club_createForm = async function(req, res, next) {
  if (!isSuperAdmin(req)) return res.status(403).send('Forbidden');
  try {
    const venues = await Venue.getAll();
    res.render('admin/club-form', {
      static_path: '/static',
      pageTitle: 'New Club',
      pageDescription: 'Create a club',
      user: req.user,
      club: null,
      venues,
      canonical: canonicalFor(req)
    });
  } catch (err) {
    next(err);
  }
};

exports.admin_club_create = async function(req, res, next) {
  if (!isSuperAdmin(req)) return res.status(403).send('Forbidden');
  try {
    const clubObj = buildClubObj(req.body);
    if (!clubObj.name) return res.status(400).send('Club name is required');
    await Club.createFull(clubObj);
    res.redirect('/admin/clubs');
  } catch (err) {
    next(err);
  }
};

exports.admin_club_editForm = async function(req, res, next) {
  if (!isSuperAdmin(req)) return res.status(403).send('Forbidden');
  try {
    const [club] = await Club.getById(req.params.id);
    if (!club) return res.status(404).send('Not found');
    const venues = await Venue.getAll();
    res.render('admin/club-form', {
      static_path: '/static',
      pageTitle: 'Edit Club',
      pageDescription: 'Edit a club',
      user: req.user,
      club,
      venues,
      canonical: canonicalFor(req)
    });
  } catch (err) {
    next(err);
  }
};

exports.admin_club_update = async function(req, res, next) {
  if (!isSuperAdmin(req)) return res.status(403).send('Forbidden');
  try {
    const clubObj = buildClubObj(req.body);
    if (!clubObj.name) return res.status(400).send('Club name is required');
    await Club.updateFull(clubObj, req.params.id);
    res.redirect('/admin/clubs');
  } catch (err) {
    next(err);
  }
};
