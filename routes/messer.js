// The Messer cup: rules, the draw, scorecards, approval and the bracket.
// Mounted by routes/index.js, in the order listed there (REARCH-04).
const express = require('express');
const router = express.Router();
const access = require('../middleware/access');
const team_controller = require('../controllers/teamController');
const static_controller = require('../controllers/staticPagesController');
const messer_scorecard_controller = require('../controllers/messer-scorecard-controller');
const documents_controller = require('../controllers/documentsController');
const league_event_controller = require('../controllers/leagueEventController');
const { mediaLimiter } = require('../middleware/rateLimit');

router.get('/messer-rules', access.public, static_controller.messer_rules);
router.get('/messer-draw/:section', access.public, team_controller.new_messer_draw);
router.get('/messer-draw/:season/:section', access.public, team_controller.new_messer_draw);
// The score sheet, a PDF drawn with the current season (utils/messerScoreSheet.js). It
// replaced a static spreadsheet whose URL redirects here for anyone holding the old link.
router.get('/forms/messer-score-sheet.pdf', access.public, documents_controller.messerScoreSheet);
router.get('/static/beta/docs/Messer-Score-Sheet.xlsx', access.public, (req, res) => res.redirect(301, '/forms/messer-score-sheet.pdf'));
router.post('/messer-draw/:section/swap/:id', access.messerAdmin, messer_scorecard_controller.messer_draw_swap);
// Concede a draw match 15-0, switch it, or undo it (Fixture.concedeMesserMatch).
router.post('/messer-draw/:section/concede/:id', access.messerAdmin, messer_scorecard_controller.messer_draw_concede);

// Messer scorecard routes
router.get('/messer-scorecard-beta', access.member, messer_scorecard_controller.messer_scorecard_beta);
router.get('/messer-scorecard-beta/test', access.devOnly, messer_scorecard_controller.messer_scorecard_beta_test);
router.post('/messer-scorecard-beta', access.member, messer_scorecard_controller.validateMesserScorecard, messer_scorecard_controller.full_messer_fixture_post);
router.get('/populated-messer-scorecard/:id', access.member, messer_scorecard_controller.messer_fixture_populate_scorecard_fromId);
router.get('/api/messer-teams-by-section/:section', access.member, messer_scorecard_controller.messer_teams_by_section);
router.get('/messer-results', access.messerAdmin, messer_scorecard_controller.messer_results_list);
router.get('/messer-result/:id', access.messerAdmin, messer_scorecard_controller.messer_result_detail);
router.get('/messer-scorecard-photo/:id', access.messerAdmin, mediaLimiter, messer_scorecard_controller.messer_scorecard_photo);
router.post('/messer-result/:id/approve', access.messerAdmin, messer_scorecard_controller.messer_result_approve);
router.post('/messer-result/:id/reject', access.messerAdmin, messer_scorecard_controller.messer_result_reject);

// Messer bracket wire-up (admin) — set up auto-advance links once per season
router.get('/admin/messer-bracket', access.messerAdmin, messer_scorecard_controller.messer_bracket_landing);
router.get('/admin/messer-bracket/:section', access.messerAdmin, messer_scorecard_controller.messer_bracket_edit);
router.post('/admin/messer-bracket/:section', access.messerAdmin, messer_scorecard_controller.messer_bracket_save);

// The Messer finals dates (and any other non-fixture date) on the fixtures list, kept by a
// Messer admin each season rather than hard-coded (migrations/040_league_event.sql).
router.get('/admin/league-events', access.messerAdmin, league_event_controller.admin_list);
router.get('/admin/league-events/create', access.messerAdmin, league_event_controller.admin_createForm);
router.post('/admin/league-events', access.messerAdmin, league_event_controller.admin_create);
router.get('/admin/league-events/:id(\\d+)', access.messerAdmin, league_event_controller.admin_editForm);
router.post('/admin/league-events/:id(\\d+)', access.messerAdmin, league_event_controller.admin_update);
router.post('/admin/league-events/:id(\\d+)/delete', access.messerAdmin, league_event_controller.admin_delete);

module.exports = router;
