// `GET /fixture/outstanding` sends email, and until 15 Sep 2026 anyone could call it.
//
// The route runs `Fixture.getCardsDueToday()` and mails every fixture played six days ago
// with no result, to two hardcoded addresses. It carried no gate at all: no `secured`, no
// token, not even a rate limiter. Anyone who knew the URL could make the league email
// itself as often as they liked.
//
// It is NOT an open relay — the recipients are derived server-side, which is the rule
// `/fixture/reminder` broke — so the exposure is a free, unattributable send rather than
// mail to a stranger. That is still worth closing, and it costs one line, because the gate
// already exists: `middleware/requireCronCaller.js`, built for HARD-23 and now on its
// fourth caller.
//
// Found while surveying what Make.com actually does for this league. The scenario named
// "late scorecards" contains exactly one module — an HTTP GET of this URL, daily at 09:00 —
// so the endpoint was ungated because the thing calling it could not authenticate.
//
// What these tests pin, in order of how badly each has gone wrong before in this repo:
//
//   1. an anonymous caller gets 403 and NO email is sent;
//   2. the refusal is a 403, never a 302 — `secured`'s redirect to /login is what Make.com
//      recorded as a successful invoice run for a year (HARD-23);
//   3. an UNSET token closes the path rather than opening it, so an unconfigured deploy
//      does not republish the endpoint;
//   4. a valid token gets through and the mail goes.

process.env.NODE_ENV = 'test';

jest.mock('../../utils/mailer', () => ({
  send: jest.fn().mockResolvedValue({ messageId: 'test' }),
  RESULTS_MAILBOX: 'results@stockport-badminton.co.uk',
}));

jest.mock('../../models/fixture', () => ({
  getCardsDueToday: jest.fn().mockResolvedValue([
    { date: '2026-09-09', homeTeam: 'Mellor B', awayTeam: 'Tatton A' },
  ]),
}));

const request = require('supertest');
const app = require('../../app');
const mailer = require('../../utils/mailer');
const Fixture = require('../../models/fixture');

const TOKEN = 'a-test-token-that-is-not-real';

// The controller says nothing out of season (months 4..6 inclusive, zero-based), and this
// suite must not pass or fail on the date it happens to run. Pin it into the window.
let clock;
beforeAll(() => {
  clock = jest.spyOn(Date.prototype, 'getMonth').mockReturnValue(8); // September
});
afterAll(() => clock.mockRestore());

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.LATE_SCORECARD_CRON_TOKEN;
});

describe('GET /fixture/outstanding is gated', () => {
  it('refuses an anonymous caller and sends nothing', async () => {
    process.env.LATE_SCORECARD_CRON_TOKEN = TOKEN;

    const res = await request(app).get('/fixture/outstanding');

    expect(res.status).toBe(403);
    expect(mailer.send).not.toHaveBeenCalled();
    // The reminder must not even be assembled for a caller who cannot have it.
    expect(Fixture.getCardsDueToday).not.toHaveBeenCalled();
  });

  it('refuses with 403, not a redirect to /login', async () => {
    // HARD-23's lesson, and the reason this uses requireCronCaller rather than `secured`:
    // an HTTP client that follows redirects reads a 302 to Auth0 as a successful run. The
    // invoices went unsent for a year behind exactly that.
    process.env.LATE_SCORECARD_CRON_TOKEN = TOKEN;

    const res = await request(app).get('/fixture/outstanding');

    expect(res.status).toBe(403);
    expect(res.status).not.toBe(302);
    expect(res.headers.location).toBeUndefined();
  });

  it('refuses a wrong token', async () => {
    process.env.LATE_SCORECARD_CRON_TOKEN = TOKEN;

    const res = await request(app)
      .get('/fixture/outstanding')
      .set('X-Late-Scorecard-Token', 'not-the-token');

    expect(res.status).toBe(403);
    expect(mailer.send).not.toHaveBeenCalled();
  });

  it('an UNSET token closes the path rather than opening it', async () => {
    // "Empty secret matches empty header" is how an unconfigured deploy becomes a public
    // endpoint again. Both the empty header and a plausible one must fail.
    delete process.env.LATE_SCORECARD_CRON_TOKEN;

    const blank = await request(app)
      .get('/fixture/outstanding')
      .set('X-Late-Scorecard-Token', '');
    expect(blank.status).toBe(403);

    const anything = await request(app)
      .get('/fixture/outstanding')
      .set('X-Late-Scorecard-Token', TOKEN);
    expect(anything.status).toBe(403);

    expect(mailer.send).not.toHaveBeenCalled();
  });

  it('lets the scheduler through and sends the reminder', async () => {
    process.env.LATE_SCORECARD_CRON_TOKEN = TOKEN;

    const res = await request(app)
      .get('/fixture/outstanding')
      .set('X-Late-Scorecard-Token', TOKEN);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, sent: true, fixtures: 1 });
    expect(mailer.send).toHaveBeenCalledTimes(1);

    // The recipients come from the code, never from the request — the property that keeps
    // this a free send rather than an open relay, and the one worth asserting because it
    // is what `/fixture/reminder` got wrong.
    const sent = mailer.send.mock.calls[0][0];
    expect(sent.to).toEqual([
      'stockport.badders.results@gmail.com',
      'bigcoops@outlook.com',
    ]);
  });

  it('a day with nothing outstanding still answers 200 and sends nothing', async () => {
    // Guarding the fix recorded in the controller: `params` was once only built inside
    // `if (row.length > 0)`, so an empty day threw and the daily job failed precisely when
    // everything was in order.
    process.env.LATE_SCORECARD_CRON_TOKEN = TOKEN;
    Fixture.getCardsDueToday.mockResolvedValueOnce([]);

    const res = await request(app)
      .get('/fixture/outstanding')
      .set('X-Late-Scorecard-Token', TOKEN);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, sent: false });
    expect(mailer.send).not.toHaveBeenCalled();
  });
});
