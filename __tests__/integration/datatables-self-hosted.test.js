const fs = require('fs');
const path = require('path');
const ejs = require('ejs');
const request = require('supertest');

// HARD-45. DataTables came from cdn.datatables.net: a render-blocking stylesheet in the
// head on a host nothing else on the page used (770 ms of Lighthouse's 4.9 s FCP on
// /results/All), then the bundle and two plug-ins as synchronous scripts, one of them
// over a protocol-relative URL. It is self-hosted now, so it shares the site's
// connection and HARD-42's year-long caching, and the CDN is out of the CSP.
//
// The partials are rendered for real rather than grepped, because what matters is the
// URL `asset()` produces — and a URL that does not resolve comes back from asset()
// unchanged and unversioned, which is exactly the failure to catch.

jest.mock('../../db_connect', () => ({
  connect: jest.fn(),
  sessionPool: () => ({ query: () => Promise.resolve({ rows: [] }) }),
  end: jest.fn().mockResolvedValue(undefined),
  otherConnect: jest.fn(() => Promise.resolve({ query: jest.fn(() => Promise.resolve([[]])) })),
  withTransaction: jest.fn(fn => fn({ query: jest.fn(() => Promise.resolve([[]])) })),
  isObject: jest.fn(obj => obj === Object(obj)),
}));

const app = require('../../app');

const VIEWS = path.join(__dirname, '..', '..', 'views');

function render(file, data) {
  return ejs.renderFile(path.join(VIEWS, file), Object.assign({}, app.locals, data || {}));
}

function tags(html) {
  const out = [];
  const re = /<(script|link)\b([^>]*?)(?:src|href)\s*=\s*"([^"]+)"([^>]*)>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    out.push({ tag: m[1].toLowerCase(), url: m[3], attrs: m[2] + m[4] });
  }
  return out;
}

const PARTIALS = [
  ['datatables-css.ejs', {}],
  ['datatables.ejs', { dtCsv: true }],
  ['datatables-stats.ejs', { dtCsv: true, dtColumnSearch: true }],
];

describe.each(PARTIALS)('%s', (file, data) => {
  let found;
  beforeAll(async () => { found = tags(await render(file, data)); });

  test('asks for something, or the scan is broken', () => {
    expect(found.length).toBeGreaterThan(0);
  });

  test('every DataTables file is same-origin and versioned', () => {
    for (const { url } of found) {
      expect(url).toMatch(/^\/static\/vendor\/datatables\/[^?]+\?v=[0-9a-f]{12}$/);
    }
  });

  test('every script is deferred, so none blocks parsing', () => {
    for (const t of found.filter(t => t.tag === 'script')) {
      expect(t.attrs).toMatch(/\bdefer\b/);
    }
  });

  test('each one is served and cached for a year at that version', async () => {
    for (const { url } of found) {
      const res = await request(app).get(url);
      expect(res.status).toBe(200);
      expect(res.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    }
  });
});

test('the plug-ins come after the bundle they register on', async () => {
  // `defer` runs scripts in document order. date-euro and page.jumpToData() call
  // jQuery.fn.dataTable at the top level, so before the bundle they throw.
  const urls = tags(await render('datatables.ejs')).map(t => t.url.split('?')[0]);
  expect(urls).toEqual([
    '/static/vendor/datatables/datatables.min.js',
    '/static/vendor/datatables/date-euro.js',
    '/static/vendor/datatables/page.jumpToData.js',
  ]);
});

test('no template references cdn.datatables.net', () => {
  const offenders = [];
  (function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (!entry.name.endsWith('.ejs')) continue;
      // Comments may name the host to say why it is gone; a tag may not.
      for (const t of tags(fs.readFileSync(full, 'utf8'))) {
        if (t.url.includes('cdn.datatables.net')) offenders.push(path.relative(VIEWS, full));
      }
    }
  })(VIEWS);
  expect(offenders).toEqual([]);
});

test('the CSP no longer allows cdn.datatables.net', async () => {
  const res = await request(app).get('/rules');
  expect(res.headers['content-security-policy-report-only']).not.toContain('cdn.datatables.net');
});
