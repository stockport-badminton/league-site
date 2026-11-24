// @ts-check
// Fan-out: deliver one or more notifications to the subscriptions that want them, and delete
// the ones the push service says are gone. Ported from the Hyde club site (lib/push/send.js);
// the matching is SQL here (Push.subscribersFor) rather than a filter over every subscriber.

const webpush = require('web-push');
const config = require('../../config');
const log = require('../log');
const Push = require('../../models/push');
const { siteOrigin } = require('../canonical');

const CONCURRENCY = 25;

/**
 * @typedef {{ title: string, body: string, url: string, tag?: string,
 *   type?: 'results' | 'reminders', teams?: number[] }} Notification
 */

/** False with no private key: the kill switch, and what every test and local run has. */
function configured() {
  return !!(config.VAPID_PRIVATE_KEY && config.VAPID_PUBLIC_KEY);
}

/**
 * @param {Notification[]} notifications
 * @param {{ only?: string[] }} [opts]  only: subscription ids to send to (a test to one device)
 */
async function sendNotifications(notifications, opts = {}) {
  const summary = { notifications: notifications.length, subscribers: 0, sent: 0, failed: 0, removed: 0 };
  if (!configured()) return { ...summary, skipped: 'no VAPID key' };

  const options = {
    vapidDetails: {
      subject: siteOrigin(),
      publicKey: /** @type {string} */ (config.VAPID_PUBLIC_KEY),
      privateKey: /** @type {string} */ (config.VAPID_PRIVATE_KEY),
    },
    TTL: 24 * 60 * 60, // dropped if the device is offline for over a day
    urgency: /** @type {const} */ ('normal'),
  };

  /** @type {{ s: { id: string, endpoint: string, p256dh: string, auth: string }, payload: string }[]} */
  const jobs = [];
  const reached = new Set();
  for (const n of notifications) {
    let subs = await Push.subscribersFor({ teams: n.teams, type: n.type });
    if (opts.only) subs = subs.filter(s => /** @type {string[]} */ (opts.only).includes(s.id));
    const payload = JSON.stringify({ title: n.title, body: n.body, url: n.url || '/', tag: n.tag });
    for (const s of subs) { jobs.push({ s, payload }); reached.add(s.id); }
  }
  summary.subscribers = reached.size;

  const dead = new Set();
  const ok = new Set();
  for (let i = 0; i < jobs.length; i += CONCURRENCY) {
    await Promise.all(jobs.slice(i, i + CONCURRENCY).map(async ({ s, payload }) => {
      if (dead.has(s.id)) return;
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, options);
        summary.sent++;
        ok.add(s.id);
      } catch (err) {
        const e = /** @type {any} */ (err);
        // 404/410: the browser unsubscribed, or the subscription expired.
        if (e.statusCode === 404 || e.statusCode === 410) dead.add(s.id);
        else {
          summary.failed++;
          log.warn({ statusCode: e.statusCode, body: e.body, err: e.statusCode ? undefined : e }, 'push send failed');
        }
      }
    }));
  }

  summary.removed = await Push.removeSubscriptions([...dead]);
  await Push.markSent([...ok]);
  return summary;
}

module.exports = { configured, sendNotifications, CONCURRENCY };
