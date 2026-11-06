// The monthly login cull (controllers/authCullController.js).
//
// It sends mail without a session, and it deletes accounts from an Auth0 tenant shared with
// Tameside's site. So the gate is pinned by what reached SES, and deletion by what reached
// Auth0, not just by status.
const request = require('supertest');

let mockCurrentUser = null;
jest.mock('../../middleware/secured', () => (req, res, next) => {
  if (mockCurrentUser) req.user = mockCurrentUser;
  next();
});
// The run route is a cron gate, not `secured`: a superadmin is recognised from the session
// user every request carries, which userInViews puts there.
jest.mock('../../models/userInViews', () => () => (req, res, next) => {
  if (mockCurrentUser) req.user = mockCurrentUser;
  next();
});
jest.mock('../../models/auth');
jest.mock('../../models/authCull');
jest.mock('../../models/players');
jest.mock('../../utils/ses', () => ({ sendEmail: jest.fn().mockResolvedValue({}) }));
jest.mock('../../utils/externalLeagues', () => ({
  ...jest.requireActual('../../utils/externalLeagues'),
  tamesideLinkedAccounts: jest.fn(),
}));

const Auth = require('../../models/auth');
const AuthCull = require('../../models/authCull');
const Player = require('../../models/players');
const ses = require('../../utils/ses');
const mailer = require('../../utils/mailer');
const externalLeagues = require('../../utils/externalLeagues');
const app = require('../../app');

const SUPERADMIN = { id: 'a', displayName: 'Results Secretary', _json: { 'https://my-app.example.com/role': 'superadmin', 'https://my-app.example.com/club': 'All' } };
const CLUB_ADMIN = { id: 'b', displayName: 'Club Admin', _json: { 'https://my-app.example.com/role': 'admin', 'https://my-app.example.com/club': 'Dome' } };

const TOKEN = 'the-real-token';
const daysAgo = n => new Date(Date.now() - n * 864e5).toISOString();
const acct = (id, email, lastLogin, md = {}) => ({ user_id: id, email, last_login: daysAgo(lastLogin),
  created_at: daysAgo(900), app_metadata: { betaAccess: true, ...md } });

const TENANT = [
  acct('auth0|idle', 'idle@example.com', 400),                         // ours, idle: warn
  acct('auth0|due', 'due@example.com', 420),                           // ours, warned 40 days ago: due
  acct('auth0|active', 'active@example.com', 3),                       // ours, active
  acct('google-oauth2|tam', 'tam@example.com', 800),                   // Tameside has linked it
  acct('auth0|tam-signup', 'tamsignup@example.com', 800, { league: 'tameside' }), // unlinked, signed up there
];

const sentTo = () => ses.sendEmail.mock.calls.map(([p]) => p.Destination.ToAddresses[0]);
const sentFor = addr => ses.sendEmail.mock.calls.map(([p]) => p).find(p => p.Destination.ToAddresses[0] === addr);

let savedToken;
beforeEach(() => {
  jest.clearAllMocks();
  mockCurrentUser = SUPERADMIN;
  savedToken = process.env.AUDIT_CRON_TOKEN;
  Auth.listUsers.mockResolvedValue(TENANT);
  Auth.getManagementAPIKey.mockResolvedValue('mgmt');
  Auth.deleteUser.mockResolvedValue('deleted');
  Player.getAuthEmailIndex.mockResolvedValue(new Map([
    ['idle@example.com', { id: 1, first_name: 'Ida', family_name: 'Idle', clubName: 'Dome', role: null }],
  ]));
  Player.clearAuthEmail.mockResolvedValue([]);
  externalLeagues.tamesideLinkedAccounts.mockResolvedValue(new Set(['google-oauth2|tam']));
  AuthCull.getAll.mockResolvedValue(new Map([['auth0|due', { user_id: 'auth0|due', notified_at: new Date(daysAgo(40)), kept_at: null }]]));
  AuthCull.recordNotice.mockResolvedValue();
});
afterEach(() => {
  if (savedToken === undefined) delete process.env.AUDIT_CRON_TOKEN; else process.env.AUDIT_CRON_TOKEN = savedToken;
});

describe('POST /admin/login-cull/run', () => {
  it('refuses anyone without the token or a superadmin session, and sends nothing', async () => {
    process.env.AUDIT_CRON_TOKEN = TOKEN;
    mockCurrentUser = null;
    expect((await request(app).post('/admin/login-cull/run')).status).toBe(403);
    expect((await request(app).post('/admin/login-cull/run').set('x-audit-token', 'guess')).status).toBe(403);
    mockCurrentUser = CLUB_ADMIN;
    expect((await request(app).post('/admin/login-cull/run')).status).toBe(403);
    expect(ses.sendEmail).not.toHaveBeenCalled();
    expect(AuthCull.recordNotice).not.toHaveBeenCalled();
  });

  it('warns only our idle login, records the token it emailed, and tells the results secretary', async () => {
    process.env.AUDIT_CRON_TOKEN = TOKEN;
    mockCurrentUser = null;
    const res = await request(app).post('/admin/login-cull/run').set('x-audit-token', TOKEN);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ warned: 1, failed: 0, deferred: 0, waiting: 0, due: 1 });
    expect(sentTo().sort()).toEqual([mailer.RESULTS_MAILBOX, 'idle@example.com'].sort());

    const warning = sentFor('idle@example.com');
    const text = warning.Message.Body.Text.Data;
    const link = text.match(/\/keep-login\/([A-Za-z0-9_-]+)/);
    expect(link).not.toBeNull();
    expect(AuthCull.recordNotice).toHaveBeenCalledWith('auth0|idle', link[1]);
    expect(warning.Message.Body.Html.Data).toContain('Hello Ida.');
    expect(warning.Message.Body.Html.Data).toContain(`/keep-login/${link[1]}`);

    const digest = sentFor(mailer.RESULTS_MAILBOX);
    expect(digest.Message.Subject.Data).toBe('Login cull: 1 warned, 1 due for deletion');
    expect(digest.Message.Body.Html.Data).toContain('idle@example.com');
  });

  it('records nothing for a warning SES refused', async () => {
    ses.sendEmail.mockImplementation(async p => {
      if (p.Destination.ToAddresses[0] === 'idle@example.com') throw new Error('SES said no');
      return {};
    });
    const res = await request(app).post('/admin/login-cull/run');
    expect(res.body).toMatchObject({ warned: 0, failed: 1 });
    expect(AuthCull.recordNotice).not.toHaveBeenCalled();
  });

  it('a quiet month sends nothing', async () => {
    AuthCull.getAll.mockResolvedValue(new Map([
      ['auth0|idle', { kept_at: new Date(daysAgo(10)) }],
      ['auth0|due', { kept_at: new Date(daysAgo(10)) }],
    ]));
    const res = await request(app).post('/admin/login-cull/run');
    expect(res.body).toEqual({ warned: 0, failed: 0, deferred: 0, waiting: 0, due: 0 });
    expect(ses.sendEmail).not.toHaveBeenCalled();
  });

  it('without Tameside\'s list it warns nobody', async () => {
    externalLeagues.tamesideLinkedAccounts.mockRejectedValue(new Error('TAMESIDE_DATABASE_URL is not set'));
    expect((await request(app).post('/admin/login-cull/run')).status).toBe(500);
    expect(ses.sendEmail).not.toHaveBeenCalled();
  });
});

describe('/keep-login/:token', () => {
  it('the GET shows a button and changes nothing (mail scanners prefetch links)', async () => {
    mockCurrentUser = null;
    AuthCull.findByToken.mockImplementation(async t => (t === 'good' ? { user_id: 'auth0|idle' } : undefined));
    const res = await request(app).get('/keep-login/good');
    expect(res.status).toBe(200);
    expect(res.text).toContain('<form method="post">');
    expect(res.headers['cache-control']).toMatch(/no-store/);
    expect(AuthCull.keepByToken).not.toHaveBeenCalled();
    expect((await request(app).get('/keep-login/bad')).status).toBe(404);
  });

  it('the POST keeps the login', async () => {
    mockCurrentUser = null;
    AuthCull.keepByToken.mockImplementation(async t => (t === 'good' ? { user_id: 'auth0|idle' } : undefined));
    const res = await request(app).post('/keep-login/good');
    expect(res.status).toBe(200);
    expect(res.text).toContain('your login is kept');
    const bad = await request(app).post('/keep-login/bad');
    expect(bad.status).toBe(404);
    expect(bad.text).toContain('This link has expired');
  });
});

describe('/admin/login-cull', () => {
  it('is superadmin-only, and a club admin reaches neither Auth0 nor the notices', async () => {
    mockCurrentUser = CLUB_ADMIN;
    expect((await request(app).get('/admin/login-cull')).status).toBe(403);
    for (const url of ['/admin/login-cull/delete', '/admin/login-cull/keep']) {
      expect((await request(app).post(url).type('form').send({ userId: 'auth0|due' })).status).toBe(403);
    }
    expect(Auth.deleteUser).not.toHaveBeenCalled();
    expect(AuthCull.keep).not.toHaveBeenCalled();
  });

  it('lists the due login with its delete form, and not Tameside\'s', async () => {
    const res = await request(app).get('/admin/login-cull');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Due for deletion (1)');
    expect(res.text).toContain('<code>due@example.com</code>');
    expect(res.text).toContain('<strong>1</strong> will get the email');
    expect(res.text).not.toContain('tam@example.com');
    expect(res.text).not.toContain('tamsignup@example.com');
  });

  it('says why when it cannot build the list', async () => {
    externalLeagues.tamesideLinkedAccounts.mockRejectedValue(new Error('TAMESIDE_DATABASE_URL is not set: cannot tell'));
    const res = await request(app).get('/admin/login-cull');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Could not build the cull list: TAMESIDE_DATABASE_URL is not set');
  });

  it('deletes only what was shown AND is still due, and unlinks it by its tenant address', async () => {
    const res = await request(app).post('/admin/login-cull/delete').type('form')
      .send('userId=auth0%7Cdue&userId=auth0%7Cactive&userId=auth0%7Cidle&userId=google-oauth2%7Ctam');
    expect(res.status).toBe(303);
    expect(Auth.deleteUser.mock.calls.map(c => c[0])).toEqual(['auth0|due']);
    expect(Player.clearAuthEmail).toHaveBeenCalledWith('due@example.com');
    expect(AuthCull.remove).toHaveBeenCalledWith('auth0|due');
    expect(decodeURIComponent(res.headers.location)).toContain('Deleted 1 login. 3 no longer due and left alone.');
  });

  it('a due login that was not on the page is left alone', async () => {
    await request(app).post('/admin/login-cull/delete').type('form').send({});
    expect(Auth.deleteUser).not.toHaveBeenCalled();
  });

  it('stops at the first failed delete and leaves that login linked', async () => {
    Auth.deleteUser.mockRejectedValue(new Error('HTTP 500'));
    const res = await request(app).post('/admin/login-cull/delete').type('form').send({ userId: 'auth0|due' });
    expect(decodeURIComponent(res.headers.location)).toContain('Deleted 0; stopped at due@example.com: HTTP 500');
    expect(Player.clearAuthEmail).not.toHaveBeenCalled();
    expect(AuthCull.remove).not.toHaveBeenCalled();
  });

  it('keep: only an account the tenant has', async () => {
    expect((await request(app).post('/admin/login-cull/keep').type('form').send({ userId: 'auth0|invented' })).status).toBe(404);
    expect((await request(app).post('/admin/login-cull/keep').type('form').send({ userId: 'auth0|due' })).status).toBe(303);
    expect(AuthCull.keep.mock.calls).toEqual([['auth0|due']]);
  });
});
