// POST /contact-us for a club enquiry — the path that lost four messages on 7 Sep.
//
// `getContactDetailsById` aliases its columns without quotes, so Postgres folds them and
// the row comes back as `clubsecemail`. The controller read `rows[0].clubSecEmail`,
// which is `undefined`, and `undefined.indexOf(',')` threw. The catch turned that into
// "Sorry something went wrong sending your email." and the enquiry was gone — one member
// tried four times in five minutes and the league received nothing (Sentry NODE-12).
//
// So these tests use the LOWERCASE key the real query returns. A fixture spelling it
// `clubSecEmail` would pass against the bug and prove nothing, which is the same trap
// CLAUDE.md records for mocking `{ insertId: 42 }`.

const request = require('supertest');

jest.mock('../../models/club');
jest.mock('../../models/fixture');
jest.mock('../../models/division');
jest.mock('../../models/players');
jest.mock('../../models/teams');
jest.mock('../../models/auth.js');
jest.mock('../../models/spamControls');
jest.mock('axios');
jest.mock('../../utils/ses', () => ({ sendEmail: jest.fn().mockResolvedValue({}) }));

const Spam = require('../../models/spamControls');
const Club = require('../../models/club');
const ses = require('../../utils/ses');
const axios = require('axios');
const { formStamp } = require('../../utils/spamChecks');
const app = require('../../app');

// Past the timing floor.
const goodStamp = () => formStamp(Date.now() - 30000);

// Exactly the keys Club.getContactDetailsById returns — all folded to lowercase.
const clubRow = (over = {}) => ({
  clubname: 'Mellor', teamname: 'Mellor A',
  venueId: 1, venuename: 'Mellor Sports Club', address: 'Mellor, SK6 5DA',
  matchsecretary: 'A Secretary', matchsectel: '0161 000 0000',
  matchsecemail: 'match@mellorbadminton.org.uk',
  clubsecretary: 'John Pawsey', clubsectel: '0161 000 0001',
  clubsecemail: 'secretary@mellorbadminton.org.uk',
  teamcaptain: 'A Captain', teamcaptaintel: '', teamcaptainemail: '',
  ...over,
});

function post(body = {}) {
  return request(app).post('/contact-us').send({
    contactType: 'Clubs',
    clubSelect: '39',
    contactEmail: 'someone@example.com',
    contactQuery: 'Can I come along on Tuesday?',
    formTs: goodStamp(),
    'g-recaptcha-response': 'test-token',
    ...body,
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  ses.sendEmail.mockResolvedValue({});
  Club.getAll.mockResolvedValue([]);
  Club.getContactDetailsById.mockResolvedValue([clubRow()]);
  axios.post.mockResolvedValue({ data: { success: true } });
  Spam.isBlockedIpSync.mockReturnValue(false);
  Spam.isBlockedIp.mockResolvedValue(false);
  Spam.isBlockedEmail.mockResolvedValue(false);
  Spam.matchBlockedText.mockResolvedValue(null);
  Spam.logSubmission.mockResolvedValue();
  Spam.refresh.mockResolvedValue({});
});

describe('a club enquiry', () => {
  it('emails the club secretary', async () => {
    const res = await post();

    expect(res.status).toBe(200);
    expect(ses.sendEmail).toHaveBeenCalledTimes(1);
    const params = ses.sendEmail.mock.calls[0][0];
    expect(params.Destination.ToAddresses).toEqual(['secretary@mellorbadminton.org.uk']);
    // The league is copied regardless, so a message is never only in one place.
    expect(params.Destination.BccAddresses).toContain('stockport.badders.results@gmail.com');
    // Replying goes back to the person who wrote in.
    expect(params.ReplyToAddresses).toContain('someone@example.com');
  });

  it('does not answer with the failure page', async () => {
    const res = await post();
    expect(res.text).not.toMatch(/something went wrong/i);
  });

  it('splits a comma-separated secretary address', async () => {
    Club.getContactDetailsById.mockResolvedValue([clubRow({
      clubsecemail: 'one@example.com, two@example.com',
    })]);
    await post();
    expect(ses.sendEmail.mock.calls[0][0].Destination.ToAddresses)
      .toEqual(['one@example.com', 'two@example.com']);
  });

  // The enquiry matters more than the addressing. Losing someone's message to an
  // exception is the outcome worth designing away.
  it.each([
    ['a null address',        [clubRow({ clubsecemail: null })]],
    ['a blank address',       [clubRow({ clubsecemail: '   ' })]],
    ['a nonsense address',    [clubRow({ clubsecemail: 'not-an-email' })]],
    ['no row at all',         []],
  ])('still delivers to the league with %s', async (_label, rows) => {
    Club.getContactDetailsById.mockResolvedValue(rows);
    const res = await post();

    expect(res.status).toBe(200);
    expect(ses.sendEmail).toHaveBeenCalledTimes(1);
    expect(ses.sendEmail.mock.calls[0][0].Destination.ToAddresses)
      .toEqual(['stockport.badders.results@gmail.com']);
  });

  // The regression itself. A row carrying ONLY the camelCase spelling is what the code
  // used to read, and it is not what Postgres returns.
  it('does not depend on a camelCase key the query never returns', async () => {
    Club.getContactDetailsById.mockResolvedValue([
      { clubSecEmail: 'wrong@example.com', clubsecemail: 'right@example.com' },
    ]);
    await post();
    expect(ses.sendEmail.mock.calls[0][0].Destination.ToAddresses)
      .toEqual(['right@example.com']);
  });
});
