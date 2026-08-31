const request = require('supertest');

// The 500 page (HARD-06 / FAIL-4, OPS-6).
//
// It used to render `<%= error %>`. A `pg` error stringifies with its message, and a pg
// message is made of the schema: `relation "scorecardstore" does not exist`, `column
// player.authemail does not exist`, whole fragments of the failing statement. So every
// failed request printed a little more of the database to whoever tripped it, and the
// member who tripped it got a developer's error string instead of an answer.
//
// Escaping is not the fix and never was. `<%= %>` escapes for HTML, so the double quotes
// in `relation "fixture" does not exist` came out as `&#34;` — which is enough to fool a
// substring assertion while the table name sits there in plain sight. The tests below
// check the escaped spelling as well as the raw one for exactly that reason.
//
// The other half of the package is the reference code. This site is meant to be runnable
// by someone non-technical: "I saw error 7F2A1B" has to be one Sentry search away, which
// means the code has to be on the page AND on the Sentry event as a *tag* — tags are
// indexed and searchable, extra context is not.

jest.mock('@sentry/node', () => ({
  init: jest.fn(),
  captureException: jest.fn(),
  flush: jest.fn().mockResolvedValue(true),
  setupExpressErrorHandler: jest.fn(),
}));

jest.mock('../../models/fixture');
jest.mock('../../models/players');
jest.mock('../../models/teams');
jest.mock('../../models/club');
jest.mock('../../models/division');

jest.mock('../../db_connect', () => ({
  connect: jest.fn(),
  end: jest.fn().mockResolvedValue(undefined),
  otherConnect: jest.fn(() => Promise.resolve({
    query: jest.fn(() => Promise.resolve([[]]))
  })),
  withTransaction: jest.fn(fn => fn({ query: jest.fn(() => Promise.resolve([[]])) })),
  isObject: jest.fn(obj => obj === Object(obj)),
}));

jest.mock('../../middleware/secured', () => (req, res, next) => next());

const Sentry = require('@sentry/node');
const Fixture = require('../../models/fixture');
const Player = require('../../models/players');
const app = require('../../app');

const CLOUD_RUN_HOST = 'league-site-akvq7tsxuq-nw.a.run.app';

// A realistic pg failure: the message names a table, two columns and part of the
// statement, and carries the pg error properties alongside.
function pgError() {
  const err = new Error('relation "scorecardstore" does not exist');
  err.code = '42P01';
  err.severity = 'ERROR';
  err.routine = 'parserOpenTable';
  err.query = 'SELECT s."homeTeam", s."awayScore" FROM scorecardstore s WHERE s.id = $1';
  return err;
}

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&#34;').replace(/'/g, '&#39;');
}

// The code as the page presents it. Marked up so a support conversation and a test can
// both find it without guessing at prose.
function referenceFrom(html) {
  const m = html.match(/<code[^>]*class="[^"]*error-reference[^"]*"[^>]*>\s*([0-9A-F]+)\s*<\/code>/);
  return m && m[1];
}

async function failingRequest(host) {
  Fixture.getAll.mockRejectedValue(pgError());
  const req = request(app).get('/fixtures');
  if (host) req.set('Host', host);
  return req;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('the 500 page keeps the error out of the HTML', () => {
  it('answers 500', async () => {
    const res = await failingRequest();
    expect(res.status).toBe(500);
  });

  it('contains no part of the pg message, raw or escaped', () => {
    // Split out so a failure names which fragment leaked.
    return failingRequest().then(res => {
      const leaks = [
        'relation "scorecardstore" does not exist',
        'scorecardstore',
        'does not exist',
        '42P01',
        'parserOpenTable',
      ];
      for (const leak of leaks) {
        expect(res.text).not.toContain(leak);
        expect(res.text).not.toContain(escapeHtml(leak));
      }
    });
  });

  it('contains no SQL fragment from the failing statement', async () => {
    const res = await failingRequest();
    for (const frag of ['homeTeam', 'awayScore', 'FROM scorecardstore', 'WHERE s.id']) {
      expect(res.text).not.toContain(frag);
      expect(res.text).not.toContain(escapeHtml(frag));
    }
  });

  it('contains no stack trace', async () => {
    const res = await failingRequest();
    expect(res.text).not.toContain('__tests__');
    expect(res.text).not.toMatch(/\bat [A-Za-z_$][\w$.]* \(/);
    expect(res.text).not.toMatch(/\.js:\d+:\d+/);
  });

  it('does not put the error in an HTML comment or a data- attribute either', async () => {
    const res = await failingRequest();
    const comments = res.text.match(/<!--[\s\S]*?-->/g) || [];
    for (const c of comments) expect(c).not.toContain('scorecardstore');
    const dataAttrs = res.text.match(/data-[\w-]+="[^"]*"/g) || [];
    for (const d of dataAttrs) expect(d).not.toContain('scorecardstore');
  });

  it('still tells the visitor what happened and what to do', async () => {
    const res = await failingRequest();
    // Not the wording, the job the wording has to do: name the problem, and give a
    // route to a human that is not "check the logs".
    expect(res.text).toMatch(/something went wrong/i);
    expect(res.text).toContain('/contact-us');
    // Nothing a visitor cannot act on. (`\blog\b` would match the nav's "Log in".)
    expect(res.text).not.toMatch(/check the (server )?logs?/i);
    expect(res.text).not.toMatch(/stack trace/i);
  });
});

describe('the reference code', () => {
  it('appears on the page', async () => {
    const res = await failingRequest();
    expect(referenceFrom(res.text)).toMatch(/^[0-9A-F]{6}$/);
  });

  it('is the same code Sentry is tagged with', async () => {
    const res = await failingRequest();
    const shown = referenceFrom(res.text);

    expect(Sentry.captureException).toHaveBeenCalled();
    const [err, hint] = Sentry.captureException.mock.calls[0];
    expect(err.message).toContain('scorecardstore');
    // A *tag*, not extra context — extra is not searchable, so "I saw error 7F2A1B"
    // would still be untraceable.
    expect(hint).toBeDefined();
    expect(hint.tags).toBeDefined();
    expect(hint.tags.reference).toBe(shown);
  });

  it('is different for a different failure, so a code names one event', async () => {
    const a = referenceFrom((await failingRequest()).text);
    const b = referenceFrom((await failingRequest()).text);
    expect(a).not.toBe(b);
  });

  it('reaches the JSON handler too, so an /api/ caller can quote one', async () => {
    // The JSON handler runs before the HTML one for /api/ paths and must keep doing so —
    // a fetch() caller getting a rendered page back can only report "Save failed".
    Player.searchPlayers.mockRejectedValue(pgError());
    const res = await request(app).get('/api/players/search?q=smith');

    expect(res.status).toBe(500);
    expect(res.headers['content-type']).toMatch(/json/);
    expect(JSON.stringify(res.body)).not.toContain('scorecardstore');

    const ref = res.body.reference;
    expect(ref).toMatch(/^[0-9A-F]{6}$/);
    const [, hint] = Sentry.captureException.mock.calls[0];
    expect(hint.tags.reference).toBe(ref);
  });

  it('does not spend a reference or a Sentry event on a 4xx from /api/', async () => {
    // 4xx messages are written deliberately by this code and are passed through to the
    // editor's toast; they are not faults and must not become Sentry events.
    const err = new Error('Priya Ramanathan is registered to College Green.');
    err.status = 409;
    Player.searchPlayers.mockRejectedValue(err);
    const res = await request(app).get('/api/players/search?q=smith');

    expect(res.status).toBe(409);
    expect(res.body.error).toContain('College Green');
    expect(res.body.reference).toBeUndefined();
    expect(Sentry.captureException).not.toHaveBeenCalled();
  });
});

describe('the error pages under a spoofed Host', () => {
  // Firebase Hosting rewrites to Cloud Run and the Host header that arrives is the Cloud
  // Run one, so a canonical built from req.get('host') declares the authoritative copy
  // of the page to live on league-site-...run.app — which serves the whole site publicly.
  // CLAUDE.md gotcha 1b; utils/canonical.js exists to retire the pattern.
  it('500: canonical is the public origin', async () => {
    const res = await failingRequest(CLOUD_RUN_HOST);
    expect(res.text).not.toContain('run.app');
    expect(res.text).toContain('https://stockport-badminton.co.uk/fixtures');
  });

  it('404: canonical is the public origin', async () => {
    const res = await request(app).get('/no-such-page').set('Host', CLOUD_RUN_HOST);
    expect(res.status).toBe(404);
    expect(res.text).not.toContain('run.app');
    expect(res.text).toContain('https://stockport-badminton.co.uk/no-such-page');
  });

  it('4xx via the error handler: canonical is the public origin', async () => {
    // The other branch of the HTML handler: an error carrying a 4xx status (a junk
    // season from models/season.js, assertClubAccess's 403) renders 404/403, not 500.
    const err = new Error('invalid season name: "20252027 AS team WHERE false --"');
    err.status = 404;
    Fixture.getAll.mockRejectedValue(err);

    const res = await request(app).get('/fixtures').set('Host', CLOUD_RUN_HOST);

    expect(res.status).toBe(404);
    expect(res.text).not.toContain('run.app');
    expect(res.text).toContain('https://stockport-badminton.co.uk/fixtures');
    // A bad request is not a fault of ours, so it still must not spend a Sentry event.
    expect(Sentry.captureException).not.toHaveBeenCalled();
  });
});
