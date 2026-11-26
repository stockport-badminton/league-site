// The push notification routes (routes/push.js, controllers/pushController.js): the opt-in
// page, the subscription API it calls, the scheduled reminders and the superadmin page. The
// sending is unit-tested in __tests__/unit/push.test.js and the SQL in __tests__/db/push.test.js.
const request = require('supertest');

let mockCurrentUser = null;
jest.mock('../../middleware/secured', () => (req, res, next) => {
  if (mockCurrentUser) req.user = mockCurrentUser;
  next();
});
jest.mock('../../models/push');
jest.mock('../../utils/push', () => ({
  runReminders: jest.fn(),
  sendTest: jest.fn(),
  configured: jest.fn(() => true),
}));

const Push = require('../../models/push');
const push = require('../../utils/push');
const { subscriptionId } = require('../../utils/push/subscription');
const app = require('../../app');

const SUPERADMIN = { id: 'a', displayName: 'Results Secretary', _json: { 'https://my-app.example.com/role': 'superadmin', 'https://my-app.example.com/club': 'All' } };
const CLUB_ADMIN = { id: 'b', displayName: 'Club Admin', _json: { 'https://my-app.example.com/role': 'admin', 'https://my-app.example.com/club': 'Dome' } };

const TEAMS = [
  { id: 1, name: 'Northfield A', clubId: 1, clubName: 'Northfield', divisionName: 'Division 1' },
  { id: 4, name: 'Northfield B', clubId: 1, clubName: 'Northfield', divisionName: 'Division 2' },
  { id: 2, name: 'Southgate A', clubId: 2, clubName: 'Southgate', divisionName: null },
];
const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/device-1';
const KEYS = { p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u', auth: 'tBHItJI5svbpez7KI4CCXg' };

const saved = { ...process.env };
beforeEach(() => {
  jest.clearAllMocks();
  mockCurrentUser = null;
  Push.followableTeams.mockResolvedValue(TEAMS);
  Push.upsertSubscription.mockResolvedValue();
  Push.removeSubscriptions.mockResolvedValue(1);
});
afterEach(() => { process.env = { ...saved }; });

describe('GET /notifications', () => {
  it('offers every followable team, grouped by club, with the VAPID key for the browser', async () => {
    const res = await request(app).get('/notifications');
    expect(res.status).toBe(200);
    expect(res.text).toContain('data-vapid-key="BTestVapidPublicKey_');
    expect(res.text.match(/<summary>/g)).toHaveLength(2);
    expect(res.text).toMatch(/<summary>Northfield[\s\S]*Northfield A[\s\S]*Northfield B[\s\S]*<summary>Southgate/);
    expect(res.text).toMatch(/name="push-team" id="team-4"\s+value="4">/);
    expect(res.text).toContain('push-panel.js');
    expect(res.text).toMatch(/<a href="#" data-notifications-video>[\s\S]*?Watch how it works/);
    expect(res.text).toContain('id="notificationsVideoPlayer"');
  });

  it('?team= ticks that team and opens its club', async () => {
    const res = await request(app).get('/notifications?team=4');
    expect(res.text).toMatch(/value="4" checked>/);
    expect(res.text).not.toMatch(/value="1" checked>/);
    expect(res.text).toMatch(/<details class="mb-1" open>\s*<summary>Northfield/);
  });

  it('a ?team= that is not a followable team ticks nothing', async () => {
    const res = await request(app).get('/notifications?team=999');
    expect(res.text).not.toContain(' checked>\n                    <label class="form-check-label" for="team-');
    expect(res.text).not.toMatch(/name="push-team"[^>]*checked/);
  });

  it('says notifications are unavailable when the server has no VAPID key', async () => {
    delete process.env.VAPID_PUBLIC_KEY;
    // The schema's test value applies only when the variable is set by the test setup.
    const res = await request(app).get('/notifications');
    expect(res.status).toBe(200);
    expect(res.text).toContain('data-vapid-key=""');
  });
});

describe('POST /api/push/subscribe', () => {
  const body = (over = {}) => ({ subscription: { endpoint: ENDPOINT, keys: KEYS }, teams: [4, 999], types: ['results'], ...over });

  it('saves the subscription under the hash of its endpoint, with only known teams', async () => {
    const res = await request(app).post('/api/push/subscribe').set('Sec-Fetch-Site', 'same-origin').send(body());
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, teams: [4], types: ['results'] });
    expect(Push.upsertSubscription).toHaveBeenCalledWith({
      id: subscriptionId(ENDPOINT), endpoint: ENDPOINT, p256dh: KEYS.p256dh, auth: KEYS.auth, teams: [4], types: ['results'],
    });
  });

  it('refuses a request from another site\'s page, and saves nothing', async () => {
    const cross = await request(app).post('/api/push/subscribe').set('Sec-Fetch-Site', 'cross-site').send(body());
    expect(cross.status).toBe(403);
    const foreign = await request(app).post('/api/push/subscribe').set('Origin', 'https://evil.example').send(body());
    expect(foreign.status).toBe(403);
    expect(Push.upsertSubscription).not.toHaveBeenCalled();
  });

  it('accepts the site\'s own origin when the browser sends no Sec-Fetch-Site', async () => {
    const res = await request(app).post('/api/push/subscribe').set('Origin', 'https://stockport-badminton.co.uk').send(body());
    expect(res.status).toBe(200);
  });

  it.each([
    ['an endpoint that is not a push service', { subscription: { endpoint: 'https://evil.example/hook', keys: KEYS } }, 'unsupported push service'],
    ['no followable team', { teams: [999] }, 'pick at least one team'],
    ['no subscription', { subscription: undefined }, 'missing subscription'],
  ])('answers 400 in JSON for %s', async (_, over, error) => {
    const res = await request(app).post('/api/push/subscribe').send(body(over));
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ ok: false, error });
    expect(Push.upsertSubscription).not.toHaveBeenCalled();
  });
});

describe('the lookup and unsubscribe', () => {
  it('POST /api/push/subscription returns what this browser is subscribed to', async () => {
    Push.getSubscription.mockResolvedValueOnce({ teams: [4], types: [] });
    const res = await request(app).post('/api/push/subscription').send({ endpoint: ENDPOINT });
    expect(Push.getSubscription).toHaveBeenCalledWith(subscriptionId(ENDPOINT));
    expect(res.body).toEqual({ ok: true, subscribed: true, teams: [4], types: [] });

    Push.getSubscription.mockResolvedValueOnce(null);
    const none = await request(app).post('/api/push/subscription').send({ endpoint: ENDPOINT });
    expect(none.body).toEqual({ ok: true, subscribed: false });
  });

  it('DELETE /api/push/subscribe removes it; a missing endpoint is a 400', async () => {
    const res = await request(app).delete('/api/push/subscribe').send({ endpoint: ENDPOINT });
    expect(res.status).toBe(200);
    expect(Push.removeSubscriptions).toHaveBeenCalledWith([subscriptionId(ENDPOINT)]);

    const bad = await request(app).delete('/api/push/subscribe').send({});
    expect(bad.status).toBe(400);
  });
});

describe('POST /admin/push/reminders', () => {
  const TOKEN = 'a-test-push-token';

  it('refuses an anonymous caller with 403, not a redirect, and runs nothing', async () => {
    process.env.PUSH_CRON_TOKEN = TOKEN;
    const res = await request(app).post('/admin/push/reminders?when=tonight');
    expect(res.status).toBe(403);
    expect(res.headers.location).toBeUndefined();
    expect(push.runReminders).not.toHaveBeenCalled();
  });

  it('an unset token closes the path', async () => {
    delete process.env.PUSH_CRON_TOKEN;
    const res = await request(app).post('/admin/push/reminders?when=tonight').set('X-Push-Token', TOKEN);
    expect(res.status).toBe(403);
  });

  it('the scheduler runs the reminders; it cannot pick the day or a dry run', async () => {
    process.env.PUSH_CRON_TOKEN = TOKEN;
    push.runReminders.mockResolvedValue({ when: 'tomorrow', date: '2027-02-09', sent: 2 });
    const res = await request(app).post('/admin/push/reminders?when=tomorrow&date=2027-01-01&dry=1').set('X-Push-Token', TOKEN);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ when: 'tomorrow', date: '2027-02-09', sent: 2 });
    expect(push.runReminders).toHaveBeenCalledWith('tomorrow', { date: undefined, dry: false });
  });

  it('an unknown kind is a 400; a failed run is a 500 the scheduler shows', async () => {
    process.env.PUSH_CRON_TOKEN = TOKEN;
    push.runReminders.mockRejectedValueOnce(new Error('when must be one of tonight, tomorrow'));
    expect((await request(app).post('/admin/push/reminders?when=weekly').set('X-Push-Token', TOKEN)).status).toBe(400);
    push.runReminders.mockRejectedValueOnce(new Error('db down'));
    expect((await request(app).post('/admin/push/reminders?when=tonight').set('X-Push-Token', TOKEN)).status).toBe(500);
  });
});

describe('/admin/push', () => {
  beforeEach(() => {
    Push.teamCounts.mockResolvedValue({ subscriptions: 3, teams: [{ id: 4, name: 'Northfield B', subscribers: 2 }] });
    Push.recentSends.mockResolvedValue([{ key: 'result-304', sentAt: new Date('2027-02-09T21:00:00Z'), summary: { subscribers: 2, sent: 2 } }]);
  });

  it('is superadmin-only', async () => {
    mockCurrentUser = CLUB_ADMIN;
    expect((await request(app).get('/admin/push')).status).toBe(403);
    expect((await request(app).post('/admin/push/test').send({ to: 'everyone' })).status).toBe(403);
    expect(push.sendTest).not.toHaveBeenCalled();
  });

  it('shows followers per team and recent sends', async () => {
    mockCurrentUser = SUPERADMIN;
    const res = await request(app).get('/admin/push');
    expect(res.status).toBe(200);
    expect(res.text).toContain('3 devices subscribed.');
    expect(res.text).toMatch(/<td>Northfield B<\/td><td class="text-right text-end">2<\/td>/);
    expect(res.text).toContain('<code>result-304</code>');
    expect(res.text).not.toContain('Not configured.');
  });

  it('a test to this browser goes to its subscription only', async () => {
    mockCurrentUser = SUPERADMIN;
    push.sendTest.mockResolvedValue({ subscribers: 1, sent: 1, failed: 0, removed: 0 });
    const res = await request(app).post('/admin/push/test').type('form').send({ to: 'me', endpoint: ENDPOINT });
    expect(push.sendTest).toHaveBeenCalledWith({ subscriptionId: subscriptionId(ENDPOINT) });
    expect(res.text).toContain('Sent 1 of 1.');
  });

  it('a test to this browser without a subscription sends nothing and says why', async () => {
    mockCurrentUser = SUPERADMIN;
    const res = await request(app).post('/admin/push/test').type('form').send({ to: 'me', endpoint: '' });
    expect(push.sendTest).not.toHaveBeenCalled();
    expect(res.text).toContain('This browser has no subscription.');
  });

  it('a test to everyone', async () => {
    mockCurrentUser = SUPERADMIN;
    push.sendTest.mockResolvedValue({ subscribers: 3, sent: 2, failed: 0, removed: 1 });
    const res = await request(app).post('/admin/push/test').type('form').send({ to: 'everyone' });
    expect(push.sendTest).toHaveBeenCalledWith({});
    expect(res.text).toContain('Sent 2 of 3; 1 expired subscription(s) removed.');
  });
});
