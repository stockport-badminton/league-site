// Players and team management: the roster pages, the intent API and player edits.
// Mounted by routes/index.js, in the order listed there (REARCH-04).
const express = require('express');
const router = express.Router();
const access = require('../middleware/access');
const player_controller = require('../controllers/playerController');
const roster_controller = require('../controllers/rosterController');

// Player routes
//
// `/player/create` and `/manage-players/create` used to sit here with no
// middleware at all — anyone could create a player into any club, because both
// took the club and team straight from the request body. Creating a player is now
// only possible through POST /api/roster/club-:club/players, which is authorized
// against the club in the URL and derives the club from the destination team.
router.post('/player/create', access.superadmin, player_controller.player_create);
router.get('/player/:id/update', access.member, player_controller.player_update_get);

// `/players/club-:clubid?/team-:teamid?/gender-:gender?` used to be declared here,
// unauthenticated, returning the registration rows as raw JSON. It shadowed the
// identically-shaped `secured` route further down — first match wins — so the
// Registered Players page never rendered for that URL shape and anyone could read
// the data. Nothing in the app called the JSON version, so it is gone rather than
// merely secured, which un-shadows the real page.
router.get('/players/matching/:name/:gender', access.member, player_controller.find_closest_matched_player);

// Secured routes
//
// `POST /player/batch-update` used to live here. It took `tablename` and `fields`
// from the request body and interpolated both into an UPDATE, behind `secured`
// only — so any logged-in captain could write any column of any table, including
// their own player.role. It was also the only write path the team-management page
// had. The roster API below replaces it: each endpoint takes intent (an ordered
// list of player ids, a destination team) and derives its own SQL.
//
// Roster writes. Authorization is resolved from the row's real owner inside each
// handler — the club in the URL is never taken on trust.
router.post('/api/teams/:id/order', access.member, roster_controller.api_team_order);
router.post('/api/players/:id/move', access.member, roster_controller.api_player_move);
router.post('/api/players/:id/release', access.member, roster_controller.api_player_release);
router.get('/api/roster/club-:club/candidates', access.clubScoped, roster_controller.api_candidates);
router.post('/api/roster/club-:club/players', access.clubScoped, roster_controller.api_player_create);
router.post('/api/roster/club-:club/attach', access.clubScoped, roster_controller.api_player_attach);
router.post('/api/roster/club-:club/transfer', access.clubScoped, roster_controller.api_transfer_request);

router.post('/player/:id(\\d+)', access.member, player_controller.player_update_post);

router.get('/players/club-:club?/team-:team?/gender-:gender?', access.member, player_controller.player_list_clubs_teams);
router.get('/players/club-:club?', access.member, player_controller.player_list_clubs_teams);
router.get('/players/team-:team?', access.member, player_controller.player_list_clubs_teams);
router.get('/players/gender-:gender?', access.member, player_controller.player_list_clubs_teams);
router.get('/players', access.member, player_controller.player_list_clubs_teams);

// Team management. Two pages with two jobs, where there used to be one template
// switching on a `superadmin` boolean: the roster a captain reads, and the editor
// the results secretary works in. The .docx is its own endpoint rather than a side
// effect of rendering the page.
//
// More specific paths first — `/manage-players/club-:club?` would otherwise match
// `/manage-players/club-Aerospace/edit` with the club captured as 'Aerospace/edit'.
router.get('/manage-players/club-:club/edit', access.clubScoped, roster_controller.club_roster_edit);
router.get('/manage-players/club-:club/registration.docx', access.clubScoped, roster_controller.registration_docx);
router.get('/manage-players/club-:club', access.member, roster_controller.club_roster);
router.get('/manage-players', access.member, roster_controller.club_picker);
router.get('/player/create', access.superadmin, player_controller.player_create_get);

module.exports = router;
