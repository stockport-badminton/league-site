// Publishing a result to Meta from here, instead of handing it to Make.com.
//
// `SOCIAL_POST_DIRECT=true` switches `sendResultZap` from posting a webhook to posting the
// result itself. Unset keeps the old path, so a rollback is one environment variable rather
// than one deploy — this runs when a captain publishes a result, and a bad week is a week
// of missing posts nobody notices until someone asks.
//
// **The switch needs no change in Make at all**, which is worth pinning here because it is
// not obvious and someone will otherwise "tidy up" the scenario and break Tameside. That
// one scenario serves both leagues off a single webhook, routed by whether `imgUrl`
// contains `stockport-badminton` or `tameside-badminton`, and Tameside posts its own
// webhook from its own site. Stop sending ours and route 1 never fires; Tameside's route is
// untouched.
//
// Both of those are now history: Tameside ported on 15 Sep 2026 and every Make scenario is
// disabled. The flag stays because it is the rollback path, and these tests stay because
// they pin what the direct path does — which is the thing no test covered when the same
// job was done by a webhook nobody asserted on.

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
  delete process.env.SOCIAL_POST_DIRECT;
  axios.post.mockResolvedValue({ data: 'Accepted' });
  meta.targets.mockReturnValue({ stockportPage: PAGE, instagram: IG, tamesidePage: null });
  SocialResultPost.enqueue.mockImplementation(async (id, kinds) => kinds.map((target, i) => ({ id: i + 1, target })));
});

describe('with the flag unset, nothing changes', () => {
  it('still posts the Make.com webhook and does not touch Meta or the queue', async () => {
    await Fixture.sendResultZap({ ...RESULT });

    expect(axios.post).toHaveBeenCalledTimes(1);
    expect(axios.post.mock.calls[0][0]).toMatch(/hook\.integromat\.com/);
    expect(meta.publishEverywhere).not.toHaveBeenCalled();
    expect(SocialResultPost.enqueue).not.toHaveBeenCalled();
  });
});

// HARD-47: direct means queued. Posting inside the publish request took up to 52 s against
// Firebase's 60 s cut, so sendResultZap writes one row per configured target and returns,
// and `sbl-results-meta` posts them (__tests__/integration/meta-results.test.js).
describe('with SOCIAL_POST_DIRECT=true', () => {
  beforeEach(() => { process.env.SOCIAL_POST_DIRECT = 'true'; });

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

  // This very nearly shipped as a silent success, and it is the most dangerous thing in
  // the change. The flag lives in the Cloud Run service config; the credentials live in
  // .env, which is gitignored and never deployed. Setting one without the other gives a
  // service that takes the direct path, finds nothing to post to, posts nowhere — and
  // reports success, because an empty target list produces neither a post nor a failure.
  //
  // Same shape as `secured`'s 302 that Make.com logged as a successful invoice run: a
  // rejection that looks like an acceptance. A switch whose halves live in different
  // places has to fail loudly when only one is set.
  it('throws rather than queueing nothing when NO target is configured', async () => {
    meta.targets.mockReturnValue({ stockportPage: null, instagram: null, tamesidePage: null });

    await expect(Fixture.sendResultZap({ ...RESULT }))
      .rejects.toThrow(/would have been posted nowhere/);
    expect(SocialResultPost.enqueue).not.toHaveBeenCalled();
    expect(axios.post).not.toHaveBeenCalled();   // and it does NOT fall back to Make
  });

  it('throws without a fixture id, which the queue cannot do without', async () => {
    await expect(Fixture.sendResultZap({ ...RESULT, fixtureId: undefined }))
      .rejects.toThrow(/fixture id/);
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
});

describe('the local-development guard still comes first', () => {
  it('sends and queues nothing at all from a dev server, flag or no flag', async () => {
    process.env.SOCIAL_POST_DIRECT = 'true';
    const out = await Fixture.sendResultZap({ ...RESULT, host: '127.0.0.1:8080' });

    expect(out).toBe('test env');
    expect(axios.post).not.toHaveBeenCalled();
    expect(SocialResultPost.enqueue).not.toHaveBeenCalled();
  });
});
