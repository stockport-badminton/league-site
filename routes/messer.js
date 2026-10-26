// The Messer cup: rules, the draw, scorecards, approval and the bracket.
// Mounted by routes/index.js, in the order listed there (REARCH-04).
const express = require('express');
const router = express.Router();
const access = require('../middleware/access');
const team_controller = require('../controllers/teamController');
const static_controller = require('../controllers/staticPagesController');
const messer_scorecard_controller = require('../controllers/messer-scorecard-controller');
const { mediaLimiter } = require('../middleware/rateLimit');

router.get('/messer-rules', access.public, static_controller.messer_rules);
router.get('/messer-draw/:section', access.public, team_controller.new_messer_draw);
router.get('/messer-draw/:season/:section', access.public, team_controller.new_messer_draw);
router.post('/messer-draw/:section/swap/:id', access.messerAdmin, messer_scorecard_controller.messer_draw_swap);

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

module.exports = router;
