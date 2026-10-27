// Results-secretary tools that belong to no other area, and the scheduled jobs behind them.
// Mounted by routes/index.js, in the order listed there (REARCH-04).
const express = require('express');
const router = express.Router();
const access = require('../middleware/access');
const venue_controller = require('../controllers/venueController');
const team_controller = require('../controllers/teamController');
const player_controller = require('../controllers/playerController');
const club_controller = require('../controllers/clubController');
const junior_club_controller = require('../controllers/juniorClubController');
const fixture_controller = require('../controllers/fixtureController');
const scorecard_controller = require('../controllers/scorecardController');
const contact_controller = require('../controllers/contactusController');
const shuttle_controller = require('../controllers/shuttleController');
const homepage_content_controller = require('../controllers/homepageContentController');
const site_settings_controller = require('../controllers/siteSettingsController');
const spam_admin_controller = require('../controllers/spamAdminController');
const { publicFormLimiter } = require('../middleware/rateLimit');
const requireCronCaller = require('../middleware/requireCronCaller');
// The annual invoice run (HARD-23). Same gate as the weekly audit and the daily
// registration reminder — a scheduler token or a superadmin session, never a redirect.
const requireInvoiceCaller = requireCronCaller({
  envVar: 'INVOICE_CRON_TOKEN',
  header: 'x-invoice-token',
  describe: 'the annual invoice run',
  callerProp: 'invoiceCaller',
});
// The daily missing-scorecard reminder. Fourth caller of the same gate.
//
// This one was NOT a scheduler endpoint that lacked a gate — it was an *ungated* endpoint
// that a Make.com scenario had been GETting every morning since 2025. `getLateScorecards`
// sends mail, so anyone who knew the URL could make the league email itself as often as
// they liked. Not an open relay — the recipients are hardcoded, unlike the
// `/fixture/reminder` bug — but the send is free and unattributable, which is enough.
//
// Found 15 Sep 2026 while surveying what Make.com is actually doing for us: the scenario
// named "late scorecards" turned out to contain a single HTTP module pointed at this URL,
// i.e. a Cloud Scheduler job wearing a costume.
const requireLateScorecardCaller = requireCronCaller({
  envVar: 'LATE_SCORECARD_CRON_TOKEN',
  header: 'x-late-scorecard-token',
  describe: 'the missing-scorecard reminder',
  callerProp: 'lateScorecardCaller',
});

// A superadmin session OR the Cloud Scheduler token. These were unauthenticated,
// protected by nothing but a check that today is the annual invoice date — so on that one
// day of the year any caller could send every club its invoice, repeatedly, from our own
// verified domain. The date check stays, but as a safety net rather than the only control.
//
// SEC-3 fixed that with `secured` + `requireSuperAdmin` and, by not checking who was
// already calling, broke the thing that actually ran it: `secured` redirected Make.com to
// /login, Make followed the 302, got a 200 from Auth0 and recorded a successful job. The
// 1 Sep 2026 invoices never went out and nothing said so (HARD-23). `requireInvoiceCaller`
// answers a 403 instead of redirecting, for exactly that reason.
router.post('/league/sendInvoices', access.cron(requireInvoiceCaller),
  publicFormLimiter, contact_controller.send_invoices);
router.post('/league/sendInvoice/:club', access.cron(requireInvoiceCaller),
  publicFormLimiter, contact_controller.send_invoices);

// Fixture routes
// Superadmin only since Oct 2026, because the popup now lets the results secretary
// edit the recipients — see fixture_reminder_post. No limiter: a busy week can have a
// dozen cards due at once, and the gate is the control now, as for rearrangement.
router.get('/fixture/:id/reminder-contacts', access.superadmin, scorecard_controller.fixture_reminder_contacts);
router.post('/fixture/reminder', access.superadmin, scorecard_controller.fixture_reminder_post);
// Kept as GET: Cloud Scheduler can issue either, and the Make.com scenario this replaces
// used GET, so a token-carrying GET keeps a rollback one env var away rather than one
// deploy away.
router.get('/fixture/outstanding', access.cron(requireLateScorecardCaller), fixture_controller.getLateScorecards);
// Superadmin only. This was unauthenticated behind nothing but a rate limit until
// Sep 2026 — anyone who could POST could set a fixture to 'rearranged' and insert a
// replacement at a date of their choosing. The only client is the rearrangement modal
// in fixtures-results.ejs, which is itself inside `if (superadmin)`, so the server now
// says what the UI always assumed. Captains request rearrangements by email; they have
// never had this form.
router.post('/fixture/rearrangement', access.superadmin, fixture_controller.fixture_rearrange_by_team_name);

// Superadmin-only: an admin tool (it is on the /admin hub), and each row's email
// button carries the club officers' contact addresses. It was `secured` alone, which
// only proves someone is logged in.
router.get('/missed-three', access.superadmin, player_controller.players_missed_three);
// Preview a player's notice to their club's secretaries, then send it through SES.
router.get('/missed-three/:playerId(\\d+)/notice', access.superadmin, player_controller.missed_three_notice_preview);
router.get('/missed-three/:playerId(\\d+)/notice/email', access.superadmin, player_controller.missed_three_notice_email);
router.post('/missed-three/:playerId(\\d+)/notice', access.superadmin, player_controller.missed_three_notice_send);

router.get('/players/eloPop', access.superadmin, player_controller.player_elo_populate);
router.get('/dev/player-stats-debug', access.devOnly, player_controller.player_stats_debug);
router.get('/dev/elo-audit', access.devOnly, player_controller.player_elo_audit);
router.get('/dev/elo-raw/:playerId', access.devOnly, player_controller.player_elo_raw);
router.get('/players/eloFullRecalc', access.superadmin, player_controller.player_elo_full_recalc);
router.get('/players/eloBackfillAll', access.superadmin, player_controller.player_elo_backfill_all);

router.get('/admin/homepage-content', access.superadmin, homepage_content_controller.list);
router.get('/admin/homepage-content/create', access.superadmin, homepage_content_controller.createForm);
router.post('/admin/homepage-content', access.superadmin, homepage_content_controller.create);
router.get('/admin/homepage-content/:id', access.superadmin, homepage_content_controller.editForm);
router.post('/admin/homepage-content/:id', access.superadmin, homepage_content_controller.update);
router.post('/admin/homepage-content/:id/delete', access.superadmin, homepage_content_controller.remove);

router.get('/admin/site-settings', access.superadmin, site_settings_controller.form);
router.post('/admin/site-settings', access.superadmin, site_settings_controller.update);

// Blocklists and the submission log. `secured` proves someone is logged in; the
// controller checks superadmin, same as the other /admin screens.
router.get('/admin/spam', access.superadmin, spam_admin_controller.form);
router.post('/admin/spam', access.superadmin, spam_admin_controller.add);
router.post('/admin/spam/:id/active', access.superadmin, spam_admin_controller.toggle);

// League structure admin (superadmin only — role check in controller)
router.get('/admin/clubs', access.superadmin, club_controller.admin_club_list);
router.get('/admin/clubs/create', access.superadmin, club_controller.admin_club_createForm);
router.post('/admin/clubs', access.superadmin, club_controller.admin_club_create);
router.get('/admin/clubs/:id', access.superadmin, club_controller.admin_club_editForm);
router.post('/admin/clubs/:id', access.superadmin, club_controller.admin_club_update);

// Junior clubs, listed on /info/junior-clubs.
router.get('/admin/junior-clubs', access.superadmin, junior_club_controller.admin_list);
router.get('/admin/junior-clubs/create', access.superadmin, junior_club_controller.admin_createForm);
router.post('/admin/junior-clubs', access.superadmin, junior_club_controller.admin_create);
router.get('/admin/junior-clubs/:id', access.superadmin, junior_club_controller.admin_editForm);
router.post('/admin/junior-clubs/:id', access.superadmin, junior_club_controller.admin_update);
router.post('/admin/junior-clubs/:id/delete', access.superadmin, junior_club_controller.admin_delete);

router.get('/admin/teams', access.superadmin, team_controller.admin_team_list);
router.get('/admin/teams/create', access.superadmin, team_controller.admin_team_createForm);
router.post('/admin/teams', access.superadmin, team_controller.admin_team_create);
router.post('/admin/teams/:id/move', access.superadmin, team_controller.admin_team_move);
// Withdrawing a team voids fixtures and takes a team out of the league table, so it
// carries requireSuperAdmin as well as the in-controller role check the rest of
// /admin/teams uses — `secured` only proves someone is logged in. HARD-10.
router.get('/admin/teams/:id/withdraw', access.superadmin, team_controller.admin_team_withdrawForm);
router.post('/admin/teams/:id/withdraw', access.superadmin, team_controller.admin_team_withdraw);
router.post('/admin/teams/:id/reinstate', access.superadmin, team_controller.admin_team_reinstate);
router.get('/admin/teams/:id', access.superadmin, team_controller.admin_team_editForm);
router.post('/admin/teams/:id', access.superadmin, team_controller.admin_team_update);
router.post('/admin/fixture/:id/date', access.superadmin, fixture_controller.admin_fixture_date_update);
router.get('/players/eloBackfillAdmin', access.superadmin, player_controller.player_elo_backfill_admin);

// Shuttle price comparison (superadmin only — role check in controller)
router.get('/shuttle-prices', access.superadmin, shuttle_controller.shuttlePrices);
router.get('/shuttle-prices/export', access.superadmin, shuttle_controller.exportPrices);
router.post('/shuttle-prices/refresh', access.superadmin, shuttle_controller.refreshPrices);

// Manual venues-map regeneration (superadmin only — role check in controller)
router.post('/venues-map/refresh', access.superadmin, venue_controller.venues_map_refresh);

// ---------------------------------------------------------------------------
// Weekly data-integrity digest (HARD-07)
// ---------------------------------------------------------------------------
// Required here rather than at the top of the file to keep this package's diff inside
// the block it owns; `require` is cached, so there is no cost to it.
const audit_controller = require('../controllers/auditController');

// The report is a list of every weakness in the league's data, so both routes are
// gated. The preview is superadmin-session only. The send additionally accepts a shared
// secret in X-Audit-Token, for Cloud Scheduler, and deliberately does *not* use
// `secured`: `secured` answers an anonymous caller with a 302 to /login, which a
// scheduler would record as a successful job.
// Admin → Invoices (HARD-23). A browser page, so `secured` is right here: a redirect to
// /login is the correct answer for a human. The machine path is POST /league/sendInvoices,
// which must NOT redirect — see the note there.
router.get('/admin/invoices', access.superadmin,
  contact_controller.admin_invoices_form);
router.post('/admin/invoices', access.superadmin,
  contact_controller.admin_invoices_run);

router.get('/admin/audit', access.superadmin, audit_controller.audit_preview);
router.post('/admin/audit/run', access.cron(audit_controller.requireAuditCaller), audit_controller.audit_run);

// Every superadmin tool, grouped (utils/adminTools.js) — the Admin dropdown's
// "All admin tools…".
router.get('/admin', access.superadmin,
  require('../controllers/adminHubController').hub);

module.exports = router;
