const request = require('supertest');

// The weekly anomaly email (HARD-07).
//
// Two things are being defended here, and they pull in opposite directions.
//
// The endpoint has to be callable by a scheduler with no session, which is exactly the
// shape that made the annual invoice run (SEC-3) reachable by anyone who guessed the
// path. So the token path is closed unless a token is configured, compared in constant
// time, and the report — a map of every weakness in the league's data — is never
// rendered to a caller who has neither.
//
// And the send has to be impossible to trigger by accident. `DATABASE_URL` points at
// production, so a job that mails on import would mail the real results secretary from a
// developer's laptop. The recipient therefore comes only from AUDIT_EMAIL_TO, never from
// the request, and an unconfigured deploy renders the report and sends nothing.

let mockCurrentUser = null;

jest.mock('../../middleware/secured', () => (req, res, next) => {
  if (mockCurrentUser) req.user = mockCurrentUser;
  next();
});

// Passport's session deserialisation is what puts req.user on a request that does *not*
// go through `secured` — which is the case for the cron endpoint. Stand in for it.
jest.mock('../../models/userInViews', () => () => (req, res, next) => {
  if (mockCurrentUser) req.user = mockCurrentUser;
  res.locals.user = req.user;
  next();
});

jest.mock('../../utils/ses');

// Only runAll is mocked: the SQL in tools/audit/checks.js is not this package's to
// exercise, and mocking the connection instead would give every check the same rows.
jest.mock('../../tools/audit/checks', () => {
  const actual = jest.requireActual('../../tools/audit/checks');
  return { ...actual, runAll: jest.fn() };
});

jest.mock('../../db_connect', () => ({
  connect: jest.fn(),
  otherConnect: jest.fn(() => Promise.resolve({
    query: jest.fn(() => Promise.resolve([[], []]))
  })),
  withTransaction: jest.fn(fn => fn({ query: jest.fn(() => Promise.resolve([[]])) })),
  isObject: jest.fn(obj => obj === Object(obj)),
}));

const checks = require('../../tools/audit/checks');
const ses = require('../../utils/ses');
const app = require('../../app');

const SUPERADMIN = {
  id: 'auth0|super',
  displayName: 'Results Secretary',
  email: 'results@example.com',
  _json: {
    'https://my-app.example.com/role': 'superadmin',
    'https://my-app.example.com/club': 'All',
  },
};

const CLUB_ADMIN = {
  id: 'auth0|captain',
  displayName: 'A Captain',
  email: 'captain@example.com',
  _json: {
    'https://my-app.example.com/role': 'captain',
    'https://my-app.example.com/club': 'Alderley Park',
  },
};

const TOKEN = 'a-long-shared-secret-for-cloud-scheduler';

function clean() {
  return checks.all().map(c => ({ ...c, rows: [] }));
}

function withFindings() {
  return checks.all().map(c => {
    if (c.name === 'orphan-results') {
      return { ...c, rows: [{ id: 6600, played: '2026-08-29', homeScore: 7, awayScore: 4,
                              home: 'Hazel Grove A', away: 'Marple B' }] };
    }
    if (c.name === 'missing-contact') {
      return { ...c, rows: [], error: 'check "missing-contact" needs DB_PI_KEY in the environment' };
    }
    return { ...c, rows: [] };
  });
}

let savedEnv;

beforeEach(() => {
  jest.clearAllMocks();
  mockCurrentUser = null;
  savedEnv = {
    to: process.env.AUDIT_EMAIL_TO,
    token: process.env.AUDIT_CRON_TOKEN,
  };
  delete process.env.AUDIT_EMAIL_TO;
  delete process.env.AUDIT_CRON_TOKEN;
  checks.runAll.mockResolvedValue(clean());
  ses.sendEmail.mockResolvedValue({ MessageId: 'test' });
});

afterEach(() => {
  if (savedEnv.to === undefined) delete process.env.AUDIT_EMAIL_TO;
  else process.env.AUDIT_EMAIL_TO = savedEnv.to;
  if (savedEnv.token === undefined) delete process.env.AUDIT_CRON_TOKEN;
  else process.env.AUDIT_CRON_TOKEN = savedEnv.token;
});

describe('POST /admin/audit/run — who may trigger it', () => {
  it('refuses an anonymous caller with no token', async () => {
    const res = await request(app).post('/admin/audit/run').send({});
    expect(res.status).toBe(403);
    expect(checks.runAll).not.toHaveBeenCalled();
    expect(ses.sendEmail).not.toHaveBeenCalled();
  });

  it('refuses a club admin — the report is a map of every weakness in the data', async () => {
    mockCurrentUser = CLUB_ADMIN;
    const res = await request(app).post('/admin/audit/run').send({});
    expect(res.status).toBe(403);
    expect(checks.runAll).not.toHaveBeenCalled();
    expect(ses.sendEmail).not.toHaveBeenCalled();
  });

  it('refuses a token when none is configured, so an unset env var is not an open door', async () => {
    const res = await request(app)
      .post('/admin/audit/run')
      .set('X-Audit-Token', '')
      .send({});
    expect(res.status).toBe(403);
    expect(checks.runAll).not.toHaveBeenCalled();
  });

  it('refuses a wrong token', async () => {
    process.env.AUDIT_CRON_TOKEN = TOKEN;
    const res = await request(app)
      .post('/admin/audit/run')
      .set('X-Audit-Token', TOKEN + 'x')
      .send({});
    expect(res.status).toBe(403);
    expect(checks.runAll).not.toHaveBeenCalled();
  });

  it('accepts the configured token with no session at all', async () => {
    process.env.AUDIT_CRON_TOKEN = TOKEN;
    const res = await request(app)
      .post('/admin/audit/run')
      .set('X-Audit-Token', TOKEN)
      .send({});
    expect(res.status).toBe(200);
    expect(checks.runAll).toHaveBeenCalled();
  });

  it('accepts the results secretary', async () => {
    mockCurrentUser = SUPERADMIN;
    const res = await request(app).post('/admin/audit/run').send({});
    expect(res.status).toBe(200);
    expect(checks.runAll).toHaveBeenCalled();
  });
});

describe('POST /admin/audit/run — the send', () => {
  beforeEach(() => { mockCurrentUser = SUPERADMIN; });

  it('sends nothing when no recipient is configured, and says so', async () => {
    const res = await request(app).post('/admin/audit/run').send({});
    expect(res.status).toBe(200);
    expect(ses.sendEmail).not.toHaveBeenCalled();
    expect(res.body.sent).toBe(false);
    expect(res.body.reason).toMatch(/AUDIT_EMAIL_TO/);
  });

  it('ignores a recipient supplied in the request body', async () => {
    process.env.AUDIT_EMAIL_TO = 'secretary@example.com';
    await request(app).post('/admin/audit/run').send({
      to: 'attacker@example.com',
      email: 'attacker@example.com',
      AUDIT_EMAIL_TO: 'attacker@example.com',
    });

    expect(ses.sendEmail).toHaveBeenCalledTimes(1);
    const params = ses.sendEmail.mock.calls[0][0];
    expect(params.Destination.ToAddresses).toEqual(['secretary@example.com']);
    expect(JSON.stringify(params)).not.toMatch(/attacker@example\.com/);
  });

  it('takes several configured recipients, and drops anything that is not an address', async () => {
    process.env.AUDIT_EMAIL_TO = ' secretary@example.com , chair@example.com ,,nonsense';
    await request(app).post('/admin/audit/run').send({});
    const params = ses.sendEmail.mock.calls[0][0];
    expect(params.Destination.ToAddresses).toEqual(['secretary@example.com', 'chair@example.com']);
  });

  it('sends an all-clear email rather than staying silent', async () => {
    process.env.AUDIT_EMAIL_TO = 'secretary@example.com';
    const res = await request(app).post('/admin/audit/run').send({});

    const params = ses.sendEmail.mock.calls[0][0];
    expect(params.Message.Subject.Data).toBe('[SBL audit] all clear');
    const html = params.Message.Body.Html.Data;
    expect(html).toMatch(/all clear/i);
    expect(res.body.sent).toBe(true);
  });

  it('lists a real finding with enough detail to act on, and links to it', async () => {
    process.env.AUDIT_EMAIL_TO = 'secretary@example.com';
    checks.runAll.mockResolvedValue(withFindings());
    await request(app).post('/admin/audit/run').send({});

    const params = ses.sendEmail.mock.calls[0][0];
    const html = params.Message.Body.Html.Data;
    expect(html).toContain('6600');
    expect(html).toContain('2026-08-29');
    expect(html).toContain('Hazel Grove A');
    expect(html).toContain('Marple B');
    // Absolute, on the real site — never built from the caller's Host header.
    expect(html).toContain('https://stockport-badminton.co.uk/event/6600/');
    expect(html).not.toContain('127.0.0.1');
  });

  it('reports a failing check in the email instead of aborting the send', async () => {
    process.env.AUDIT_EMAIL_TO = 'secretary@example.com';
    checks.runAll.mockResolvedValue(withFindings());
    await request(app).post('/admin/audit/run').send({});

    expect(ses.sendEmail).toHaveBeenCalledTimes(1);
    const params = ses.sendEmail.mock.calls[0][0];
    expect(params.Message.Subject.Data).toBe('[SBL audit] 1 new finding, 1 check failing');
    const html = params.Message.Body.Html.Data;
    expect(html).toMatch(/DB_PI_KEY/);
    // The other section survived it.
    expect(html).toContain('6600');
  });

  it('sends from the league address and does not fail the request if SES does', async () => {
    process.env.AUDIT_EMAIL_TO = 'secretary@example.com';
    ses.sendEmail.mockRejectedValue(new Error('Throttling: Maximum sending rate exceeded'));
    const res = await request(app).post('/admin/audit/run').send({});

    expect(res.status).toBe(200);
    expect(res.body.sent).toBe(false);
    expect(res.body.reason).toMatch(/Throttling/);
  });

  it('names the league as the sender', async () => {
    process.env.AUDIT_EMAIL_TO = 'secretary@example.com';
    await request(app).post('/admin/audit/run').send({});
    const params = ses.sendEmail.mock.calls[0][0];
    expect(params.Source).toMatch(/@stockport-badminton\.co\.uk$/);
  });
});

describe('GET /admin/audit — the preview', () => {
  it('never sends, whatever is configured', async () => {
    process.env.AUDIT_EMAIL_TO = 'secretary@example.com';
    mockCurrentUser = SUPERADMIN;
    const res = await request(app).get('/admin/audit');

    expect(res.status).toBe(200);
    expect(ses.sendEmail).not.toHaveBeenCalled();
  });

  it('shows the report a superadmin asked for', async () => {
    mockCurrentUser = SUPERADMIN;
    checks.runAll.mockResolvedValue(withFindings());
    const res = await request(app).get('/admin/audit');
    expect(res.status).toBe(200);
    expect(res.text).toContain('6600');
  });

  it('warns on the page when no recipient is configured, so the gap is discoverable', async () => {
    mockCurrentUser = SUPERADMIN;
    const res = await request(app).get('/admin/audit');
    expect(res.text).toMatch(/AUDIT_EMAIL_TO/);
  });

  it('refuses a club admin', async () => {
    mockCurrentUser = CLUB_ADMIN;
    const res = await request(app).get('/admin/audit');
    expect(res.status).toBe(403);
    expect(checks.runAll).not.toHaveBeenCalled();
  });

  it('does not answer 200 to an anonymous request', async () => {
    const res = await request(app).get('/admin/audit');
    expect(res.status).not.toBe(200);
    expect(checks.runAll).not.toHaveBeenCalled();
  });

  it('ignores a token on the preview route — the token is for the cron POST only', async () => {
    process.env.AUDIT_CRON_TOKEN = TOKEN;
    const res = await request(app).get('/admin/audit').set('X-Audit-Token', TOKEN);
    expect(res.status).not.toBe(200);
  });
});
