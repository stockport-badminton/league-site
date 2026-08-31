const fs = require('fs');
const path = require('path');
const request = require('supertest');

// Security response headers (HARD-12).
//
// Nothing was set at all: no HSTS, no nosniff, no frame protection, no CSP. The site
// could be framed, and any markup bug that let a script through had nothing standing
// behind it.
//
// The split this file asserts is the whole design. Two CSP headers go out:
//
//   Content-Security-Policy             — only directives that cannot break a page that
//                                         is already working (no resource allowlists)
//   Content-Security-Policy-Report-Only — the full allowlist, observed not enforced
//
// A CSP is the one change in the hardening backlog that can break pages it never
// touched. This site's forms are heavily inline-scripted, the scorecard modal is a
// jQuery wizard filling its dropdowns from three endpoints, and the stats tables are
// DataTables. Breaking that on a Tuesday night while captains file results is worse
// than having no policy, so the resource allowlist observes first and enforces later.

jest.mock('../../models/fixture');
jest.mock('../../models/venue');
jest.mock('../../models/club');
jest.mock('../../models/division');
jest.mock('../../models/auth.js');
jest.mock('../../models/homepageContent');
jest.mock('../../models/siteSettings');
jest.mock('axios');

const Fixture = require('../../models/fixture');
const HomepageContent = require('../../models/homepageContent');
const SiteSettings = require('../../models/siteSettings');
const axios = require('axios');
const app = require('../../app');

function homepage() {
  Fixture.getOutstandingScorecards.mockResolvedValue([]);
  Fixture.getRecent.mockResolvedValue([]);
  Fixture.getupComing.mockResolvedValue([]);
  HomepageContent.getActive.mockResolvedValue([]);
  SiteSettings.get.mockResolvedValue('messer2026');
  axios.get.mockResolvedValue({ data: { resources: [] } });
  return request(app).get('/');
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('the headers that enforce now', () => {
  it('sets them on a rendered page', async () => {
    const res = await homepage();
    expect(res.status).toBe(200);
    expect(res.headers['strict-transport-security']).toMatch(/max-age=\d{7,}/);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(res.headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
  });

  // HSTS applies to this host only unless someone opts in.
  //
  // `includeSubDomains` commits every subdomain of stockport-badminton.co.uk to HTTPS
  // for a year, and a browser that has seen the header keeps honouring it — so an
  // http-only subdomain breaks and stays broken for anyone who has visited, whatever we
  // serve afterwards. Nobody has confirmed what is on the subdomains.
  //
  // The assertion above only ever matched `max-age`, so this directive was untested in
  // both directions and could be flipped by accident without a test noticing.
  it('does not claim the subdomains without an explicit opt-in', async () => {
    const res = await homepage();
    expect(res.headers['strict-transport-security']).not.toMatch(/includeSubDomains/i);
  });
});

describe('HSTS_INCLUDE_SUBDOMAINS', () => {
  // Tested against the function that builds the value, not by booting a second app.
  //
  // The first version of this did `jest.resetModules()` and `require('../../app')`, which
  // constructs a whole second application including a second pg pool. It leaked — Jest
  // reported "a worker process has failed to exit gracefully" — and timed out about one
  // full run in nine, looking exactly like the contention flakiness this suite already
  // suffers from. A bad test hiding inside a known problem is worse than an obvious one,
  // so the config moved to utils/securityHeaders.js where it can be read directly.
  const { strictTransportSecurity, HSTS_MAX_AGE } = require('../../utils/securityHeaders');
  const original = process.env.HSTS_INCLUDE_SUBDOMAINS;

  afterEach(() => {
    if (original === undefined) delete process.env.HSTS_INCLUDE_SUBDOMAINS;
    else process.env.HSTS_INCLUDE_SUBDOMAINS = original;
  });

  it('adds includeSubDomains when set to true', () => {
    process.env.HSTS_INCLUDE_SUBDOMAINS = 'true';
    expect(strictTransportSecurity().includeSubDomains).toBe(true);
  });

  it('leaves it off for anything else, including "1" and "yes"', () => {
    for (const v of ['1', 'yes', 'TRUE', '', 'false']) {
      process.env.HSTS_INCLUDE_SUBDOMAINS = v;
      expect(strictTransportSecurity().includeSubDomains).toBe(false);
    }
    delete process.env.HSTS_INCLUDE_SUBDOMAINS;
    expect(strictTransportSecurity().includeSubDomains).toBe(false);
  });

  it('never preloads, and keeps a year', () => {
    expect(strictTransportSecurity().preload).toBe(false);
    expect(strictTransportSecurity().maxAge).toBe(HSTS_MAX_AGE);
  });

  // "Headers present on every response" is the acceptance criterion, so helmet is
  // mounted above the static handlers and above /healthz rather than beside the router.
  it('sets them on a static asset', async () => {
    const res = await request(app).get('/static/beta/css/custom.css');
    expect(res.status).toBe(200);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toBeDefined();
  });

  it('sets them on /healthz, which is mounted above the rate limiter', async () => {
    const res = await request(app).get('/healthz');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toBeDefined();
  });

  it('stops announcing the server framework', async () => {
    const res = await homepage();
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  // The site is entirely public, and views/emails/websiteUpdated.ejs embeds a generated
  // image from stockport-badminton.co.uk into an email. helmet's same-origin default
  // for Cross-Origin-Resource-Policy would tell a browser not to load our own images
  // anywhere but our own pages, which is the opposite of what these are for.
  it('does not lock our public images to same-origin embedding', async () => {
    const res = await homepage();
    expect(res.headers['cross-origin-resource-policy']).toBe('cross-origin');
  });
});

describe('the enforcing Content-Security-Policy', () => {
  let policy;
  beforeAll(async () => {
    policy = (await homepage()).headers['content-security-policy'];
  });

  it('protects against the things that need no allowlist', () => {
    expect(policy).toContain("frame-ancestors 'self'");
    expect(policy).toContain("base-uri 'self'");
    expect(policy).toContain("object-src 'none'");
    // Every <form action> in views/ is same-origin — grepped, all 24 of them — so an
    // injected form cannot be used to post a session anywhere else.
    expect(policy).toContain("form-action 'self'");
  });

  // The point of the split. If a resource directive ever appears on the enforcing
  // header by accident, a page that loads DataTables or the Sentry loader goes blank
  // for a real visitor with nothing in the server logs to say why.
  it('carries no resource allowlist, so it cannot blank a working page', () => {
    expect(policy).not.toMatch(/script-src/);
    expect(policy).not.toMatch(/style-src/);
    expect(policy).not.toMatch(/img-src/);
    expect(policy).not.toMatch(/connect-src/);
    expect(policy).not.toMatch(/default-src/);
  });
});

describe('the report-only Content-Security-Policy', () => {
  let policy;
  beforeAll(async () => {
    policy = (await homepage()).headers['content-security-policy-report-only'];
  });

  it('is present and starts from a default-src of self', () => {
    expect(policy).toBeDefined();
    expect(policy).toContain("default-src 'self'");
  });

  // Each of these is forced by a named view. Grepped, not assumed.
  it.each([
    ['https://www.googletagmanager.com', 'views/header.ejs — gtag.js, every page'],
    ['https://js-de.sentry-cdn.com', 'views/header.ejs — the browser Sentry loader'],
    ['https://browser.sentry-cdn.com', 'the bundle + lazyLoadIntegration the loader fetches'],
    ['https://static.hotjar.com', 'views/header.ejs — Hotjar, every logged-in page'],
    ['https://cdn.datatables.net', 'views/datatables-scripts.ejs — every stats table'],
    ['https://cdn.jsdelivr.net', 'views/elo-chart.ejs, views/player-game-stats.ejs — Chart.js'],
    ['https://cdn.quilljs.com', 'views/admin/homepage-content-form.ejs — the editor'],
    ['https://unpkg.com', 'views/file-upload.ejs — SheetJS'],
    ['https://connect.facebook.net', 'views/footer.ejs — the page plugin, every page'],
    ['https://www.google.com', 'views/contact-us-form.ejs, views/club-v2.ejs — reCAPTCHA'],
    ['https://maps.googleapis.com', 'views/club-v2.ejs, views/viewEventDetails.ejs — maps'],
  ])('allows %s in script-src (%s)', (host) => {
    const scriptSrc = policy.split(';').find(d => d.trim().startsWith('script-src'));
    expect(scriptSrc).toContain(host);
  });

  // 159 inline onclick attributes and 17 views with inline <script> blocks. Removing
  // them is explicitly out of HARD-12's scope, and a nonce or hash policy would ignore
  // 'unsafe-inline' and kill every one of them. Without this the report-only period
  // would drown in violations we already know about and the unexpected ones — a host
  // nobody remembered — would be invisible.
  it("keeps 'unsafe-inline' in script-src, which is the honest state of the views", () => {
    const scriptSrc = policy.split(';').find(d => d.trim().startsWith('script-src'));
    expect(scriptSrc).toContain("'unsafe-inline'");
  });

  it('allows the frames third parties open', () => {
    const frameSrc = policy.split(';').find(d => d.trim().startsWith('frame-src'));
    // views/footer.ejs's .fb-page plugin and reCAPTCHA's challenge both become iframes
    // at runtime — neither is an <iframe> in any template, so grepping for <iframe>
    // finds nothing and a policy built that way breaks both.
    expect(frameSrc).toContain('https://www.facebook.com');
    expect(frameSrc).toContain('https://www.google.com');
  });

  it('allows the beacons the page sends', () => {
    const connectSrc = policy.split(';').find(d => d.trim().startsWith('connect-src'));
    expect(connectSrc).toContain('sentry.io');
    expect(connectSrc).toContain('google-analytics.com');
    expect(connectSrc).toContain('hotjar');
  });

  // views/homepage.ejs renders announcement images from homepage_content.image_url, an
  // arbitrary URL an admin pastes into /admin/homepage-content, and the scorecard views
  // render scorecardstore."scoresheet-url" from S3. Neither has a fixed host.
  it('allows images from any https host', () => {
    const imgSrc = policy.split(';').find(d => d.trim().startsWith('img-src'));
    expect(imgSrc).toContain('https:');
    expect(imgSrc).toContain('data:');
  });

  it('names somewhere for violations to be sent', () => {
    expect(policy).toMatch(/report-uri \S+/);
    expect(policy).toMatch(/report-to csp-endpoint/);
  });

  it('declares the reporting endpoint Chrome needs alongside report-uri', async () => {
    const res = await homepage();
    expect(res.headers['reporting-endpoints']).toMatch(/^csp-endpoint="/);
  });
});

// The guard. The policy above is a snapshot of what the views load today; a view added
// next season that pulls in another CDN would fail silently under report-only and blank
// a page the day enforcement is flipped on. This walks the templates instead.
describe('every CDN the templates actually reference is in the policy', () => {
  const viewsDir = path.join(__dirname, '../../views');

  function ejsFiles(dir) {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(dir, entry.name);
      // views/emails/* is HTML mailed to people. A mail client applies no CSP of ours,
      // so those hosts are deliberately not in the policy.
      if (entry.isDirectory()) return entry.name === 'emails' ? [] : ejsFiles(full);
      return entry.name.endsWith('.ejs') ? [full] : [];
    });
  }

  const found = new Map();
  for (const file of ejsFiles(viewsDir)) {
    const src = fs.readFileSync(file, 'utf8');
    const re = /<(script|link)\b[^>]*?(?:src|href)\s*=\s*"((?:https?:)?\/\/[^"]+)"/gi;
    let m;
    while ((m = re.exec(src)) !== null) {
      const host = m[2].replace(/^https?:/, '').split('/')[2];
      if (!host || host.includes('<%')) continue;
      if (!found.has(host)) found.set(host, path.relative(viewsDir, file));
    }
  }

  it('found some, or the scan itself is broken', () => {
    expect(found.size).toBeGreaterThan(5);
  });

  it.each([...found].map(([host, file]) => [host, file]))(
    '%s (referenced by views/%s) is allowlisted',
    async (host) => {
      const policy = (await homepage()).headers['content-security-policy-report-only'];
      expect(policy).toContain(host);
    }
  );
});

describe('POST /csp-report', () => {
  it('accepts a report-uri violation and answers 204', async () => {
    const res = await request(app)
      .post('/csp-report')
      .set('Content-Type', 'application/csp-report')
      .send(JSON.stringify({
        'csp-report': {
          'document-uri': 'https://stockport-badminton.co.uk/scorecard-beta',
          'effective-directive': 'script-src',
          'blocked-uri': 'https://evil.example/x.js',
        }
      }));
    expect(res.status).toBe(204);
  });

  it('accepts the Reporting API shape too', async () => {
    const res = await request(app)
      .post('/csp-report')
      .set('Content-Type', 'application/reports+json')
      .send(JSON.stringify([{
        type: 'csp-violation',
        url: 'https://stockport-badminton.co.uk/',
        body: { effectiveDirective: 'img-src', blockedURL: 'https://evil.example/x.png' },
      }]));
    expect(res.status).toBe(204);
  });

  // Same reasoning as /healthz. A browser can fire a report per blocked subresource, so
  // a single page load on a page with a bad policy could be a dozen hits. Below the
  // sitewide limiter those reports would spend a real visitor's request budget and then
  // rate-limit the pages they were trying to read.
  it('does not consume the sitewide rate limit', async () => {
    const spy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    for (let i = 0; i < 40; i++) {
      const res = await request(app)
        .post('/csp-report')
        .set('Content-Type', 'application/csp-report')
        .send(JSON.stringify({ 'csp-report': { 'blocked-uri': 'inline' } }));
      expect(res.status).toBe(204);
    }
    spy.mockRestore();
    const page = await homepage();
    expect(page.status).toBe(200);
  });

  // The report body is attacker-controlled and goes to Cloud Logging, where a newline
  // would forge a log line of its own.
  it('cannot inject a line into the log', async () => {
    const spy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    await request(app)
      .post('/csp-report')
      .set('Content-Type', 'application/csp-report')
      .send(JSON.stringify({
        'csp-report': { 'blocked-uri': 'https://x/\n\rcsp-report: forged' }
      }));
    const logged = spy.mock.calls.map(c => c.join(' ')).join('');
    expect(logged).toContain('csp-report');
    expect(logged).not.toMatch(/[\n\r]/);
    spy.mockRestore();
  });

  it('ignores browser-extension noise rather than logging it', async () => {
    const spy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    await request(app)
      .post('/csp-report')
      .set('Content-Type', 'application/csp-report')
      .send(JSON.stringify({
        'csp-report': { 'blocked-uri': 'chrome-extension://abcdef/inject.js' }
      }));
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
