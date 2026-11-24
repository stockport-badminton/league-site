// Web push notifications (docs/claude/push.md): the opt-in page, the subscription API it calls,
// the scheduled match reminders and the superadmin page. Results are sent from the publish
// request instead (scorecardController), so they have no route here.
// Mounted by routes/index.js, in the order listed there (REARCH-04).
const express = require('express');
const router = express.Router();
const access = require('../middleware/access');
const { pushLimiter } = require('../middleware/rateLimit');
const requireCronCaller = require('../middleware/requireCronCaller');
const push_controller = require('../controllers/pushController');

const requirePushCaller = requireCronCaller({
  envVar: 'PUSH_CRON_TOKEN',
  header: 'x-push-token',
  describe: 'the match reminders',
  callerProp: 'pushCaller',
});

router.get('/notifications', access.public, push_controller.notificationsPage);

// Called by fetch() from /notifications. No spamGate: there is no free text to screen, only a
// push-service endpoint (allowlisted), team ids (checked against the league's teams) and two
// type names, and the browser's own same-origin headers are checked in the controller.
router.post('/api/push/subscribe', access.public, pushLimiter, push_controller.subscribe);
router.delete('/api/push/subscribe', access.public, pushLimiter, push_controller.unsubscribe);
router.post('/api/push/subscription', access.public, pushLimiter, push_controller.lookup);

// Cloud Scheduler: sbl-push-tonight (17:00) and sbl-push-tomorrow (18:00), Europe/London.
router.post('/admin/push/reminders', access.cron(requirePushCaller), push_controller.reminders);

router.get('/admin/push', access.superadmin, push_controller.adminPage);
router.post('/admin/push/test', access.superadmin, push_controller.adminTest);

module.exports = router;
