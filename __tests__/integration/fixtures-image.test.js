// The weekly fixtures card, one division at a time.
//
// Same contract as the league table images beside it, for the same reason: Meta fetches
// the URL from Meta's own servers, inspects the bytes rather than the extension, accepts
// JPEG only, and retries — so a cached 404 outlives the fault that caused it.
//
// The one rule that is specific to this card is that **a division with no fixtures is a
// 404, not an empty picture**. The caller only ever asks for divisions that have some, so
// reaching this is already a bug; the question is whether that bug is visible. An empty
// card posted to Instagram is not.

process.env.NODE_ENV = 'test';

const request = require('supertest');
const app = require('../../app');
const Fixture = require('../../models/fixture');
const { fixturesImagePath } = require('../../utils/canonical');
const { fixtureCardLines, fixtureDateRange } = require('../../controllers/socialController');

// Premier plays over two nights, Division 2 over one, and Divisions 1 and 3 not at all —
// which is an ordinary week, not an edge case.
const FIXTURES = [
  { id: 1, dayLabel: 'Mon 21 Sep', homeTeam: 'Bramhall Village B', awayTeam: 'Altrincham Central',
    homeClub: 'Bramhall Village', awayClub: 'Altrincham', divisionName: 'Premier' },
  { id: 2, dayLabel: 'Mon 21 Sep', homeTeam: 'Tatton A', awayTeam: 'Disley A',
    homeClub: 'Tatton', awayClub: 'Disley', divisionName: 'Premier' },
  { id: 3, dayLabel: 'Wed 23 Sep', homeTeam: 'Mellor A', awayTeam: 'GHAP A',
    homeClub: 'Mellor', awayClub: 'G.H.A.P', divisionName: 'Premier' },
  { id: 4, dayLabel: 'Tue 22 Sep', homeTeam: 'Dome A', awayTeam: 'Shell B',
    homeClub: 'Dome', awayClub: 'Shell', divisionName: 'Division 2' },
];

let spy;
beforeEach(() => { spy = jest.spyOn(Fixture, 'getUpcomingWeek').mockResolvedValue(FIXTURES); });
afterEach(() => { spy.mockRestore(); });

// The bytes, not the Content-Type header: the header is what we set, the bytes are what
// Meta inspects, and it was the bytes that were wrong on the tables carousel.
const isJpeg = buf => buf[0] === 0xFF && buf[1] === 0xD8;
const isPng = buf => buf[0] === 0x89 && buf[1] === 0x50;

describe('GET /fixtures-image/:division', () => {
  it('returns a JPEG, not a PNG — the format Instagram will accept', async () => {
    const res = await request(app).get('/fixtures-image/Premier');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^image\/jpeg/);
    expect(isJpeg(res.body)).toBe(true);
    expect(isPng(res.body)).toBe(false);
  });

  it('serves a division whose name contains a space', async () => {
    const path = fixturesImagePath('Division 2');
    expect(path).toBe('/fixtures-image/Division%202.jpg');

    const res = await request(app).get(path);
    expect(res.status).toBe(200);
    expect(isJpeg(res.body)).toBe(true);
  });

  it('serves the same picture with or without the .jpg', async () => {
    const withExt = await request(app).get('/fixtures-image/Premier.jpg');
    const without = await request(app).get('/fixtures-image/Premier');
    expect(withExt.status).toBe(200);
    expect(without.body.length).toBe(withExt.body.length);
  });

  // The rule this card has and the table card does not.
  it('404s a division with no fixtures this week rather than drawing an empty card', async () => {
    const res = await request(app).get(fixturesImagePath('Division 1'));
    expect(res.status).toBe(404);
    expect(res.text).toMatch(/No fixtures/);
  });

  it('404s out of season, when no division has any', async () => {
    spy.mockResolvedValue([]);
    const res = await request(app).get(fixturesImagePath('Premier'));
    expect(res.status).toBe(404);
  });

  // Firebase Hosting caches any response that does not set Cache-Control for ten minutes,
  // and Meta retries — so a cached 404 outlives the fault and the retry never sees the fix.
  it('never lets a 404 be cached', async () => {
    const res = await request(app).get(fixturesImagePath('Division 1'));
    expect(res.status).toBe(404);
    expect(res.headers['cache-control']).toBe('no-store');
  });

  // An hour, not the tables' day: this card's content is a function of NOW(), so a copy
  // taken on Sunday evening and served on Monday would show last week's window with
  // nothing on it to say so.
  it('caches a hit for an hour, not for a day', async () => {
    const res = await request(app).get(fixturesImagePath('Premier'));
    expect(res.headers['cache-control']).toMatch(/max-age=3600/);
    expect(res.headers['cache-control']).not.toMatch(/max-age=86400/);
  });
});

// Against the real function the picture draws with, not a copy of its arithmetic.
describe('fixtureCardLines — what the card actually says', () => {
  const premier = FIXTURES.filter(f => f.divisionName === 'Premier');

  it('heads each night once and lists that night’s matches under it', () => {
    expect(fixtureCardLines(premier)).toEqual([
      { kind: 'date', text: 'Mon 21 Sep' },
      { kind: 'fixture', home: 'Bramhall Village B', away: 'Altrincham Central' },
      { kind: 'fixture', home: 'Tatton A', away: 'Disley A' },
      { kind: 'date', text: 'Wed 23 Sep' },
      { kind: 'fixture', home: 'Mellor A', away: 'GHAP A' },
    ]);
  });

  it('does not repeat a night header for consecutive matches on it', () => {
    const dates = fixtureCardLines(premier).filter(l => l.kind === 'date');
    expect(dates).toHaveLength(2);
  });

  // The grouping is positional, so it depends on the rows arriving in date order — which
  // is what the ORDER BY in getUpcomingWeek is for. If that is ever dropped this is the
  // test that says what breaks: a night would head its own list twice.
  it('repeats a night if the rows arrive out of order, which is what the ORDER BY prevents', () => {
    const shuffled = [premier[0], premier[2], premier[1]];
    const dates = fixtureCardLines(shuffled).filter(l => l.kind === 'date');
    expect(dates.map(d => d.text)).toEqual(['Mon 21 Sep', 'Wed 23 Sep', 'Mon 21 Sep']);
  });

  it('never prints the string "null" or "undefined" for a missing field', () => {
    const lines = fixtureCardLines([{ dayLabel: null, homeTeam: undefined, awayTeam: null }]);
    const text = lines.map(l => l.kind === 'date' ? l.text : `${l.home} ${l.away}`).join(' ');
    expect(text).not.toMatch(/null|undefined/);
  });

  it('is empty for no fixtures', () => {
    expect(fixtureCardLines([])).toEqual([]);
  });
});

// Each division's card is drawn on that division's own artwork — the same files the RESULT
// card uses, so a fixtures post and a result post for the same division look like one
// league. The lookup is by name, which means a name with no matching file is reachable:
// a rename, a new division, a friendly. That must not 500 a route Meta is fetching.
describe('the division artwork', () => {
  it('still renders a card for a division with no artwork of its own', async () => {
    spy.mockResolvedValue([{ dayLabel: 'Fri 25 Sep', homeTeam: 'Messer A', awayTeam: 'Messer B',
      homeClub: 'No Club', awayClub: 'No Club', divisionName: 'Messer Knockout' }]);

    const res = await request(app).get(fixturesImagePath('Messer Knockout'));
    expect(res.status).toBe(200);
    expect(isJpeg(res.body)).toBe(true);
  });

  // Asserted on the lookup, not on the rendered bytes. The first version of this test
  // compared a Premier card against a Division 1 card and expected them to differ — which
  // they do regardless, because the division NAME is printed on the picture. It passed
  // against a version that used one background for every division.
  const { fixturesBackground } = require('../../controllers/socialController');

  it('picks each division its own artwork', async () => {
    await expect(fixturesBackground('Premier'))
      .resolves.toBe('static/beta/images/bg/social-Premier.png');
    await expect(fixturesBackground('Division 1'))
      .resolves.toBe('static/beta/images/bg/social-Division-1.png');
  });

  it('falls back to the plain background for a division with no artwork', async () => {
    await expect(fixturesBackground('Messer Knockout'))
      .resolves.toBe('static/beta/images/bg/social.png');
  });
});

// "Fixtures this week" means nothing to somebody who finds the post later, or who does not
// follow the league. The range is parsed out of the SQL-formatted dayLabel rather than
// recomputed from a JS Date, so the heading cannot disagree with the rows beneath it.
describe('fixtureDateRange', () => {
  const on = (...labels) => labels.map(dayLabel => ({ dayLabel }));

  it('gives a range within one month', () => {
    expect(fixtureDateRange(on('Wed 16 Sep', 'Thu 17 Sep', 'Tue 22 Sep'))).toBe('16 \u2013 22 Sep');
  });

  it('keeps both months when the week straddles one', () => {
    expect(fixtureDateRange(on('Mon 28 Sep', 'Sat 4 Oct'))).toBe('28 Sep \u2013 4 Oct');
  });

  it('gives a single date when every fixture is on one night', () => {
    expect(fixtureDateRange(on('Wed 16 Sep', 'Wed 16 Sep'))).toBe('16 Sep');
  });

  it('is empty for no fixtures, so the card simply omits the line', () => {
    expect(fixtureDateRange([])).toBe('');
    expect(fixtureDateRange(on(null, ''))).toBe('');
  });
});

// The accent — the date headings and the "Fixtures this week" line — is derived from each
// division's own artwork rather than hardcoded, so it follows the artwork when those files
// are replaced (HARD-37) instead of becoming four stale hex values in a controller.
//
// It is derived, so it needs a floor. An earlier draft of this card sampled
// `stats().dominant` over the WHOLE image and got the near-white that these backgrounds
// fade to across the bottom third — which put near-white text on a near-white bar and was
// invisible. Sampling the top strip fixes the cause; forcing the lightness is what stops
// any future artwork reintroducing it.
describe('the derived accent colour', () => {
  const { accentFor } = require('../../controllers/socialController');
  const parse = css => css.match(/\d+/g).map(Number);
  const luminance = ([r, g, b]) => 0.299*r + 0.587*g + 0.114*b;

  const BACKGROUNDS = [
    'static/beta/images/bg/social-Premier.png',
    'static/beta/images/bg/social-Division-1.png',
    'static/beta/images/bg/social-Division-2.png',
    'static/beta/images/bg/social-Division-3.png',
    'static/beta/images/bg/social.png',
  ];

  it.each(BACKGROUNDS)('is light enough to read on the dark panel: %s', async bg => {
    const rgb = parse(await accentFor(bg));
    // The panel is #0d0d0f at 80% over artwork, so anything this bright carries.
    expect(luminance(rgb)).toBeGreaterThan(140);
  });

  it.each(BACKGROUNDS)('is not washed out to white: %s', async bg => {
    const [r, g, b] = parse(await accentFor(bg));
    // A colour with no chroma left has stopped saying which division it is.
    expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeGreaterThan(20);
  });

  it('gives different divisions different accents', async () => {
    const premier = await accentFor('static/beta/images/bg/social-Premier.png');
    const div1 = await accentFor('static/beta/images/bg/social-Division-1.png');
    expect(premier).not.toBe(div1);
  });
});
