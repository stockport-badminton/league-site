// Public league data: tables, fixtures, results, clubs, teams, venues and player stats.
// Mounted by routes/index.js, in the order listed there (REARCH-04).
const express = require('express');
const router = express.Router();
const access = require('../middleware/access');
const venue_controller = require('../controllers/venueController');
const team_controller = require('../controllers/teamController');
const player_controller = require('../controllers/playerController');
const club_controller = require('../controllers/clubController');
const fixture_controller = require('../controllers/fixtureController');
const league_controller = require('../controllers/leagueController');
const validateSeason = require('../middleware/validateSeason');

router.get('/playerStats/:id/:fullName', access.public, player_controller.player_game_data);
router.get('/eligiblePlayers/:id/:gender', access.public, player_controller.eligible_players_list);

// Team routes
router.get('/team/:id(\\d+)', access.public, team_controller.team_detail);
router.get('/teams', access.public, team_controller.team_list);
router.post('/teams', access.public, team_controller.team_search);

// League routes

router.get('/league/:id', access.public, league_controller.league_detail);
router.get('/tables/All', access.public, league_controller.all_league_tables);
router.get('/tables/All/:season', access.public, validateSeason, league_controller.all_league_tables);
router.get('/tables/:division', access.public, league_controller.league_table);
router.get('/tables/:division/:season', access.public, validateSeason, league_controller.league_table);

// Club routes
router.get('/clubs', access.public, club_controller.club_list);
// A public page per club — the surface for "badminton club near me", which
// /info/clubs cannot rank for because all 18 clubs share that one URL. Matched by
// name slug, not id, so the URL reads. Declared after `/clubs` so the exact path
// still reaches club_list.
router.get('/clubs/:slug', access.public, club_controller.club_public_page);
router.get('/info/clubs', access.public, club_controller.club_list_detail);

router.get('/fixture/homeId-:homeTeam/awayId-:awayTeam', access.public, fixture_controller.fixture_id);
router.get('/event/:id/:date-:homeTeam-:awayTeam', access.public, fixture_controller.fixture_event_detail);
router.get('/scorecard/fixture/:id(\\d+)', access.public, fixture_controller.getScorecard);
router.get('/fixture-players', access.public, fixture_controller.get_fixture_players_details);
router.get('/fixture-players/team-:team?', access.public, fixture_controller.get_fixture_players_details);
router.get('/fixture-players/club-:club?', access.public, fixture_controller.get_fixture_players_details);
router.get('/fixture-players/:season?', access.public, fixture_controller.get_fixture_players_details);
router.get('/fixture-players/team-:team?/season-:season?', access.public, fixture_controller.get_fixture_players_details);
router.get('/fixture-players/club-:club?/:season?', access.public, fixture_controller.get_fixture_players_details);

// Venue routes
router.get('/venues', access.public, venue_controller.venue_list);

// Wildcard fixture/result routes
router.get('/fixtures/*', access.public, fixture_controller.fixture_detail_byDivision);
router.get('/results/*', access.public, fixture_controller.fixture_detail_byDivision);
router.get('/calendars/*', access.public, fixture_controller.fixture_calendars);
router.get('/results-grid/*', access.public, fixture_controller.fixture_detail_byDivision);

router.get('/admin/results/*', access.member, fixture_controller.fixture_detail_byDivision);
router.get('/admin/results/:division/:season', access.member, fixture_controller.fixture_detail_byDivision);

router.get('/api/player-elo', access.public, player_controller.player_elo_history_api);
router.get('/api/players/search', access.public, player_controller.player_search_api);
router.get('/api/seasons', access.public, player_controller.get_seasons_api);
router.get('/elo-chart', access.member, player_controller.player_elo_chart);
router.get('/player-stats/*', access.member, player_controller.all_player_stats);
router.get('/player-stats', access.member, player_controller.all_player_stats);
router.get('/pair-stats/*', access.member, player_controller.all_pair_stats);
router.get('/pair-stats', access.member, player_controller.all_pair_stats);

router.get('/club/:id', access.member, club_controller.club_detail);
router.get('/club-api/:id', access.member, club_controller.club_detail_api);
router.get('/admin/info/clubs', access.member, club_controller.club_list_detail);

module.exports = router;
