const { canonicalFor, absoluteUrl, eventPath, DEFAULT_ORIGIN } = require('../../utils/canonical');

// The bug this file exists to prevent: every page on the site declared its
// canonical URL (and og:url) to be on the Cloud Run hostname, because the URL was
// built from `req.get('host')` and Firebase Hosting forwards its own host when it
// rewrites to Cloud Run. Both hostnames serve the whole site, so Google was being
// told the authoritative copy of every page lived somewhere else.
//
// A request object is passed in, so the guarantee worth testing is the negative
// one: whatever the request claims the host is, it must not reach the output.
function fakeReq(originalUrl, host) {
  return {
    originalUrl,
    get: () => host,
  };
}

describe('canonicalFor', () => {
  const ORIGINAL_ENV = process.env.SITE_ORIGIN;
  afterEach(() => {
    if (ORIGINAL_ENV === undefined) delete process.env.SITE_ORIGIN;
    else process.env.SITE_ORIGIN = ORIGINAL_ENV;
  });

  it('ignores the request host entirely', () => {
    const url = canonicalFor(fakeReq('/rules', 'league-site-akvq7tsxuq-nw.a.run.app'));
    expect(url).toBe('https://stockport-badminton.co.uk/rules');
    expect(url).not.toContain('run.app');
  });

  it('is not fooled by a spoofed Host header', () => {
    const url = canonicalFor(fakeReq('/tables/All', 'evil.example.com'));
    expect(url).toBe('https://stockport-badminton.co.uk/tables/All');
  });

  it('keeps the percent-encoding the client sent', () => {
    // Event URLs carry team names with spaces; re-encoding or decoding here would
    // produce a canonical that differs from the URL in the sitemap.
    const url = canonicalFor(fakeReq('/event/7313/03092026-Mellor%20A-Aerospace%20A', 'x'));
    expect(url).toBe('https://stockport-badminton.co.uk/event/7313/03092026-Mellor%20A-Aerospace%20A');
  });

  it('strips tracking params but keeps meaningful ones', () => {
    expect(canonicalFor(fakeReq('/gallery?utm_source=facebook&fbclid=abc', 'x')))
      .toBe('https://stockport-badminton.co.uk/gallery');
    expect(canonicalFor(fakeReq('/results/All?division=3', 'x')))
      .toBe('https://stockport-badminton.co.uk/results/All?division=3');
    expect(canonicalFor(fakeReq('/results/All?division=3&gclid=xyz', 'x')))
      .toBe('https://stockport-badminton.co.uk/results/All?division=3');
  });

  it('honours SITE_ORIGIN so a staging deploy does not claim to be production', () => {
    process.env.SITE_ORIGIN = 'https://staging.example.com/';
    expect(canonicalFor(fakeReq('/rules', 'x'))).toBe('https://staging.example.com/rules');
  });

  it('defaults to the live origin', () => {
    delete process.env.SITE_ORIGIN;
    expect(canonicalFor(fakeReq('/', 'x'))).toBe(DEFAULT_ORIGIN + '/');
  });
});

describe('absoluteUrl', () => {
  it('builds request-free URLs for emails and sitemap entries', () => {
    expect(absoluteUrl('/messer-result/42')).toBe('https://stockport-badminton.co.uk/messer-result/42');
    expect(absoluteUrl('messer-result/42')).toBe('https://stockport-badminton.co.uk/messer-result/42');
  });
});

describe('eventPath', () => {
  // The sitemap and homepage.ejs both use this. If they disagreed we would be
  // submitting a second URL for a page that self-canonicalises to the first.
  const fixture = { id: 7313, date: '2026-09-03T00:00:00', homeTeam: 'Mellor A', awayTeam: 'Aerospace A' };

  it('matches the /event/:id/:date-:homeTeam-:awayTeam route shape', () => {
    expect(eventPath(fixture)).toBe('/event/7313/03092026-Mellor%20A-Aerospace%20A');
  });

  it('zero-pads day and month', () => {
    expect(eventPath({ id: 1, date: '2027-01-05T00:00:00', homeTeam: 'A', awayTeam: 'B' }))
      .toBe('/event/1/05012027-A-B');
  });

  it('percent-encodes so the result is a legal URI in XML', () => {
    const p = eventPath({ id: 2, date: '2026-10-07T00:00:00', homeTeam: 'Syddal Park A', awayTeam: 'College Green C' });
    expect(p).not.toContain(' ');
    expect(p).toBe('/event/2/07102026-Syddal%20Park%20A-College%20Green%20C');
  });
});
