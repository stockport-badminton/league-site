// The weekly results video post — HARD-21 phase 3.
//
// Same shape as the tables and fixtures posts: `targets()`, per-target reporting, the same
// gate and the same 200/207/502. Two things are specific to video.
//
// **A video container is not usable the moment it is created.** A photo container is; a
// video one has to be fetched and transcoded by Meta first, so the status is polled until
// FINISHED. Publishing early fails with a container-not-ready error, which is why the
// video path is its own set of functions rather than a flag on the photo ones.
//
// **The video has to exist before Meta is told where it is.** Encoding takes ~36 seconds,
// far longer than Meta will wait on a fetch, so it is built ahead of time into S3 and
// served from `GET /social-video/:aspect`.
//
// Posted at 4:5 to both platforms: the slides are 1080x1350 result cards, so 4:5 carries
// them with no bars. Measured 20 Sep 2026 — Reels accepts it and the silent audio track is
// fine. 16:9 was dropped; it was a landscape frame around portrait content.

process.env.NODE_ENV = 'test';

// The handler reads the stored video's age before posting, so S3 has to answer.
let mockVideoModified = new Date();
let mockVideoExists = true;
jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: class {
    async send() {
      if (!mockVideoExists) { const e = new Error('NotFound'); e.name = 'NotFound'; throw e; }
      return { LastModified: mockVideoModified };
    }
  },
  HeadObjectCommand: class { constructor(input) { this.input = input; } },
}));

jest.mock('../../utils/metaPublisher', () => ({
  targets: jest.fn(),
  publishVideoEverywhere: jest.fn(),
  validateVideo: jest.fn(),
}));

const request = require('supertest');
const app = require('../../app');
const meta = require('../../utils/metaPublisher');

const PAGE = { id: '101950371354925', token: 'page-token' };
const IG = { id: '17841409056774880', token: 'page-token' };
const TOKEN = 'social-cron-token-not-real';
const VIDEO_URL = 'https://stockport-badminton.co.uk/social-video/4-5';

beforeEach(() => {
  jest.clearAllMocks();
  process.env.SOCIAL_CRON_TOKEN = TOKEN;
  mockVideoExists = true;
  mockVideoModified = new Date();            // generated just now
  meta.targets.mockReturnValue({ stockportPage: PAGE, instagram: IG, tamesidePage: null });
  meta.publishVideoEverywhere.mockResolvedValue({
    posted: [{ target: 'Stockport page', kind: 'page', id: 'p1' },
             { target: 'Instagram', kind: 'instagram', id: 'i1' }],
    failed: [], ok: true,
  });
  meta.validateVideo.mockResolvedValue({ ok: true, refused: [] });
});
afterEach(() => { delete process.env.SOCIAL_CRON_TOKEN; });

const post = (qs = '') => request(app).post('/admin/social/weekly-video' + qs)
  .set('X-Social-Token', TOKEN);

describe('the gate', () => {
  it('refuses an anonymous caller with 403, not a redirect', async () => {
    const res = await request(app).post('/admin/social/weekly-video');
    expect(res.status).toBe(403);
    expect(res.headers.location).toBeUndefined();
    expect(meta.publishVideoEverywhere).not.toHaveBeenCalled();
  });

  it('an unset token closes the path rather than opening it', async () => {
    delete process.env.SOCIAL_CRON_TOKEN;
    const res = await request(app).post('/admin/social/weekly-video').set('X-Social-Token', TOKEN);
    expect(res.status).toBe(403);
  });
});

describe('what gets posted', () => {
  it('sends the 4:5 video, on our own domain', async () => {
    await post();
    const [, payload] = meta.publishVideoEverywhere.mock.calls[0];
    expect(payload.videoUrl).toBe(VIDEO_URL);
    // The objects are private; a bucket URL 403s for everyone, which is HARD-21's
    // original finding and the reason the read route exists.
    expect(payload.videoUrl).not.toMatch(/amazonaws\.com/);
  });

  // 16:9 was a landscape frame carrying portrait content and spent most of its width on
  // black bars. If it ever comes back, this is what says so.
  it('does not post 16:9', async () => {
    await post();
    const [, payload] = meta.publishVideoEverywhere.mock.calls[0];
    expect(payload.videoUrl).not.toMatch(/16-9/);
    expect(payload.videoUrl).toMatch(/4-5$/);
  });

  it('posts to the page and Instagram', async () => {
    await post();
    const [targets] = meta.publishVideoEverywhere.mock.calls[0];
    expect(targets.map(t => t.kind)).toEqual(['page', 'instagram']);
  });

  it('carries a caption for each platform and a link to the site', async () => {
    await post();
    const [, payload] = meta.publishVideoEverywhere.mock.calls[0];
    expect(payload.message).toContain('stockport-badminton.co.uk');
    expect(payload.caption).toContain('stockport-badminton.co.uk');
  });

  // Deliberate: a results video names every club that played, and mentioning all of them
  // reads as spam. The tables post makes the opposite call because its mentions are the
  // point. Facebook page mentions are not @-syntax at all and need a feature we lack.
  it('carries no @-mentions on either platform', async () => {
    await post();
    const [, payload] = meta.publishVideoEverywhere.mock.calls[0];
    expect(payload.message).not.toContain('@');
    expect(payload.caption).not.toContain('@');
  });
});

describe('reporting what happened', () => {
  it('207 when one target took it and another did not', async () => {
    meta.publishVideoEverywhere.mockResolvedValue({
      posted: [{ target: 'Stockport page', kind: 'page', id: 'p1' }],
      failed: [{ target: 'Instagram', error: new Error('could not be processed') }],
      ok: false,
    });
    const res = await post();
    expect(res.status).toBe(207);
    expect(res.body.failed[0]).toMatchObject({ target: 'Instagram' });
  });

  it('502 when it reached nowhere', async () => {
    meta.publishVideoEverywhere.mockResolvedValue({
      posted: [], failed: [{ target: 'Stockport page', error: new Error('nope') }], ok: false,
    });
    expect((await post()).status).toBe(502);
  });

  it('fails loudly when no target is configured at all', async () => {
    meta.targets.mockReturnValue({ stockportPage: null, instagram: null, tamesidePage: null });
    const res = await post();
    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/posted nowhere/);
    expect(meta.publishVideoEverywhere).not.toHaveBeenCalled();
  });
});

describe('the dry run', () => {
  // A container expires on its own in 24h, so this costs nothing and leaves nothing
  // behind — the video equivalent of validateImages.
  it('asks Meta to transcode and publishes nothing', async () => {
    const res = await post('?dry=1');
    expect(res.status).toBe(200);
    expect(res.body.dry).toBe(true);
    expect(meta.validateVideo).toHaveBeenCalledWith(IG.id, IG.token, VIDEO_URL);
    expect(meta.publishVideoEverywhere).not.toHaveBeenCalled();
  });

  it('reports a refusal rather than pretending it is fine', async () => {
    meta.validateVideo.mockResolvedValue({
      ok: false, refused: [{ url: VIDEO_URL, reason: 'Meta could not process the video' }],
    });
    const res = await post('?dry=1');
    expect(res.body.ok).toBe(false);
    expect(res.body.refused[0].reason).toMatch(/could not process/);
  });
});

// Behind secured + superadmin, so supertest cannot reach it. Rendered here with the
// controller's own locals instead — an EJS error or a forgotten local only shows at render
// time, and this page is the only way anyone looks at the post before it goes out.
describe('the preview page', () => {
  const weekly = require('../../controllers/weeklyVideoController');

  const renderPreview = async () => {
    let captured;
    const res = { render: (view, locals) => { captured = { view, locals }; } };
    await weekly.preview({ query: {}, get: () => 'stockport-badminton.co.uk', headers: {}, protocol: 'https' },
      res, e => { throw e; });
    return new Promise((resolve, reject) => {
      app.render(captured.view, captured.locals, (err, html) => err ? reject(err) : resolve(html));
    });
  };

  it('renders, with a player for the 4:5 video', async () => {
    const html = await renderPreview();
    expect(html).toContain('<video');
    expect(html).toContain('4-5');
  });

  // The defect both the tables and fixtures previews shipped with: an absolute src means
  // the page shows PRODUCTION's file whatever server it runs on.
  it('plays this server’s video, not the production domain’s', async () => {
    const html = await renderPreview();
    const src = html.match(/<video src="([^"]*)"/)[1];
    expect(src.startsWith('/')).toBe(true);
    expect(src).not.toMatch(/^https?:\/\//);
  });

  it('still shows the absolute URL Meta will fetch', async () => {
    const html = await renderPreview();
    expect(html).toContain('https://stockport-badminton.co.uk/social-video/4-5');
  });
});

// The handler posts whatever is in the bucket, and the bucket keeps the last render for
// ever. So a generation that did not happen — the endpoint refused, the encode crashed,
// the scheduler misfired — would publish LAST WEEK'S RESULTS as this week's, under a
// caption saying so. Worse than posting nothing, and the same class of silent wrongness
// this feature has already produced twice.
describe('refusing to post a stale or missing video', () => {
  it('refuses when the stored video is older than the posting cycle', async () => {
    mockVideoModified = new Date(Date.now() - 9 * 24 * 60 * 60 * 1000);   // nine days

    const res = await post();

    expect(res.status).toBe(409);
    expect(res.body.ok).toBe(false);
    expect(res.body.error).toMatch(/9 days old/);
    expect(res.body.error).toMatch(/not this week/i);
    expect(meta.publishVideoEverywhere).not.toHaveBeenCalled();
  });

  it('refuses when nothing has been generated at all', async () => {
    mockVideoExists = false;

    const res = await post();

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/No video has been generated/i);
    expect(meta.publishVideoEverywhere).not.toHaveBeenCalled();
  });

  // The refusal says what to do about it. A 409 that only said "stale" would send the
  // reader to the code to find out how to fix it.
  it('names the step that was missed', async () => {
    mockVideoExists = false;
    const res = await post();
    expect(res.body.error).toMatch(/generate-weekly-video/);
  });

  it('posts happily when the video is fresh', async () => {
    mockVideoModified = new Date(Date.now() - 60 * 1000);
    const res = await post();
    expect(res.status).toBe(200);
    expect(meta.publishVideoEverywhere).toHaveBeenCalledTimes(1);
  });

  // A dry run must not slip past the guard either: validating a stale video against Meta
  // would report "ok" for something that must not be posted.
  it('refuses a dry run on a stale video too', async () => {
    mockVideoModified = new Date(Date.now() - 9 * 24 * 60 * 60 * 1000);
    const res = await post('?dry=1');
    expect(res.status).toBe(409);
    expect(meta.validateVideo).not.toHaveBeenCalled();
  });
});
