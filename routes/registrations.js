// Registration paperwork: the forms, the chase-and-digest flow, the requests queue, signup approval.
// Mounted by routes/index.js, in the order listed there (REARCH-04).
const express = require('express');
const router = express.Router();
const access = require('../middleware/access');
const documents_controller = require('../controllers/documentsController');
const registration_controller = require('../controllers/registrationController');
const auth_controller = require('../models/auth.js');

router.get('/approve-user/:userId', access.superadmin, auth_controller.approve_signup_get);
router.post('/approve-user/:userId', access.superadmin, auth_controller.approve_signup_post);

// Team registration form as an editable Word document — the one the nav links to.
// A PDF AcroForm has a fixed set of named fields, so a club secretary cannot add or
// delete a roster row; a Word table can. Same layout, no 12-row cap.
router.get('/forms/team-registration.docx', access.public, documents_controller.teamRegistrationFormDocx);
// Same, prefilled with a club's current player registrations (auth check in controller)
router.get('/forms/team-registration/:club/prefilled.docx', access.member, documents_controller.teamRegistrationFormPrefilledDocx);
// The original PDF versions. Kept working for anyone holding an old link, but no
// longer linked from the nav.
router.get('/forms/team-registration', access.public, documents_controller.teamRegistrationForm);
router.get('/forms/team-registration/:club/prefilled', access.member, documents_controller.teamRegistrationFormPrefilled);
// Club registration form, generated with the current season filled in
router.get('/forms/club-registration', access.public, documents_controller.clubRegistrationForm);
// Same form, prefilled with a club's contacts, teams and venue (auth check in controller)
router.get('/forms/club-registration/:club/prefilled', access.member, documents_controller.clubRegistrationFormPrefilled);

// Chasing clubs for their player registration forms. The page and the two writes are
// superadmin; the daily send takes either a superadmin session or the scheduler's token,
// for the same reason the audit run does — `secured` would redirect Cloud Scheduler to
// Auth0 and it would report the 302 as a success.
router.get('/admin/registrations', access.superadmin,
  registration_controller.registrations_page);
router.get('/admin/registrations/digest', access.superadmin,
  registration_controller.digest_preview);
router.post('/admin/registrations/:club/received', access.superadmin,
  registration_controller.mark_received);
router.post('/admin/registrations/:club/chase', access.superadmin,
  registration_controller.send_chase);
router.post('/admin/registrations/run',
  access.cron(registration_controller.requireReminderCaller), registration_controller.digest_run);

// Player registration requests forwarded to registrations@ (controllers/playerRequestController).
// All superadmin: the queue holds other people's email. /match is registered before /:id
// so it is not read as an id.
const player_request_controller = require('../controllers/playerRequestController');
router.get('/admin/player-requests', access.superadmin,
  player_request_controller.list_page);
router.get('/admin/player-requests/match', access.superadmin,
  player_request_controller.api_match);
router.get('/admin/player-requests/:id', access.superadmin,
  player_request_controller.detail_page);
router.post('/admin/player-requests/:id/candidates/:index', access.superadmin,
  player_request_controller.api_set_candidate);
router.post('/admin/player-requests/:id/candidates', access.superadmin,
  player_request_controller.api_add_candidate);
router.post('/admin/player-requests/:id/status', access.superadmin,
  player_request_controller.set_status);

module.exports = router;
