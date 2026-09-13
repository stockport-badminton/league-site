const request = require('supertest');

// The annual club invoice send.
//
// These endpoints were unauthenticated. The only thing standing between the open
// internet and an invoice run was a check that today happens to be the annual invoice
// date — so on that one day of the year, any caller could send every club its invoice,
// repeatedly, from our own verified sending domain. Duplicate invoices to club
// treasurers is a credibility problem rather than a technical one, which is exactly the
// kind that goes unnoticed until it has happened.
//
// `secured` is mocked so the same route can be exercised anonymously, as a club admin,
// and as the results secretary.

let mockCurrentUser = null;

jest.mock('../../middleware/secured', () => (req, res, next) => {
  if (mockCurrentUser) req.user = mockCurrentUser;
  next();
});

// The send endpoints are no longer `secured` — they take a superadmin session OR the
// Cloud Scheduler token, and answer 403 rather than redirecting, because a redirect is
// what Make.com recorded as a successful run (HARD-23). So `req.user` has to arrive the
// way it does in production on an unsecured route: from the global `passport.session()`.
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

jest.mock('../../models/league');
jest.mock('../../utils/ses');

jest.mock('../../db_connect', () => ({
  connect: jest.fn(),
  otherConnect: jest.fn(() => Promise.resolve({
    query: jest.fn(() => Promise.resolve([[], []]))
  })),
  withTransaction: jest.fn(fn => fn({ query: jest.fn(() => Promise.resolve([[]])) })),
  isObject: jest.fn(obj => obj === Object(obj)),
}));

const League = require('../../models/league');
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

beforeEach(() => {
  jest.clearAllMocks();
  mockCurrentUser = null;
  League.getAnnualInvoices.mockResolvedValue([]);
});

describe('POST /league/sendInvoices', () => {
  it('refuses an anonymous caller', async () => {
    const res = await request(app).post('/league/sendInvoices').send({});
    // 403, NOT a redirect. `secured` answered 302 to /login, Make.com's HTTP module
    // followed it, got a 200 from Auth0 and recorded a successful run — which is how the
    // 1 Sep 2026 invoice send failed in silence for a year (HARD-23).
    expect(res.status).toBe(403);
    expect(res.headers.location).toBeUndefined();
    // The important part: it never reached the handler, so nothing was sent and the
    // club list was never even read.
    expect(League.getAnnualInvoices).not.toHaveBeenCalled();
    expect(ses.sendEmail).not.toHaveBeenCalled();
  });

  it('refuses a club admin — this is the results secretary’s job', async () => {
    mockCurrentUser = CLUB_ADMIN;
    const res = await request(app).post('/league/sendInvoices').send({});
    expect(res.status).toBe(403);
    expect(League.getAnnualInvoices).not.toHaveBeenCalled();
    expect(ses.sendEmail).not.toHaveBeenCalled();
  });

  it('lets the results secretary through', async () => {
    mockCurrentUser = SUPERADMIN;
    await request(app).post('/league/sendInvoices').send({});
    // Reaching the model is the assertion. Whether anything is actually emailed is
    // still governed by the date check inside the handler, which is deliberately
    // left alone — it is now a safety net rather than the only control.
    expect(League.getAnnualInvoices).toHaveBeenCalled();
  });
});

describe('POST /league/sendInvoice/:club', () => {
  it('refuses an anonymous caller', async () => {
    const res = await request(app).post('/league/sendInvoice/43').send({});
    expect(res.status).not.toBe(200);
    expect(League.getAnnualInvoices).not.toHaveBeenCalled();
    expect(ses.sendEmail).not.toHaveBeenCalled();
  });

  it('refuses a club admin, even for their own club', async () => {
    mockCurrentUser = CLUB_ADMIN;
    const res = await request(app).post('/league/sendInvoice/43').send({});
    expect(res.status).toBe(403);
    expect(ses.sendEmail).not.toHaveBeenCalled();
  });

  it('lets the results secretary through', async () => {
    mockCurrentUser = SUPERADMIN;
    await request(app).post('/league/sendInvoice/43').send({});
    expect(League.getAnnualInvoices).toHaveBeenCalledWith('43');
  });
});

// --- the invoice body ------------------------------------------------
//
// Every test above mocks getAnnualInvoices to `[]`, so the loop never runs, the
// template is never rendered and nothing about the data contract is exercised. That is
// how the 1 Sep 2026 send went out reading "£NaN": commit b3b8efd renamed the fee column
// to season."clubFee" in the query and left the controller reading `club.teamFee`.
// `undefined` multiplied by anything is NaN, EJS prints NaN without complaint, and all 18
// clubs were invoiced for £NaN.
//
// These rows use the column names the query actually returns. Mocking a shape the model
// does not produce is the same mistake in a different costume — see the insertId note in
// CLAUDE.md.
describe('POST /league/sendInvoices — the numbers in the email', () => {
  // Exactly as models/league.js getAnnualInvoices aliases them.
  const row = (over = {}) => Object.assign({
    clubId: 1,
    clubName: 'Mellor',
    teamsCount: '2',        // count() comes back as a string
    fineId: null,
    desc: null,
    amount: null,
    fineTeam: null,
    fineClub: null,
    season: null,
    secretary: 'John',
    playerEmail: 'sec@example.com',
    clubFee: '15',          // bigint, also a string
  }, over);

  const sentHtml = () => ses.sendEmail.mock.calls[0][0].Message.Body.Html.Data;

  beforeEach(() => {
    mockCurrentUser = SUPERADMIN;
    ses.sendEmail.mockResolvedValue({});
    jest.useFakeTimers().setSystemTime(new Date('2026-09-01T09:00:00Z'));
  });
  afterEach(() => jest.useRealTimers());

  it('bills teams at the season fee instead of NaN', async () => {
    League.getAnnualInvoices.mockResolvedValue([row()]);

    const res = await request(app).post('/league/sendInvoices');

    expect(res.status).toBe(200);
    expect(ses.sendEmail).toHaveBeenCalledTimes(1);
    const html = sentHtml();
    expect(html).not.toMatch(/NaN/);
    expect(html).toContain('£30');       // 2 teams x £15
  });

  it('adds fines to the total', async () => {
    League.getAnnualInvoices.mockResolvedValue([
      row({ fineId: 9, desc: 'card', amount: 10 }),
    ]);

    await request(app).post('/league/sendInvoices');

    const html = sentHtml();
    expect(html).not.toMatch(/NaN/);
    expect(html).toContain('£40');       // 30 + 10
  });

  it('refuses to mail a club whose total will not compute', async () => {
    // The exact failure of 1 Sep 2026: the fee column absent under the expected name.
    League.getAnnualInvoices.mockResolvedValue([row({ clubFee: undefined })]);

    const res = await request(app).post('/league/sendInvoices');

    expect(ses.sendEmail).not.toHaveBeenCalled();
    expect(res.body.join(' ')).toMatch(/NOT sent/);
  });

  it('a broken club does not stop the others being invoiced', async () => {
    League.getAnnualInvoices.mockResolvedValue([
      row({ clubId: 1, clubName: 'Broken', clubFee: undefined }),
      row({ clubId: 2, clubName: 'Fine' }),
    ]);

    await request(app).post('/league/sendInvoices');

    expect(ses.sendEmail).toHaveBeenCalledTimes(1);
    expect(ses.sendEmail.mock.calls[0][0].Message.Subject.Data).toContain('Fine');
  });
});


// ---------------------------------------------------------------------------
// Who may run it — HARD-23
// ---------------------------------------------------------------------------
//
// The gate is middleware/requireCronCaller.js, shared with the weekly audit and the daily
// registration reminder. The acceptance criteria for this package name these cases
// explicitly, because the failure they describe was invisible for a year.

describe('POST /league/sendInvoices — the scheduler token', () => {
  const TOKEN = 'invoice-cron-token-for-tests';

  beforeEach(() => {
    // Set per-test, never in setup.js: a set cron token is one of the shapes
    // utils/testEnvGuard.js refuses a whole run for, and INVOICE_CRON_TOKEN is now on
    // that list alongside the audit and registration ones.
    process.env.INVOICE_CRON_TOKEN = TOKEN;
    ses.sendEmail.mockResolvedValue({});
    jest.useFakeTimers().setSystemTime(new Date('2026-09-01T09:00:00Z'));
  });
  afterEach(() => {
    delete process.env.INVOICE_CRON_TOKEN;
    jest.useRealTimers();
  });

  it('accepts the correct token with no session at all', async () => {
    League.getAnnualInvoices.mockResolvedValue([]);

    const res = await request(app)
      .post('/league/sendInvoices')
      .set('X-Invoice-Token', TOKEN);

    // 409 because there is nothing to invoice — but it got PAST the gate, which is what
    // this asserts. Make.com never did.
    expect(res.status).toBe(409);
    expect(League.getAnnualInvoices).toHaveBeenCalled();
  });

  it('refuses a wrong token, without redirecting', async () => {
    const res = await request(app)
      .post('/league/sendInvoices')
      .set('X-Invoice-Token', 'not-the-token');

    expect(res.status).toBe(403);
    expect(res.headers.location).toBeUndefined();
    expect(League.getAnnualInvoices).not.toHaveBeenCalled();
    expect(ses.sendEmail).not.toHaveBeenCalled();
  });

  // The property that matters most, and the one an unconfigured deploy gets wrong: an
  // empty expected secret must not match an empty presented one.
  it('refuses everyone when the token is unset, rather than admitting everyone', async () => {
    delete process.env.INVOICE_CRON_TOKEN;

    const res = await request(app)
      .post('/league/sendInvoices')
      .set('X-Invoice-Token', '');

    expect(res.status).toBe(403);
    expect(League.getAnnualInvoices).not.toHaveBeenCalled();
  });
});

describe('POST /league/sendInvoices — the date window', () => {
  const row = {
    clubId: 1, clubName: 'Mellor', teamsCount: '2', fineId: null, desc: null,
    amount: null, fineTeam: null, fineClub: null, season: null,
    secretary: 'John', playerEmail: 'sec@example.com', clubFee: '15',
  };

  beforeEach(() => {
    mockCurrentUser = SUPERADMIN;
    ses.sendEmail.mockResolvedValue({});
    League.getAnnualInvoices.mockResolvedValue([row]);
  });
  afterEach(() => jest.useRealTimers());

  it('still sends three days either side of the annual date', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-09-03T09:00:00Z'));

    const res = await request(app).post('/league/sendInvoices');

    expect(res.status).toBe(200);
    expect(ses.sendEmail).toHaveBeenCalledTimes(1);
  });

  // The refusal must be a NON-2xx. It used to be `res.send(["not the right date"])` — a
  // 200 whose body is the error — so a caller that checks only the status saw a success.
  it('refuses well outside the window with a non-2xx that says why', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-11-20T09:00:00Z'));

    const res = await request(app).post('/league/sendInvoices');

    expect(res.status).toBe(409);
    expect(res.status).not.toBe(200);
    expect(res.body.join(' ')).toMatch(/not the right date/i);
    expect(ses.sendEmail).not.toHaveBeenCalled();
  });

  it('lets a superadmin override the window explicitly', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-11-20T09:00:00Z'));

    const res = await request(app).post('/league/sendInvoices').send({ force: 'true' });

    expect(res.status).toBe(200);
    expect(ses.sendEmail).toHaveBeenCalledTimes(1);
  });

  // A scheduler firing on the wrong day is a misconfiguration. Letting its token force
  // the run would hide precisely the thing worth knowing about.
  it('does NOT let the scheduler token override the window', async () => {
    process.env.INVOICE_CRON_TOKEN = 'invoice-cron-token-for-tests';
    mockCurrentUser = null;
    jest.useFakeTimers().setSystemTime(new Date('2026-11-20T09:00:00Z'));

    const res = await request(app)
      .post('/league/sendInvoices')
      .set('X-Invoice-Token', 'invoice-cron-token-for-tests')
      .send({ force: 'true' });

    expect(res.status).toBe(409);
    expect(ses.sendEmail).not.toHaveBeenCalled();

    delete process.env.INVOICE_CRON_TOKEN;
  });

  it('refuses with a non-2xx when there is nothing to invoice', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-09-01T09:00:00Z'));
    League.getAnnualInvoices.mockResolvedValue([]);

    const res = await request(app).post('/league/sendInvoices');

    expect(res.status).toBe(409);
    expect(res.body.join(' ')).toMatch(/nothing was sent/i);
    expect(ses.sendEmail).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Admin → Invoices (HARD-23)
// ---------------------------------------------------------------------------
//
// There was no trigger for this anywhere in the app, so the recovery on the night was a
// fetch() typed into devtools. This page is the button, and the confirmation is there
// because the same run went out twice that evening.

describe('GET /admin/invoices', () => {
  it('refuses a club admin', async () => {
    mockCurrentUser = CLUB_ADMIN;
    const res = await request(app).get('/admin/invoices');
    expect(res.status).toBe(403);
  });

  it('shows the results secretary where today sits relative to the annual date', async () => {
    mockCurrentUser = SUPERADMIN;
    jest.useFakeTimers().setSystemTime(new Date('2026-11-20T09:00:00Z'));

    const res = await request(app).get('/admin/invoices');

    expect(res.status).toBe(200);
    expect(res.text).toMatch(/Outside the invoice window/i);
    expect(res.text).toMatch(/Send annual invoices to every club/i);
    expect(ses.sendEmail).not.toHaveBeenCalled();

    jest.useRealTimers();
  });
});

describe('POST /admin/invoices', () => {
  const row = {
    clubId: 1, clubName: 'Mellor', teamsCount: '2', fineId: null, desc: null,
    amount: null, fineTeam: null, fineClub: null, season: null,
    secretary: 'John', playerEmail: 'sec@example.com', clubFee: '15',
  };

  beforeEach(() => {
    mockCurrentUser = SUPERADMIN;
    ses.sendEmail.mockResolvedValue({});
    League.getAnnualInvoices.mockResolvedValue([row]);
    jest.useFakeTimers().setSystemTime(new Date('2026-09-01T09:00:00Z'));
  });
  afterEach(() => jest.useRealTimers());

  it('sends nothing without the typed confirmation', async () => {
    const res = await request(app).post('/admin/invoices').send({});

    expect(res.status).toBe(400);
    expect(ses.sendEmail).not.toHaveBeenCalled();
    expect(res.text).toMatch(/type SEND/i);
  });

  it('sends nothing when the confirmation is wrong', async () => {
    const res = await request(app).post('/admin/invoices').send({ confirm: 'send please' });

    expect(res.status).toBe(400);
    expect(ses.sendEmail).not.toHaveBeenCalled();
  });

  it('runs when confirmed, and lists the per-club result', async () => {
    const res = await request(app).post('/admin/invoices').send({ confirm: 'SEND' });

    expect(res.status).toBe(200);
    expect(ses.sendEmail).toHaveBeenCalledTimes(1);
    expect(res.text).toMatch(/Mellor invoice sent successfully/);
  });

  // A club that could not be invoiced must be visible in the same list as the successes,
  // not an absence the treasurer has to notice.
  it('shows a club that was not sent, alongside the ones that were', async () => {
    League.getAnnualInvoices.mockResolvedValue([
      Object.assign({}, row, { clubId: 1, clubName: 'Broken', clubFee: undefined }),
      Object.assign({}, row, { clubId: 2, clubName: 'Fine' }),
    ]);

    const res = await request(app).post('/admin/invoices').send({ confirm: 'SEND' });

    expect(res.status).toBe(200);
    expect(res.text).toMatch(/Broken invoice NOT sent/);
    expect(res.text).toMatch(/Fine invoice sent successfully/);
  });

  it('refuses outside the window unless the override is ticked', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-11-20T09:00:00Z'));

    const refused = await request(app).post('/admin/invoices').send({ confirm: 'SEND' });
    expect(refused.status).toBe(409);
    expect(ses.sendEmail).not.toHaveBeenCalled();

    const forced = await request(app).post('/admin/invoices')
      .send({ confirm: 'SEND', force: 'true' });
    expect(forced.status).toBe(200);
    expect(ses.sendEmail).toHaveBeenCalledTimes(1);
  });
});
