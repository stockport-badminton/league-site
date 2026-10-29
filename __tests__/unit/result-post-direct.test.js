// Queueing a published result for Meta. This was once a Make.com webhook nobody asserted
// on, and then a choice between the two behind `SOCIAL_POST_DIRECT`; Make went in October
// 2026 and the queue is the only path. These pin what it does.

jest.mock('axios');
jest.mock('../../utils/metaPublisher', () => ({
  targets: jest.fn(),
  pageStoryTarget: jest.requireActual('../../utils/metaPublisher').pageStoryTarget,
  publishEverywhere: jest.fn(),
}));
jest.mock('../../models/socialResultPost', () => ({ enqueue: jest.fn() }));

const axios = require('axios');
const meta = require('../../utils/metaPublisher');
const SocialResultPost = require('../../models/socialResultPost');
const Fixture = require('../../models/fixture');

const RESULT = {
  fixtureId: 7300,
  homeTeam: 'Tatton A', awayTeam: 'Mellor B',
  homeScore: 11, awayScore: 7, division: 'Division 3',
  host: 'stockport-badminton.co.uk',
};

const PAGE = { id: '101950371354925', token: 'page-token' };
const IG = { id: '17841409056774880', token: 'page-token' };

beforeEach(() => {
  jest.clearAllMocks();
  axios.post.mockResolvedValue({ data: 'Accepted' });
  meta.targets.mockReturnValue({ stockportPage: PAGE, instagram: IG, tamesidePage: null });
  SocialResultPost.enqueue.mockImplementation(async (id, kinds) => kinds.map((target, i) => ({ id: i + 1, target })));
});

// HARD-47: direct means queued. Posting inside the publish request took up to 52 s against
// Firebase's 60 s cut, so sendResultZap writes one row per configured target and returns,
// and `sbl-results-meta` posts them (__tests__/integration/meta-results.test.js).
describe('publishing a result', () => {
  it('queues the result and posts nothing itself — no Meta call, no webhook', async () => {
    const out = await Fixture.sendResultZap({ ...RESULT });

    expect(axios.post).not.toHaveBeenCalled();
    expect(meta.publishEverywhere).not.toHaveBeenCalled();
    expect(SocialResultPost.enqueue).toHaveBeenCalledWith(7300, ['page', 'instagram']);
    expect(out.queued.map(q => q.target)).toEqual(['page', 'instagram']);
  });

  it('queues only a target whose credential is present', async () => {
    meta.targets.mockReturnValue({ stockportPage: null, instagram: IG, tamesidePage: null });
    await Fixture.sendResultZap({ ...RESULT });

    // An unset token means "does not post there", never "post to whatever is left in that
    // slot" — but the ones that ARE configured still go.
    expect(SocialResultPost.enqueue).toHaveBeenCalledWith(7300, ['instagram']);
  });

  // This very nearly shipped as a silent success. The credentials live in the Cloud Run
  // service config, not the repo; a service without them finds nothing to post to, posts
  // nowhere — and reports success, because an empty target list produces neither a post
  // nor a failure. Same shape as `secured`'s 302 that Make.com logged as a successful
  // invoice run: a rejection that looks like an acceptance.
  it('throws rather than queueing nothing when NO target is configured', async () => {
    meta.targets.mockReturnValue({ stockportPage: null, instagram: null, tamesidePage: null });

    await expect(Fixture.sendResultZap({ ...RESULT }))
      .rejects.toThrow(/would have been posted nowhere/);
    expect(SocialResultPost.enqueue).not.toHaveBeenCalled();
    expect(axios.post).not.toHaveBeenCalled();
  });

  it('throws without a fixture id, which the queue cannot do without', async () => {
    await expect(Fixture.sendResultZap({ ...RESULT, fixtureId: undefined }))
      .rejects.toThrow(/fixture id/);
    expect(SocialResultPost.enqueue).not.toHaveBeenCalled();
  });

  it('refuses anything that is not an object', async () => {
    await expect(Fixture.sendResultZap('not an object')).rejects.toThrow(/supplied an object/);
    expect(SocialResultPost.enqueue).not.toHaveBeenCalled();
  });
});

describe('what a queued result is posted as', () => {
  it('is the on-demand card, absolute, percent-encoded and .jpg, with the result as text', () => {
    // Meta fetches the URL from its own servers and Instagram takes JPEG only.
    const c = Fixture.resultPostContent(RESULT);
    expect(c.imageUrls).toBe(
      'https://stockport-badminton.co.uk/resultImage/Tatton%20A/Mellor%20B/11/7/Division%203.jpg');
    expect(c.storyImageUrl).toBe(
      'https://stockport-badminton.co.uk/resultImage/Tatton%20A/Mellor%20B/11/7/Division%203/story.jpg');
    expect(c.message).toMatch(/Result: Tatton A vs Mellor B : 11-7/);
  });

  it("links to the division's results, not the homepage", () => {
    const c = Fixture.resultPostContent(RESULT);
    expect(c.message).toMatch(/ https:\/\/stockport-badminton\.co\.uk\/results\/Division-3$/);
  });
});

describe('the local-development guard still comes first', () => {
  it('sends and queues nothing at all from a dev server', async () => {
    const out = await Fixture.sendResultZap({ ...RESULT, host: '127.0.0.1:8080' });

    expect(out).toBe('test env');
    expect(axios.post).not.toHaveBeenCalled();
    expect(SocialResultPost.enqueue).not.toHaveBeenCalled();
  });
});
