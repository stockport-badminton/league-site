// The weekly league-tables post, published from here rather than by Make.com.
//
// Make's scenario has three routes and TWO OF THEM ARE DEAD: routes 1 and 2 add tournament
// posters and are both gated on a `tournament` variable the scenario hardcodes to
// `"false"`. Route 3 has no filter and is the entire live behaviour — four tables to
// Stockport, plus Tameside's two to the Tameside page. This reproduces route 3's Stockport
// half; Tameside deliberately stays in Make until that league is ported.
//
// The Instagram half of that post has never worked, for two reasons both now fixed: the
// images were PNG and Instagram takes JPEG only, and they were files on a container's disk
// that had 404'd by the time Meta fetched them.

process.env.NODE_ENV = 'test';

jest.mock('../../utils/metaPublisher', () => ({
  targets: jest.fn(),
  publishEverywhere: jest.fn(),
  validateImages: jest.fn(),
}));

jest.mock('../../models/club', () => ({
  getInstagramHandles: jest.fn(),
}));

const request = require('supertest');
const app = require('../../app');
const meta = require('../../utils/metaPublisher');
const Club = require('../../models/club');

const PAGE = { id: '101950371354925', token: 'page-token' };
const IG = { id: '17841409056774880', token: 'page-token' };
const TOKEN = 'social-cron-token-not-real';

beforeEach(() => {
  jest.clearAllMocks();
  process.env.SOCIAL_CRON_TOKEN = TOKEN;
  meta.targets.mockReturnValue({ stockportPage: PAGE, instagram: IG, tamesidePage: null });
  meta.publishEverywhere.mockResolvedValue({
    posted: [{ target: 'Stockport page', kind: 'page', id: 'p1' },
             { target: 'Instagram', kind: 'instagram', id: 'i1' }],
    failed: [], ok: true,
  });
  meta.validateImages.mockResolvedValue({ ok: true, refused: [] });
  Club.getInstagramHandles.mockResolvedValue([
    { name: 'G.H.A.P', handle: 'ghapbadminton' },
    { name: 'Manor', handle: 'manorbadmintonclubwilmslow' },
  ]);
});
afterEach(() => { delete process.env.SOCIAL_CRON_TOKEN; });

const post = (qs = '') => request(app).post('/admin/social/weekly-tables' + qs)
  .set('X-Social-Token', TOKEN);

describe('the gate', () => {
  it('refuses an anonymous caller with 403, not a redirect', async () => {
    const res = await request(app).post('/admin/social/weekly-tables');
    expect(res.status).toBe(403);
    expect(res.headers.location).toBeUndefined();
    expect(meta.publishEverywhere).not.toHaveBeenCalled();
  });

  it('an unset token closes the path rather than opening it', async () => {
    delete process.env.SOCIAL_CRON_TOKEN;
    const res = await request(app).post('/admin/social/weekly-tables').set('X-Social-Token', TOKEN);
    expect(res.status).toBe(403);
  });
});

describe('what gets posted', () => {
  it('sends the four tables, top division first, as absolute JPEG URLs', async () => {
    await post();

    const [, payload] = meta.publishEverywhere.mock.calls[0];
    expect(payload.imageUrls).toEqual([
      'https://stockport-badminton.co.uk/league-table-image/Premier.jpg',
      'https://stockport-badminton.co.uk/league-table-image/Division%201.jpg',
      'https://stockport-badminton.co.uk/league-table-image/Division%202.jpg',
      'https://stockport-badminton.co.uk/league-table-image/Division%203.jpg',
    ]);
  });

  it('posts to the page and Instagram with different text for each', async () => {
    await post();
    const [targets, payload] = meta.publishEverywhere.mock.calls[0];
    expect(targets.map(t => t.kind)).toEqual(['page', 'instagram']);
    // Facebook gets `message`, Instagram gets `caption`, and they are not the same string.
    expect(payload.message).not.toBe(payload.caption);
  });

  // Instagram turns a bare @handle into a real mention. The handles must come from the
  // database: the Make scenario's hardcoded list had drifted to `@manor_badminton_club`
  // where the club's stored handle is `manorbadmintonclubwilmslow`, and named a club with
  // no Instagram handle at all. A wrong handle mentions a stranger or nothing, silently.
  it('mentions clubs on Instagram using their stored handles', async () => {
    await post();
    const [, payload] = meta.publishEverywhere.mock.calls[0];
    expect(payload.caption).toContain('@ghapbadminton');
    expect(payload.caption).toContain('@manorbadmintonclubwilmslow');
    expect(payload.caption).not.toContain('@manor_badminton_club');
  });

  // Facebook page mentions need the Pages API; the `@Shell Badminton Club` text the Make
  // scenario carries does nothing and has been posting literal @-names for years.
  it('does not put fake @-names in the Facebook message', async () => {
    await post();
    const [, payload] = meta.publishEverywhere.mock.calls[0];
    expect(payload.message).not.toMatch(/@[A-Z]/);
  });

  it('carries no mentions at all when no club has a handle', async () => {
    Club.getInstagramHandles.mockResolvedValue([]);
    await post();
    const [, payload] = meta.publishEverywhere.mock.calls[0];
    expect(payload.caption).not.toContain('@');
  });

  it('adds tournament posters only when asked, and ignores unknown ones', async () => {
    await post('?posters=handicap,nonesuch');
    const [, payload] = meta.publishEverywhere.mock.calls[0];
    expect(payload.imageUrls).toHaveLength(5);
    expect(payload.imageUrls[4]).toBe('https://stockport-badminton.co.uk/tournament-image/handicap.jpg');
  });
});

describe('reporting what happened', () => {
  it('207 when one target took it and another did not', async () => {
    meta.publishEverywhere.mockResolvedValue({
      posted: [{ target: 'Stockport page', kind: 'page', id: 'p1' }],
      failed: [{ target: 'Instagram', error: new Error('media could not be fetched') }],
      ok: false,
    });
    const res = await post();
    expect(res.status).toBe(207);
    expect(res.body.posted).toHaveLength(1);
    expect(res.body.failed[0]).toMatchObject({ target: 'Instagram' });
  });

  it('502 when it reached nowhere', async () => {
    meta.publishEverywhere.mockResolvedValue({
      posted: [], failed: [{ target: 'Stockport page', error: new Error('nope') }], ok: false,
    });
    expect((await post()).status).toBe(502);
  });

  // Posting nowhere must never read as success — the same rule as the result post, and the
  // same shape as `secured`'s 302 that Make.com logged as a successful invoice run.
  it('fails loudly when no target is configured at all', async () => {
    meta.targets.mockReturnValue({ stockportPage: null, instagram: null, tamesidePage: null });
    const res = await post();
    expect(res.status).toBe(500);
    expect(res.body.ok).toBe(false);
    expect(res.body.error).toMatch(/posted nowhere/);
    expect(meta.publishEverywhere).not.toHaveBeenCalled();
  });
});

describe('the dry run', () => {
  it('asks Meta whether it will accept the images and publishes nothing', async () => {
    const res = await post('?dry=1');
    expect(res.status).toBe(200);
    expect(res.body.dry).toBe(true);
    expect(meta.validateImages).toHaveBeenCalledTimes(1);
    expect(meta.publishEverywhere).not.toHaveBeenCalled();
  });

  it('reports a refusal rather than pretending it is fine', async () => {
    meta.validateImages.mockResolvedValue({
      ok: false, refused: [{ url: 'https://x.co/a.png', reason: 'Instagram accepts JPEG only' }],
    });
    const res = await post('?dry=1');
    expect(res.body.ok).toBe(false);
    expect(res.body.refused[0].reason).toMatch(/JPEG only/);
  });
});

// The preview page is behind `secured` + superadmin, so supertest cannot reach it. It had
// the same defect the fixtures preview was built with and fixed: absolute `<img src>`
// values, which make the page show **production's** rendering of each table whatever
// server it is running on. That hid here rather than failing, because these routes ARE
// deployed — so the production picture loaded happily over the top of whatever the local
// code would have drawn, and a renderer change looked like a no-op.
describe('the preview page', () => {
  const weekly = require('../../controllers/weeklyTablesController');

  const renderPreview = async () => {
    let captured;
    const res = { render: (view, locals) => { captured = { view, locals }; } };
    await weekly.preview({ query: {}, get: () => 'stockport-badminton.co.uk', headers: {}, protocol: 'https' }, res, e => { throw e; });
    return new Promise((resolve, reject) => {
      app.render(captured.view, captured.locals, (err, html) => err ? reject(err) : resolve(html));
    });
  };

  it('displays the tables from this server, not from the production domain', async () => {
    const html = await renderPreview();
    const srcs = [...html.matchAll(/<img src="([^"]*league-table-image[^"]*)"/g)].map(m => m[1]);

    expect(srcs).toHaveLength(4);
    for (const src of srcs) {
      expect(src.startsWith('/')).toBe(true);
      expect(src).not.toMatch(/^https?:\/\//);
    }
  });

  it('shows the absolute URL Meta will fetch, as text', async () => {
    const html = await renderPreview();
    expect(html).toContain('posts as https://stockport-badminton.co.uk/league-table-image/Premier.jpg');
  });
});
