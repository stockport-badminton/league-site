// middleware/access.js — each level wraps an existing gate, so these check the wrapping:
// that a level admits and refuses whom its gate does, and that composition keeps Express's
// next(err) / next('route') semantics.

const access = require('../../middleware/access');
const requireCronCaller = require('../../middleware/requireCronCaller');

const ROLE = 'https://my-app.example.com/role';
const CLUB = 'https://my-app.example.com/club';
const MESSER = 'https://my-app.example.com/messeradmin';

function user(json) { return { _json: json }; }

function req(over = {}) {
  return {
    isAuthenticated: () => !!over.user,
    originalUrl: '/x',
    query: {},
    session: {},
    params: {},
    get: () => undefined,
    ...over,
  };
}

function res() {
  const r = { redirected: null, statusCode: 200 };
  r.redirect = url => { r.redirected = url; };
  r.status = c => { r.statusCode = c; return r; };
  r.json = () => r;
  r.set = () => r;
  return r;
}

// Resolves with what the middleware passed to next ('ok' for a bare next()), or 'redirect'.
function run(mw, rq) {
  return new Promise(resolve => {
    const rs = res();
    rs.redirect = () => resolve('redirect');
    mw(rq, rs, arg => resolve(arg === undefined ? 'ok' : arg));
  });
}

const SUPER = user({ [ROLE]: 'superadmin', [CLUB]: 'All' });
const CAPTAIN = user({ [ROLE]: 'admin', [CLUB]: 'Dome' });
const MESSER_ADMIN = user({ [ROLE]: 'admin', [CLUB]: 'Dome', [MESSER]: true });

const savedEnv = { ...process.env };
afterEach(() => { process.env = { ...savedEnv }; });

it('tags every level for the route table', () => {
  expect(access.public.access).toBe('public');
  expect(access.member.access).toBe('member');
  expect(access.superadmin.access).toBe('superadmin');
  expect(access.messerAdmin.access).toBe('messerAdmin');
  expect(access.clubScoped.access).toBe('clubScoped');
  expect(access.publish.access).toBe('publish');
  expect(access.sns.access).toBe('sns');
  expect(access.devOnly.access).toBe('devOnly');
  expect(access.token('draft link').access).toBe('token:draft link');
});

it('public admits anyone', async () => {
  expect(await run(access.public, req())).toBe('ok');
});

it('member sends an anonymous visitor to log in, and admits a member', async () => {
  expect(await run(access.member, req())).toBe('redirect');
  expect(await run(access.member, req({ user: CAPTAIN }))).toBe('ok');
});

describe('superadmin', () => {
  it('sends an anonymous visitor to log in before asking about the role', async () => {
    expect(await run(access.superadmin, req())).toBe('redirect');
  });
  it('refuses a captain with a 403', async () => {
    const out = await run(access.superadmin, req({ user: CAPTAIN }));
    expect(out).toBeInstanceOf(Error);
    expect(out.status).toBe(403);
  });
  it('admits the superadmin', async () => {
    expect(await run(access.superadmin, req({ user: SUPER }))).toBe('ok');
  });
});

it('messerAdmin admits the superadmin and a messeradmin, refuses a captain', async () => {
  expect(await run(access.messerAdmin, req({ user: SUPER }))).toBe('ok');
  expect(await run(access.messerAdmin, req({ user: MESSER_ADMIN }))).toBe('ok');
  expect((await run(access.messerAdmin, req({ user: CAPTAIN }))).status).toBe(403);
});

it('clubScoped admits a captain for their own club only', async () => {
  expect(await run(access.clubScoped, req({ user: CAPTAIN, params: { club: 'Dome' } }))).toBe('ok');
  expect((await run(access.clubScoped, req({ user: CAPTAIN, params: { club: 'Shell' } }))).status).toBe(403);
  expect(await run(access.clubScoped, req({ user: SUPER, params: { club: 'Shell' } }))).toBe('ok');
});

it('devOnly falls through to the 404 outside a dev server, through the wrapper', async () => {
  process.env.DEV_MODE = 'false';
  expect(await run(access.devOnly, req())).toBe('route');
  process.env.DEV_MODE = 'true';
  process.env.NODE_ENV = 'development';
  expect(await run(access.devOnly, req())).toBe('ok');
});

describe('cron', () => {
  const gate = requireCronCaller({ envVar: 'TEST_ACCESS_TOKEN', header: 'x-test', describe: 'a test', callerProp: 'testCaller' });

  it('is tagged with the token it checks', () => {
    expect(access.cron(gate).access).toBe('cron:TEST_ACCESS_TOKEN');
  });
  it('refuses to label anything requireCronCaller did not build', () => {
    expect(() => access.cron((rq, rs, next) => next())).toThrow(/requireCronCaller/);
  });
  it('admits the token, refuses without it', async () => {
    process.env.TEST_ACCESS_TOKEN = 's3cret';
    const ok = req({ get: h => (h === 'x-test' ? 's3cret' : undefined) });
    expect(await run(access.cron(gate), ok)).toBe('ok');
    expect(ok.testCaller).toBe('scheduler');
    expect((await run(access.cron(gate), req())).status).toBe(403);
  });
});

it('token() insists on saying which token', () => {
  expect(() => access.token()).toThrow();
});

describe('compose', () => {
  it('runs in order and stops at the first error', async () => {
    const seen = [];
    const mw = access.compose([
      (rq, rs, next) => { seen.push(1); next(); },
      (rq, rs, next) => { seen.push(2); next(new Error('no')); },
      (rq, rs, next) => { seen.push(3); next(); },
    ]);
    expect((await run(mw, req())).message).toBe('no');
    expect(seen).toEqual([1, 2]);
  });
  it("passes next('route') straight out", async () => {
    const mw = access.compose([(rq, rs, next) => next('route'), () => { throw new Error('ran'); }]);
    expect(await run(mw, req())).toBe('route');
  });
  it('turns a throw or a rejected promise into next(err)', async () => {
    expect((await run(access.compose([() => { throw new Error('sync'); }]), req())).message).toBe('sync');
    expect((await run(access.compose([async () => { throw new Error('async'); }]), req())).message).toBe('async');
  });
});
