// Rearrangement emails forwarded to rearrangements@ — queued for /admin/rearrangements
// instead of being forwarded on, then applied from the page.
//
// As for registrations@ (player-requests.test.js): only an allowed, authenticated sender
// fills the queue, anything refused is still forwarded, and the pages are superadmin-only.
// What is new here is Apply, which moves a fixture: it must send exactly what the form
// says, record the outcome inside the same transaction, and come back to the page with
// the reason when it is refused.

const request = require('supertest');

let mockCurrentUser = null;
jest.mock('../../middleware/secured', () => (req, res, next) => {
  if (mockCurrentUser) req.user = mockCurrentUser;
  next();
});

jest.mock('../../models/fixture');
jest.mock('../../models/division');
jest.mock('../../models/players');
jest.mock('../../models/game');
jest.mock('../../models/teams');
jest.mock('../../models/club');
jest.mock('../../models/auth.js');
jest.mock('../../models/registrationRequest');
jest.mock('../../models/rearrangementRequest');
jest.mock('axios');
jest.mock('../../utils/ses', () => ({
  sendEmail: jest.fn().mockResolvedValue({}),
  sendRawEmail: jest.fn().mockResolvedValue({}),
}));

const mockSendMail = jest.fn().mockResolvedValue({ messageId: 'test', envelope: {} });
jest.mock('nodemailer', () => ({
  createTransport: jest.fn(() => ({ sendMail: mockSendMail })),
}));

jest.mock('../../middleware/verifySns', () => {
  const mw = (req, res, next) => {
    req.snsMessage = JSON.parse(req.body.Message ? JSON.stringify(req.body) : '{}');
    next();
  };
  const forTopic = () => mw;
  forTopic.isAmazonSubscribeUrl = () => true;
  return forTopic;
});

const Requests = require('../../models/rearrangementRequest');
const Registrations = require('../../models/registrationRequest');
const Fixture = require('../../models/fixture');
const Player = require('../../models/players');
const app = require('../../app');

const SUPERADMIN = {
  id: 'auth0|super', displayName: 'Results Secretary',
  emails: [{ value: 'results@example.com' }],
  _json: { 'https://my-app.example.com/role': 'superadmin', 'https://my-app.example.com/club': 'All' },
};
const CLUB_ADMIN = {
  id: 'auth0|admin', displayName: 'Club Admin',
  _json: { 'https://my-app.example.com/role': 'admin', 'https://my-app.example.com/club': 'Dome' },
};

const CLUBS = [{ id: 49, name: 'Cheadle Hulme' }, { id: 51, name: 'Disley' }, { id: 52, name: 'Dome' }];
const TEAMS = [{ id: 30, name: 'Disley A', clubId: 51 }, { id: 31, name: 'Cheadle Hulme A', clubId: 49 }];

const FORWARD = [
  '---------- Forwarded message ---------',
  'From: Nathan <nathan@example.com>',
  'Date: Mon, 26 Oct 2026 at 16:25',
  'Subject: Disley v Cheadle Hulme A',
  '',
  'Disley V Cheadle Hulme A',
  'Original date - Tuesday 10th Nov 2026',
  'New date - Tuesday 13th April 2027',
  '',
  'Thanks',
].join('\r\n');

function rawEmail({ from, to, text }) {
  return [
    'From: ' + from, 'To: ' + to, 'Subject: Fwd: Disley v Cheadle Hulme A',
    'Date: Mon, 26 Oct 2026 17:00:00 +0000',
    'Message-ID: <rearr123@mail.gmail.com>', 'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8', '', text, '',
  ].join('\r\n');
}

const PASS = { status: 'PASS' };
function postMail(mime, { recipients, verdicts } = {}) {
  const notification = {
    content: Buffer.from(mime).toString('base64'),
    mail: { messageId: 'ses-id-1' },
    receipt: Object.assign({ recipients: recipients || ['rearrangements@stockport-badminton.co.uk'] },
      verdicts === undefined ? { spfVerdict: PASS, dkimVerdict: PASS, dmarcVerdict: PASS } : verdicts),
  };
  return request(app).post('/mail').type('json').send({ Type: 'Notification', Message: JSON.stringify(notification) });
}
const neilForward = () => rawEmail({ from: 'Neil <neil@example.com>', to: 'rearrangements@stockport-badminton.co.uk', text: FORWARD });

beforeEach(() => {
  jest.clearAllMocks();
  mockCurrentUser = SUPERADMIN;
  process.env.REARRANGEMENT_INBOX_SENDERS = 'neil@example.com';
  mockSendMail.mockResolvedValue({ messageId: 'test', envelope: {} });
  Player.getEmails = jest.fn().mockResolvedValue([]);
  Requests.clubsAndTeams.mockResolvedValue({ clubs: CLUBS, teams: TEAMS });
  Requests.create.mockResolvedValue(3);
});
afterAll(() => { delete process.env.REARRANGEMENT_INBOX_SENDERS; });

describe('POST /mail to rearrangements@', () => {
  it('queues the email with its reading, and forwards nothing', async () => {
    const res = await postMail(neilForward());
    expect(res.status).toBe(200);
    expect(mockSendMail).not.toHaveBeenCalled();
    expect(Registrations.create).not.toHaveBeenCalled();
    const queued = Requests.create.mock.calls[0][0];
    expect(queued).toMatchObject({ messageId: '<rearr123@mail.gmail.com>', originalFrom: 'Nathan <nathan@example.com>' });
    expect(queued.reading.clubIds.sort()).toEqual([49, 51]);
    expect(queued.reading.dates.map(d => [d.ymd, d.role])).toEqual([['2026-11-10', 'original'], ['2027-04-13', 'new']]);
  });

  it('treats a redelivery as done', async () => {
    Requests.create.mockResolvedValue(null);
    await postMail(neilForward());
    expect(mockSendMail).not.toHaveBeenCalled();
  });

  describe('a refusal still reaches a person, by the ordinary forward', () => {
    it('when the queue is closed', async () => {
      delete process.env.REARRANGEMENT_INBOX_SENDERS;
      await postMail(neilForward());
      expect(Requests.create).not.toHaveBeenCalled();
      expect(mockSendMail).toHaveBeenCalled();
    });

    it('when the sender is not allowed', async () => {
      await postMail(rawEmail({ from: 'stranger@example.org', to: 'rearrangements@stockport-badminton.co.uk', text: FORWARD }));
      expect(Requests.create).not.toHaveBeenCalled();
      expect(mockSendMail).toHaveBeenCalled();
    });

    it('when the From is not authenticated', async () => {
      await postMail(neilForward(), { verdicts: { spfVerdict: { status: 'FAIL' }, dkimVerdict: { status: 'FAIL' } } });
      expect(Requests.create).not.toHaveBeenCalled();
      expect(mockSendMail).toHaveBeenCalled();
    });

    it('when queueing throws', async () => {
      Requests.clubsAndTeams.mockRejectedValue(new Error('db down'));
      const res = await postMail(neilForward());
      expect(res.status).toBe(200);
      expect(mockSendMail).toHaveBeenCalled();
    });
  });

  it('leaves mail also addressed to a list for the list', async () => {
    await postMail(neilForward(), { recipients: ['rearrangements@stockport-badminton.co.uk', 'captains@stockport-badminton.co.uk'] });
    expect(Requests.create).not.toHaveBeenCalled();
  });
});

describe('the pages', () => {
  const REQUEST = {
    id: 3, subject: 'Fwd: Disley v Cheadle Hulme A', status: 'pending', receivedAt: new Date('2026-10-26T17:00:00Z'),
    forwardedBy: 'Neil <neil@example.com>', originalFrom: 'Nathan <nathan@example.com>',
    bodyText: 'Original date 10th Nov <script>alert(1)</script>', outcome: null,
    reading: { dates: [{ ymd: '2026-11-10', role: 'original', raw: 'Tuesday 10th Nov 2026' },
      { ymd: '2027-04-13', role: 'new', raw: 'Tuesday 13th April 2027' }], clubIds: [49, 51], teamIds: [31], noDateYet: false },
  };
  const FIXTURE = {
    id: 7358, date: '2026-11-10', dayLabel: 'Tue 10 Nov 2026', status: 'outstanding', homeScore: null,
    homeTeamId: 30, awayTeamId: 31, homeTeam: 'Disley A', awayTeam: 'Cheadle Hulme A', homeClubId: 51, awayClubId: 49,
    division: 'Division 3',
  };

  beforeEach(() => {
    Requests.list.mockResolvedValue([REQUEST]);
    Requests.getById.mockResolvedValue(REQUEST);
    Requests.playersByEmail.mockResolvedValue([{ firstName: 'Nathan', familyName: 'M', team: 'Disley A', club: 'Disley',
      clubId: 51, teamCaptain: 1, clubSecretary: 0, matchSecrertary: 0 }]);
    Requests.candidateFixtures.mockResolvedValue([FIXTURE]);
    Requests.fixtureById.mockResolvedValue(null);
    Requests.homeWeekdays.mockResolvedValue([{ dow: 2, n: 9 }]);
    Requests.fixturesOn.mockResolvedValue([]);
    Requests.seasonEnd.mockResolvedValue('2027-07-29');
    Requests.replacementOf.mockResolvedValue(null);
  });

  it.each([
    ['get', '/admin/rearrangements'],
    ['get', '/admin/rearrangements/3'],
    ['post', '/admin/rearrangements/3/apply'],
    ['post', '/admin/rearrangements/3/status'],
  ])('%s %s is superadmin-only', async (method, path) => {
    mockCurrentUser = CLUB_ADMIN;
    const res = await request(app)[method](path).type('form').send({ fixture: '7358', date: '2027-04-13' });
    expect(res.status).toBe(403);
    expect(Requests.getById).not.toHaveBeenCalled();
    expect(Fixture.rearrangeById).not.toHaveBeenCalled();
  });

  it('lists what is pending, and says when nothing can arrive', async () => {
    let res = await request(app).get('/admin/rearrangements');
    expect(res.text).toContain('Fwd: Disley v Cheadle Hulme A');
    expect(res.text).not.toContain('REARRANGEMENT_INBOX_SENDERS');
    delete process.env.REARRANGEMENT_INBOX_SENDERS;
    res = await request(app).get('/admin/rearrangements');
    expect(res.text).toContain('REARRANGEMENT_INBOX_SENDERS');
  });

  it('arrives with the fixture and new date chosen, and who the sender is', async () => {
    const res = await request(app).get('/admin/rearrangements/3');
    expect(res.status).toBe(200);
    expect(res.text).toMatch(/value="7358" id="fixture-7358" checked/);
    expect(res.text).toMatch(/id="date" name="date" value="2027-04-13"/);
    expect(res.text).not.toMatch(/id="nodate"[^>]*checked/);
    expect(res.text).toContain('Nathan M, Disley');
    expect(res.text).toContain('captain of Disley A');
    expect(res.text).toContain('Nothing to flag');
    // The sender's club counts as named when finding candidates.
    expect(Requests.candidateFixtures).toHaveBeenCalledWith({ dates: ['2026-11-10', '2027-04-13'], clubIds: [49, 51], teamId: null });
  });

  it('Check shows the warnings for the date on the form', async () => {
    Requests.fixturesOn.mockResolvedValue([{ id: 9, homeTeam: 'Disley A', awayTeam: 'Dome A' }]);
    const res = await request(app).get('/admin/rearrangements/3?check=1&fixture=7358&date=2027-04-15');
    expect(res.text).toMatch(/id="date" name="date" value="2027-04-15"/);
    expect(res.text).toContain('Disley A usually play at home on Tuesdays; 2027-04-15 is a Thursday.');
    expect(res.text).toContain('Already on that day: Disley A v Dome A (fixture 9).');
    expect(Requests.fixturesOn).toHaveBeenCalledWith('2027-04-15', [30, 31], 7358);
  });

  it('says when the fixture has already been moved, and where to', async () => {
    Requests.candidateFixtures.mockResolvedValue([Object.assign({}, FIXTURE, { status: 'rearranged' })]);
    Requests.replacementOf.mockResolvedValue({ id: 7695, dayLabel: 'Tue 13 Apr 2027' });
    const res = await request(app).get('/admin/rearrangements/3?check=1&fixture=7358&date=2027-04-13');
    expect(res.text).toContain('This fixture is already rearranged — it is now on Tue 13 Apr 2027 (fixture 7695).');
  });

  it('cannot be scripted by the email it shows', async () => {
    const res = await request(app).get('/admin/rearrangements/3?check=1&fixture=7358&error=%3Cscript%3Ealert(2)%3C/script%3E');
    expect(res.text).not.toContain('<script>alert(1)</script>');
    expect(res.text).not.toContain('<script>alert(2)</script>');
    expect(res.text).toContain('&lt;script&gt;alert(1)');
  });

  it('404s an unknown request', async () => {
    Requests.getById.mockResolvedValue(null);
    expect((await request(app).get('/admin/rearrangements/999')).status).toBe(404);
  });

  describe('Apply', () => {
    it('moves the fixture to the date on the form and records the outcome in the same transaction', async () => {
      const trx = {};
      Fixture.rearrangeById.mockImplementation(async (id, date, within) => {
        const result = { ok: true, action: 'rearranged', fixtureId: id, replacementId: 7695, date };
        await within(trx, result);
        return result;
      });
      Requests.recordOutcome.mockResolvedValue(true);
      const res = await request(app).post('/admin/rearrangements/3/apply').type('form')
        .send({ fixture: '7358', date: '2027-04-13', team: '' });
      expect(res.status).toBe(302);
      expect(res.headers.location).toBe('/admin/rearrangements/3?applied=1');
      expect(Fixture.rearrangeById).toHaveBeenCalledWith(7358, '2027-04-13', expect.any(Function));
      expect(Requests.recordOutcome).toHaveBeenCalledWith(trx, 3,
        { action: 'rearranged', fixtureId: 7358, replacementId: 7695, date: '2027-04-13' }, expect.any(String));
    });

    it('with "no date agreed yet" marks it rearranging, whatever is in the date box', async () => {
      Fixture.rearrangeById.mockResolvedValue({});
      await request(app).post('/admin/rearrangements/3/apply').type('form').send({ fixture: '7358', date: '2027-04-13', nodate: '1' });
      expect(Fixture.rearrangeById).toHaveBeenCalledWith(7358, null, expect.any(Function));
    });

    it('rolls back when the request was already closed', async () => {
      Requests.recordOutcome.mockResolvedValue(false);
      let thrown = null;
      Fixture.rearrangeById.mockImplementation(async (id, date, within) => {
        try { await within({}, { action: 'rearranged', fixtureId: id }); } catch (err) { thrown = err; throw err; }
      });
      const res = await request(app).post('/admin/rearrangements/3/apply').type('form').send({ fixture: '7358', date: '2027-04-13' });
      expect(thrown).toMatchObject({ status: 409 });
      expect(res.status).toBe(303);
      expect(res.headers.location).toContain('error=This+request+is+not+pending');
    });

    it('goes back to the page with the reason and the form as it was when refused', async () => {
      Fixture.rearrangeById.mockRejectedValue(Object.assign(new Error('fixture 7358 is already rearranged'), { status: 409 }));
      const res = await request(app).post('/admin/rearrangements/3/apply').type('form').send({ fixture: '7358', date: '2027-04-20' });
      expect(res.status).toBe(303);
      const back = new URL(res.headers.location, 'http://x');
      expect(Object.fromEntries(back.searchParams)).toEqual({
        check: '1', fixture: '7358', date: '2027-04-20', nodate: '', error: 'fixture 7358 is already rearranged' });
      const page = await request(app).get(res.headers.location);
      expect(page.text).toContain('Not applied: fixture 7358 is already rearranged');
    });

    it('asks for a date or the no-date box rather than guessing', async () => {
      const res = await request(app).post('/admin/rearrangements/3/apply').type('form').send({ fixture: '7358', date: '' });
      expect(res.status).toBe(303);
      expect(Fixture.rearrangeById).not.toHaveBeenCalled();
    });
  });

  it('closes a request and records who by', async () => {
    Requests.setStatus.mockResolvedValue(true);
    const res = await request(app).post('/admin/rearrangements/3/status').type('form').send({ status: 'dismissed' });
    expect(res.headers.location).toBe('/admin/rearrangements');
    expect(Requests.setStatus).toHaveBeenCalledWith(3, 'dismissed', expect.any(String));
  });
});
