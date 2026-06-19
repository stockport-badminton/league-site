var Club = require('../models/club');
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
    const result = await Player.newGetPlayerStats(searchObj);
    let clubs = result.map(item => item.clubName).filter((value, index, self) => self.indexOf(value) === index)
    let teams = result.map(item => item.teamName).filter((value, index, self) => self.indexOf(value) === index)
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
