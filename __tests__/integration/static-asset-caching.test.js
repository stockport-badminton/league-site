const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const request = require('supertest');

// HARD-42. Every asset went out as `max-age=0`, so each page view from each visitor went
// to the container for the same five files — fewer than 0.1% of ~30,000 requests in 18.8
// days were even a 304. The shell assets now carry a content hash in the URL and that URL
// is cached for a year.
//
// The cases that matter most are the ones that stop a year-long cache being WRONG: the
// version must change with the bytes, a version this instance does not hold must not be
// marked immutable, and /sw.js must never be cached at all.

jest.mock('../../db_connect', () => ({
  connect: jest.fn(),
  sessionPool: () => ({ query: () => Promise.resolve({ rows: [] }) }),
  end: jest.fn().mockResolvedValue(undefined),
  otherConnect: jest.fn(() => Promise.resolve({ query: jest.fn(() => Promise.resolve([[]])) })),
  withTransaction: jest.fn(fn => fn({ query: jest.fn(() => Promise.resolve([[]])) })),
  isObject: jest.fn(obj => obj === Object(obj)),
}));

const app = require('../../app');
const assets = require('../../utils/assets');

const ROOT = path.join(__dirname, '..', '..');
const sha = (file) => crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, file))).digest('hex').slice(0, 12);

const SHELL = [
  ['/static/beta/css/custom.css', 'static/beta/css/custom.css'],
  ['/scripts/bootstrap/dist/css/bootstrap.min.css', 'node_modules/bootstrap/dist/css/bootstrap.min.css'],
  ['/scripts/jquery/dist/jquery.min.js', 'node_modules/jquery/dist/jquery.min.js'],
  ['/scripts/popper.js/dist/umd/popper.min.js', 'node_modules/popper.js/dist/umd/popper.min.js'],
  ['/scripts/bootstrap/dist/js/bootstrap.min.js', 'node_modules/bootstrap/dist/js/bootstrap.min.js'],
];

describe('the rendered page asks for versioned shell assets', () => {
  let html;
  beforeAll(async () => {
    const res = await request(app).get('/rules');
    expect(res.status).toBe(200);
    html = res.text;
  });

  test.each(SHELL)('%s carries the hash of its contents', (url, file) => {
    expect(html).toContain(`${url}?v=${sha(file)}"`);
  });

  test('no shell asset is left on a bare, unversioned URL', () => {
    for (const [url] of SHELL) {
      expect(html).not.toContain(`"${url}"`);
    }
  });
});

describe('Cache-Control on the static mounts', () => {
  test.each(SHELL)('%s at its current version is cached for a year, immutable', async (url, file) => {
    const res = await request(app).get(`${url}?v=${sha(file)}`);
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('public, max-age=31536000, immutable');
  });

  // Two revisions serve side by side during a deploy, so the new page's `?v=<new>` can
  // reach the old instance. Marking that immutable would pin the old bytes under the new
  // URL for a year, at the CDN and in the browser.
  test('a version this instance does not hold is not cached', async () => {
    const res = await request(app).get('/static/beta/css/custom.css?v=000000000000');
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-cache');
  });

  test('an unversioned asset gets an hour, not zero', async () => {
    const res = await request(app).get('/static/beta/css/custom.css');
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('public, max-age=3600');
  });

  test('runtime-generated images are not held', () => {
    expect(assets.cacheControlFor('/static/beta/images/generated/table-Premier.png')).toBe('public, max-age=0');
    expect(assets.cacheControlFor('/static/generated/venues-map.png')).toBe('public, max-age=0');
  });

  test('/sw.js stays no-cache — a cached service worker pins users to an old site', async () => {
    const res = await request(app).get('/sw.js');
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-cache');
  });
});

describe('the service worker precaches what the page requests', () => {
  test.each(SHELL)('%s is precached at its versioned URL', async (url, file) => {
    const res = await request(app).get('/sw.js');
    expect(res.text).toContain(`'${url}?v=${sha(file)}'`);
    expect(res.text).not.toContain(`'${url}'`);
  });
});

describe('/scripts serves the vendor files the pages use, not node_modules', () => {
  test.each([
    '/scripts/ejs/ejs.js',
    '/scripts/express/package.json',
    '/scripts/bootstrap/package.json',
    // Font Awesome is inline SVG since HARD-44; its font and css are no longer published.
    '/scripts/@fortawesome/fontawesome-free/css/all.css',
    '/scripts/@fortawesome/fontawesome-free/webfonts/fa-solid-900.woff2',
  ])('%s is not served', async (url) => {
    const res = await request(app).get(url);
    expect(res.status).toBe(404);
  });

  // The 404 is the site's own page, with the nav. A public max-age on it outlives the deploy
  // that adds the file, and would hand one person's page to everyone the day the 404
  // handler passes a user. The first deploy of this did stamp it, until it was curled.
  test.each([
    '/scripts/ejs/ejs.js',
    '/static/does-not-exist.css',
    '/static/does-not-exist.css?v=000000000000',
  ])('the 404 for %s carries no public cache policy', async (url) => {
    const res = await request(app).get(url);
    expect(res.status).toBe(404);
    expect(res.headers['cache-control'] || '').not.toMatch(/public|max-age=[1-9]/);
  });
});

describe('asset() follows the file\'s contents', () => {
  const rel = `static/__hard42-test-${process.pid}.css`;
  const file = path.join(ROOT, rel);
  const url = '/' + rel;
  afterAll(() => { try { fs.unlinkSync(file); } catch (e) { /* already gone */ } });

  test('a change to the file changes its URL', () => {
    fs.writeFileSync(file, 'body{color:red}');
    const before = assets.asset(url);
    expect(before).toMatch(/\?v=[0-9a-f]{12}$/);
    expect(assets.asset(url)).toBe(before);

    fs.writeFileSync(file, 'body{color:blue;}');
    const later = new Date(Date.now() + 5000);
    fs.utimesSync(file, later, later);
    expect(assets.asset(url)).not.toBe(before);
  });

  test('a path it cannot resolve comes back unchanged, on the short-cache path', () => {
    expect(assets.asset('/static/does-not-exist.css')).toBe('/static/does-not-exist.css');
    expect(assets.asset('/scripts/express/index.js')).toBe('/scripts/express/index.js');
    expect(assets.asset('/static/../package.json')).toBe('/static/../package.json');
  });
});
