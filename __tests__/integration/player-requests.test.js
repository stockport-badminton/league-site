// Registration emails forwarded to registrations@ — queued for /admin/player-requests
// instead of being forwarded on.
//
// The two things that matter most are at the edges. Inbound: only an allowed,
// authenticated sender may fill the queue, and anything refused must still be forwarded
// the way it always was, so a message is never lost to the new path. Outbound: the page
// is superadmin-only, because the queue is other people's email.

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
jest.mock('axios');
jest.mock('../../utils/ses', () => ({
  sendEmail: jest.fn().mockResolvedValue({}),
  sendRawEmail: jest.fn().mockResolvedValue({}),
}));
// The real splitter and matcher; only the table read is faked.
jest.mock('../../models/roster', () => Object.assign({}, jest.requireActual('../../models/roster'), {
  allForMatching: jest.fn(),
}));

const mockSendMail = jest.fn().mockResolvedValue({ messageId: 'test', envelope: {} });
jest.mock('nodemailer', () => ({
  createTransport: jest.fn(() => ({ sendMail: mockSendMail })),
}));

// Signature checking is mail-relay.test.js's subject; here the message is taken as verified.
jest.mock('../../middleware/verifySns', () => {
  const mw = (req, res, next) => {
    req.snsMessage = JSON.parse(req.body.Message ? JSON.stringify(req.body) : '{}');
    next();
  };
  mw.isAmazonSubscribeUrl = () => true;
  return mw;
});

const Requests = require('../../models/registrationRequest');
const Roster = require('../../models/roster');
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

const TEAMS = [
  { id: 28, name: 'Dome A', clubId: 52, clubName: 'Dome' },
  { id: 29, name: 'Dome B', clubId: 52, clubName: 'Dome' },
];

const FORWARD = [
  '---------- Forwarded message ---------',
  'From: Jane Secretary <jane@example.com>',
  'Subject: New players',
  '',
  'Please register these for Dome B:',
  'Mary Whitle (F)',
  'John Smith - M',
  '',
  'Thanks,',
  'Jane',
].join('\r\n');

function rawEmail({ from, to, text, messageId }) {
  return [
    'From: ' + from,
    'To: ' + to,
    'Subject: Fwd: New players',
    'Message-ID: <' + (messageId || 'abc123@mail.gmail.com') + '>',
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    '',
    text,
    '',
  ].join('\r\n');
}

const PASS = { status: 'PASS' };
function postMail(mime, { recipients, verdicts } = {}) {
  const notification = {
    content: Buffer.from(mime).toString('base64'),
    mail: { messageId: 'ses-id-1' },
    receipt: Object.assign({
      recipients: recipients || ['registrations@stockport-badminton.co.uk'],
    }, verdicts === undefined ? { spfVerdict: PASS, dkimVerdict: PASS, dmarcVerdict: PASS } : verdicts),
  };
  return request(app).post('/mail').type('json').send({
    Type: 'Notification',
    Message: JSON.stringify(notification),
  });
}
const neilForward = () => rawEmail({
  from: 'Neil Cooper <neil@example.com>',
  to: 'registrations@stockport-badminton.co.uk',
  text: FORWARD,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockCurrentUser = SUPERADMIN;
  process.env.REGISTRATION_INBOX_SENDERS = 'Neil@Example.com, other@example.com';
  mockSendMail.mockResolvedValue({ messageId: 'test', envelope: {} });
  Player.getEmails = jest.fn().mockResolvedValue([]);
  Requests.registrableTeams.mockResolvedValue(TEAMS);
  Requests.create.mockResolvedValue(7);
  Requests.OUTCOMES = ['created', 'attached', 'transferred', 'skipped'];
});
afterAll(() => { delete process.env.REGISTRATION_INBOX_SENDERS; });

describe('POST /mail to registrations@', () => {
  it('queues the email, with the names read out of it, and forwards nothing', async () => {
    const res = await postMail(neilForward());
    expect(res.status).toBe(200);
    expect(mockSendMail).not.toHaveBeenCalled();
    expect(Requests.create).toHaveBeenCalledTimes(1);
    const queued = Requests.create.mock.calls[0][0];
    expect(queued.messageId).toBe('<abc123@mail.gmail.com>');
    expect(queued.originalFrom).toBe('Jane Secretary <jane@example.com>');
    expect(queued.candidates).toEqual([
      expect.objectContaining({ first: 'Mary', family: 'Whitle', gender: 'Female', team: 'Dome B', outcome: null }),
      expect.objectContaining({ first: 'John', family: 'Smith', gender: 'Male', team: 'Dome B', outcome: null }),
    ]);
  });

  // SNS delivers at least once. A redelivery must neither queue twice nor, having been
  // recognised, fall through and forward the message as if it were new.
  it('treats a redelivery as done', async () => {
    Requests.create.mockResolvedValue(null);
    const res = await postMail(neilForward());
    expect(res.status).toBe(200);
    expect(mockSendMail).not.toHaveBeenCalled();
  });

  describe('a refusal still reaches a person, by the ordinary forward', () => {
    it('when the queue is closed (no allowed senders)', async () => {
      delete process.env.REGISTRATION_INBOX_SENDERS;
      await postMail(neilForward());
      expect(Requests.create).not.toHaveBeenCalled();
      expect(mockSendMail).toHaveBeenCalled();
    });

    it('when the sender is not allowed', async () => {
      await postMail(rawEmail({ from: 'stranger@example.org', to: 'registrations@stockport-badminton.co.uk', text: FORWARD }));
      expect(Requests.create).not.toHaveBeenCalled();
      expect(mockSendMail).toHaveBeenCalled();
    });

    // The From header is only a claim; SES's verdicts are the evidence.
    it('when an allowed From is not authenticated', async () => {
      await postMail(neilForward(), { verdicts: { spfVerdict: { status: 'FAIL' }, dkimVerdict: { status: 'FAIL' } } });
      expect(Requests.create).not.toHaveBeenCalled();
      expect(mockSendMail).toHaveBeenCalled();
    });

    it('when queueing throws', async () => {
      Requests.create.mockRejectedValue(new Error('connection reset'));
      const res = await postMail(neilForward());
      expect(res.status).toBe(200);
      expect(mockSendMail).toHaveBeenCalled();
    });

    it('when DMARC fails, whatever else passed', async () => {
      await postMail(neilForward(), { verdicts: { spfVerdict: PASS, dkimVerdict: PASS, dmarcVerdict: { status: 'FAIL' } } });
      expect(Requests.create).not.toHaveBeenCalled();
    });
  });

  it('leaves mail that is also addressed to a list for the list', async () => {
    await postMail(neilForward(), {
      recipients: ['registrations@stockport-badminton.co.uk', 'clubSecretaries@stockport-badminton.co.uk'],
    });
    expect(Requests.create).not.toHaveBeenCalled();
    expect(mockSendMail).toHaveBeenCalled();
  });

  it('leaves every other address alone', async () => {
    await postMail(neilForward(), { recipients: ['division3@stockport-badminton.co.uk'] });
    expect(Requests.create).not.toHaveBeenCalled();
    expect(mockSendMail).toHaveBeenCalled();
  });
});

describe('the pages', () => {
  const REQUEST = {
    id: 7, subject: 'Fwd: New players', status: 'pending', receivedAt: new Date('2026-09-28T10:00:00Z'),
    forwardedBy: 'Neil <neil@example.com>', originalFrom: 'Jane <jane@example.com>',
    bodyText: 'Mary Whitle (F) <script>alert(1)</script>', attachments: [],
    candidates: [{ first: 'Mary', family: 'Whitle', gender: 'Female', team: 'Dome B', raw: 'Mary Whitle (F)', outcome: null, playerId: null }],
  };

  beforeEach(() => {
    Requests.list.mockResolvedValue([REQUEST]);
    Requests.getById.mockResolvedValue(REQUEST);
    Roster.allForMatching.mockResolvedValue([
      { playerId: 163, name: 'Marry Whitle', gender: 'Female', clubName: 'Parrs Wood', clubId: 57, teamName: 'Parrs Wood B' },
      { playerId: 5, name: 'Graham White', gender: 'Male', clubName: 'Tatton', clubId: 60, teamName: 'Tatton A' },
    ]);
  });

  it.each([
    ['get', '/admin/player-requests'],
    ['get', '/admin/player-requests/7'],
    ['get', '/admin/player-requests/match?q=mary'],
    ['post', '/admin/player-requests/7/candidates/0'],
    ['post', '/admin/player-requests/7/candidates'],
    ['post', '/admin/player-requests/7/status'],
  ])('%s %s is superadmin-only', async (method, path) => {
    mockCurrentUser = CLUB_ADMIN;
    const res = await request(app)[method](path).send({});
    expect(res.status).toBe(403);
    expect(Requests.getById).not.toHaveBeenCalled();
    expect(Requests.setCandidate).not.toHaveBeenCalled();
  });

  it('lists what is pending, with progress', async () => {
    const res = await request(app).get('/admin/player-requests');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Fwd: New players');
    expect(res.text).toContain('0 of 1 done');
    expect(Requests.list).toHaveBeenCalledWith('pending');
  });

  it('says so when nothing can arrive', async () => {
    delete process.env.REGISTRATION_INBOX_SENDERS;
    const res = await request(app).get('/admin/player-requests');
    expect(res.text).toContain('REGISTRATION_INBOX_SENDERS');
  });

  it('arrives with each person already matched against the players on file', async () => {
    const res = await request(app).get('/admin/player-requests/7');
    expect(res.status).toBe(200);
    const data = JSON.parse(res.text.match(/<script type="application\/json" id="request-data">([\s\S]*?)<\/script>/)[1]);
    expect(data.candidates[0].matches).toEqual([
      expect.objectContaining({ playerId: 163, name: 'Marry Whitle', where: 'club', match: 'close' }),
    ]);
    expect(data.teams).toEqual(TEAMS);
  });

  // The body is somebody's email. It must not be able to run on the page, either as
  // markup or by closing the JSON block the page script reads.
  it('cannot be scripted by the email it shows', async () => {
    Requests.getById.mockResolvedValue(Object.assign({}, REQUEST, {
      candidates: [Object.assign({}, REQUEST.candidates[0], { raw: '</script><script>alert(2)</script>' })],
    }));
    const res = await request(app).get('/admin/player-requests/7');
    expect(res.text).not.toContain('<script>alert(1)</script>');
    expect(res.text).not.toContain('<script>alert(2)</script>');
    expect(res.text).toContain('&lt;script&gt;alert(1)');
  });

  it('404s an unknown request', async () => {
    Requests.getById.mockResolvedValue(null);
    const res = await request(app).get('/admin/player-requests/999');
    expect(res.status).toBe(404);
  });

  it('re-matches an edited name', async () => {
    const res = await request(app).get('/admin/player-requests/match?q=Mary%20Whitle&gender=Female');
    expect(res.body.matches.map(m => m.playerId)).toEqual([163]);
  });

  describe('recording what was done', () => {
    beforeEach(() => {
      Requests.setCandidate.mockImplementation(async (id, index, c) => [c]);
    });

    it('stores the edited person and the outcome', async () => {
      const res = await request(app).post('/admin/player-requests/7/candidates/0')
        .send({ first: ' Mary ', family: 'Whitle', gender: 'Female', team: 'Dome B', outcome: 'transferred', playerId: 163 });
      expect(res.status).toBe(200);
      expect(Requests.setCandidate).toHaveBeenCalledWith(7, 0, expect.objectContaining({
        first: 'Mary', outcome: 'transferred', playerId: 163,
      }));
      expect(res.body.summary).toEqual({ total: 1, handled: 1 });
    });

    it('refuses an outcome it does not know', async () => {
      const res = await request(app).post('/admin/player-requests/7/candidates/0')
        .send({ first: 'Mary', family: 'Whitle', outcome: 'deleted' });
      expect(res.status).toBe(400);
      expect(Requests.setCandidate).not.toHaveBeenCalled();
    });

    it('404s a person the request does not have', async () => {
      Requests.setCandidate.mockResolvedValue(null);
      const res = await request(app).post('/admin/player-requests/7/candidates/9')
        .send({ first: 'Mary', family: 'Whitle' });
      expect(res.status).toBe(404);
    });
  });

  it('closes a request and records who by', async () => {
    Requests.setStatus.mockResolvedValue(true);
    const res = await request(app).post('/admin/player-requests/7/status').type('form').send({ status: 'done' });
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/admin/player-requests');
    expect(Requests.setStatus).toHaveBeenCalledWith(7, 'done', expect.stringContaining('Results Secretary'));
  });
});
