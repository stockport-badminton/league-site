// What we actually post to Make.com when a result is published.
//
// Make.com hands `imgGen` straight to the Facebook Graph API, which fetches it
// server-side. Built by string interpolation it carried literal spaces — "Tatton A",
// "Division 3" — and Facebook refused it:
//
//     [400] Missing or invalid image file (324, OAuthException)
//
// which reads as a problem with the image, or with Make, or with Facebook's token. It was
// none of those. The endpoint was fine the whole time: fetched with the spaces encoded it
// answers 200 with a 1080x1350 JPEG in about a second. Only the URL was malformed.
//
// Nothing caught it because `sendResultZap` is mocked in every suite that reaches it, so
// what it posts had never been asserted. This is that assertion.

jest.mock('axios', () => ({ post: jest.fn().mockResolvedValue({ data: { ok: true } }) }));

const axios = require('axios');
const Fixture = require('../../models/fixture');

const RESULT = {
  homeTeam: 'Tatton A',
  awayTeam: 'Mellor B',
  homeScore: 11,
  awayScore: 7,
  division: 'Division 3',
};

async function postedBody(overrides) {
  axios.post.mockClear();
  await Fixture.sendResultZap(Object.assign({}, RESULT, overrides));
  return axios.post.mock.calls[0][1];
}

describe('the result webhook sent to Make.com', () => {
  it('sends an image url with every segment encoded', async () => {
    const body = await postedBody();
    expect(body.imgGen).toBe(
      'https://stockport-badminton.co.uk/resultImage/Tatton%20A/Mellor%20B/11/7/Division%203');
  });

  // The property, not the spelling: a raw space is not a legal URL character, and what a
  // client does with one varies — some repair it, Facebook rejects the request.
  it('never puts a raw space in the url', async () => {
    const body = await postedBody({ homeTeam: 'Bramhall Village B', division: 'Division 10' });
    expect(body.imgGen).not.toMatch(/ /);
    expect(body.imgGen).toContain('Bramhall%20Village%20B');
  });

  // Kept pointing at the same value deliberately: removing a field from a live webhook
  // payload changes somebody else's scenario, so a step still reading the old name gets
  // a working URL rather than a 404.
  it('keeps imgUrl in step with imgGen for the old scenario field', async () => {
    const body = await postedBody();
    expect(body.imgUrl).toBe(body.imgGen);
  });

  it('still sends the message text, with the names unencoded there', async () => {
    const body = await postedBody();
    expect(body.message).toContain('Tatton A vs Mellor B : 11-7');
  });

  it('does not post at all from the local test host', async () => {
    axios.post.mockClear();
    const result = await Fixture.sendResultZap(Object.assign({}, RESULT, { host: '127.0.0.1:8080' }));
    expect(result).toBe('test env');
    expect(axios.post).not.toHaveBeenCalled();
  });

  it('refuses anything that is not an object', async () => {
    await expect(Fixture.sendResultZap('not an object')).rejects.toThrow(/supplied an object/);
  });
});
