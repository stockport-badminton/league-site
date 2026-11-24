// utils/push: checking subscriptions, what a notification says, the fan-out, and the at-most-once
// rules around it. The model's SQL is tested in __tests__/db/push.test.js; here it is mocked.

jest.mock('web-push', () => ({ sendNotification: jest.fn() }));
jest.mock('../../models/push', () => ({
  subscribersFor: jest.fn(),
  removeSubscriptions: jest.fn(async ids => ids.length),
  markSent: jest.fn(async () => {}),
  claimSend: jest.fn(async () => true),
  recordSummary: jest.fn(async () => {}),
  resultFor: jest.fn(),
  remindersFor: jest.fn(),
}));

const webpush = require('web-push');
const Push = require('../../models/push');
const { validateSubscription, validateTypes, validateTeams, subscriptionId } = require('../../utils/push/subscription');
const N = require('../../utils/push/notifications');
const { sendNotifications } = require('../../utils/push/send');
const push = require('../../utils/push');

const saved = { ...process.env };
const withKeys = () => {
  process.env.VAPID_PUBLIC_KEY = 'BPublicKeyForTests';
  process.env.VAPID_PRIVATE_KEY = 'private-key-for-tests';
};
afterEach(() => { process.env = { ...saved }; jest.clearAllMocks(); });

const KEYS = { p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM', auth: 'tBHItJI5svbpez7KI4CCXg' };

describe('validateSubscription', () => {
  it('accepts a real push service endpoint and keeps only endpoint and keys', () => {
    const sub = { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', keys: { ...KEYS, extra: 1 }, expirationTime: null };
    expect(validateSubscription(sub)).toEqual({ endpoint: sub.endpoint, keys: KEYS });
    expect(validateSubscription({ endpoint: 'https://web.push.apple.com/QG', keys: KEYS }).endpoint).toMatch(/apple/);
  });

  it.each([
    ['an arbitrary host', { endpoint: 'https://evil.example.com/x', keys: KEYS }, /unsupported push service/],
    ['a lookalike host', { endpoint: 'https://fcm.googleapis.com.evil.example/x', keys: KEYS }, /unsupported/],
    ['plain http', { endpoint: 'http://fcm.googleapis.com/fcm/send/abc', keys: KEYS }, /invalid endpoint/],
    ['not a URL', { endpoint: 'nope', keys: KEYS }, /invalid endpoint/],
    ['bad keys', { endpoint: 'https://fcm.googleapis.com/x', keys: { p256dh: 'has space', auth: 'a' } }, /invalid keys/],
    ['no keys', { endpoint: 'https://fcm.googleapis.com/x' }, /invalid keys/],
    ['nothing', undefined, /missing subscription/],
  ])('refuses %s', (_, sub, message) => {
    expect(() => validateSubscription(sub)).toThrow(message);
  });

  it('ids a subscription by the hash of its endpoint', () => {
    expect(subscriptionId('https://a')).toMatch(/^[0-9a-f]{64}$/);
    expect(subscriptionId('https://a')).toBe(subscriptionId('https://a'));
    expect(subscriptionId('https://a')).not.toBe(subscriptionId('https://b'));
  });
});

describe('validateTypes and validateTeams', () => {
  it('keeps known types once each; none means all', () => {
    expect(validateTypes(['results', 'spam', 'results'])).toEqual(['results']);
    expect(validateTypes(undefined)).toEqual([]);
    expect(() => validateTypes('results')).toThrow(/invalid types/);
  });

  it('keeps allowed team ids once each, and needs at least one', () => {
    expect(validateTeams([3, '4', 4, 99, 'x'], [3, 4, 5])).toEqual([3, 4]);
    expect(() => validateTeams([99], [3])).toThrow(/at least one team/);
    expect(() => validateTeams([], [3])).toThrow(/at least one team/);
    expect(() => validateTeams('3', [3])).toThrow(/invalid teams/);
  });
});

const fixture = (over = {}) => ({
  id: 304, date: new Date(2027, 1, 9), status: 'outstanding', homeScore: null, awayScore: null,
  homeTeamId: 4, awayTeamId: 3, homeTeam: 'Northfield B', awayTeam: 'Eastbank A',
  startTime: '19:30', divisionName: 'Division 2', venueName: 'Northfield Leisure Centre', ...over,
});

describe('notifications', () => {
  it('a result goes to both teams, links to the event page, and is tagged by fixture', () => {
    expect(N.resultNotification(fixture({ status: 'complete', homeScore: 12, awayScore: 6 }))).toEqual({
      type: 'results', teams: [4, 3],
      title: 'Northfield B 12–6 Eastbank A', body: 'Result · Division 2',
      url: '/event/304/09022027-Northfield%20B-Eastbank%20A', tag: 'result-304',
    });
  });

  it('no result notification without a completed score', () => {
    expect(N.resultNotification(fixture())).toBeNull();
    expect(N.resultNotification(fixture({ status: 'complete', homeScore: 12 }))).toBeNull();
    expect(N.resultNotification(fixture({ status: 'conceded', homeScore: 18, awayScore: 0 }))).toBeNull();
  });

  it('a reminder says when, where and which division, with a tag per kind', () => {
    const tonight = N.reminderNotification(fixture(), 'tonight');
    expect(tonight).toMatchObject({
      type: 'reminders', teams: [4, 3], title: 'Tonight: Northfield B v Eastbank A',
      body: '7:30pm · Northfield Leisure Centre · Division 2', tag: 'reminder-tonight-304',
    });
    expect(N.reminderNotification(fixture(), 'tomorrow')).toMatchObject({ title: 'Tomorrow: Northfield B v Eastbank A', tag: 'reminder-tomorrow-304' });
  });

  it('a reminder leaves out what is not known', () => {
    expect(N.reminderNotification(fixture({ startTime: null, venueName: null }), 'tonight').body).toBe('Division 2');
  });

  it.each([['19:30', '7:30pm'], ['20:00', '8pm'], ['18.45', '6:45pm'], ['12:00', '12pm'], ['9:15', '9:15am'], [' 7.30pm ', '7.30pm'], [null, '']])(
    'start time %p reads %p', (t, text) => expect(N.startTimeText(t)).toBe(text));

  it('the reminder date is the UK date, the next one for "tomorrow", across a clock change', () => {
    // 17:00 UK on Sat 25 Oct 2025 (BST, 16:00Z); the clocks went back that night.
    expect(N.reminderDate('tonight', new Date('2025-10-25T16:00:00Z'))).toBe('2025-10-25');
    expect(N.reminderDate('tomorrow', new Date('2025-10-25T17:00:00Z'))).toBe('2025-10-26');
    // 18:00 UK on Sat 28 Mar 2026 (GMT); the clocks went forward that night.
    expect(N.reminderDate('tomorrow', new Date('2026-03-28T18:00:00Z'))).toBe('2026-03-29');
    // 23:30 UTC in summer is already the next UK day.
    expect(N.reminderDate('tonight', new Date('2026-07-01T23:30:00Z'))).toBe('2026-07-02');
  });
});

const subRow = id => ({ id, endpoint: `https://fcm.googleapis.com/fcm/send/${id}`, p256dh: 'p', auth: 'a' });
const note = { type: 'results', teams: [1], title: 'T', body: 'B', url: '/x', tag: 't' };

describe('sendNotifications', () => {
  it('sends nothing without the VAPID key', async () => {
    expect(await sendNotifications([note])).toMatchObject({ skipped: 'no VAPID key', sent: 0 });
    expect(Push.subscribersFor).not.toHaveBeenCalled();
    expect(webpush.sendNotification).not.toHaveBeenCalled();
  });

  it('sends each match, removes subscriptions that are gone, counts other failures', async () => {
    withKeys();
    Push.subscribersFor.mockResolvedValue([subRow('ok'), subRow('gone'), subRow('expired'), subRow('flaky')]);
    webpush.sendNotification.mockImplementation(async s => {
      if (s.endpoint.endsWith('gone')) throw Object.assign(new Error('gone'), { statusCode: 410 });
      if (s.endpoint.endsWith('expired')) throw Object.assign(new Error('nf'), { statusCode: 404 });
      if (s.endpoint.endsWith('flaky')) throw Object.assign(new Error('busy'), { statusCode: 503 });
    });

    expect(await sendNotifications([note])).toEqual({ notifications: 1, subscribers: 4, sent: 1, failed: 1, removed: 2 });
    expect(Push.subscribersFor).toHaveBeenCalledWith({ teams: [1], type: 'results' });
    expect(Push.removeSubscriptions).toHaveBeenCalledWith(['gone', 'expired']);
    expect(Push.markSent).toHaveBeenCalledWith(['ok']);

    const [sub, payload, options] = webpush.sendNotification.mock.calls[0];
    expect(sub).toEqual({ endpoint: 'https://fcm.googleapis.com/fcm/send/ok', keys: { p256dh: 'p', auth: 'a' } });
    expect(JSON.parse(payload)).toEqual({ title: 'T', body: 'B', url: '/x', tag: 't' });
    expect(options.vapidDetails).toEqual({ subject: 'https://stockport-badminton.co.uk', publicKey: 'BPublicKeyForTests', privateKey: 'private-key-for-tests' });
  });

  it('only: sends to the named subscription and nobody else', async () => {
    withKeys();
    Push.subscribersFor.mockResolvedValue([subRow('mine'), subRow('theirs')]);
    webpush.sendNotification.mockResolvedValue({});
    expect(await sendNotifications([note], { only: ['mine'] })).toMatchObject({ subscribers: 1, sent: 1 });
    expect(webpush.sendNotification).toHaveBeenCalledTimes(1);
  });
});

describe('notifyResult', () => {
  const played = fixture({ status: 'complete', homeScore: 10, awayScore: 8 });

  it('without the key it claims nothing, so the result can still be sent once the key is set', async () => {
    expect(await push.notifyResult(304)).toEqual({ skipped: 'no VAPID key' });
    expect(Push.claimSend).not.toHaveBeenCalled();
  });

  it('claims result-<id>, sends, and records what happened', async () => {
    withKeys();
    Push.resultFor.mockResolvedValue(played);
    Push.subscribersFor.mockResolvedValue([subRow('a')]);
    webpush.sendNotification.mockResolvedValue({});
    expect(await push.notifyResult(304)).toMatchObject({ sent: 1 });
    expect(Push.claimSend).toHaveBeenCalledWith('result-304');
    expect(Push.recordSummary).toHaveBeenCalledWith('result-304', expect.objectContaining({ sent: 1 }));
  });

  it('a republished result sends nothing the second time', async () => {
    withKeys();
    Push.resultFor.mockResolvedValue(played);
    Push.claimSend.mockResolvedValueOnce(false);
    expect(await push.notifyResult(304)).toEqual({ skipped: 'already sent' });
    expect(webpush.sendNotification).not.toHaveBeenCalled();
  });

  it('claims nothing for a fixture without a result', async () => {
    withKeys();
    Push.resultFor.mockResolvedValue(fixture());
    expect(await push.notifyResult(304)).toEqual({ skipped: 'no result' });
    expect(Push.claimSend).not.toHaveBeenCalled();
  });
});

describe('runReminders', () => {
  const at = new Date('2027-02-08T18:00:00Z'); // 18:00 UK, Monday 8 Feb 2027

  it('reads tomorrow\'s fixtures, claims the day and kind, and sends one per fixture', async () => {
    withKeys();
    Push.remindersFor.mockResolvedValue([fixture()]);
    Push.subscribersFor.mockResolvedValue([subRow('a')]);
    webpush.sendNotification.mockResolvedValue({});
    const out = await push.runReminders('tomorrow', { now: at });
    expect(Push.remindersFor).toHaveBeenCalledWith('2027-02-09');
    expect(Push.claimSend).toHaveBeenCalledWith('reminders-2027-02-09-tomorrow');
    expect(out).toMatchObject({ when: 'tomorrow', date: '2027-02-09', fixtures: 1, sent: 1, titles: ['Tomorrow: Northfield B v Eastbank A'] });
  });

  it('a second run for the same day and kind sends nothing', async () => {
    withKeys();
    Push.remindersFor.mockResolvedValue([fixture()]);
    Push.claimSend.mockResolvedValueOnce(false);
    expect(await push.runReminders('tonight', { date: '2027-02-09' })).toMatchObject({ skipped: 'reminders-2027-02-09-tonight already sent' });
    expect(webpush.sendNotification).not.toHaveBeenCalled();
  });

  it('a day with no fixtures claims nothing; a dry run claims and sends nothing', async () => {
    withKeys();
    Push.remindersFor.mockResolvedValue([]);
    expect(await push.runReminders('tonight', { now: at })).toMatchObject({ note: 'no fixtures' });
    Push.remindersFor.mockResolvedValue([fixture()]);
    expect(await push.runReminders('tonight', { date: '2027-02-09', dry: true })).toMatchObject({ dry: true, fixtures: 1 });
    expect(Push.claimSend).not.toHaveBeenCalled();
    expect(webpush.sendNotification).not.toHaveBeenCalled();
  });

  it('refuses an unknown kind', async () => {
    await expect(push.runReminders('weekly')).rejects.toThrow(/tonight, tomorrow/);
  });
});
