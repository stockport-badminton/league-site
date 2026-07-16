var Team = require('../models/teams');
var Club = require('../models/club');
var Division = require('../models/division');
var Venue = require('../models/venue');
var League = require('../models/league');

// Display list of all Teams
exports.team_list = async function(req, res, next) {
  try {
    const rows = await Team.getAll();
    // console.log(rows);
    res.send(rows);
  } catch (err) {
    next(err);
  }
};

// Display list of all Teams
exports.team_search = async function(req, res, next) {
  try {
    const rows = await Team.getTeams(req.body);
    // console.log(result)
    res.send(rows);
  } catch (err) {
    console.log(err);
    next(err);
  }
};

// Display detail page for a specific Team
exports.team_detail = async function(req, res, next) {
  try {
    const row = await Team.getById(req.params.id);
    // console.log(row);
    res.send(row);
  } catch (err) {
    next(err);
  }
};

// Display Team create form on GET
exports.team_create_get = function(req, res) {
    res.send('NOT IMPLEMENTED: Team create GET');
};

// Handle Team create on POST
exports.team_create_post = async function(req, res, next) {
  try {
    const row = await Team.create(req.body.name, req.body.startTime, req.body.endTime, req.body.matchDay, req.body.venue, req.body.courtspace, req.body.club, req.body.division, req.body.rank);
    // console.log(req.body);
    // console.log(row);
    res.send(row);
  } catch (err) {
    console.log(err);
    next(err);
  }
};

exports.teams_batch_create = async function(req, res, next) {
  try {
    const result = await Team.createBatch(req.body);
    // console.log(result)
    res.send(result);
  } catch (err) {
    console.log(err);
    next(err);
  }
};

// Display Team delete form on GET
exports.team_delete_get = function(req, res) {
    res.send('NOT IMPLEMENTED: Team delete GET');
};

// Handle Team delete on POST
exports.team_delete_post = async function(req, res, next) {
  try {
    const row = await Team.deleteById(req.params.id);
    // console.log(req.params)
    // console.log(row);
    res.send(row);
  } catch (err) {
    next(err);
  }
};

// Display Team update form on GET
exports.team_update_get = function(req, res) {
    res.send('NOT IMPLEMENTED: Team update GET');
};

// Handle Team update on POST
exports.team_update_post = async function(req, res, next) {
  try {
    const row = await Team.updateById(req.body, req.params.id);
    // console.log(req.body);
    // console.log(row);
    res.send(row);
  } catch (err) {
    console.log(err);
    next(err);
  }
};

exports.messer_draw = function(req, res, next) {
  let renderstring = `beta/messer-draw-${req.params.section}`
   //console.log(renderstring)
  res.render(renderstring, {
    static_path: '/static',
    theme: process.env.THEME || 'flatly',
    flask_debug: process.env.FLASK_DEBUG || 'false',
    pageTitle : "Messer Tropy Draws and results",
    pageDescription : "Messer Trophy Draws and results",
    canonical:("https://" + req.get("host") + req.originalUrl).replace("www.'","").replace(".com",".co.uk").replace("-badders.herokuapp","-badminton")
  });
};

exports.new_messer_draw = async function(req, res, next) {
  var searchObj = {
    "section": req.params.section.toUpperCase().at(0)
  };
  if (req.params.season !== undefined) {
    searchObj.season = req.params.season;
  }
  try {
    const rows = await Team.getMesser(searchObj);
    // console.log(rows)
    var otherArray = rows.reduce(function(obj, row){
      // console.log(row)
      let homeTeamAdjHandicap = ''
      let awayTeamAdjHandicap = ''
      let homeHand = ''
      let awayHand = ''
      homeHand = row.homeTeamHandicap.indexOf('H') >= 0 ? 'H' : ''
      awayHand = row.awayTeamHandicap.indexOf('H') >= 0 ? 'H' : ''
      if (homeHand == 'H' && awayHand == 'H'){
        homeHand = ''
        awayHand = ''
      }
      if ((row.homeTeamHandicap.toString().indexOf('-') >= 0)&&(row.awayTeamHandicap.toString().indexOf('-') >= 0)){
         //console.log("both negative")
        if (Math.abs(parseInt(row.homeTeamHandicap)) > Math.abs(parseInt(row.awayTeamHandicap))){
          homeTeamAdjHandicap = Math.round((-21 * (Math.abs(parseInt(row.homeTeamHandicap)) - Math.abs(parseInt(row.awayTeamHandicap))))/(21 + Math.abs(parseInt(row.awayTeamHandicap))))
          // homeTeamAdjHandicap = homeTeamAdjHandicap < 0 ? Math.ceil(homeTeamAdjHandicap) : Math.floor(homeTeamAdjHandicap)
          awayTeamAdjHandicap = 'Scr'
        }
        else if (Math.abs(parseInt(row.homeTeamHandicap)) == Math.abs(parseInt(row.awayTeamHandicap))){
          homeTeamAdjHandicap = 'Scr'
          awayTeamAdjHandicap = 'Scr'
        }
        else {
          awayTeamAdjHandicap = Math.round((-21 * (Math.abs(parseInt(row.awayTeamHandicap)) - Math.abs(parseInt(row.homeTeamHandicap))))/(21 + Math.abs(parseInt(row.homeTeamHandicap))))
          // awayTeamAdjHandicap = awayTeamAdjHandicap < 0 ? Math.ceil(awayTeamAdjHandicap) : Math.floor(awayTeamAdjHandicap)
          homeTeamAdjHandicap = 'Scr'
        }
      }
      else if ((row.homeTeamHandicap.toString().indexOf('+') >= 0)&&(row.awayTeamHandicap.toString().indexOf('+') >= 0)){
         //console.log("both positive")
        if (Math.abs(parseInt(row.homeTeamHandicap)) > Math.abs(parseInt(row.awayTeamHandicap))){
          homeTeamAdjHandicap = Math.round((21 * (Math.abs(parseInt(row.homeTeamHandicap)) - Math.abs(parseInt(row.awayTeamHandicap))))/(21 - Math.abs(parseInt(row.awayTeamHandicap))))
          if (homeTeamAdjHandicap > 0){
            homeTeamAdjHandicap = '+'+homeTeamAdjHandicap
          }
          awayTeamAdjHandicap = 'Scr'
        }
        else if (Math.abs(parseInt(row.homeTeamHandicap)) == Math.abs(parseInt(row.awayTeamHandicap))){
          homeTeamAdjHandicap = 'Scr'
          awayTeamAdjHandicap = 'Scr'
        }
        else {
          awayTeamAdjHandicap = Math.round((21 * (Math.abs(parseInt(row.awayTeamHandicap)) - Math.abs(parseInt(row.homeTeamHandicap))))/(21 - Math.abs(parseInt(row.homeTeamHandicap))))
          if (awayTeamAdjHandicap > 0){
            awayTeamAdjHandicap = '+'+awayTeamAdjHandicap
          }
          // awayTeamAdjHandicap = awayTeamAdjHandicap < 0 ? Math.floor(awayTeamAdjHandicap) : Math.ceil(awayTeamAdjHandicap)
          homeTeamAdjHandicap = 'Scr'
        }
      }
      else {
        homeTeamAdjHandicap = row.homeTeamHandicap.replace('H','')
        awayTeamAdjHandicap = row.awayTeamHandicap.replace('H','')
      }
      // console.log(homeTeamAdjHandicap+homeHand)
      // console.log(awayTeamAdjHandicap+awayHand)
      obj[row.drawPos] = {"homeTeam":row.homeTeamName,"awayTeam":row.awayTeamName,"homeHandicap":row.homeTeamHandicap,"awayHandicap":row.awayTeamHandicap,"homeAdjHandicap":homeTeamAdjHandicap+homeHand,"awayAdjHandicap":awayTeamAdjHandicap+awayHand,"homeScore":row.homeScore,"awayScore":row.awayScore};
      return obj;
    }, {});

    // console.log(otherArray);
    // var totalRounds = Math.ceil(Math.log(rows.length)/Math.log(2))
    //console.log(JSON.stringify(rows));
    res.render('messer-draw-a-section', {
      static_path: '/static',
      theme: process.env.THEME || 'flatly',
      flask_debug: process.env.FLASK_DEBUG || 'false',
      teams: otherArray,
      section: req.params.section.toUpperCase().at(0),
      pageTitle : "Messer Tropy Draws and results - " + req.params.section.toUpperCase().at(0) + " section",
      pageDescription : "Messer Trophy Draws and results",
      canonical:("https://" + req.get("host") + req.originalUrl).replace("www.'","").replace(".com",".co.uk").replace("-badders.herokuapp","-badminton")
    });
  } catch (err) {
    console.log(err);
    next(err);
  }
};

// ---------------------------------------------------------------------------
// Superadmin admin UI — add / edit teams, copy a team, promote / relegate
// (mirrors the homepage-content pattern; role enforced in-controller)
// ---------------------------------------------------------------------------

function isSuperAdmin(req) {
  return !!(req.user && req.user._json && req.user._json['https://my-app.example.com/role'] === 'superadmin');
}

function canonicalFor(req) {
  return ("https://" + req.get("host") + req.originalUrl).replace("www.'", "").replace(".com", ".co.uk").replace("-badders.herokuapp", "-badminton");
}

// Editable team fields from the form. name/club/division/venue are required;
// rank/divRank are NOT NULL in the DB and managed by the controller (defaulted
// on create, recomputed on division change), so they are not in this object.
function buildTeamObj(body) {
  const obj = { name: (body.name || '').trim() };
  ['starttime', 'endtime', 'matchDay', 'section', 'handicap'].forEach(k => {
    const v = (body[k] || '').trim();
    obj[k] = v === '' ? null : v;
  });
  ['club', 'division', 'venue'].forEach(k => {
    const n = parseInt(body[k], 10);
    obj[k] = isNaN(n) ? null : n;
  });
  const courts = parseInt(body.courtspace, 10);
  obj.courtspace = isNaN(courts) ? null : courts;
  return obj;
}

exports.admin_team_list = async function(req, res, next) {
  if (!isSuperAdmin(req)) return res.status(403).send('Forbidden');
  try {
    const [teams, divisionRows, clubs, tableRows] = await Promise.all([
      Team.getAll(), Division.getAll(), Club.getAll(), League.getAllLeagueTables()
    ]);
    const clubName = {};
    clubs.forEach(c => { clubName[c.id] = c.name; });

    // Current standings order per division (division id -> { teamName: position }),
    // so the list matches the league table — easier to spot who to promote/relegate.
    // Teams with no fixtures yet aren't in the table and sort to the bottom.
    const tableOrder = {};
    tableRows.forEach(r => {
      if (!tableOrder[r.division]) tableOrder[r.division] = {};
      if (tableOrder[r.division][r.name] === undefined) {
        tableOrder[r.division][r.name] = Object.keys(tableOrder[r.division]).length;
      }
    });

    // Divisions sorted by rank (Premier first); each carries its teams. First =
    // top (can't promote), last = bottom (can't relegate).
    const divisions = divisionRows
      .slice()
      .sort((a, b) => a.rank - b.rank)
      .map(d => ({ id: d.id, name: d.name, rank: d.rank, teams: [] }));
    const divById = {};
    divisions.forEach(d => { divById[d.id] = d; });

    const unassigned = [];
    teams.forEach(t => {
      const row = { id: t.id, name: t.name, clubName: clubName[t.club] || '' };
      if (divById[t.division]) divById[t.division].teams.push(row);
      else unassigned.push(row);
    });
    divisions.forEach(d => {
      const order = tableOrder[d.id] || {};
      d.teams.sort((a, b) => {
        const ai = order[a.name] !== undefined ? order[a.name] : Infinity;
        const bi = order[b.name] !== undefined ? order[b.name] : Infinity;
        if (ai !== bi) return ai - bi;
        return a.name.localeCompare(b.name);
      });
    });

    res.render('admin/team-list', {
      static_path: '/static',
      pageTitle: 'Team Admin',
      pageDescription: 'Add, edit, promote and relegate teams',
      user: req.user,
      divisions,
      unassigned,
      canonical: canonicalFor(req)
    });
  } catch (err) {
    next(err);
  }
};

exports.admin_team_createForm = async function(req, res, next) {
  if (!isSuperAdmin(req)) return res.status(403).send('Forbidden');
  try {
    const [clubs, divisions, venues, teams] = await Promise.all([
      Club.getAll(), Division.getAll(), Venue.getAll(), Team.getAll()
    ]);
    clubs.sort((a, b) => a.name.localeCompare(b.name));
    divisions.sort((a, b) => a.rank - b.rank);
    teams.sort((a, b) => a.name.localeCompare(b.name));

    // Copy-an-existing-team: pre-fill attributes only (no name/captain/players).
    let team = null;
    if (req.query.copyFrom) {
      const [source] = await Team.getById(req.query.copyFrom);
      if (source) {
        team = {
          name: '',
          club: source.club,
          division: source.division,
          venue: source.venue,
          matchDay: source.matchDay,
          starttime: source.starttime,
          endtime: source.endtime,
          courtspace: source.courtspace,
          section: source.section,
          handicap: source.handicap
        };
      }
    }

    res.render('admin/team-form', {
      static_path: '/static',
      pageTitle: 'New Team',
      pageDescription: 'Create a team',
      user: req.user,
      team,
      clubs, divisions, venues, teams,
      copyFrom: req.query.copyFrom || '',
      canonical: canonicalFor(req)
    });
  } catch (err) {
    next(err);
  }
};

exports.admin_team_create = async function(req, res, next) {
  if (!isSuperAdmin(req)) return res.status(403).send('Forbidden');
  try {
    const teamObj = buildTeamObj(req.body);
    if (!teamObj.name) return res.status(400).send('Team name is required');
    if (teamObj.club == null || teamObj.division == null || teamObj.venue == null) {
      return res.status(400).send('Club, division and venue are required');
    }
    teamObj.rank = parseInt(req.body.rank, 10) || 0;
    teamObj.divRank = await Team.getNextDivRank(teamObj.division);
    await Team.createFull(teamObj);
    res.redirect('/admin/teams');
  } catch (err) {
    next(err);
  }
};

exports.admin_team_editForm = async function(req, res, next) {
  if (!isSuperAdmin(req)) return res.status(403).send('Forbidden');
  try {
    const [team] = await Team.getById(req.params.id);
    if (!team) return res.status(404).send('Not found');
    const [clubs, divisions, venues] = await Promise.all([Club.getAll(), Division.getAll(), Venue.getAll()]);
    clubs.sort((a, b) => a.name.localeCompare(b.name));
    divisions.sort((a, b) => a.rank - b.rank);
    res.render('admin/team-form', {
      static_path: '/static',
      pageTitle: 'Edit Team',
      pageDescription: 'Edit a team',
      user: req.user,
      team,
      clubs, divisions, venues, teams: [],
      copyFrom: '',
      canonical: canonicalFor(req)
    });
  } catch (err) {
    next(err);
  }
};

exports.admin_team_update = async function(req, res, next) {
  if (!isSuperAdmin(req)) return res.status(403).send('Forbidden');
  try {
    const [existing] = await Team.getById(req.params.id);
    if (!existing) return res.status(404).send('Not found');
    const teamObj = buildTeamObj(req.body);
    if (!teamObj.name) return res.status(400).send('Team name is required');
    if (teamObj.club == null || teamObj.division == null || teamObj.venue == null) {
      return res.status(400).send('Club, division and venue are required');
    }
    teamObj.rank = parseInt(req.body.rank, 10) || existing.rank || 0;
    // Direct division change from the edit form counts as a move — reset divRank
    // so the team sorts to the bottom of the new division until finalised.
    if (teamObj.division !== existing.division) {
      teamObj.divRank = await Team.getNextDivRank(teamObj.division);
    }
    await Team.updateById(teamObj, req.params.id);
    res.redirect('/admin/teams');
  } catch (err) {
    next(err);
  }
};

// One-click promote (up) / relegate (down): move a team to the adjacent
// division by rank within its own league.
exports.admin_team_move = async function(req, res, next) {
  if (!isSuperAdmin(req)) return res.status(403).send('Forbidden');
  try {
    const [team] = await Team.getById(req.params.id);
    if (!team) return res.status(404).send('Not found');
    const [currentDivision] = await Division.getById(team.division);
    if (!currentDivision) return res.status(400).send('Team has no division');

    const leagueDivisions = (await Division.getAllByLeague(currentDivision.league)).sort((a, b) => a.rank - b.rank);
    const targetRank = req.body.direction === 'up' ? currentDivision.rank - 1 : currentDivision.rank + 1;
    const target = leagueDivisions.find(d => d.rank === targetRank);
    if (!target) return res.redirect('/admin/teams'); // already top/bottom — no-op

    const divRank = await Team.getNextDivRank(target.id);
    await Team.updateById({ division: target.id, divRank }, req.params.id);
    res.redirect('/admin/teams');
  } catch (err) {
    next(err);
  }
};
