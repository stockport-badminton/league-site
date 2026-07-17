var Division = require('../models/division');
var seasonModel = require("../models/season");
var Team = require('../models/teams');
var Player = require('../models/players');
var Fixture = require('../models/fixture');
var Game = require('../models/game');
var HomepageContent = require('../models/homepageContent');
var SiteSettings = require('../models/siteSettings');
const axios = require('axios');
var AWS = require('aws-sdk');
const ICAL = require('ical.js');
var contact_controller = require(__dirname + '/contactusController');




// Display fixtures played 6 days ago that haven't had results entered
exports.getLateScorecards = async function(req, res) {
  try {
    const row = await Fixture.getCardsDueToday();
    const msg = {
      to: 'stockport.badders.results@gmail.com',
      from: 'stockport.badders.results@stockport-badminton.co.uk',
      replyto: 'stockport.badders.results@gmail.com',
      templateId: 'd-3a224c8f7b214f3ba4062f6a2dbd1bd4',
      dynamic_template_data: { "missingFixtures": [] }
    };

    var params;
    if (row.length > 0) {
      for (var x = 0; x < row.length; x++) {
        var fixture = {};
        fixture.date = row[x].date;
        fixture.homeTeam = row[x].homeTeam;
        fixture.awayTeam = row[x].awayTeam;
        msg.dynamic_template_data.missingFixtures.push(fixture);
      }
      params = {
        Destination: { ToAddresses: ['stockport.badders.results@gmail.com', 'bigcoops@outlook.com'] },
        Message: {
          Body: { Html: { Charset: 'UTF-8', Data: contact_controller.generateMissingScorecardHTML(msg.dynamic_template_data.missingFixtures) } },
          Subject: { Charset: 'UTF-8', Data: 'Todays Missing Scorecards' }
        },
        Source: 'results@stockport-badminton.co.uk',
        ReplyToAddresses: ['stockport.badders.results@gmail.com'],
      };
    } else {
      msg.dynamic_template_data.noFixtures = 'No outstanding fixtures today';
    }

    let today = new Date()
    if (today.getMonth() <= 4 || today.getMonth() >= 7) {
      var ses = new AWS.SES({ apiVersion: '2010-12-01' });
      await ses.sendEmail(params).promise();
      res.send("Message Sent");
    } else {
      res.sendStatus(200);
    }
  } catch (err) {
    console.log(err.toString());
    res.status(500).send(err);
  }
};


exports.fixture_outstanding = async function(req, res, next) {
  try {
    const result = await Fixture.getOutstandingResults();
    res.render('results-short', {
      static_path: '/static',
      theme: process.env.THEME || 'flatly',
      pageTitle: "Quick Results Entry",
      pageDescription: "Quick Results Entry",
      result: result,
      stringResult: JSON.stringify(result),
      canonical: ("https://" + req.get("host") + req.originalUrl).replace("www.'", "").replace(".com", ".co.uk").replace("-badders.herokuapp", "-badminton")
    });
  } catch (err) {
    next(err);
  }
}

// Handle Fixture update on POST
exports.fixture_outstanding_post = async function(req, res, next) {
  try {
    var reqBody = {
      "homeScore": 1 * (req.body.homeTeamScore),
      "awayScore": 18 - req.body.homeTeamScore,
      "status": "complete"
    }
    await Fixture.updateById(reqBody, req.body.outstandingResults);
    var zapObject = {
      "homeTeam": req.body.homeTeamName,
      "awayTeam": req.body.awayTeamName,
      "homeScore": 1 * (req.body.homeTeamScore),
      "awayScore": 1 * (req.body.awayTeamScore),
      "division": "Premier"
    }
    // Get social media mentions for the result
    zapObject.mentions = await Fixture.getResultMentions(zapObject.homeTeam, zapObject.awayTeam);
    const zapRes = await Fixture.sendResultZap(zapObject);
    const result = await Fixture.getOutstandingResults();
    res.render('results-short', {
      static_path: '/static',
      theme: process.env.THEME || 'flatly',
      pageTitle: "Quick Results Entry - Success",
      pageDescription: "Quick Results Entry - Success",
      result: result,
      zapRes: zapRes,
      success: true,
      canonical: ("https://" + req.get("host") + req.originalUrl).replace("www.", "").replace(".com", ".co.uk").replace("-badders.herokuapp", "-badminton")
    });
  } catch (err) {
    next(err);
  }
};

// Display list of all Fixtures
exports.fixture_list = async function(req, res, next) {
  try {
    const row = await Fixture.getAll();
    res.send(row);
  } catch (err) {
    res.send(err);
  }
};

// Display list of all Fixtures
exports.get_fixture_players_details = async function(req, res, next) {
  try {
    var searchObj = {}
    if (req.params.season !== undefined) searchObj.season = req.params.season
    if (req.params.team !== undefined) searchObj.team = req.params.team
    if (req.params.club !== undefined) searchObj.club = req.params.club
    const row = await Fixture.getMatchPlayerOrderDetails(searchObj);
    let clubs = row.map(item => item.name).filter((value, index, self) => self.indexOf(value) === index)
    let teams = row.map(item => item.teamName).filter((value, index, self) => self.indexOf(value) === index)
    res.render('fixture-players', {
      static_path: '/static',
      pageTitle: "Fixture Player Details",
      pageDescription: "Find out who played which matches and in what order",
      filter: true,
      hideFilters: ["division", "gender", "gametype"],
      teams: teams,
      clubs: clubs,
      result: row,
      canonical: ("https://" + req.get("host") + req.originalUrl).replace("www.'", "").replace(".com", ".co.uk").replace("-badders.herokuapp", "-badminton")
    });
  } catch (err) {
    res.send(err);
  }
};

// Return fixture id given home and away team ids
exports.fixture_id = async function(req, res, next) {
  try {
    const row = await Fixture.getFixtureId({ "homeTeam": req.params.homeTeam, "awayTeam": req.params.awayTeam });
    res.send(row);
  } catch (err) {
    res.send(err);
  }
};

// Return fixture id given home and away team names
exports.fixture_id_from_team_names = async function(req, res, next) {
  try {
    const row = await Fixture.getFixtureIdFromTeamNames({ "homeTeam": req.params.homeTeam, "awayTeam": req.params.awayTeam });
    res.send(row);
  } catch (err) {
    res.send(err);
  }
};

// Display detail page for a specific Fixture
exports.fixture_detail = async function(req, res, next) {
  try {
    const row = await Fixture.getById(req.params.id);
    res.send(row);
  } catch (err) {
    res.send(err);
  }
};

// Display detail page for a specific Fixture
exports.fixture_event_detail = async function(req, res, next) {
  try {
    const row = await Fixture.getFixtureEventById(req.params.id);
    res.render('viewEventDetails', {
      static_path: '/static',
      pageTitle: 'Event Details: ' + row[0].homeTeam + " vs " + row[0].awayTeam,
      pageDescription: "View scorecard for this match",
      fixtureDetails: row[0],
      mapsApiKey: process.env.GMAPSAPIKEY,
      canonical: ("https://" + req.get("host") + req.originalUrl).replace("www.'", "").replace(".com", ".co.uk").replace("-badders.herokuapp", "-badminton")
    });
  } catch (err) {
    res.send(err);
  }
};

// Display detail page for a specific Fixture
exports.getScorecard = async function(req, res, next) {
  try {
    const row = await Fixture.getScorecardDataById(req.params.id);
    res.render('viewScorecard', {
      static_path: '/static',
      pageTitle: "Scorecard Info",
      pageDescription: "View scorecard for this match",
      result: row,
      canonical: ("https://" + req.get("host") + req.originalUrl).replace("www.'", "").replace(".com", ".co.uk").replace("-badders.herokuapp", "-badminton")
    });
  } catch (err) {
    res.send(err);
  }
};

exports.fixture_calendars = async function(req,res,next){
    // console.log(Object.entries(req.params))
    var convertedParams = req.params[0].replace('Premier','division-7')
      .replace('Division 1','division-8')
      .replace('Division-1','division-8')
      .replace('Division 2','division-9')
      .replace('Division-2','division-9')
      .replace('Division 3','division-10')
      .replace('Division-3','division-10')
      .replace(/(\/)(20\d\d20\d\d)/g,'$1season-$2')
    const pattern = /(\bPremier(?!\s|-\d)|Division(?:-|\s))(\d+)/g;
    // Finding matches using regex and replacing them
    const replacedMatches = [];
    const replacedString = req.params[0].replace(pattern, (match, p1, p2) => {
      let replacedMatch;
      if (p1 === "Premier") {
        replacedMatch = p1;
      } else {
        replacedMatch = `${p1.replace('-', ' ')}${p2}`;
      }
      replacedMatches.push(replacedMatch);
      return replacedMatch;
    });
    let divisionString = "All"
    if (replacedMatches.length > 0){
      divisionString = replacedMatches[0]
    }
    // console.log(regexParams)
    var searchArray = convertedParams.split('/')
    let searchObj = searchArray.reduce((acc, str) => {
      const [key, value] = str.split("-");
      return { ...acc, [key]: value };
    }, {});
     //console.log(searchObj)
    try {
      let result = await Fixture.getFixtureDetails(searchObj);
      {
          result = result.filter(row => row.homeClub.indexOf('No Club') == -1)
          let id = (searchObj.season != undefined ? searchObj.season:seasonModel.current()) + (searchObj.division != undefined ? searchObj.division:"") + (searchObj.club != undefined ? searchObj.club:"") + (searchObj.team != undefined ? searchObj.team:"")

          const jcal = new ICAL.Component('vcalendar');
          jcal.addPropertyWithValue('prodid', (searchObj.season != undefined ? searchObj.season:seasonModel.current()) +"/"+ (searchObj.division != undefined ? searchObj.division:"") +"/"+ (searchObj.club != undefined ? searchObj.club:"") +"/"+ (searchObj.team != undefined ? searchObj.team:""));
          jcal.addPropertyWithValue('version', '2.0');
          const vcalendar = jcal

          // Iterate over each event and convert it to an iCalendar event
          result.forEach(row => {
            let MyDate = new Date(row.date)

            let startDate = MyDate.getFullYear()+ ('0' + (MyDate.getMonth()+1)).slice(-2)  + ('0' + MyDate.getDate()).slice(-2)
            let endDate = MyDate.getFullYear() + ('0' + (MyDate.getMonth()+1)).slice(-2) + ('0' + (MyDate.getDate()+1)).slice(-2)
            const vevent = new ICAL.Component('vevent');
            vevent.addPropertyWithValue('uid', row.id.toString());
            vevent.addPropertyWithValue('summary', row.homeTeam + " vs " + row.awayTeam);
            vevent.addPropertyWithValue('dtstart;value=date', startDate);
            vevent.addPropertyWithValue('dtend;value=date', endDate);
            vevent.addPropertyWithValue('location', row.venueName + " " + row.venueLink);

            // Add other properties if needed

            vcalendar.addSubcomponent(vevent);
          });

          // Convert the iCalendar object to a string
          const icsData = jcal.toString();

          // Set the response headers
          res.setHeader('Content-Type', 'text/calendar');
          res.setHeader('Content-Disposition', `attachment; filename=${id}.ics`);
          res.setHeader('Cache-Control', 'no-cache');
          res.setHeader('ETag', id + new Date().toUTCString()); // Update the ETag value when the calendar data changes
          res.setHeader('Last-Modified', new Date().toUTCString());

          // Send the iCalendar data as the response
          res.send(icsData);
      }
    } catch (err) {
      next(err);
    }
}

// Display detail page for a specific Fixture
exports.fixture_detail_byDivision = async function(req, res, next) {
  function buildGridData(result) {
    let divisionsArray = result.map(row => row.division).filter((division, index, arr) => arr.indexOf(division) == index)
    let griddedData = []
    for (division of divisionsArray) {
      let gridFixtures = result.filter(row => row.division == division && row.status != 'rearranged' && row.id != 99999)
      gridFixtures.sort(function(x, y) { return x.homeTeam.localeCompare(y.homeTeam) || x.awayTeam.localeCompare(y.awayTeam); });
      let gridTeams = gridFixtures.map(p => p.homeTeam).filter((homeTeam, index, arr) => arr.indexOf(homeTeam) == index)
      let gridDataElem = {}
      gridDataElem.teams = gridTeams
      gridDataElem.fixtures = gridFixtures
      gridDataElem.division = division == 7 ? "Prem" : division == 8 ? "Division 1" : division == 9 ? "Division 2" : "Division 3";
      griddedData.push(gridDataElem)
    }
    return griddedData
  }

  function getNearestFixture(result) {
    let today = new Date()
    today.setHours(0); today.setMinutes(0); today.setSeconds(0); today.setMilliseconds(0);
    let nearestFixture = result
      .map((row) => ({ "date": row.date, "diff": new Date(row.date) - today }))
      .filter(row => row.diff >= 0)
      .sort((a, b) => a.diff - b.diff)
    if (nearestFixture.length == 0) nearestFixture.push(result[result.length - 1])
    return nearestFixture
  }

  function applyAdminRole(renderObject, req) {
    if (req.path.search('admin') != -1 && req.user._json["https://my-app.example.com/role"] !== undefined) {
      const role = req.user._json["https://my-app.example.com/role"]
      if (role == "admin" || role == "superadmin") {
        renderObject.admin = true
        renderObject.superadmin = role == "superadmin"
        renderObject.user = req.user
      }
    }
  }

  try {
    let divisionString = "";
    let searchObj = {}
    if (req.params.division !== undefined) {
      divisionString = req.params.division.replace('-', ' ')
      const row = await Division.getIdByURLParam(req.params.division);
      if (row.length < 1) {
        delete req.params.division
        searchObj = req.params
      } else {
        searchObj = req.params
        searchObj.division = row[0].id
      }
      const result = await Fixture.getFixtureDetails(searchObj);
      const nearestFixture = getNearestFixture(result)
      console.log(`nearestFixture: ${nearestFixture[0].date}`)
      var type = '';
      if (req.path.indexOf('results-grid') > -1) type = '-grid'
      const griddedData = buildGridData(result)
      let renderObject = {
        static_path: '/static',
        pageTitle: "Fixtures & Results: " + divisionString,
        pageDescription: "Find out how the teams in your division have got on, and check when your next match is",
        result: result,
        jsonResult: griddedData,
        error: false,
        division: divisionString,
        nearestDate: nearestFixture[0].date,
        canonical: ("https://" + req.get("host") + req.originalUrl).replace("www.", "").replace(".com", ".co.uk").replace("-badders.herokuapp", "-badminton")
      }
      applyAdminRole(renderObject, req)
      console.log(renderObject)
      res.render('fixtures-results' + type, renderObject);
    } else {
      var convertedParams = req.params[0].replace('Premier', 'division-7')
        .replace('Division 1', 'division-8').replace('Division-1', 'division-8')
        .replace('Division 2', 'division-9').replace('Division-2', 'division-9')
        .replace('Division 3', 'division-10').replace('Division-3', 'division-10')
        .replace(/(\/)(20\d\d20\d\d)/g, '$1season-$2')
      const pattern = /(\bPremier(?!\s|-\d)|Division(?:-|\s))(\d+)/g;
      const replacedMatches = [];
      req.params[0].replace(pattern, (match, p1, p2) => {
        replacedMatches.push(p1 === "Premier" ? p1 : `${p1.replace('-', ' ')}${p2}`);
        return match;
      });
      divisionString = replacedMatches.length > 0 ? replacedMatches[0] : "All"
      var searchArray = convertedParams.split('/')
      searchObj = searchArray.reduce((acc, str) => {
        const [key, value] = str.split("-");
        return { ...acc, [key]: value };
      }, {});
      if (req.path.search('admin') != -1 && req.user._json["https://my-app.example.com/role"] == "admin") {
        if (req.user._json["https://my-app.example.com/club"] != "All" && req.user._json["https://my-app.example.com/club"] !== undefined) {
          searchObj.club = req.user._json["https://my-app.example.com/club"]
        }
      }
      const result = await Fixture.getFixtureDetails(searchObj);
      const nearestFixture = getNearestFixture(result)
      console.log(`nearestFixture: ${nearestFixture[0].date}`)
      var type = '';
      if (req.path.indexOf('results-grid') > -1) type = '-grid'
      const griddedData = buildGridData(result)
      let titleString = ""
      if (searchObj !== undefined) {
        for (filter of ['season', 'division', 'club', 'team']) {
          let sqlParams = Object.entries(searchObj).filter(obj => obj[0] === filter)
          if (sqlParams.length > 0) titleString += sqlParams[0][1] + " "
        }
      }
      let clubs = result.map(item => item.homeClub).filter((value, index, self) => self.indexOf(value) === index)
      let teams = result.map(item => item.homeTeam).filter((value, index, self) => self.indexOf(value) === index)
      let renderObject = {
        path: req.path,
        user: req.user,
        clubs: clubs,
        teams: teams,
        filter: true,
        hideFilters: ["gender", "gametype"],
        static_path: '/static',
        pageTitle: "Fixtures & Results: " + titleString,
        pageDescription: "Find out how the teams in your division have got on, and check when your next match is",
        result: result,
        jsonResult: griddedData,
        error: false,
        division: divisionString,
        nearestDate: nearestFixture[0].date,
        canonical: ("https://" + req.get("host") + req.originalUrl).replace("www.'", "").replace(".com", ".co.uk").replace("-badders.herokuapp", "-badminton")
      }
      applyAdminRole(renderObject, req)
      if (req.path.indexOf('fixtures') > -1) {
        res.status(200);
        res.send(result);
      } else {
        res.status(200);
        console.log(renderObject.jsonResult)
        res.render('fixtures-results' + type, renderObject);
      }
    }
  } catch (err) {
    next(err);
  }
};


// Display Fixture create form on GET
exports.fixture_create_get = function(req, res,next) {
    res.send('NOT IMPLEMENTED: Fixture create GET');
};

// Handle Fixture create on POST
exports.fixture_create_post = async function(req, res, next) {
  try {
    const row = await Fixture.create(req.body);
    res.send(row);
  } catch (err) {
    res.send(err);
  }
};



// Handle getting results from previous 7 days
exports.fixture_get_summary = async function(req, res, next) {
  try {
    const [scorecards, recentResults, upcomingFixtures, announcements, galleryTag] = await Promise.all([
      Fixture.getOutstandingScorecards(),
      Fixture.getRecent(),
      Fixture.getupComing(),
      HomepageContent.getActive(),
      SiteSettings.get('homepage_gallery_tag')
    ]);
    let assets = [];
    try {
      const response = await axios.get('https://'+process.env.CLOUDINARY_KEY+':'+process.env.CLOUDINARY_SECRET+'@api.cloudinary.com/v1_1/hvunsveuh/resources/image/tags/'+(galleryTag || 'messer2026')+'?max_results=30&context=true');
      assets = response.data.resources;
    } catch (cloudinaryErr) {
      console.error('Cloudinary fetch failed:', cloudinaryErr.message);
    }
    res.render('homepage', {
      static_path: '/static',
      pageTitle: "Homepage",
      pageDescription: "Clubs: Aerospace, Astrazeneca, Altrincham Central, Bramhall Village, CAP, Canute, Carrington, Cheadle Hulme, College Green, David Lloyd, Disley, Dome, GHAP, Macclesfield, Manor, Mellor, New Mills, Parrswood, Poynton, Racketeer, Shell, Syddal Park, Tatton. Social and Competitive badminton in and around Stockport.",
      result: recentResults,
      row: upcomingFixtures,
      scorecards,
      assets,
      announcements,
      canonical: ("https://" + req.get("host") + req.originalUrl).replace("www.'", "").replace(".com", ".co.uk").replace("-badders.herokuapp", "-badminton")
    });
  } catch (err) {
    next(err);
  }
};

// Static-friendly homepage used as the offline fallback for `/`. Omits the
// dynamic fixture sections (upcoming/recent/outstanding) and the Cloudinary
// gallery — just nav, branding and the CMS announcements — so the service
// worker can snapshot an anonymous copy at install time and serve it offline.
exports.fixture_get_offline_home = async function(req, res, next) {
  try {
    const announcements = await HomepageContent.getActive();
    res.render('homepage', {
      static_path: '/static',
      pageTitle: "Homepage",
      pageDescription: "Stockport & District Badminton League — social and competitive badminton in and around Stockport.",
      offline: true,
      result: [],
      row: [],
      scorecards: [],
      assets: [],
      announcements,
      canonical: ("https://" + req.get("host") + req.originalUrl).replace("www.'", "").replace(".com", ".co.uk").replace("-badders.herokuapp", "-badminton")
    });
  } catch (err) {
    next(err);
  }
};

exports.fixture_batch_create = async function(req, res, next) {
  try {
    const result = await Fixture.createBatch(req.body);
    res.send(result);
  } catch (err) {
    next(err);
  }
}

exports.fixture_update_by_team_name = async function(req, res, next) {
  try {
    const result = await Fixture.updateByTeamNames(req.body);
    res.send(result);
  } catch (err) {
    next(err);
  }
}


exports.fixture_rearrange_by_team_name = async function(req, res, next) {
  try {
    const result = await Fixture.rearrangeByTeamNames(req.body);
    res.send(result);
  } catch (err) {
    next(err);
  }
}

// Display Fixture delete form on GET
exports.fixture_delete_get = function(req, res,next) {
    res.send('NOT IMPLEMENTED: Fixture delete GET');
};

// Handle Fixture delete on POST
exports.fixture_delete_post = async function(req, res, next) {
  try {
    const row = await Fixture.deleteById(req.params.id);
    res.send(row);
  } catch (err) {
    next(err);
  }
};

// Display Fixture update form on GET
exports.fixture_update_get = function(req, res, next) {
    res.send('NOT IMPLEMENTED: Fixture update GET');
};


// Handle Fixture update on POST
exports.fixture_update_post = async function(req, res, next) {
  try {
    const row = await Fixture.updateById(req.body, req.params.id);
    res.send(row);
  } catch (err) {
    res.send(err);
  }
};

function isSuperAdmin(req) {
  return !!(req.user && req.user._json && req.user._json['https://my-app.example.com/role'] === 'superadmin');
}

// Inline date edit from the admin results grid (session-secured, superadmin only).
// Edits the existing fixture's date in place — distinct from the rearrangement flow,
// which archives the old fixture and inserts a new one.
exports.admin_fixture_date_update = async function(req, res, next) {
  if (!isSuperAdmin(req)) return res.status(403).json({ error: 'Forbidden' });
  const date = (req.body.date || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: 'Invalid date — expected YYYY-MM-DD' });
  }
  try {
    // Store as a wall-clock string to avoid the TIMESTAMP -> JS Date off-by-one.
    const result = await Fixture.updateById({ date: date + ' 00:00:00' }, req.params.id);
    if (!result.affectedRows) return res.status(404).json({ error: 'Fixture not found' });
    res.json({ ok: true, id: req.params.id, date });
  } catch (err) {
    next(err);
  }
};
