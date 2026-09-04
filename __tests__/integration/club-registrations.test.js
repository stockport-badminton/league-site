const request = require('supertest');

// Chasing clubs for their player registration forms.
//
// Two things matter more than the rest here.
//
// The chase email carries a Word document and goes to real club secretaries, so its
// recipients are derived server-side from the club's own officers and never read from the
// request. `/fixture/reminder` took its address from the body and was an open relay from
// our own verified domain; the risk is the domain's sending reputation, which is shared
// with the invoices.
//
// And the status has to reset every season without anybody remembering to reset it. The
// rows are keyed by season, so a new season simply has none — these tests assert that
// last season's "received" does not carry over, because the failure mode is silent and
// would show up once, in August, as eighteen clubs mysteriously already done.

let mockCurrentUser = null;

jest.mock('../../middleware/secured', () => (req, res, next) => {
  if (mockCurrentUser) req.user = mockCurrentUser;
  next();
});
jest.mock('../../models/userInViews', () => () => (req, res, next) => {
  if (mockCurrentUser) req.user = mockCurrentUser;
  res.locals.user = req.user;
  next();
});

jest.mock('../../utils/ses');
jest.mock('../../models/clubRegistration');
jest.mock('../../controllers/documentsController', () => {
  const actual = jest.requireActual('../../controllers/documentsController');
  return { ...actual, buildPrefilledRegistrationDocx: jest.fn() };
});
jest.mock('../../models/season', () => ({
  current: () => '20262027',
  previous: () => '20252026',
  assertName: n => n,
  init: jest.fn(),
  getAll: jest.fn(() => Promise.resolve([])),
  isServable: () => false,
}));

const ses = require('../../utils/ses');
const Registration = require('../../models/clubRegistration');
const documents = require('../../controllers/documentsController');
const app = require('../../app');

const SUPERADMIN = { displayName: 'Neil', _json: {
  'https://my-app.example.com/role': 'superadmin',
} };

// A club as models/clubRegistration.getStatus reports one.
const club = (over = {}) => ({
  id: 42, name: 'Aerospace', teams: 1,
  firstFixture: '2026-09-10', daysAway: 2,
  receivedAt: null, chasedAt: null, chaseCount: 0,
  received: false, chased: false, season: '20262027',
  officers: [
    { name: 'Anne Secretary', email: 'anne@example.com', role: 'club secretary' },
    { name: 'Mark Match', email: 'mark@example.com', role: 'match secretary' },
  ],
  ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockCurrentUser = SUPERADMIN;
  process.env.REGISTRATION_EMAIL_TO = 'results@stockport-badminton.co.uk';
  process.env.REGISTRATION_CRON_TOKEN = 'a-real-token';
  documents.buildPrefilledRegistrationDocx.mockResolvedValue({
    buffer: Buffer.from('PK-a-docx'),
    filename: 'Aerospace Team Registration Form 2026-27.docx',
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  });
  Registration.getStatus.mockResolvedValue([club()]);
  Registration.recordChase.mockResolvedValue(1);
  Registration.markReceived.mockResolvedValue(1);
  Registration.markNotReceived.mockResolvedValue(1);
});

describe('POST /admin/registrations/:club/chase', () => {
  it('emails the club secretary with the prefilled form attached', async () => {
    const res = await request(app).post('/admin/registrations/42/chase');
    expect(res.status).toBe(302);

    // An attachment cannot go through SendEmail, so this must take the raw path.
    expect(ses.sendRawEmail).toHaveBeenCalledTimes(1);
    expect(ses.sendEmail).not.toHaveBeenCalled();

    const sent = ses.sendRawEmail.mock.calls[0][0];
    expect(sent.to).toEqual(['anne@example.com']);
    expect(sent.cc).toEqual(['mark@example.com']);
    expect(sent.subject).toMatch(/Aerospace player registration form/i);

    expect(sent.attachments).toHaveLength(1);
    expect(sent.attachments[0].filename).toMatch(/\.docx$/);
    expect(sent.attachments[0].content.toString()).toBe('PK-a-docx');

    // Both parts, as mailer.send requires of every email.
    expect(sent.html).toMatch(/Aerospace/);
    expect(sent.text).toMatch(/Aerospace/);
  });

  it('records the chase, so the digest can stop nagging about it', async () => {
    await request(app).post('/admin/registrations/42/chase');
    expect(Registration.recordChase).toHaveBeenCalledWith('20262027', 42, 'Neil');
  });

  // The address is the club's, from the database. Nothing in the request may influence it.
  it('ignores any recipient supplied in the request', async () => {
    await request(app).post('/admin/registrations/42/chase')
      .send({ to: 'attacker@example.com', email: 'attacker@example.com',
              cc: 'attacker@example.com' });
    const sent = ses.sendRawEmail.mock.calls[0][0];
    expect(JSON.stringify(sent)).not.toMatch(/attacker/);
    expect(sent.to).toEqual(['anne@example.com']);
  });

  // One person often holds both roles, and some clubs have no club secretary at all.
  it('writes to the match secretary when there is no club secretary', async () => {
    Registration.getStatus.mockResolvedValue([club({ officers: [
      { name: 'Mark Match', email: 'mark@example.com', role: 'match secretary' },
    ] })]);
    await request(app).post('/admin/registrations/42/chase');
    const sent = ses.sendRawEmail.mock.calls[0][0];
    expect(sent.to).toEqual(['mark@example.com']);
    expect(sent.cc).toEqual([]);
  });

  // A data problem, not a server fault: say so on the page rather than throwing a 500 at
  // somebody halfway through chasing eighteen clubs.
  it('reports a club with no contactable officer instead of failing', async () => {
    Registration.getStatus.mockResolvedValue([club({ officers: [
      { name: 'Anne Secretary', email: null, role: 'club secretary' },
    ] })]);
    const res = await request(app).post('/admin/registrations/42/chase');
    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/problem=/);
    expect(ses.sendRawEmail).not.toHaveBeenCalled();
    expect(Registration.recordChase).not.toHaveBeenCalled();
  });

  // A club with nobody on its books still gets chased — arguably it needs it most. The
  // form is simply blank.
  it('still writes when there is no roster to prefill', async () => {
    documents.buildPrefilledRegistrationDocx.mockResolvedValue(null);
    await request(app).post('/admin/registrations/42/chase');
    // No attachment means the simple send path, which is the correct transport for it.
    expect(ses.sendEmail).toHaveBeenCalledTimes(1);
    expect(ses.sendRawEmail).not.toHaveBeenCalled();
  });

  it('is superadmin only', async () => {
    mockCurrentUser = { displayName: 'Captain', _json: {
      'https://my-app.example.com/role': 'captain' } };
    const res = await request(app).post('/admin/registrations/42/chase');
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(ses.sendRawEmail).not.toHaveBeenCalled();
  });
});

describe('POST /admin/registrations/run — the daily digest', () => {
  const digest = (over = {}) => ({
    season: '20262027', withinDays: 3,
    dueSoon: [club()], chased: [], received: 0, total: 18, ...over,
  });

  beforeEach(() => { Registration.getDigest.mockResolvedValue(digest()); });

  it('sends to REGISTRATION_EMAIL_TO when something is outstanding', async () => {
    const res = await request(app).post('/admin/registrations/run')
      .set('x-registration-token', 'a-real-token');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, sent: true, caller: 'scheduler' });
    expect(ses.sendEmail).toHaveBeenCalledTimes(1);
    const params = ses.sendEmail.mock.calls[0][0];
    expect(params.Destination.ToAddresses).toEqual(['results@stockport-badminton.co.uk']);
    expect(params.Message.Subject.Data).toMatch(/due in the next 3 days/);
  });

  // A daily "nothing to do" is how a reader learns to ignore the email.
  it('sends nothing when nothing is outstanding', async () => {
    Registration.getDigest.mockResolvedValue(digest({ dueSoon: [], chased: [] }));
    const res = await request(app).post('/admin/registrations/run')
      .set('x-registration-token', 'a-real-token');
    expect(res.body).toMatchObject({ sent: false, reason: 'nothing outstanding' });
    expect(ses.sendEmail).not.toHaveBeenCalled();
  });

  // dev.env points at production, so an unconfigured recipient must mean silence, not
  // a mail to whoever the default happens to be.
  it('sends nothing when the recipient is unset', async () => {
    delete process.env.REGISTRATION_EMAIL_TO;
    delete process.env.AUDIT_EMAIL_TO;
    const res = await request(app).post('/admin/registrations/run')
      .set('x-registration-token', 'a-real-token');
    expect(res.body).toMatchObject({ sent: false });
    expect(ses.sendEmail).not.toHaveBeenCalled();
  });

  describe('who may call it', () => {
    beforeEach(() => { mockCurrentUser = null; });

    it('refuses with no token', async () => {
      const res = await request(app).post('/admin/registrations/run');
      expect(res.status).toBe(403);
      expect(ses.sendEmail).not.toHaveBeenCalled();
    });

    it('refuses a wrong token', async () => {
      const res = await request(app).post('/admin/registrations/run')
        .set('x-registration-token', 'not-the-token');
      expect(res.status).toBe(403);
    });

    // "Empty secret matches empty header" is how an unconfigured deploy becomes a public
    // endpoint that mails on demand.
    it('refuses when no token is configured, rather than accepting an empty one', async () => {
      delete process.env.REGISTRATION_CRON_TOKEN;
      const res = await request(app).post('/admin/registrations/run')
        .set('x-registration-token', '');
      expect(res.status).toBe(403);
    });

    it('lets a superadmin run it by hand', async () => {
      mockCurrentUser = SUPERADMIN;
      const res = await request(app).post('/admin/registrations/run');
      expect(res.status).toBe(200);
      expect(res.body.caller).toBe('superadmin');
    });
  });
});

describe('marking a form received', () => {
  it('records who marked it', async () => {
    await request(app).post('/admin/registrations/42/received');
    expect(Registration.markReceived).toHaveBeenCalledWith('20262027', '42', 'Neil');
  });

  it('can be undone', async () => {
    await request(app).post('/admin/registrations/42/received').send({ received: 'false' });
    expect(Registration.markNotReceived).toHaveBeenCalledWith('20262027', '42', 'Neil');
  });
});
