var Club = require('../models/club');
var Venue = require('../models/venue');
var Team = require('../models/teams');
var Roster = require('../models/roster');
const { canonicalFor, clubPath, clubSlug } = require('../utils/canonical');
const SD = require('../utils/structuredData');
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
        // For the SportsClub JSON-LD below — coordinates, club night and the club's
        // own social/web presence (emitted as sameAs).
        newClubElem.Lat = row.clubLat
        newClubElem.Lng = row.clubLng
        newClubElem.clubNight = row.clubNight
        newClubElem.facebook = row.facebook
        newClubElem.instagram = row.instagram
        newClubElem.twitter = row.twitter
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
         // One SportsClub block per club, built in utils/structuredData.js rather
         // than as literal JSON in the template. Club 63 is the `No Club` sentinel
         // and is skipped here for the same reason club-v2.ejs skips it in the table.
         jsonLd: newClubArray
           .filter(function(c) { return c.id !== Roster.NO_CLUB_ID; })
           .map(function(c) { return SD.jsonLd(SD.sportsClub(c)); }),
         canonical:canonicalFor(req)
     });
  } catch (err) {
    res.status(500);
    next(err);
  }
};

// GET /clubs/:slug — a club's own public page.
//
// The reason this exists: Search Console shows "badminton club near me" at position
// 24.5 on 1,387 impressions and "badminton clubs near me" at 16.3 on 807, both
// answered by /info/clubs — a single URL carrying all 18 clubs. One page cannot rank
// for 18 different local intents, and individual club names are searched too
// ("cheadle hulme badminton club", 564 impressions). A page per club is the fix.
//
// It does not compete with the clubs' own websites: it links out to them prominently
// and says so in the markup with `sameAs`. Contact goes through the league's form —
// no captain or secretary details are published here.
exports.club_public_page = async function(req, res, next) {
  try {
    const clubs = await Club.getPublicClubs(Roster.NO_CLUB_ID);
    const slug = String(req.params.slug || '').toLowerCase();
    const club = clubs.find(function(c) { return clubSlug(c.name) === slug; });

    // A slug we don't recognise is absent, not an error — and must not be a 200.
    if (!club) {
      return res.status(404).render('404-error', {
        static_path: '/static',
        pageTitle: 'Club not found',
        pageDescription: 'No club with that name',
        canonical: canonicalFor(req)
      });
    }

    const teams = await Club.getTeamsForClub(club.id, Roster.NO_TEAM_ID);
    const displayName = /badminton/i.test(club.name) ? club.name : club.name + ' Badminton Club';
    const address = SD.parseUkAddress(club.venueAddress);
    const town = address && address.addressLocality;

    res.render('club-page', {
      static_path: '/static',
      // Town in the title because that is the half of "badminton club near me" the
      // old single page could never say.
      pageTitle: displayName + (town ? ', ' + town : ''),
      pageDescription: 'Where and when ' + displayName + ' play'
        + (town ? ' in ' + town : '') + ', plus their teams in the '
        + SD.LEAGUE_NAME + '.',
      club,
      teams,
      displayName,
      town,
      jsonLd: [
        SD.jsonLd(SD.sportsClub(club)),
        SD.jsonLd(SD.breadcrumbs([
          { name: 'Home', path: '/' },
          { name: 'Clubs', path: '/info/clubs' },
          { name: displayName, path: clubPath(club) },
        ])),
      ],
      canonical: canonicalFor(req)
    });
  } catch (err) {
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
        canonical:canonicalFor(req)
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
    // Was `res.send(err)` — an Error serialises to `{}` and goes out with the default
    // status, so a failed request answered **HTTP 200** with an empty body. A visitor
    // saw a blank page, Sentry heard nothing because Express thought it succeeded, and
    // a crawler banked it as a real page. That is what blanked 48 /event/ pages.
    next(err);
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
