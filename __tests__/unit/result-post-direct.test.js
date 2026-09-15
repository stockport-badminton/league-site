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
// they pin what the direct path sends — which is the thing no test covered when the same
// job was done by a webhook nobody asserted on.

jest.mock('axios');
jest.mock('../../utils/metaPublisher', () => ({
  targets: jest.fn(),
  publishEverywhere: jest.fn(),
}));

const axios = require('axios');
const meta = require('../../utils/metaPublisher');
const Fixture = require('../../models/fixture');

const RESULT = {
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
  meta.publishEverywhere.mockResolvedValue({
    posted: [{ target: 'Stockport page', kind: 'page', id: 'p1' },
             { target: 'Instagram', kind: 'instagram', id: 'i1' }],
    failed: [], ok: true,
  });
});

describe('with the flag unset, nothing changes', () => {
  it('still posts the Make.com webhook and does not touch Meta', async () => {
    await Fixture.sendResultZap({ ...RESULT });

    expect(axios.post).toHaveBeenCalledTimes(1);
    expect(axios.post.mock.calls[0][0]).toMatch(/hook\.integromat\.com/);
    expect(meta.publishEverywhere).not.toHaveBeenCalled();
  });
});

describe('with SOCIAL_POST_DIRECT=true', () => {
  beforeEach(() => { process.env.SOCIAL_POST_DIRECT = 'true'; });

  it('posts to Meta and sends no webhook', async () => {
    await Fixture.sendResultZap({ ...RESULT });

    expect(axios.post).not.toHaveBeenCalled();
    expect(meta.publishEverywhere).toHaveBeenCalledTimes(1);
  });

  it('targets the page and Instagram, and sends the same image and message', async () => {
    await Fixture.sendResultZap({ ...RESULT });

    const [targets, payload] = meta.publishEverywhere.mock.calls[0];
    expect(targets.map(t => t && t.kind)).toEqual(['page', 'instagram']);
    expect(targets[0]).toMatchObject({ id: PAGE.id, token: PAGE.token });
    expect(targets[1]).toMatchObject({ id: IG.id, token: IG.token });

    // The URL must be the on-demand card, absolute, percent-encoded and ending .jpg —
    // Meta fetches it from its own servers and Instagram takes JPEG only.
    expect(payload.imageUrls).toBe(
      'https://stockport-badminton.co.uk/resultImage/Tatton%20A/Mellor%20B/11/7/Division%203.jpg');
    expect(payload.message).toMatch(/Result: Tatton A vs Mellor B : 11-7/);
  });

  it('skips a target whose credential is absent rather than posting elsewhere', async () => {
    meta.targets.mockReturnValue({ stockportPage: null, instagram: IG, tamesidePage: null });
    await Fixture.sendResultZap({ ...RESULT });

    const [targets] = meta.publishEverywhere.mock.calls[0];
    // An unset token means "does not post there", never "post to whatever is left in that
    // slot" — but the ones that ARE configured still go.
    expect(targets).toHaveLength(1);
    expect(targets[0]).toMatchObject({ kind: 'instagram' });
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
  it('throws rather than posting nowhere when NO target is configured', async () => {
    meta.targets.mockReturnValue({ stockportPage: null, instagram: null, tamesidePage: null });

    await expect(Fixture.sendResultZap({ ...RESULT }))
      .rejects.toThrow(/would have been posted nowhere/);
    expect(meta.publishEverywhere).not.toHaveBeenCalled();
    expect(axios.post).not.toHaveBeenCalled();   // and it does NOT fall back to Make
  });

  // A post that reached Facebook and not Instagram has still reached Facebook. Throwing
  // would tell afterCommit the whole thing failed, and a retry would double-post the half
  // that worked.
  it('does not throw when one target fails and another succeeds', async () => {
    meta.publishEverywhere.mockResolvedValue({
      posted: [{ target: 'Stockport page', kind: 'page', id: 'p1' }],
      failed: [{ target: 'Instagram', error: new Error('media could not be fetched') }],
      ok: false,
    });

    const out = await Fixture.sendResultZap({ ...RESULT });
    expect(out.posted).toHaveLength(1);
    expect(out.failed).toHaveLength(1);
  });

  // ...but a post that went nowhere is a real failure, and afterCommit should record it.
  it('throws when every target failed, so it reaches Sentry', async () => {
    const boom = new Error('Meta rejected the access token');
    meta.publishEverywhere.mockResolvedValue({
      posted: [], failed: [{ target: 'Stockport page', error: boom }], ok: false,
    });

    await expect(Fixture.sendResultZap({ ...RESULT })).rejects.toThrow(/rejected the access token/);
  });
});

describe('the local-development guard still comes first', () => {
  it('sends nothing at all from a dev server, flag or no flag', async () => {
    process.env.SOCIAL_POST_DIRECT = 'true';
    const out = await Fixture.sendResultZap({ ...RESULT, host: '127.0.0.1:8080' });

    expect(out).toBe('test env');
    expect(axios.post).not.toHaveBeenCalled();
    expect(meta.publishEverywhere).not.toHaveBeenCalled();
  });
});
