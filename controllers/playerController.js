var Club = require('../models/club');
var Division = require('../models/division');
var Fixture = require('../models/fixture');
var Game = require('../models/game');
var Player = require('../models/players');
var Team = require('../models/teams');
var Venue = require('../models/venue');
var jp = require('jsonpath');
const {distance, closest} = require('fastest-levenshtein');
const axios = require('axios');
var Auth = require('../models/auth.js');
const { read } = require('fs');
const { validationResult } = require('express-validator');
const docx = require("docx");
const fs = require("fs");
const path = require('path');
const { match } = require('assert');

exports.index = async function(req, res) {
  try {
    const [player_count, player_female_count, player_male_count] = await Promise.all([
      Player.count(""),
      Player.count("Female"),
      Player.count("Male")
    ]);
    const results = { player_count, player_female_count, player_male_count };
    var flattenedResult = JSON.stringify(results);
    res.render('index', { title: 'Stockport League website', static_path: '/static', theme: 'flatly', error: false, data: results, dataString: flattenedResult });
  } catch (err) {
    res.render('index', { title: 'Stockport League website', static_path: '/static', theme: 'flatly', error: err, data: {}, dataString: '{}' });
  }
};

// Display list of all Players
exports.player_list = async function(req, res, next) {
  try {
    const rows = await Player.search(req.params);
    res.send(rows);
  } catch (err) {
    next(err);
  }
};

// Display list of all Players
exports.players_missed_three = async function(req, res, next) {
  try {
    const rows = await Player.getMissedThreePlayers();
    res.render('missed-three-list', {
      static_path: '/static',
      theme: process.env.THEME || 'flatly',
      flask_debug: process.env.FLASK_DEBUG || 'false',
      pageTitle: "Players that have missed three matches",
      pageDescription: "Players that have missed three matches",
      result: rows,
      canonical: ("https://" + req.get("host") + req.originalUrl).replace("www.'", "").replace(".com", ".co.uk").replace("-badders.herokuapp", "-badminton")
    });
  } catch (err) {
    next(err);
  }
};


// Display list of all Players
exports.player_game_data = async function(req, res, next) {
  try {
    const rows = await Player.getPlayerGameData(req.params.id);
    res.render('player-game-stats', {
      static_path: '/static',
      theme: process.env.THEME || 'flatly',
      flask_debug: process.env.FLASK_DEBUG || 'false',
      pageTitle: "Player Game Data:" + req.params.fullName,
      pageDescription: "Information about games that " + req.params.fullName + "played in this season",
      result: rows,
      fullName: req.params.fullName,
      canonical: ("https://" + req.get("host") + req.originalUrl).replace("www.'", "").replace(".com", ".co.uk").replace("-badders.herokuapp", "-badminton")
    });
  } catch (err) {
    next(err);
  }
};


// Display list of all Players
exports.player_list_clubs_teams = async function(req, res, next) {
  try {
    const rows = await Player.getNamesClubsTeams(req.params);
    res.render('player-list', {
      static_path: '/static',
      theme: process.env.THEME || 'flatly',
      flask_debug: process.env.FLASK_DEBUG || 'false',
      pageTitle: "Player Registrations",
      pageDescription: "List of players registered to teams in the Stockport League",
      result: rows,
      canonical: ("https://" + req.get("host") + req.originalUrl).replace("www.'", "").replace(".com", ".co.uk").replace("-badders.herokuapp", "-badminton")
    });
  } catch (err) {
    next(err);
  }
};

exports.find_closest_matched_player = async function(req, res, next) {
  try {
    var searchTerms = {
      "name": req.params.name,
      "gender": req.params.gender
    }
    const rows = await Player.getNamesClubsTeams(searchTerms);
    var names = jp.query(rows, "$..name")
    var playerID = jp.query(rows, "$..playerID")
    var clubId = jp.query(rows, "$..clubId")
    var clubName = jp.query(rows, "$..clubName")
    var nameDistance = [];
    for (const [i, name] of names.entries()) {
      var nameDistanceElement = {
        "name": name,
        "distance": distance(req.params.name, name),
        "playerID": playerID[i],
        "clubId": clubId[i],
        "clubName": clubName[i]
      }
      if (nameDistanceElement.distance <= 10) {
        nameDistance.push(nameDistanceElement);
      }
    }
    nameDistance.sort((a, b) => a.distance - b.distance);
    res.send(nameDistance.slice(0, 8));
  } catch (err) {
    next(err);
  }
}


exports.manage_player_list_clubs_teams = async function(req, res, next) {
  try {
    const apiKey = await Auth.getManagementAPIKey();
    const userResponse = await axios.get(
      'https://' + process.env.AUTH0_DOMAIN + '/api/v2/users?q=user_id:' + req.user.id + '&fields=app_metadata,nickname,email',
      { headers: { "Authorization": "Bearer " + apiKey } }
    );
    const user = userResponse.data;
    var superadmin = false;
    if (user[0].app_metadata.role && user[0].app_metadata.role == "superadmin") {
      superadmin = true;
    }
    var club = user[0].app_metadata.club || false;

    if (user[0].app_metadata.club == req.params.club || user[0].app_metadata.club == "All") {
      const rows = await Player.getNamesClubsTeams(req.params);
      if (rows.length < 1) return next("no club by that name");

      var manageTeamObject = {}
      manageTeamObject.teams = [];
      var teamNames = jp.query(rows, "$..teamName").filter((v, i, a) => a.indexOf(v) == i)
      var teamIds = jp.query(rows, "$..teamId").filter((v, i, a) => a.indexOf(v) == i)
      const table = new docx.Table({
        rows: [
          new docx.TableRow({
            children: [
              new docx.TableCell({
                children: [new docx.Paragraph({
                  text: teamNames[0].substring(0, teamNames[0].length - 2) + " Registrations",
                  style: "docHeading"
                })],
                columnSpan: 4
              })
            ]
          })
        ],
        margins: {
          top: docx.convertInchesToTwip(0.05),
          bottom: docx.convertInchesToTwip(0.05),
          right: docx.convertInchesToTwip(0.1),
          left: docx.convertInchesToTwip(0.1),
        },
        width: {
          size: 100,
          type: docx.percentage
        }
      });
      for (let i = 0; i < teamNames.length; i++) {
        table.addChildElement(new docx.TableRow({
          children: [
            new docx.TableCell({
              children: [new docx.Paragraph({
                text: teamNames[i],
                style: "teamHeading"
              })],
              columnSpan: 4
            })
          ],
        }))
        table.addChildElement(new docx.TableRow({
          children: [
            new docx.TableCell({
              children: [new docx.Paragraph({
                text: "Men",
                style: "gender"
              })],
              columnSpan: 2
            }),
            new docx.TableCell({
              children: [new docx.Paragraph({
                text: "Ladies",
                style: "gender"
              })],
              columnSpan: 2
            }),
          ],
        }))

        var nomMen = jp.query(rows, "$..[?(@.teamName=='" + teamNames[i] + "' && @.rank != 99 && @.gender == 'Male')]")
        var nomLadies = jp.query(rows, "$..[?(@.teamName=='" + teamNames[i] + "' && @.rank != 99 && @.gender == 'Female')]")
        var resMen = jp.query(rows, "$..[?(@.teamName=='" + teamNames[i] + "' && @.rank == 99 && @.gender == 'Male')]")
        var resLadies = jp.query(rows, "$..[?(@.teamName=='" + teamNames[i] + "' && @.rank == 99 && @.gender == 'Female')]")
        let longest = Math.max(nomMen.length + resMen.length, nomLadies.length + resLadies.length);
        for (let j = 1; j <= longest; j++) {
          var manName = (j > (nomMen.length + resMen.length) ? "" : (j > nomMen.length ? resMen[j - nomMen.length - 1].name : nomMen[j - 1].name))
          var menTeamName = teamNames[i].substring(teamNames[i].length - 1)
          var ladiesTeamName = menTeamName
          if (j > nomMen.length) menTeamName = "R"
          if (j > nomLadies.length) ladiesTeamName = "R"
          var ladyName = (j > (nomLadies.length + resLadies.length) ? "" : (j > nomLadies.length ? resLadies[j - nomLadies.length - 1].name : nomLadies[j - 1].name))
          table.addChildElement(new docx.TableRow({
            children: [
              new docx.TableCell({
                children: [new docx.Paragraph(manName)],
                width: { size: 40, type: docx.PERCENTAGE }
              }),
              new docx.TableCell({
                children: [new docx.Paragraph(menTeamName)],
                width: { size: 10, type: docx.PERCENTAGE }
              }),
              new docx.TableCell({
                children: [new docx.Paragraph(ladyName)],
                width: { size: 40, type: docx.PERCENTAGE }
              }),
              new docx.TableCell({
                children: [new docx.Paragraph(ladiesTeamName)],
                width: { size: 10, type: docx.PERCENTAGE }
              }),
            ],
          }))
        }

        var teamObject = {
          name: teamNames[i],
          id: teamIds[i],
          nominated: { men: nomMen, ladies: nomLadies },
          reserves: { men: resMen, ladies: resLadies }
        }
        manageTeamObject.teams.push(teamObject);
      }
      const doc = new docx.Document({
        title: "Title",
        sections: [{ children: [table] }],
        styles: {
          paragraphStyles: [
            { name: 'Normal', run: { font: "Arial" } },
            { name: 'docHeading', basedOn: "Normal", run: { bold: true, size: 30 } },
            { name: 'teamHeading', basedOn: "Normal", run: { bold: true, size: 24 } },
            { name: 'gender', basedOn: "Normal", run: { bold: true } }
          ]
        }
      });

      docx.Packer.toBuffer(doc).then((buffer) => {
        const docDir = 'static/beta/docs/generated';
        fs.mkdirSync(docDir, { recursive: true });
        fs.writeFileSync(docDir + '/' + teamNames[0].substring(0, teamNames[0].length - 2) + '.docx', buffer);
      });

      const clubsRes = await Club.getAll();
      console.log(clubsRes);
      let clubs = clubsRes.map(row => row.name)
      res.render('team-admin', {
        static_path: '/static',
        theme: process.env.THEME || 'flatly',
        flask_debug: process.env.FLASK_DEBUG || 'false',
        pageTitle: "Player Registrations",
        pageDescription: "List of players registered to teams in the Stockport League",
        result: manageTeamObject,
        clubId: rows[0].clubId,
        superadmin: superadmin,
        filter: true,
        hideFilters: ["season", "gametype", "gender", "division", "status"],
        club: club,
        clubs: clubs,
        canonical: ("https://" + req.get("host") + req.originalUrl).replace("www.'", "").replace(".com", ".co.uk").replace("-badders.herokuapp", "-badminton")
      });
    } else {
      return next("Sorry you don't have access to this page");
    }
  } catch (err) {
    next(err);
  }
};

// Return list of players eligible based on team
exports.eligible_players_list = async function(req, res, next) {
  try {
    const rows = await Player.findElgiblePlayersFromTeamId(req.params.id, req.params.gender);
    res.send(rows);
  } catch (err) {
    next(err);
  }
};

// Display detail page for a specific Player
exports.player_detail = async function(req, res, next) {
  try {
    const rows = await Player.getById(req.params.id);
    res.send(rows);
  } catch (err) {
    next(err);
  }
};


exports.all_player_stats = async function(req, res, next) {
  const pattern = /(\bPremier(?!\s|-\d)|Division(?:-|\s))(\d+)/g;
  const replacedMatches = [];
  let divisionString = "All"
  let searchObj = {}
  if (Object.entries(req.params).length > 0) {
    var convertedParams = req.params[0].replace('Premier', 'division-7')
      .replace('Division 1', 'division-8')
      .replace('Division-1', 'division-8')
      .replace('Division 2', 'division-9')
      .replace('Division-2', 'division-9')
      .replace('Division 3', 'division-10')
      .replace('Division-3', 'division-10')
      .replace('season-', '')
      .replace(/(\/)(20\d\d20\d\d)/g, '$1season-$2')
      .replace(/(20\d\d20\d\d)/g, 'season-$1')
      .replace('season-season', 'season')

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
    var searchArray = convertedParams.split('/')
    searchObj = searchArray.reduce((acc, str) => {
      const [key, value] = str.split("-");
      return { ...acc, [key]: value };
    }, {});
    if (typeof req.session.user != 'undefined') {
      if (req.user._json["https://my-app.example.com/role"] !== undefined) {
        if (req.user._json["https://my-app.example.com/role"] == "admin") {
          if (req.user._json["https://my-app.example.com/club"] != "All" && req.user._json["https://my-app.example.com/club"] !== undefined) {
            searchObj.club = req.user._json["https://my-app.example.com/club"]
          }
        }
      }
    }
  } else {
    searchObj = {}
  }

  if (replacedMatches.length > 0) divisionString = replacedMatches[0]
  if (req.user._json["https://my-app.example.com/role"] !== undefined) {
    if (req.user._json["https://my-app.example.com/role"] == "admin") {
      if (req.user._json["https://my-app.example.com/club"] != "All" && req.user._json["https://my-app.example.com/club"] !== undefined) {
        searchObj.club = req.user._json["https://my-app.example.com/club"]
      }
    }
  }

  console.log(searchObj)

  try {
    const rawResult = await Player.newGetPlayerStats(searchObj);

    // Group rows by playerId to detect players with stats from multiple teams
    const playerGroups = {}
    rawResult.forEach(row => {
      if (!playerGroups[row.playerId]) playerGroups[row.playerId] = []
      playerGroups[row.playerId].push(row)
    })

    // For players with multiple teams, prepend an "All Teams" aggregate row
    const result = []
    Object.values(playerGroups).forEach(rows => {
      if (rows.length > 1) {
        const first = rows[0]
        const totalRow = {
          playername: first.playername,
          playerId: first.playerId,
          playergender: first.playergender,
          forPoints: rows.reduce((s, r) => s + (parseInt(r.forPoints) || 0), 0),
          againstPoints: rows.reduce((s, r) => s + (parseInt(r.againstPoints) || 0), 0),
          gamesWon: rows.reduce((s, r) => s + (parseInt(r.gamesWon) || 0), 0),
          gamesPlayed: rows.reduce((s, r) => s + (parseInt(r.gamesPlayed) || 0), 0),
          Points: rows.reduce((s, r) => s + (parseInt(r.Points) || 0), 0),
          clubName: first.clubName,
          teamName: 'All Teams',
          rating: first.rating,
          isTotal: true
        }
        result.push(totalRow, ...rows.map(r => ({ ...r, isTotal: false })))
      } else {
        result.push({ ...rows[0], isTotal: false })
      }
    })

    let clubs = result.map(item => item.clubName).filter((value, index, self) => self.indexOf(value) === index)
    let teams = result
      .map(item => item.teamName)
      .filter(t => t !== 'All Teams')
      .filter((value, index, self) => self.indexOf(value) === index)
    res.render('player-stats', {
      static_path: '/static',
      theme: process.env.THEME || 'flatly',
      flask_debug: process.env.FLASK_DEBUG || 'false',
      pageTitle: "Player Stats",
      pageDescription: "Geek out on Stockport League Player stats!",
      result: result,
      filter: true,
      hideFilters: [],
      clubs: clubs,
      teams: teams,
      query: searchObj,
      canonical: ("https://" + req.get("host") + req.originalUrl).replace("www.'", "").replace(".com", ".co.uk").replace("-badders.herokuapp", "-badminton")
    });
  } catch (err) {
    next(err);
  }
}



exports.all_pair_stats = async function(req, res, next) {
  const replacedMatches = [];
  const pattern = /(\bPremier(?!\s|-\d)|Division(?:-|\s))(\d+)/g;
  let searchObj = {}
  if (Object.entries(req.params).length > 0) {
    var convertedParams = req.params[0].replace('Premier', 'division-7')
      .replace('Division 1', 'division-8')
      .replace('Division-1', 'division-8')
      .replace('Division 2', 'division-9')
      .replace('Division-2', 'division-9')
      .replace('Division 3', 'division-10')
      .replace('Division-3', 'division-10')
      .replace('season-', '')
      .replace(/(20\d\d20\d\d)/g, 'season-$1')

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
    var searchArray = convertedParams.split('/')
    searchObj = searchArray.reduce((acc, str) => {
      const [key, value] = str.split("-");
      return { ...acc, [key]: value };
    }, {});
    if (typeof req.session.user != 'undefined') {
      if (req.user._json["https://my-app.example.com/role"] !== undefined) {
        if (req.user._json["https://my-app.example.com/role"] == "admin") {
          if (req.user._json["https://my-app.example.com/club"] != "All" && req.user._json["https://my-app.example.com/club"] !== undefined) {
            searchObj.club = req.user._json["https://my-app.example.com/club"]
          }
        }
      }
    }
  } else {
    searchObj = {}
  }
  let divisionString = "All"
  if (replacedMatches.length > 0) divisionString = replacedMatches[0]

  try {
    const result = await Player.newGetPairStats(searchObj);
    let clubs = result.map(item => item.clubName).filter((value, index, self) => self.indexOf(value) === index)
    let teams = result.map(item => item.teamName).filter((value, index, self) => self.indexOf(value) === index)
    res.render('pair-stats', {
      static_path: '/static',
      theme: process.env.THEME || 'flatly',
      flask_debug: process.env.FLASK_DEBUG || 'false',
      pageTitle: "Pair Stats",
      pageDescription: "Geek out on Stockport League Player stats!",
      filter: true,
      hideFilters: [],
      clubs: clubs,
      teams: teams,
      result: result,
      query: searchObj,
      canonical: ("https://" + req.get("host") + req.originalUrl).replace("www.'", "").replace(".com", ".co.uk").replace("-badders.herokuapp", "-badminton")
    });
  } catch (err) {
    next(err);
  }
}

// Display Player create form on GET
exports.player_create_get = async function(req, res, next) {
  try {
    const clubs = await Club.getAll();
    res.render('player_form', {
      pageTitle: 'Create Player', pageDescription: 'Create a Player', static_path: '/static', theme: 'flatly', club_list: clubs,
      canonical: ("https://" + req.get("host") + req.originalUrl).replace("www.'", "").replace(".com", ".co.uk").replace("-badders.herokuapp", "-badminton")
    });
  } catch (err) {
    next(err);
  }
};

exports.player_create_from_team = async function(req, res, next) {
  try {
    const row = await Player.create(req.body.first_name, req.body.family_name, req.body.team, req.body.club, req.body.gender);
    res.send(row);
  } catch (err) {
    res.send(err);
  }
}

// Handle Player create on POST
exports.player_create = async function(req, res, next) {
  try {
    const row = await Player.create(req.body.first_name, req.body.family_name, req.body.team, req.body.club, req.body.gender);
    const rows = await Player.getPlayerClubandTeamById(row.insertId);
    res.render('player_form', {
      pageTitle: 'Create Player', pageDescription: 'Create a Player', static_path: '/static', theme: 'flatly', result: req.body, row: rows,
      canonical: ("https://" + req.get("host") + req.originalUrl).replace("www.'", "").replace(".com", ".co.uk").replace("-badders.herokuapp", "-badminton")
    });
  } catch (err) {
    res.send(err);
  }
}

exports.player_batch_create = async function(req, res, next) {
  try {
    const result = await Player.createBatch(req.body);
    res.send(result);
  } catch (err) {
    res.send(err);
  }
}

exports.player_batch_update = async function(req, res, next) {
  try {
    const result = await Player.updateBulk(req.body);
    res.send(result);
  } catch (err) {
    res.send(err);
  }
}

// Display Player delete form on GET
exports.player_delete_get = function(req, res) {
  res.send('NOT IMPLEMENTED: Player delete GET');
};

// Handle Player delete on POST
exports.player_delete = async function(req, res, next) {
  try {
    const row = await Player.deleteById(req.params.id);
    res.send(row);
  } catch (err) {
    next(err);
  }
};

// Display Player update form on GET
exports.player_update_get = async function(req, res, next) {
  try {
    const result = await Player.getById(req.params.id);
    res.render('player_update_form', {
      static_path: '/static',
      theme: process.env.THEME || 'flatly',
      flask_debug: process.env.FLASK_DEBUG || 'false',
      pageTitle: "Pair Stats",
      pageDescription: "Geek out on Stockport League Player stats!",
      result: result,
      canonical: ("https://" + req.get("host") + req.originalUrl).replace("www.'", "").replace(".com", ".co.uk").replace("-badders.herokuapp", "-badminton")
    });
  } catch (err) {
    next(err);
  }
};

// Handle Player update on POST
exports.player_update_post = async function(req, res, next) {
  let patchObj = {
    "tablename": "player",
    "fields": [
      "id", "first_name", "family_name", "gender", "playerTel", "playerEmail", "teamCaptain", "clubSecretary", "matchSecrertary", "treasurer", "junior"
    ],
    "data": [[req.params.id, req.body.first_name, req.body.family_name, req.body.gender, req.body.playerTel, req.body.playerEmail, req.body.teamCaptain == 1 ? 1 : 0, req.body.clubSecretary == 1 ? 1 : 0, req.body.matchSecrertary == 1 ? 1 : 0, req.body.treasurer == 1 ? 1 : 0, req.body.junior == 1 ? 1 : 0]]
  }
  try {
    await Player.updateBulk(patchObj);
    res.redirect(`/player/${req.params.id}/update`);
  } catch (err) {
    res.send(err);
  }
};

exports.player_elo_populate = async function(req, res) {
  try {
    const rows = await Fixture.getFixtureDetails({ "status": "complete", "type": "eloSetting" });
    let totalFixtures = rows.length
    let subLoopLength = 10
    let start = 0
    let gamesprocessed = 0
    let gamesskipped = 0

    do {
      let subFixtures = rows.filter((el, i) => i >= start && i < start + subLoopLength)
      start += subLoopLength
      for (const fixture of subFixtures) {
        if (fixture.id !== 99999) {
          let fixtureDate = fixture.date
          let fixtureRank = fixture.rank

          let fixturePlayers = {}
          fixturePlayers[fixture.homeMan1] = {}
          fixturePlayers[fixture.homeMan2] = {}
          fixturePlayers[fixture.homeMan3] = {}
          fixturePlayers[fixture.homeLady1] = {}
          fixturePlayers[fixture.homeLady2] = {}
          fixturePlayers[fixture.homeLady3] = {}
          fixturePlayers[fixture.awayMan1] = {}
          fixturePlayers[fixture.awayMan2] = {}
          fixturePlayers[fixture.awayMan3] = {}
          fixturePlayers[fixture.awayLady1] = {}
          fixturePlayers[fixture.awayLady2] = {}
          fixturePlayers[fixture.awayLady3] = {}

          fixturePlayers = await Player.getPrevRating(fixtureDate, fixturePlayers)
          const results = await Game.getByFixture(fixture.id)

          for (const game of results) {
            const rateResult = Game.calculateRating(game, fixturePlayers, fixtureDate, fixtureRank)
            if (rateResult && (game.homePlayer1 != 0 || game.homePlayer2 != 0 || game.awayPlayer1 != 0 || game.awayPlayer2 != 0)) {
              fixturePlayers[game.homePlayer1].rating = rateResult.updateObj.homePlayer1End
              fixturePlayers[game.homePlayer1].date = fixtureDate
              fixturePlayers[game.homePlayer2].rating = rateResult.updateObj.homePlayer2End
              fixturePlayers[game.homePlayer2].date = fixtureDate
              fixturePlayers[game.awayPlayer1].rating = rateResult.updateObj.awayPlayer1End
              fixturePlayers[game.awayPlayer1].date = fixtureDate
              fixturePlayers[game.awayPlayer2].rating = rateResult.updateObj.awayPlayer2End
              fixturePlayers[game.awayPlayer2].date = fixtureDate
              try {
                await Game.updateById(rateResult.updateObj, game.id)
              } catch (ratingErr) {
                console.error(`ratingErr: ${ratingErr}`)
              }
              gamesprocessed++
            }
          }

          let playerUpdate = {
            tablename: "player",
            data: [],
            fields: ["id", "rating"]
          }
          for (const [index, player] of Object.entries(fixturePlayers)) {
            playerUpdate.data.push([index, player.rating])
          }
          if (playerUpdate.data.length > 0) {
            try {
              await Player.updateBulk(playerUpdate)
              console.log(`Player rankings updated again`)
            } catch (playerErr) {
              console.error(`playerErr: ${playerErr}`)
            }
          }
        }
      }
    } while (start <= totalFixtures)

    res.send(`all done: totalFixtures: ${totalFixtures}; gamesprocessed: ${gamesprocessed}; gamesskipped: ${gamesskipped}`)
  } catch (err) {
    res.send(err)
  }
}

exports.player_stats_debug = async function(req, res, next) {
  if (process.env.DEV_MODE !== 'true' || process.env.NODE_ENV === 'production') {
    return res.status(404).send('Not found')
  }
  try {
    const rawResult = await Player.newGetPlayerStats({})
    const playerGroups = {}
    rawResult.forEach(row => {
      if (!playerGroups[row.playerId]) playerGroups[row.playerId] = []
      playerGroups[row.playerId].push(row)
    })
    const multiTeamPlayers = Object.entries(playerGroups)
      .filter(([, rows]) => rows.length > 1)
      .map(([id, rows]) => ({
        playerId: id,
        playername: rows[0].playername,
        teams: rows.map(r => ({ teamName: r.teamName, teamId: r.teamId, gamesPlayed: r.gamesPlayed, Points: r.Points }))
      }))
    res.json({
      totalRows: rawResult.length,
      playersWithMultipleTeams: multiTeamPlayers.length,
      multiTeamPlayers
    })
  } catch (err) {
    next(err)
  }
}

// GET /dev/elo-raw/:playerId  (DEV_MODE only)
// Shows raw Start/End ELO values from game records for a player across all seasons,
// in chronological order. Use this to diagnose whether the stored values are correct.
exports.player_elo_raw = async function(req, res, next) {
  if (process.env.DEV_MODE !== 'true' || process.env.NODE_ENV === 'production') {
    return res.status(404).send('Not found')
  }
  try {
    const playerId = parseInt(req.params.playerId, 10)
    const db = require('../db_connect')
    const [rows] = await (await db.otherConnect()).query(`
      SELECT
        fixture.date,
        game.id AS "gameId",
        game.fixture AS "fixtureId",
        CASE
          WHEN game."homePlayer1" = ? THEN 'homePlayer1'
          WHEN game."homePlayer2" = ? THEN 'homePlayer2'
          WHEN game."awayPlayer1" = ? THEN 'awayPlayer1'
          WHEN game."awayPlayer2" = ? THEN 'awayPlayer2'
        END AS slot,
        CASE
          WHEN game."homePlayer1" = ? THEN game."homePlayer1Start"
          WHEN game."homePlayer2" = ? THEN game."homePlayer2Start"
          WHEN game."awayPlayer1" = ? THEN game."awayPlayer1Start"
          WHEN game."awayPlayer2" = ? THEN game."awayPlayer2Start"
        END AS "startVal",
        CASE
          WHEN game."homePlayer1" = ? THEN game."homePlayer1End"
          WHEN game."homePlayer2" = ? THEN game."homePlayer2End"
          WHEN game."awayPlayer1" = ? THEN game."awayPlayer1End"
          WHEN game."awayPlayer2" = ? THEN game."awayPlayer2End"
        END AS "endVal"
      FROM game
      JOIN fixture ON game.fixture = fixture.id
      WHERE game."homePlayer1" = ? OR game."homePlayer2" = ? OR game."awayPlayer1" = ? OR game."awayPlayer2" = ?
      ORDER BY fixture.date ASC, game.id ASC
    `, Array(16).fill(playerId))

    // Flag places where startVal doesn't match previous game's endVal
    let prevEnd = null
    const annotated = rows.map(r => {
      const gap = prevEnd !== null && r.startVal !== null && parseInt(r.startVal) !== prevEnd
        ? { expectedStart: prevEnd, diff: parseInt(r.startVal) - prevEnd }
        : null
      prevEnd = r.endVal !== null ? parseInt(r.endVal) : prevEnd
      return { ...r, gap }
    })

    res.json({ playerId, totalGames: rows.length, games: annotated })
  } catch (err) {
    next(err)
  }
}

// GET /dev/elo-audit  (DEV_MODE only)
// Scans all current-season games in date order and reports cases where a
// player's start rating doesn't match the end rating from their previous game.
exports.player_elo_audit = async function(req, res, next) {
  if (process.env.DEV_MODE !== 'true' || process.env.NODE_ENV === 'production') {
    return res.status(404).send('Not found')
  }
  try {
    const games = await Game.getSeasonGamesOrdered()

    // Track each player's most recently seen end rating
    const lastEnd = {}
    const discrepancies = []

    for (const g of games) {
      const positions = [
        { id: g.homePlayer1, start: g.homePlayer1Start, end: g.homePlayer1End },
        { id: g.homePlayer2, start: g.homePlayer2Start, end: g.homePlayer2End },
        { id: g.awayPlayer1, start: g.awayPlayer1Start, end: g.awayPlayer1End },
        { id: g.awayPlayer2, start: g.awayPlayer2Start, end: g.awayPlayer2End },
      ]
      for (const p of positions) {
        if (!p.id || p.id === 0) continue
        if (lastEnd[p.id] !== undefined && lastEnd[p.id] !== p.start) {
          discrepancies.push({
            playerId: p.id,
            gameId: g.id,
            fixtureId: g.fixtureId,
            date: g.date,
            expectedStart: lastEnd[p.id],
            actualStart: p.start,
            diff: p.start - lastEnd[p.id]
          })
        }
        lastEnd[p.id] = p.end
      }
    }

    res.json({
      gamesScanned: games.length,
      discrepanciesFound: discrepancies.length,
      discrepancies
    })
  } catch (err) {
    next(err)
  }
}

// Shared helper: process all complete fixtures for one season and update game ELO.
// seasonParam is a season name string (e.g. '20242025') or undefined for current season.
// Returns { fixtures, gamesProcessed, gamesSkipped }.
// carryoverRatings: optional map of { playerId: { rating, date, rank } } seeded from a
// previous season's run so ratings carry across season boundaries without a DB round-trip.
async function recalcSeasonElo(seasonParam, carryoverRatings = {}) {
  await Game.resetSeasonElo(seasonParam)

  const searchObj = { status: 'complete' }
  if (seasonParam) searchObj.season = seasonParam

  const rows = await Fixture.getFixtureDetails(searchObj)
  let gamesProcessed = 0
  let gamesSkipped = 0

  // knownRatings accumulates every player's latest End rating across fixtures so we
  // never need to re-query the DB mid-season (which was resetting everyone to 1500).
  const knownRatings = { ...carryoverRatings }

  for (const fixture of rows) {
    if (fixture.id === 99999) continue

    // Collect all player IDs for this fixture.
    let fixturePlayers = {}
    for (const key of ['homeMan1','homeMan2','homeMan3','homeLady1','homeLady2','homeLady3',
                        'awayMan1','awayMan2','awayMan3','awayLady1','awayLady2','awayLady3']) {
      const pid = fixture[key]
      if (pid != null) fixturePlayers[pid] = {}
    }

    const games = await Game.getByFixture(fixture.id)
    for (const game of games) {
      for (const pid of [game.homePlayer1, game.homePlayer2, game.awayPlayer1, game.awayPlayer2]) {
        if (pid != null && !(pid in fixturePlayers)) fixturePlayers[pid] = {}
      }
    }

    // For players already seen this (or a prior) season, carry their rating forward
    // directly — no DB query needed. Only query for genuinely new players.
    const newPlayers = {}
    for (const pid of Object.keys(fixturePlayers)) {
      if (pid in knownRatings) {
        fixturePlayers[pid] = { ...knownRatings[pid] }
      } else {
        newPlayers[pid] = {}
      }
    }
    if (Object.keys(newPlayers).length > 0) {
      const loaded = await Player.getPrevRating(fixture.date, newPlayers)
      for (const [pid, val] of Object.entries(loaded)) {
        // gamesCount isn't tracked in the DB — a player loaded here is treated as
        // starting fresh for provisional-K purposes. Full accuracy (a true
        // lifetime games-played count) requires running eloBackfillAll from the
        // start of records rather than a single isolated season recalc, same
        // caveat as the existing rating carryover above.
        fixturePlayers[pid] = { ...val, gamesCount: 0 }
        knownRatings[pid] = fixturePlayers[pid]
      }
    }

    for (const game of games) {
      const rateResult = Game.calculateRating(game, fixturePlayers, fixture.date, fixture.rank)
      if (rateResult && (game.homePlayer1 !== 0 || game.homePlayer2 !== 0 || game.awayPlayer1 !== 0 || game.awayPlayer2 !== 0)) {
        for (const [slot, endKey] of [
          [game.homePlayer1, 'homePlayer1End'],
          [game.homePlayer2, 'homePlayer2End'],
          [game.awayPlayer1, 'awayPlayer1End'],
          [game.awayPlayer2, 'awayPlayer2End'],
        ]) {
          if (slot != null && slot !== 0) {
            fixturePlayers[slot].rating = rateResult.updateObj[endKey]
            fixturePlayers[slot].date   = fixture.date
            fixturePlayers[slot].gamesCount = (fixturePlayers[slot].gamesCount || 0) + 1
            knownRatings[slot] = { ...fixturePlayers[slot] }
          }
        }
        await Game.updateById(rateResult.updateObj, game.id)
        gamesProcessed++
      } else {
        gamesSkipped++
      }
    }

    const playerUpdate = {
      tablename: 'player',
      data: Object.entries(fixturePlayers)
        .filter(([id]) => parseInt(id, 10) > 0)
        .map(([id, p]) => [id, p.rating]),
      fields: ['id', 'rating']
    }
    if (playerUpdate.data.length > 0) await Player.updateBulk(playerUpdate)
  }

  return { fixtures: rows.length, gamesProcessed, gamesSkipped, knownRatings }
}

// GET /players/eloFullRecalc?season=20242025  (superadmin or DEV_MODE only)
// Zeros ELO for one season then reprocesses every complete fixture in date order.
// Omit ?season to target the current season.
exports.player_elo_full_recalc = async function(req, res, next) {
  const isSuperAdmin = req.user &&
    req.user._json['https://my-app.example.com/role'] === 'superadmin'
  if (!isSuperAdmin && !(process.env.DEV_MODE === 'true' && process.env.NODE_ENV !== 'production')) {
    return res.status(403).send('Forbidden')
  }
  try {
    const seasonParam = req.query.season || undefined
    const result = await recalcSeasonElo(seasonParam)
    res.send(`Full recalc complete (season: ${seasonParam || 'current'}). Fixtures: ${result.fixtures}; games processed: ${result.gamesProcessed}; skipped: ${result.gamesSkipped}`)
  } catch (err) {
    next(err)
  }
}

// GET /players/eloBackfillAll  (superadmin or DEV_MODE only)
// Reprocesses ALL seasons from oldest to newest so the ELO chain is consistent
// across season boundaries.  Ratings carry over: each season seeds from the
// previous season's final game ratings.
exports.player_elo_backfill_all = async function(req, res, next) {
  const isSuperAdmin = req.user &&
    req.user._json['https://my-app.example.com/role'] === 'superadmin'
  if (!isSuperAdmin && !(process.env.DEV_MODE === 'true' && process.env.NODE_ENV !== 'production')) {
    return res.status(403).send('Forbidden')
  }
  res.setHeader('Content-Type', 'text/plain; charset=utf-8')
  res.setHeader('Transfer-Encoding', 'chunked')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  try {
    const allSeasons = await Fixture.getAllSeasons()
    const year = new Date().getFullYear()
    const currentSeason = new Date().getMonth() < 7 ? `${year - 1}${year}` : `${year}${year + 1}`

    const flush = () => { if (typeof res.flush === 'function') res.flush() }

    res.write('Resetting all ELO values...\n'); flush()
    await Game.resetAllElo()
    res.write(`Done. Processing ${allSeasons.length} seasons:\n\n`); flush()

    const results = []
    let carryoverRatings = {}

    for (const s of allSeasons) {
      res.write(`  ${s.name}... `); flush()
      try {
        const isCurrentSeason = s.name === currentSeason
        const seasonParam = isCurrentSeason ? undefined : s.name
        const r = await recalcSeasonElo(seasonParam, carryoverRatings)
        carryoverRatings = r.knownRatings
        results.push({ season: s.name, ...r })
        res.write(`${r.fixtures} fixtures, ${r.gamesProcessed} games processed\n`); flush()
      } catch (seasonErr) {
        res.write(`skipped (${seasonErr.message})\n`); flush()
      }
    }

    const totalFixtures = results.reduce((a, r) => a + r.fixtures, 0)
    const totalProcessed = results.reduce((a, r) => a + r.gamesProcessed, 0)
    const totalSkipped = results.reduce((a, r) => a + r.gamesSkipped, 0)

    res.write(`\nAll done. Total: ${totalFixtures} fixtures, ${totalProcessed} games processed, ${totalSkipped} skipped.`)
    res.end()
  } catch (err) {
    res.write(`\nERROR: ${err.message}`)
    res.end()
  }
}

// GET /api/seasons
// Returns the list of seasons from the database.
exports.get_seasons_api = async function(req, res, next) {
  try {
    const seasons = await Fixture.getAllSeasons()
    res.json(seasons)
  } catch (err) {
    next(err)
  }
}

// GET /players/eloBackfillAdmin  (secured)
// Admin page for triggering per-season or all-season ELO backfill.
exports.player_elo_backfill_admin = async function(req, res, next) {
  try {
    const seasons = await Fixture.getAllSeasons()
    res.render('elo-backfill', {
      static_path: '/static',
      theme: process.env.THEME || 'flatly',
      pageTitle: 'ELO Backfill Admin',
      pageDescription: 'ELO rating backfill admin tool',
      seasons,
      canonical: ('https://' + req.get('host') + req.originalUrl).replace('www.\'', '').replace('.com', '.co.uk')
    })
  } catch (err) {
    next(err)
  }
}

// GET /api/player-elo?players=1,2,3
// Returns ELO time-series JSON for use by the chart pages.
const ELO_CHART_MAX_PLAYERS = 20

exports.player_elo_history_api = async function(req, res, next) {
  try {
    const rawIds = (req.query.players || '').split(',').map(s => parseInt(s, 10)).filter(n => !isNaN(n)).slice(0, ELO_CHART_MAX_PLAYERS)
    if (rawIds.length === 0) return res.json([])
    const data = await Player.getPlayerEloTimeSeries(rawIds)
    res.json(data)
  } catch (err) {
    next(err)
  }
}

// GET /api/players/search?q=Smith&division=Premier&club=Dome&team=Dome+A&gender=Male
// Returns player name/id matches for the comparison page search, optionally
// narrowed by the same division/club/team/gender filters used on /player-stats.
exports.player_search_api = async function(req, res, next) {
  try {
    const q = (req.query.q || '').trim()
    const filters = {
      division: (req.query.division || '').trim(),
      club: (req.query.club || '').trim(),
      team: (req.query.team || '').trim(),
      gender: (req.query.gender || '').trim(),
    }
    const hasFilter = Object.values(filters).some(v => v.length > 0)
    if (q.length < 2 && !hasFilter) return res.json([])
    const results = await Player.searchPlayers(q, filters)
    res.json(results)
  } catch (err) {
    next(err)
  }
}

// GET /elo-chart
// Renders the multi-player ELO comparison page.
exports.player_elo_chart = async function(req, res, next) {
  try {
    const rawIds = (req.query.players || '').split(',').map(s => parseInt(s, 10)).filter(n => !isNaN(n)).slice(0, ELO_CHART_MAX_PLAYERS)
    const [seriesData, divisions, clubs, teams] = await Promise.all([
      rawIds.length > 0 ? Player.getPlayerEloTimeSeries(rawIds) : [],
      Division.getAll(),
      Club.getAll(),
      Team.getAll(),
    ])
    res.render('elo-chart', {
      static_path: '/static',
      theme: process.env.THEME || 'flatly',
      pageTitle: 'ELO Chart',
      pageDescription: 'Compare player ELO ratings over time',
      seriesData: JSON.stringify(seriesData),
      selectedIds: rawIds.join(','),
      maxPlayers: ELO_CHART_MAX_PLAYERS,
      divisions,
      clubs,
      teams,
      canonical: ('https://' + req.get('host') + req.originalUrl).replace('www.\'', '').replace('.com', '.co.uk')
    })
  } catch (err) {
    next(err)
  }
}
