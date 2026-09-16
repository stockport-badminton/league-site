// The weekly fixtures post — the Sunday-evening, forward-looking twin of the Saturday
// tables post. New, not ported: Make.com's League Tables scenario only ever looked
// backwards, so there is no prior behaviour to stay compatible with.
//
// The interesting difference from the tables post, and most of what is asserted here, is
// that **this post's content can legitimately be empty**. The league plays September to
// April. A job that fires every Sunday of the year must publish nothing through the summer
// rather than four cards headed "Fixtures this week" with nothing underneath — and must
// say which of the two it did, because `posted: []` with `ok: true` is otherwise
// indistinguishable from a post that went out.

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
const Fixture = require('../../models/fixture');

const PAGE = { id: '101950371354925', token: 'page-token' };
const IG = { id: '17841409056774880', token: 'page-token' };
const TOKEN = 'social-cron-token-not-real';

// Premier over two nights, Division 2 over one, Divisions 1 and 3 not playing.
const FIXTURES = [
  { id: 1, dayLabel: 'Mon 21 Sep', homeTeam: 'Mellor A', awayTeam: 'GHAP A',
    homeClub: 'Mellor', awayClub: 'G.H.A.P', divisionName: 'Premier' },
  { id: 2, dayLabel: 'Mon 21 Sep', homeTeam: 'Tatton A', awayTeam: 'Disley A',
    homeClub: 'Tatton', awayClub: 'Disley', divisionName: 'Premier' },
  { id: 3, dayLabel: 'Wed 23 Sep', homeTeam: 'Dome A', awayTeam: 'Shell B',
    homeClub: 'Dome', awayClub: 'Shell', divisionName: 'Division 2' },
];

let spy;
beforeEach(() => {
  jest.clearAllMocks();
  process.env.SOCIAL_CRON_TOKEN = TOKEN;
  spy = jest.spyOn(Fixture, 'getUpcomingWeek').mockResolvedValue(FIXTURES);
  meta.targets.mockReturnValue({ stockportPage: PAGE, instagram: IG, tamesidePage: null });
  meta.publishEverywhere.mockResolvedValue({
    posted: [{ target: 'Stockport page', kind: 'page', id: 'p1' },
             { target: 'Instagram', kind: 'instagram', id: 'i1' }],
    failed: [], ok: true,
  });
  meta.validateImages.mockResolvedValue({ ok: true, refused: [] });
  Club.getInstagramHandles.mockResolvedValue([
    { name: 'G.H.A.P', handle: 'ghapbadminton' },
    { name: 'Mellor', handle: 'mellorbadminton' },
    // Has a handle, but is not playing this week.
    { name: 'Manor', handle: 'manorbadmintonclubwilmslow' },
  ]);
});
afterEach(() => {
  spy.mockRestore();
  delete process.env.SOCIAL_CRON_TOKEN;
});

const post = (qs = '') => request(app).post('/admin/social/weekly-fixtures' + qs)
  .set('X-Social-Token', TOKEN);

describe('the gate', () => {
  it('refuses an anonymous caller with 403, not a redirect', async () => {
    const res = await request(app).post('/admin/social/weekly-fixtures');
    expect(res.status).toBe(403);
    expect(res.headers.location).toBeUndefined();
    expect(meta.publishEverywhere).not.toHaveBeenCalled();
  });

  it('an unset token closes the path rather than opening it', async () => {
    delete process.env.SOCIAL_CRON_TOKEN;
    const res = await request(app).post('/admin/social/weekly-fixtures').set('X-Social-Token', TOKEN);
    expect(res.status).toBe(403);
  });
});

describe('what gets posted', () => {
  // The tables post always has four cards because a division always has a table. This one
  // is built from the fixtures that exist, so the card count varies week to week.
  it('sends a card only for the divisions playing, in table order', async () => {
    await post();

    const [, payload] = meta.publishEverywhere.mock.calls[0];
    expect(payload.imageUrls).toEqual([
      'https://stockport-badminton.co.uk/fixtures-image/Premier.jpg',
      'https://stockport-badminton.co.uk/fixtures-image/Division%202.jpg',
    ]);
  });

  // Driven by the DIVISIONS list rather than by whatever divisionName values come back, so
  // a friendly, a tournament or a renamed division cannot quietly add a fifth card.
  // Instagram's carousel limit is 10; a runaway list fails the post rather than looking odd.
  it('ignores a fixture in a division that is not one of the four', async () => {
    spy.mockResolvedValue([...FIXTURES,
      { id: 9, dayLabel: 'Fri 25 Sep', homeTeam: 'Messer A', awayTeam: 'Messer B',
        homeClub: 'No Club', awayClub: 'No Club', divisionName: 'Messer Knockout' }]);
    await post();
    const [, payload] = meta.publishEverywhere.mock.calls[0];
    expect(payload.imageUrls).toHaveLength(2);
    expect(payload.imageUrls.join(' ')).not.toMatch(/Messer/);
  });

  it('posts to the page and Instagram with different text for each', async () => {
    await post();
    const [targets, payload] = meta.publishEverywhere.mock.calls[0];
    expect(targets.map(t => t.kind)).toEqual(['page', 'instagram']);
    expect(payload.message).not.toBe(payload.caption);
  });

  // A mention is a notification. Notifying a club about a week it is not playing in is how
  // an account gets muted — so this post names the clubs playing, not every club with a
  // handle, which is where it differs from the tables post.
  it('mentions only the clubs actually playing this week', async () => {
    await post();
    const [, payload] = meta.publishEverywhere.mock.calls[0];
    expect(payload.caption).toContain('@ghapbadminton');
    expect(payload.caption).toContain('@mellorbadminton');
    expect(payload.caption).not.toContain('@manorbadmintonclubwilmslow');
  });

  it('carries no mentions when nobody playing has a handle', async () => {
    Club.getInstagramHandles.mockResolvedValue([{ name: 'Manor', handle: 'manorbadmintonclubwilmslow' }]);
    await post();
    const [, payload] = meta.publishEverywhere.mock.calls[0];
    expect(payload.caption).not.toContain('@');
  });

  // A Facebook page mention is not @-syntax at all — it needs the Page Mentioning feature,
  // which needs App Review and business verification, and `@[page-id]` is silently
  // consumed without it (measured 16 Sep 2026). Make posted literal `@Club Name` strings
  // for years to no effect.
  it('does not put fake @-names in the Facebook message', async () => {
    await post();
    const [, payload] = meta.publishEverywhere.mock.calls[0];
    expect(payload.message).not.toMatch(/@[A-Z]/);
  });

  it('counts the matches in both captions, and says "match" for one', async () => {
    await post();
    const [, payload] = meta.publishEverywhere.mock.calls[0];
    expect(payload.message).toContain('3 matches this week');
    expect(payload.caption).toContain('3 matches this week');

    spy.mockResolvedValue([FIXTURES[0]]);
    await post();
    const [, one] = meta.publishEverywhere.mock.calls[1];
    expect(one.message).toContain('1 match this week');
  });
});

describe('a week with no fixtures', () => {
  beforeEach(() => spy.mockResolvedValue([]));

  it('publishes nothing at all', async () => {
    await post();
    expect(meta.publishEverywhere).not.toHaveBeenCalled();
  });

  // 200 because nothing went wrong — a scheduler retrying a 4xx every Sunday through the
  // summer is noise. But never mistakable for a post that went out.
  it('answers 200 and says it skipped, with nothing in posted', async () => {
    const res = await post();
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.skipped).toMatch(/no fixtures/i);
    expect(res.body.posted).toEqual([]);
    expect(res.body.fixtures).toBe(0);
  });

  it('does not ask Meta to validate images it is not going to post', async () => {
    await post('?dry=1');
    expect(meta.validateImages).not.toHaveBeenCalled();
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
    expect(res.body.failed[0]).toMatchObject({ target: 'Instagram' });
  });

  it('502 when it reached nowhere', async () => {
    meta.publishEverywhere.mockResolvedValue({
      posted: [], failed: [{ target: 'Stockport page', error: new Error('nope') }], ok: false,
    });
    expect((await post()).status).toBe(502);
  });

  // Posting nowhere must never read as success — the same rule as the tables post, and the
  // same shape as `secured`'s 302 that Make.com logged as a successful invoice run.
  it('fails loudly when no target is configured at all', async () => {
    meta.targets.mockReturnValue({ stockportPage: null, instagram: null, tamesidePage: null });
    const res = await post();
    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/posted nowhere/);
    expect(meta.publishEverywhere).not.toHaveBeenCalled();
  });

  // The two empty cases are different and must not look alike: no credentials is a
  // misconfiguration to fix, no fixtures is an ordinary July.
  it('tells "no credentials" apart from "no fixtures"', async () => {
    const noFixtures = await post();
    meta.targets.mockReturnValue({ stockportPage: null, instagram: null, tamesidePage: null });
    const noCreds = await post();
    expect(noFixtures.status).not.toBe(noCreds.status);
  });
});

describe('the dry run', () => {
  it('asks Meta whether it will accept the cards and publishes nothing', async () => {
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

// The preview page is behind `secured` + superadmin, so supertest cannot reach it without
// a session. That is not a reason to leave it untested: an EJS error or a local the
// controller forgets to pass only ever surfaces at render time, and this page is the only
// way anyone looks at the post before it goes out.
//
// So the controller is called with a stubbed `res` and the view is then rendered for real
// with exactly the locals it asked for. **Asserting on the HTML rather than on the view
// name** is the point — `__tests__/integration/messer-scorecard.test.js` stayed green over
// a blank page for months by checking only which view was chosen.
describe('the preview page', () => {
  const weekly = require('../../controllers/weeklyFixturesController');

  const renderPreview = async () => {
    let captured;
    const res = { render: (view, locals) => { captured = { view, locals }; } };
    await weekly.preview({ query: {}, get: () => 'stockport-badminton.co.uk', headers: {}, protocol: 'https' }, res, e => { throw e; });
    return new Promise((resolve, reject) => {
      app.render(captured.view, captured.locals, (err, html) => err ? reject(err) : resolve(html));
    });
  };

  it('renders, with a card for each division playing', async () => {
    const html = await renderPreview();
    expect(html).toContain('/fixtures-image/Premier.jpg');
    expect(html).toContain('/fixtures-image/Division%202.jpg');
    // Divisions 1 and 3 are not playing this week, so they get no card.
    expect(html).not.toContain('/fixtures-image/Division%201.jpg');
  });

  // The defect this replaced: `<img src="https://stockport-badminton.co.uk/…">`. The page
  // then shows PRODUCTION's rendering of the card whatever server you are looking at — so a
  // change to the renderer appears to do nothing locally, and a route that is not deployed
  // yet shows no image at all while the page reports how many there are. Same-origin `src`,
  // absolute URL shown as text beside it.
  it('displays the cards from this server, not from the production domain', async () => {
    const html = await renderPreview();
    const srcs = [...html.matchAll(/<img src="([^"]*fixtures-image[^"]*)"/g)].map(m => m[1]);

    expect(srcs).toHaveLength(2);
    for (const src of srcs) {
      expect(src.startsWith('/')).toBe(true);
      expect(src).not.toMatch(/^https?:\/\//);
    }
  });

  // ...but still says what will be posted, because that is what a preview is for.
  it('shows the absolute URL Meta will fetch, as text', async () => {
    const html = await renderPreview();
    expect(html).toContain('posts as https://stockport-badminton.co.uk/fixtures-image/Premier.jpg');
  });

  it('names the clubs that would actually be mentioned', async () => {
    const html = await renderPreview();
    expect(html).toContain('G.H.A.P');
    expect(html).not.toContain('Manor');
  });

  // The page a superadmin checks in July must say why it is empty, not just be empty.
  it('says nothing would be posted when there are no fixtures', async () => {
    spy.mockResolvedValue([]);
    const html = await renderPreview();
    expect(html).toMatch(/No fixtures in the coming seven days/);
    expect(html).not.toContain('/fixtures-image/');
  });
});
