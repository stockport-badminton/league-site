// @ts-check
// Web push notifications: results as they are published, match reminders at 17:00 and 18:00.
// docs/claude/push.md has the design. Every send is claimed in `push_send` first, so it goes
// at most once whoever asks for it again.

const Push = require('../../models/push');
const log = require('../log');
const { configured, sendNotifications } = require('./send');
const { REMINDER_KINDS, reminderDate, resultNotification, reminderNotification } = require('./notifications');

/**
 * Announce a just-published result to the followers of both teams. Called from the publish
 * request (scorecardController, after the commit). Returns what happened, for the page.
 * @param {number} fixtureId
 */
async function notifyResult(fixtureId) {
  // Before the claim: claiming with no key would mark the result sent when nothing was.
  if (!configured()) return { skipped: 'no VAPID key' };
  const fixture = await Push.resultFor(fixtureId);
  const notification = fixture && resultNotification(fixture);
  if (!notification) return { skipped: 'no result' };

  const key = `result-${fixtureId}`;
  if (!(await Push.claimSend(key))) return { skipped: 'already sent' };
  const summary = await sendNotifications([notification]);
  await Push.recordSummary(key, summary);
  log.info({ fixtureId, ...summary }, 'push result');
  return summary;
}

/**
 * Reminders for every fixture still to be played on the day `when` names.
 * @param {'tonight' | 'tomorrow'} when
 * @param {{ now?: Date, date?: string, dry?: boolean }} [opts]
 *   date: the UK day to remind about, instead of the one `when` and `now` give (superadmin)
 *   dry: build and report, send nothing, claim nothing
 */
async function runReminders(when, opts = {}) {
  if (!REMINDER_KINDS.includes(when)) throw new Error('when must be one of ' + REMINDER_KINDS.join(', '));
  const date = opts.date || reminderDate(when, opts.now || new Date());
  const fixtures = await Push.remindersFor(date);
  const notifications = fixtures.map(f => reminderNotification(f, when));
  const titles = notifications.map(n => n.title);
  const report = { when, date, fixtures: fixtures.length, titles };

  if (opts.dry) return { ...report, dry: true };
  if (!notifications.length) return { ...report, note: 'no fixtures' };
  if (!configured()) return { ...report, skipped: 'no VAPID key' };

  const key = `reminders-${date}-${when}`;
  if (!(await Push.claimSend(key))) return { ...report, skipped: `${key} already sent` };
  const summary = await sendNotifications(notifications);
  await Push.recordSummary(key, summary);
  log.info({ when, date, ...summary }, 'push reminders');
  return { ...report, ...summary };
}

/**
 * A test notification from /admin/push: to one device (its subscription id), or to all.
 * @param {{ subscriptionId?: string, title?: string }} opts
 */
async function sendTest(opts) {
  if (!configured()) return { skipped: 'no VAPID key' };
  const key = `test-${Date.now()}`;
  await Push.claimSend(key);
  const summary = await sendNotifications([{
    title: opts.title || 'Test notification',
    body: 'Notifications from the Stockport league are working on this device.',
    url: '/notifications',
    tag: key,
  }], opts.subscriptionId ? { only: [opts.subscriptionId] } : {});
  await Push.recordSummary(key, { ...summary, to: opts.subscriptionId ? 'one device' : 'everyone' });
  return summary;
}

module.exports = { notifyResult, runReminders, sendTest, configured };
