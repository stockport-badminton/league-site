// POST /contact-us for a junior club, and the Juniors Secretary option.
//
// The junior clubs page never shows a club's address; it links here with ?junior=<id>, and
// the address is looked up from the row. So these assert the recipient comes from the
// database and nothing in the request can choose it.

const request = require('supertest');

jest.mock('../../models/club');
jest.mock('../../models/juniorClub');
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
const JuniorClub = require('../../models/juniorClub');
const ses = require('../../utils/ses');
const axios = require('axios');
const { formStamp } = require('../../utils/spamChecks');
const app = require('../../app');

const goodStamp = () => formStamp(Date.now() - 30000);

const MACC = { id: 1, name: 'Macc Smashers Junior Badminton', contact_email: 'macc@example.invalid', active: true };

function post(body = {}) {
  return request(app).post('/contact-us').send({
    contactType: 'JuniorClub',
    juniorClubSelect: '1',
    contactEmail: 'parent@example.com',
    contactQuery: 'My son is 11, can he come along on Friday?',
    formTs: goodStamp(),
    'g-recaptcha-response': 'test-token',
    ...body,
  });
}

const sentTo = () => ses.sendEmail.mock.calls[0][0].Destination.ToAddresses;

beforeEach(() => {
  jest.clearAllMocks();
  ses.sendEmail.mockResolvedValue({});
  Club.getAll.mockResolvedValue([]);
  JuniorClub.getById.mockResolvedValue(MACC);
  JuniorClub.getContactable.mockResolvedValue([{ id: 1, name: MACC.name }, { id: 3, name: 'College Green Juniors' }]);
  axios.post.mockResolvedValue({ data: { success: true } });
  Spam.isBlockedIpSync.mockReturnValue(false);
  Spam.isBlockedIp.mockResolvedValue(false);
  Spam.isBlockedEmail.mockResolvedValue(false);
  Spam.matchBlockedText.mockResolvedValue(null);
  Spam.logSubmission.mockResolvedValue();
  Spam.refresh.mockResolvedValue({});
});

describe('a junior club enquiry', () => {
  it("emails the club's stored address, copying the league", async () => {
    const res = await post();
    expect(res.status).toBe(200);
    expect(res.text).not.toMatch(/something went wrong/i);
    expect(JuniorClub.getById).toHaveBeenCalledWith(1);
    expect(sentTo()).toEqual(['macc@example.invalid']);
    const params = ses.sendEmail.mock.calls[0][0];
    expect(params.Destination.BccAddresses).toContain('stockport.badders.results@gmail.com');
    expect(params.ReplyToAddresses).toContain('parent@example.com');
  });

  it('cannot be pointed at an address in the request', async () => {
    await post({ to: 'victim@example.com', contact_email: 'victim@example.com' });
    expect(sentTo()).toEqual(['macc@example.invalid']);
  });

  it.each([
    ['an unknown club', undefined, '99'],
    ['a hidden club', { ...MACC, active: false }, '1'],
    ['a club with no address', { ...MACC, contact_email: null }, '1'],
    ['no club chosen', undefined, 'Choose a Junior Club'],
  ])('still delivers to the league for %s', async (_label, row, id) => {
    JuniorClub.getById.mockResolvedValue(row);
    const res = await post({ juniorClubSelect: id });
    expect(res.status).toBe(200);
    expect(sentTo()).toEqual(['stockport.badders.results@gmail.com']);
  });
});

describe('the Juniors Secretary', () => {
  // The form's option value is `juniors`; the server matched only `junior`, so these
  // enquiries reached the mailer with no recipient and were lost.
  it('receives what the form actually sends', async () => {
    const res = await post({ contactType: 'League', leagueSelect: 'juniors' });
    expect(res.status).toBe(200);
    expect(res.text).not.toMatch(/something went wrong/i);
    expect(sentTo()).toEqual(['stockport.badders.results+junior@gmail.com']);
  });
});

describe('GET /contact-us', () => {
  it('offers the junior clubs, without their addresses', async () => {
    const res = await request(app).get('/contact-us');
    expect(res.status).toBe(200);
    expect(res.text).toContain('<option value="JuniorClub" >Junior Clubs</option>');
    expect(res.text).toContain('College Green Juniors');
    expect(res.text).toMatch(/id="juniorClubsDropDown"[^>]*/);
    expect(res.text).toMatch(/class="form-group d-none" id="juniorClubsDropDown"/);
    expect(res.text).not.toContain('@example.invalid');
  });

  it('arrives from the junior clubs page with that club chosen', async () => {
    const res = await request(app).get('/contact-us?junior=3');
    expect(res.text).toContain('<option value="JuniorClub" selected>Junior Clubs</option>');
    expect(res.text).toMatch(/class="form-group d-block" id="juniorClubsDropDown"/);
    expect(res.text).toContain('<option value="3" selected>College Green Juniors</option>');
  });

  it('leaves the option out when no junior club can be contacted', async () => {
    JuniorClub.getContactable.mockResolvedValue([]);
    const res = await request(app).get('/contact-us');
    expect(res.text).not.toContain('value="JuniorClub"');
  });
});
