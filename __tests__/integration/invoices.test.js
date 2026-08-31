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
