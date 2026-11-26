var config = require('../config');
const log = require('../utils/log');
var Division = require('../models/division');
var seasonModel = require("../models/season");
var Team = require('../models/teams');
var Player = require('../models/players');
var Fixture = require('../models/fixture');
const LeagueEvent = require('../models/leagueEvent');
var Game = require('../models/game');
var HomepageContent = require('../models/homepageContent');
var SiteSettings = require('../models/siteSettings');
const cloudinaryGallery = require('../utils/cloudinaryGallery');
const SD = require('../utils/structuredData');
const ses = require('../utils/ses');
const mailer = require('../utils/mailer');
const ICAL = require('ical.js');
var contact_controller = require(__dirname + '/contactusController');
const { canonicalFor, divisionTablePath, divisionResultsPath, clubPath, eventPath, absoluteUrl, resultImagePath } = require('../utils/canonical');
const TeamStrength = require('../models/teamStrength');
const League = require('../models/league');
const { buildPreview } = require('../utils/fixturePreview');
const { isSuperAdmin, mayActForEither, CLUB_CLAIM } = require('../middleware/requireClubAccess');
const { isMesserAdmin } = require('../utils/sessionUser');
const { isReminderDue } = require('../utils/scorecardReminder');




// Display fixtures played 6 days ago that haven't had results entered
exports.getLateScorecards = async function(req, res, next) {
  try {
    const rows = await Fixture.getCardsDueToday();

    const fixtures = rows.map(r => ({
      date: r.date, homeTeam: r.homeTeam, awayTeam: r.awayTeam,
    }));

    // Out of season, say nothing. Same window as before: months 0-4 and 7-11.
    const month = new Date().getMonth();
    if (!(month <= 4 || month >= 7)) return res.sendStatus(200);

    // Nothing outstanding is not worth an email. It also used to be a 500: `params` was
    // only built inside `if (row.length > 0)`, so an empty day called
    // `ses.sendEmail(undefined)` and threw — the daily job failed precisely on the days
    // when everything was in order.
    if (!fixtures.length) {
      return res.json({ ok: true, sent: false, reason: 'no outstanding scorecards' });
    }

    await mailer.send({
      template: 'missing-scorecards',
      to: ['stockport.badders.results@gmail.com', 'bigcoops@outlook.com'],
      replyTo: mailer.RESULTS_MAILBOX,
      subject: `${fixtures.length} missing scorecard${fixtures.length === 1 ? '' : 's'}`,
      whyReceiving: 'You are listed as a recipient of the league admin digests.',
      text: [
        `${fixtures.length} fixture(s) played with no scorecard entered:`,
        '',
        ...fixtures.map(f => `  ${f.date}: ${f.homeTeam} v ${f.awayTeam}`),
      ].join('\n'),
      data: { fixtures },
    });

    res.json({ ok: true, sent: true, fixtures: fixtures.length });
  } catch (err) {
    log.error({ err }, 'getLateScorecards failed');
    next(err);
  }
};


// Who played for each team in each fixture, and in what order.
//
// It was public from 2018 to Nov 2026: its only link was on the admin tools page, which
// made it look like an admin page, but anyone with the URL could read every club's
// line-ups. Now the route needs a sign-in, a superadmin sees every club, and anyone else
// sees their own club only: the club filter is forced to theirs, in the query, so another
// club's rows are never read. Asking for another club by URL is a 403, not a quiet swap.
exports.get_fixture_players_details = async function(req, res, next) {
  try {
    // The filters come from the path, parsed once for the whole site by filterState (the
    // same grammar the filter bar writes). Only these three reach the query.
    const active = (res.locals.filterBar && res.locals.filterBar.active) || {}
    var searchObj = {}
    for (const key of ['season', 'club', 'team']) if (active[key]) searchObj[key] = active[key]
    const ownClub = req.user && req.user._json ? req.user._json[CLUB_CLAIM] : undefined
    // The Messer admin reads every club's line-ups, as the superadmin does: checking who
    // has played for which team is how Messer eligibility is decided (Nov 2026).
    if (!isSuperAdmin(req) && ownClub !== 'All' && !isMesserAdmin(req.user)) {
      if (!ownClub || (searchObj.club !== undefined && searchObj.club !== ownClub)) {
        const err = new Error(ownClub ? `You can see ${ownClub}'s line-ups only` : 'Line-ups are open to club officers')
        err.status = 403
        return next(err)
      }
      searchObj.club = ownClub
    }
    res.set('Cache-Control', 'private, no-store')
    const row = await Fixture.getMatchPlayerOrderDetails(searchObj);
    let clubs = row.map(item => item.name).filter((value, index, self) => self.indexOf(value) === index)
    let teams = row.map(item => item.teamName).filter((value, index, self) => self.indexOf(value) === index)
    res.render('fixture-players', {
      static_path: '/static',
      pageTitle: "Fixture Player Details",
      pageDescription: "Find out who played which matches and in what order",
      filter: true,
      hideFilters: ["division", "status", "gender", "gametype"],
      teams: teams,
      clubs: clubs,
      result: row,
      canonical: canonicalFor(req)
    });
  } catch (err) {
    next(err);
  }
};

// Return fixture id given home and away team ids
exports.fixture_id = async function(req, res, next) {
  try {
    const row = await Fixture.getFixtureId({ "homeTeam": req.params.homeTeam, "awayTeam": req.params.awayTeam });
    res.send(row);
  } catch (err) {
    next(err);
  }
};

// Display detail page for a specific Fixture
//
// The missing-row case has to be a real 404. `row[0].homeTeam` on an empty result
// threw a TypeError, and the old `catch { res.send(err) }` serialised the Error to
// JSON — which for an Error is `{}` — and sent it with the default **status 200**.
// So a fixture this query couldn't assemble was published to crawlers as a valid,
// empty, two-byte page rather than as absent. See getFixtureEventById for why 48
// of them were in that state.
// The extras an event page writes its preview from. Each is optional: the page is the
// fixture's address, date and venue first, and a failure in any of these is logged and
// leaves its section out rather than taking the page down.
async function eventExtras(f) {
  const settle = async (what, p) => {
    try { return await p; } catch (err) { log.error({ err, fixtureId: f.id }, `[event] ${what} unavailable`); return null; }
  };
  const [context, forecast] = await Promise.all([
    settle('match context', Fixture.getMatchContext(f)),
    settle('forecast', TeamStrength.forecastFor(f.id, f.homeTeamId, f.awayTeamId)),
  ]);
  // The table as it stands, for a fixture still to play in the current season.
  let standings = null;
  if (f.homeScore == null && context && context.season === seasonModel.current()) {
    const rows = await settle('standings', League.getRunIn());
    if (rows) standings = rows.filter(r => r.divisionName === f.divisionName);
  }
  return { context, forecast, standings };
}

// Superadmin, or signed in for either club in the fixture (requireClubAccess's rule).
function mayOpenScorecard(req, f) {
  return mayActForEither(req, [f.homeClub, f.awayClub]);
}

// A fixture row without its line-up: the player ids getFixtureDetails selects for the ELO code.
const LINEUP = ['homeMan1', 'homeMan2', 'homeMan3', 'homeLady1', 'homeLady2', 'homeLady3',
  'awayMan1', 'awayMan2', 'awayMan3', 'awayLady1', 'awayLady2', 'awayLady3'];
function withoutLineup(row) {
  const out = { ...row };
  for (const k of LINEUP) delete out[k];
  return out;
}

// The season's event dates (the Messer finals; /admin/league-events) merged into a fixture
// list, in date order. Not on a club's, team's, one status's or a date range's list: an
// event belongs to no club or team and has no result. They used to be pushed onto every result of
// Fixture.getFixtureDetails, the ELO code included, with a fake id of 99999.
//
// Each is shaped like a fixture row, with isEvent set and id null, since the list view and
// the JSON both read fixture rows. The date is midnight UTC: the server runs in UTC and
// the view reads the day with local getters, which gives the same day in Europe/London.
async function withEvents(rows, searchObj) {
  if (['club', 'team', 'status', 'startDate', 'endDate'].some(k => searchObj[k] !== undefined)) return rows;
  const season = seasonModel.isValidName(searchObj.season) ? searchObj.season : seasonModel.current();
  const events = await LeagueEvent.getForSeason(season);
  if (!events.length) return rows;
  const asRows = events.map(e => ({
    id: null, isEvent: true, eventId: e.id,
    date: new Date(e.day + 'T00:00:00Z'),
    homeTeam: e.title, homeClub: null, homeClubId: null,
    awayTeam: e.detail || '', awayClub: null,
    division: null, divisionName: null,
    venueName: e.venueAddress, venueLink: e.gMapUrl,
    status: 'event', homeScore: null, awayScore: null,
  }));
  // Array sort is stable, so fixtures on the same day keep the query's order.
  return [...rows, ...asRows].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
}

exports.fixture_event_detail = async function(req, res, next) {
  try {
    const row = await Fixture.getFixtureEventById(req.params.id);
    if (!row.length) {
      return res.status(404).render('404-error', {
        static_path: '/static',
        pageTitle: 'Fixture not found',
        pageDescription: 'No fixture with that id',
        canonical: canonicalFor(req)
      });
    }
    const f = row[0];
    const { context, forecast, standings } = await eventExtras(f);
    const preview = buildPreview({ fixture: f, forecast, context, standings });

    const season = context && context.season !== seasonModel.current() ? context.season : undefined;
    const matchup = `${f.homeTeam} vs ${f.awayTeam}`;
    const when = new Date(f.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    const kind = preview.state === 'result' ? `${f.homeScore}–${f.awayScore} result` : preview.state === 'upcoming' ? 'preview & prediction' : 'fixture';
    // A finished match's social card, which already exists on demand for every result.
    const ogImage = preview.state === 'result'
      ? absoluteUrl(resultImagePath({ homeTeam: f.homeTeam, awayTeam: f.awayTeam, homeScore: f.homeScore, awayScore: f.awayScore, division: f.divisionName }))
      : null;
    const links = {
      results: divisionResultsPath(f.divisionName, season),
      table: divisionTablePath(f.divisionName, season),
      homeClub: f.homeClub ? clubPath({ name: f.homeClub }) : null,
      awayClub: f.awayClub ? clubPath({ name: f.awayClub }) : null,
      // Who played is a club's business: the link shows only to a superadmin, or to someone
      // signed in for one of the two clubs, as the results page keeps it to admins. The
      // report above names nobody, so it is the same for everyone.
      scorecard: preview.state === 'result' && mayOpenScorecard(req, f) ? `/scorecard/fixture/${f.id}` : null,
    };
    // A page with the link is that viewer's page: never let a cache hand it to anyone else.
    if (links.scorecard) res.set('Cache-Control', 'private, no-store');

    res.render('viewEventDetails', {
      static_path: '/static',
      pageTitle: matchup,
      pageDescription: preview.summary,
      documentTitle: `${matchup} – ${f.divisionName ? f.divisionName + ' ' : ''}${kind}, ${when} | Stockport & District Badminton League`,
      metaDescription: preview.summary,
      ogImage,
      fixtureDetails: f,
      preview,
      links,
      mapsApiKey: config.GMAPSAPIKEY,
      // SportsEvent markup, built in utils/structuredData.js. header.ejs used to
      // assemble this as literal JSON, keyed off `pageTitle.indexOf("Event")`.
      jsonLd: [
        SD.jsonLd(SD.sportsEvent(f, { description: preview.summary, image: ogImage })),
        SD.jsonLd(SD.breadcrumbs([
          { name: 'Home', path: '/' },
          { name: f.divisionName ? `${f.divisionName} results` : 'Results', path: links.results },
          { name: matchup, path: eventPath(f) },
        ])),
      ],
      canonical: canonicalFor(req)
    });
  } catch (err) {
    next(err);
  }
};

// Display detail page for a specific Fixture
// GET /scorecard/fixture/:id
//
// getScorecardDataById INNER JOINs `game`, so it returns nothing for a fixture with
// no per-game rows — and 3,261 of 5,214 fixtures are in that state, the archive
// predating game-level recording. viewScorecard.ejs read result[0].date unguarded,
// so all of them threw a TypeError while rendering (Sentry NODE-T). Fixture 795 is
// typical: a completed 2019 match with a 9-9 result and no game detail.
//
// The header is now built separately from the games, so a fixture with no detail
// still shows what the match was and how it finished.
//
// Who played is a club's business, not the public's (Nov 2026): the route needs a
// sign-in, and this lets in only a superadmin or someone from either club. It was public,
// and only the links to it were hidden, so any scorecard could be opened by its id. The
// fixture is read first for that reason: its clubs decide, before any player is read.
exports.getScorecard = async function(req, res, next) {
  try {
    const fixture = await Fixture.getFixtureSummaryById(req.params.id);
    if (!fixture.length) {
      return res.status(404).render('404-error', {
        static_path: '/static',
        pageTitle: "Can't find the page you're looking for",
        pageDescription: 'HTTP 404 Error',
        canonical: canonicalFor(req)
      });
    }
    if (!mayOpenScorecard(req, fixture[0])) {
      const err = new Error('Scorecards are open to the two clubs that played');
      err.status = 403;
      return next(err);
    }
    res.set('Cache-Control', 'private, no-store');

    const games = await Fixture.getScorecardDataById(req.params.id);
    // Every game row repeats the fixture-level totals; the fixture row has them otherwise.
    const summary = games.length
      ? { date: games[0].date, homeTeam: games[0].homeTeam, awayTeam: games[0].awayTeam,
          homeScore: games[0].totalHomeScore, awayScore: games[0].totalAwayScore }
      : fixture[0];

    res.render('viewScorecard', {
      static_path: '/static',
      pageTitle: "Scorecard Info",
      pageDescription: "View scorecard for this match",
      result: games,
      summary: summary,
      canonical: canonicalFor(req)
    });
  } catch (err) {
    // Was res.send(err), which answered 200 with a serialised error object — so a
    // real failure looked like a success to the browser and to monitoring.
    next(err);
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
      // No event dates (withEvents): a calendar is subscribed to for a club's or team's matches.
      let result = await Fixture.getFixtureDetails(searchObj);
      {
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
    const fixtures = result.filter(row => !row.isEvent)
    let divisionsArray = fixtures.map(row => row.division).filter((division, index, arr) => arr.indexOf(division) == index)
    let griddedData = []
    for (const division of divisionsArray) {
      let gridFixtures = fixtures.filter(row => row.division == division && row.status != 'rearranged')
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
    if (nearestFixture.length == 0 && result.length) nearestFixture.push(result[result.length - 1])
    return nearestFixture
  }

  function applyAdminRole(renderObject, req) {
    if (req.path.search('admin') != -1 && req.user._json["https://my-app.example.com/role"] !== undefined) {
      const role = req.user._json["https://my-app.example.com/role"]
      if (role == "admin" || role == "superadmin") {
        renderObject.admin = true
        renderObject.superadmin = role == "superadmin"
        renderObject.user = req.user
        // Decided here rather than in the template, so the rule has one home
        // (utils/scorecardReminder.js) and a test.
        if (renderObject.superadmin) {
          const now = Date.now()
          for (const row of renderObject.result) row.reminderDue = isReminderDue(row, now)
        }
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
      const result = await withEvents(await Fixture.getFixtureDetails(searchObj), searchObj);
      const nearestFixture = getNearestFixture(result)
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
        // Undefined for an empty list (a club or team with no fixtures that season), and
        // datatables.ejs then opens the table at today. The list was never empty while
        // getFixtureDetails appended the hard-coded Messer rows to every result.
        nearestDate: nearestFixture.length ? nearestFixture[0].date : undefined,
        canonical: canonicalFor(req)
      }
      applyAdminRole(renderObject, req)
      res.render('fixtures-results' + type, renderObject);
    } else {
      var convertedParams = req.params[0].replace('Premier', 'division-7')
        .replace('Division 1', 'division-8').replace('Division-1', 'division-8')
        .replace('Division 2', 'division-9').replace('Division-2', 'division-9')
        .replace('Division 3', 'division-10').replace('Division-3', 'division-10')
        .replace(/(\/)(20\d\d20\d\d)/g, '$1season-$2')
      // "Premier" has no number after it. The pattern here used to demand one, so the
      // Premier page was headed "All" (until Oct 2026).
      const named = req.params[0].match(/\bPremier\b|\bDivision[-\s]\d+/)
      divisionString = named ? named[0].replace('-', ' ') : "All"
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
      const result = await withEvents(await Fixture.getFixtureDetails(searchObj), searchObj);
      const nearestFixture = getNearestFixture(result)
      var type = '';
      if (req.path.indexOf('results-grid') > -1) type = '-grid'
      const griddedData = buildGridData(result)
      let titleString = ""
      if (searchObj !== undefined) {
        for (const filter of ['season', 'division', 'club', 'team']) {
          let sqlParams = Object.entries(searchObj).filter(obj => obj[0] === filter)
          if (sqlParams.length > 0) titleString += sqlParams[0][1] + " "
        }
      }
      const fixtures = result.filter(item => !item.isEvent)
      let clubs = fixtures.map(item => item.homeClub).filter((value, index, self) => self.indexOf(value) === index)
      let teams = fixtures.map(item => item.homeTeam).filter((value, index, self) => self.indexOf(value) === index)
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
        // This division's table for the same season. The nav's Tables link is all four.
        tablePath: divisionTablePath(divisionString, searchObj.season),
        // Undefined for an empty list (a club or team with no fixtures that season), and
        // datatables.ejs then opens the table at today. The list was never empty while
        // getFixtureDetails appended the hard-coded Messer rows to every result.
        nearestDate: nearestFixture.length ? nearestFixture[0].date : undefined,
        canonical: canonicalFor(req)
      }
      applyAdminRole(renderObject, req)
      if (req.path.indexOf('fixtures') > -1) {
        // The JSON goes to anyone (the Remnants calendar feed reads it daily), so it carries
        // the fixtures and not who played in them: the query's twelve player ids are for the
        // ELO code, and with them any line-up could be rebuilt by id (Nov 2026 review).
        res.status(200);
        res.send(result.map(withoutLineup));
      } else {
        res.status(200);
        res.render('fixtures-results' + type, renderObject);
      }
    }
  } catch (err) {
    next(err);
  }
};


// Handle getting results from previous 7 days
exports.fixture_get_summary = async function(req, res, next) {
  try {
    // No gallery here: it is fetched from /homepage-gallery when its modal opens. Each
    // instance's first homepage request in 10 minutes used to wait for the Cloudinary
    // listing — ~450 ms on about 1 in 16 homepage views (Nov 2026 logs) for a modal most
    // visitors never open.
    const [scorecards, recentResults, upcomingFixtures, announcements] = await Promise.all([
      Fixture.getOutstandingScorecards(),
      Fixture.getRecent(),
      Fixture.getupComing(),
      HomepageContent.getActive()
    ]);
    res.render('homepage', {
      static_path: '/static',
      pageTitle: "Homepage",
      pageDescription: "Clubs: Aerospace, Astrazeneca, Altrincham Central, Bramhall Village, CAP, Canute, Carrington, Cheadle Hulme, College Green, David Lloyd, Disley, Dome, GHAP, Macclesfield, Manor, Mellor, New Mills, Parrswood, Poynton, Racketeer, Shell, Syddal Park, Tatton. Social and Competitive badminton in and around Stockport.",
      result: recentResults,
      row: upcomingFixtures,
      scorecards,
      announcements,
      // Sitewide identity (SportsOrganization + WebSite) once, then a SportsEvent
      // per upcoming fixture. Out of season `upcomingFixtures` is empty and only the
      // identity block is emitted, which is correct — there is nothing to advertise.
      jsonLd: [SD.jsonLd(SD.webSite())].concat(
        upcomingFixtures.map(function(f) { return SD.jsonLd(SD.sportsEvent(f)); })
      ),
      canonical: canonicalFor(req)
    });
  } catch (err) {
    next(err);
  }
};

// The homepage gallery modal's carousel items, fetched by the page when the modal first
// opens. Cached, time-bounded and never rejects: see utils/cloudinaryGallery.js (HARD-43).
exports.fixture_get_homepage_gallery = async function(req, res, next) {
  try {
    const galleryTag = await SiteSettings.get('homepage_gallery_tag');
    const assets = await cloudinaryGallery.getGallery(galleryTag || 'messer2026');
    // A fragment, not a page: nothing for a search engine to index.
    res.set('X-Robots-Tag', 'noindex');
    res.render('homepage-gallery-items', { assets });
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
      announcements,
      canonical: canonicalFor(req)
    });
  } catch (err) {
    next(err);
  }
};

// POST /fixture/rearrangement (superadmin session) and PATCH /fixture/rearrange (JWT).
//
// Answers JSON either way. The 4xx cases here are all "you named a team or a pairing
// that doesn't exist" — safe to tell the caller, and the rearrangement modal shows
// nothing at all if it can't distinguish a miss from a success. 5xx keeps its message
// to itself, since it can carry SQL.
exports.fixture_rearrange_by_team_name = async function(req, res, next) {
  try {
    const result = await Fixture.rearrangeByTeamNames(req.body);
    res.json(result);
  } catch (err) {
    if (err.status >= 400 && err.status < 500) {
      return res.status(err.status).json({ ok: false, error: err.message });
    }
    next(err);
  }
}


// Inline date edit from the admin results grid (session-secured, superadmin only).
// Edits the existing fixture's date in place — distinct from the rearrangement flow,
// which archives the old fixture and inserts a new one.
exports.admin_fixture_date_update = async function(req, res, next) {
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

// Mark a fixture conceded (or undo it) from the admin results grid. access.superadmin is
// the gate; the eligibility rules are enforced by Fixture.setConceded's UPDATE, and this
// maps its answer to a status. concededBy: 'home' | 'away' | 'none' (undo).
exports.admin_fixture_concede = async function(req, res, next) {
  const concededBy = req.body.concededBy;
  if (!['home', 'away', 'none'].includes(concededBy)) {
    return res.status(400).json({ error: 'concededBy must be home, away or none' });
  }
  try {
    const result = await Fixture.setConceded(Number(req.params.id), concededBy);
    if (result.ok) return res.json({ ok: true, fixture: result.fixture });
    if (result.reason === 'not-found') return res.status(404).json({ error: 'Fixture not found' });
    const error = concededBy === 'none'
      ? 'Only a conceded fixture with no games can be un-conceded'
      : 'A ' + result.status + ' fixture cannot be conceded — only an outstanding or rearranging one with no result';
    return res.status(409).json({ error });
  } catch (err) {
    next(err);
  }
};
