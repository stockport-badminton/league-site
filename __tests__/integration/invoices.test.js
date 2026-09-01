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
    expect(res.status).toBeGreaterThanOrEqual(302);
    expect(res.status).not.toBe(200);
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
