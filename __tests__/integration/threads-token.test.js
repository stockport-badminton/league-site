// Connecting the league's Threads account, and keeping its 60-day token alive.
//
// What matters here, in order:
//   - the login stores a token only for the league's own account (the 26 Sep trap: a
//     browser signed in to a person's Instagram connects that person);
//   - the callback only accepts a login this session started (`state`);
//   - the refresh honours Threads' 24-hour floor, never overwrites a login that landed
//     while it ran, and fails LOUDLY: an error status and a recorded error, never a 200.

process.env.NODE_ENV = 'test';

let mockCurrentUser = null;

jest.mock('../../middleware/secured', () => (req, res, next) => {
  if (!mockCurrentUser) return res.redirect('/login');
  req.user = mockCurrentUser;
  next();
});
jest.mock('passport', () => {
  const actual = jest.requireActual('passport');
  actual.session = () => (req, res, next) => {
    if (mockCurrentUser) {
      req.user = mockCurrentUser;
      req.isAuthenticated = () => true;
    }
    next();
  };
  return actual;
});

// The real store is Postgres, and this process cannot reach one. The callback test needs
// a session that survives from /connect to /callback, so an in-memory one stands in.
jest.mock('connect-pg-simple', () => session => session.MemoryStore);

jest.mock('../../models/socialToken', () => ({
  status: jest.fn(),
  withToken: jest.fn(),
  saveLogin: jest.fn(),
  saveRefresh: jest.fn(),
  recordError: jest.fn(),
}));

jest.mock('../../utils/threadsAuth', () => {
  const actual = jest.requireActual('../../utils/threadsAuth');
  return {
    ...actual,
    exchangeCode: jest.fn(),
    longLived: jest.fn(),
    refresh: jest.fn(),
    me: jest.fn(),
  };
});

const request = require('supertest');
const app = require('../../app');
const SocialToken = require('../../models/socialToken');
const threads = require('../../utils/threadsAuth');

const SUPERADMIN = {
  id: 'auth0|super', displayName: 'Results Secretary',
  emails: [{ value: 'results@example.com' }],
  _json: { 'https://my-app.example.com/role': 'superadmin', 'https://my-app.example.com/club': 'All' },
};
const CAPTAIN = {
  id: 'auth0|cap', displayName: 'A Captain', emails: [{ value: 'cap@example.com' }],
  _json: { 'https://my-app.example.com/role': 'admin', 'https://my-app.example.com/club': 'Tatton' },
};

const LEAGUE_ID = '28753684917596556';
const SOCIAL = 'social-cron-token-not-real';
const DAY = 24 * 60 * 60 * 1000;

function row(overrides = {}) {
  return {
    platform: 'threads', accountId: LEAGUE_ID, username: 'stockport.badders.results',
    obtainedAt: new Date(Date.now() - 7 * DAY), expiresAt: new Date(Date.now() + 53 * DAY),
    refreshedAt: null, lastError: null, lastErrorAt: null, generation: 3,
    updatedBy: 'Results Secretary', token: 'THAA-stored-token', ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockCurrentUser = SUPERADMIN;
  process.env.META_THREADS_APP_ID = '1113993321053331';
  process.env.META_THREADS_APP_SECRET = 'not-a-real-secret';
  process.env.META_THREADS_USER_ID = LEAGUE_ID;
  process.env.SOCIAL_CRON_TOKEN = SOCIAL;
  SocialToken.status.mockResolvedValue(null);
  SocialToken.withToken.mockResolvedValue(null);
  SocialToken.saveLogin.mockResolvedValue(1);
  SocialToken.saveRefresh.mockResolvedValue(1);
  SocialToken.recordError.mockResolvedValue();
  threads.exchangeCode.mockResolvedValue('short-token');
  threads.longLived.mockResolvedValue({ token: 'THAA-long-token', expiresIn: 5184000 });
  threads.me.mockResolvedValue({ id: LEAGUE_ID, username: 'stockport.badders.results' });
  threads.refresh.mockResolvedValue({ token: 'THAA-refreshed', expiresIn: 5184000 });
});
afterEach(() => {
  for (const k of ['META_THREADS_APP_ID', 'META_THREADS_APP_SECRET', 'META_THREADS_USER_ID',
                   'SOCIAL_CRON_TOKEN']) delete process.env[k];
});

// Start a login in one session, and return that session plus the state it was given.
async function startLogin() {
  const agent = request.agent(app);
  const res = await agent.get('/admin/threads/connect');
  expect(res.status).toBe(302);
  const target = new URL(res.headers.location);
  return { agent, target, state: target.searchParams.get('state') };
}

describe('the status page', () => {
  it('is superadmin only', async () => {
    mockCurrentUser = CAPTAIN;
    const res = await request(app).get('/admin/threads');
    expect(res.status).not.toBe(200);
    expect(SocialToken.status).not.toHaveBeenCalled();
  });

  it('shows the connected account and how long the token has left', async () => {
    SocialToken.status.mockResolvedValue(row());
    const res = await request(app).get('/admin/threads');
    expect(res.status).toBe(200);
    expect(res.text).toContain('@stockport.badders.results');
    expect(res.text).toMatch(/5[23] days left/);
    expect(res.text).toContain('Reconnect');
  });

  it('says what is unset rather than offering a Connect that cannot work', async () => {
    delete process.env.META_THREADS_USER_ID;
    const res = await request(app).get('/admin/threads');
    expect(res.text).toContain('META_THREADS_USER_ID');
    expect(res.text).not.toContain('href="/admin/threads/connect"');
  });

  it('shows only fixed notices, never text from the query string', async () => {
    const res = await request(app).get('/admin/threads?notice=<b>pwned</b>');
    expect(res.status).toBe(200);
    // The canonical URL carries the query string, percent-encoded, which is correct. What
    // must not happen is the text reaching the page body, escaped or not.
    expect(res.text).not.toContain('class="alert');
    expect(res.text).not.toMatch(/(&lt;|<)b(&gt;|>)pwned/);
  });
});

describe('starting the login', () => {
  it('sends the person to Threads with both scopes and a callback on the public domain', async () => {
    const { target, state } = await startLogin();
    expect(target.origin + target.pathname).toBe('https://threads.net/oauth/authorize');
    expect(target.searchParams.get('client_id')).toBe('1113993321053331');
    expect(target.searchParams.get('redirect_uri'))
      .toBe('https://stockport-badminton.co.uk/admin/threads/callback');
    expect(target.searchParams.get('scope')).toBe('threads_basic,threads_content_publish');
    expect(target.searchParams.get('response_type')).toBe('code');
    expect(state).toMatch(/^[0-9a-f]{48}$/);
  });

  it('refuses to start when a setting is missing', async () => {
    delete process.env.META_THREADS_APP_SECRET;
    const res = await request(app).get('/admin/threads/connect');
    expect(res.status).toBe(503);
    expect(res.text).toContain('META_THREADS_APP_SECRET unset');
    expect(res.headers.location).toBeUndefined();
  });
});

describe('the callback', () => {
  it('stores the long-lived token for the league account', async () => {
    const { agent, state } = await startLogin();
    const res = await agent.get(`/admin/threads/callback?code=abc123&state=${state}`);

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/admin/threads?notice=connected');
    expect(threads.exchangeCode).toHaveBeenCalledWith({
      code: 'abc123', redirectUri: 'https://stockport-badminton.co.uk/admin/threads/callback',
    });
    expect(threads.longLived).toHaveBeenCalledWith('short-token');
    expect(SocialToken.saveLogin).toHaveBeenCalledWith('threads', expect.objectContaining({
      accountId: LEAGUE_ID, username: 'stockport.badders.results',
      token: 'THAA-long-token', expiresIn: 5184000,
    }));
  });

  it('refuses a login for anybody else, and stores nothing', async () => {
    threads.me.mockResolvedValue({ id: '999', username: 'someones.personal' });
    const { agent, state } = await startLogin();
    const res = await agent.get(`/admin/threads/callback?code=abc123&state=${state}`);

    expect(res.status).toBe(400);
    expect(res.text).toContain('@someones.personal');
    expect(res.text).toContain('nothing was stored');
    expect(SocialToken.saveLogin).not.toHaveBeenCalled();
  });

  it('ignores a callback this session did not start', async () => {
    const res = await request(app).get('/admin/threads/callback?code=abc123&state=deadbeef');
    expect(res.status).toBe(400);
    expect(threads.exchangeCode).not.toHaveBeenCalled();
    expect(SocialToken.saveLogin).not.toHaveBeenCalled();
  });

  it('ignores a state from a different session', async () => {
    const { state } = await startLogin();
    const res = await request.agent(app).get(`/admin/threads/callback?code=abc123&state=${state}`);
    expect(res.status).toBe(400);
    expect(threads.exchangeCode).not.toHaveBeenCalled();
  });

  it('accepts each state once', async () => {
    const { agent, state } = await startLogin();
    await agent.get(`/admin/threads/callback?code=abc123&state=${state}`);
    const again = await agent.get(`/admin/threads/callback?code=abc123&state=${state}`);
    expect(again.status).toBe(400);
    expect(SocialToken.saveLogin).toHaveBeenCalledTimes(1);
  });

  it('shows what Threads said when the person cancels', async () => {
    const { agent, state } = await startLogin();
    const res = await agent.get(
      `/admin/threads/callback?error=access_denied&error_description=Permissions+error&state=${state}`);
    expect(res.status).toBe(400);
    expect(res.text).toContain('Permissions error');
    expect(threads.exchangeCode).not.toHaveBeenCalled();
  });

  it('reports a refusal from Threads on the page and stores nothing', async () => {
    threads.me.mockRejectedValue(new threads.ThreadsError('Threads refused the account lookup: nope'));
    const { agent, state } = await startLogin();
    const res = await agent.get(`/admin/threads/callback?code=abc123&state=${state}`);
    expect(res.status).toBe(502);
    expect(res.text).toContain('Threads refused the account lookup');
    expect(SocialToken.saveLogin).not.toHaveBeenCalled();
  });
});

describe('the refresh', () => {
  const refresh = () => request(app).post('/admin/threads/refresh').set('X-Social-Token', SOCIAL);

  it('refuses an anonymous caller with 403, not a redirect', async () => {
    mockCurrentUser = null;
    const res = await request(app).post('/admin/threads/refresh');
    expect(res.status).toBe(403);
    expect(res.headers.location).toBeUndefined();
    expect(SocialToken.withToken).not.toHaveBeenCalled();
  });

  it('renews the token, guarded on the generation it read, and reports the stored expiry', async () => {
    mockCurrentUser = null;
    SocialToken.withToken.mockResolvedValue(row());
    const stored = new Date(Date.now() + 60 * DAY);
    SocialToken.status.mockResolvedValue(row({ expiresAt: stored }));

    const res = await refresh();
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, refreshed: true, caller: 'scheduler' });
    expect(res.body.daysLeft).toBeGreaterThanOrEqual(59);
    expect(threads.refresh).toHaveBeenCalledWith('THAA-stored-token');
    expect(SocialToken.saveRefresh).toHaveBeenCalledWith('threads', {
      token: 'THAA-refreshed', expiresIn: 5184000, generation: 3, updatedBy: 'scheduler',
    });
    // Never the token itself in the reply.
    expect(JSON.stringify(res.body)).not.toContain('THAA');
  });

  it('does nothing, successfully, when no account is connected', async () => {
    const res = await refresh();
    expect(res.status).toBe(200);
    expect(res.body.skipped).toMatch(/no Threads account/);
    expect(threads.refresh).not.toHaveBeenCalled();
  });

  it('leaves a token under 24 hours old alone, because Threads would refuse it', async () => {
    SocialToken.withToken.mockResolvedValue(row({ obtainedAt: new Date(Date.now() - 2 * 60 * 60 * 1000) }));
    const res = await refresh();
    expect(res.status).toBe(200);
    expect(res.body.skipped).toMatch(/24 hours/);
    expect(threads.refresh).not.toHaveBeenCalled();
  });

  it('fails loudly on an expired token, and records why', async () => {
    SocialToken.withToken.mockResolvedValue(row({ expiresAt: new Date(Date.now() - DAY) }));
    const res = await refresh();
    expect(res.status).toBe(409);
    expect(res.body.ok).toBe(false);
    expect(threads.refresh).not.toHaveBeenCalled();
    expect(SocialToken.recordError).toHaveBeenCalledWith('threads', expect.stringMatching(/expired/));
  });

  it('fails loudly when Threads refuses, records the reason, and keeps the old token', async () => {
    SocialToken.withToken.mockResolvedValue(row());
    threads.refresh.mockRejectedValue(new threads.ThreadsError('Threads refused the token refresh: bad'));
    const res = await refresh();
    expect(res.status).toBe(502);
    expect(res.body.error).toContain('bad');
    expect(SocialToken.recordError).toHaveBeenCalledWith('threads', 'Threads refused the token refresh: bad');
    expect(SocialToken.saveRefresh).not.toHaveBeenCalled();
  });

  it('says so when a login replaced the token while it ran', async () => {
    SocialToken.withToken.mockResolvedValue(row());
    SocialToken.saveRefresh.mockResolvedValue(0);
    const res = await refresh();
    expect(res.status).toBe(200);
    expect(res.body.refreshed).toBeUndefined();
    expect(res.body.skipped).toMatch(/replaced by a login/);
  });

  it('sends the page button back to the page with a notice', async () => {
    SocialToken.withToken.mockResolvedValue(row());
    SocialToken.status.mockResolvedValue(row());
    const res = await request(app).post('/admin/threads/refresh').type('form').send({ from: 'page' });
    expect(res.status).toBe(303);
    expect(res.headers.location).toBe('/admin/threads?notice=refreshed');
    expect(SocialToken.saveRefresh).toHaveBeenCalledWith('threads',
      expect.objectContaining({ updatedBy: expect.not.stringMatching(/^scheduler$/) }));
  });
});
