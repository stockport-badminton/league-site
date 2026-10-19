const fs = require('fs');
const path = require('path');
const request = require('supertest');

// HARD-44 item 2. The page background is the LCP element on most pages and its URL lives in
// custom.css, so the browser could not start it until that stylesheet had arrived. A preload
// in the head fixes that — but only if its URL is exactly the one the CSS will use, which
// is why the links are derived from custom.css rather than written out. These tests pin
// both halves: the links are on the page, and they are the CSS's URLs with ranges that
// select exactly one.

jest.mock('../../db_connect', () => ({
  connect: jest.fn(),
  sessionPool: () => ({ query: () => Promise.resolve({ rows: [] }) }),
  end: jest.fn().mockResolvedValue(undefined),
  otherConnect: jest.fn(() => Promise.resolve({ query: jest.fn(() => Promise.resolve([[]])) })),
  withTransaction: jest.fn(fn => fn({ query: jest.fn(() => Promise.resolve([[]])) })),
  isObject: jest.fn(obj => obj === Object(obj)),
}));

const app = require('../../app');
const { backgroundPreloads, parse } = require('../../utils/backgroundPreload');

const css = fs.readFileSync(path.join(__dirname, '../../static/beta/css/custom.css'), 'utf8');

test('the page carries one image preload per background breakpoint', async () => {
  const res = await request(app).get('/rules');
  expect(res.status).toBe(200);
  const links = [...res.text.matchAll(/<link rel="preload" as="image" fetchpriority="high" href="([^"]+)" media="([^"]+)">/g)];
  expect(links).toHaveLength(6);
  // In the head, ahead of the stylesheet whose arrival it no longer waits for.
  expect(res.text.indexOf(links[0][0])).toBeLessThan(res.text.indexOf('custom.css'));
});

test('every preload is a URL custom.css uses for .respBgImg, and they all negotiate format', () => {
  const preloads = backgroundPreloads();
  expect(preloads).toHaveLength(6);
  for (const p of preloads) {
    expect(css).toContain(`url("${p.href}")`);
    expect(p.href).toContain('/f_auto,q_auto/');
  }
});

test('the media ranges run end to end without overlapping', () => {
  const ranges = backgroundPreloads().map(({ media }) => {
    const min = Number(/min-width: ([\d.]+)px/.exec(media)[1]);
    const max = /max-width: ([\d.]+)px/.exec(media);
    return { min, max: max ? Number(max[1]) : Infinity };
  });
  expect(ranges[0].min).toBe(300);
  for (let i = 1; i < ranges.length; i++) {
    expect(ranges[i].min).toBeGreaterThan(ranges[i - 1].max);
    expect(ranges[i].min - ranges[i - 1].max).toBeLessThan(0.1);
  }
  expect(ranges[ranges.length - 1].max).toBe(Infinity);
});

test('a background edited in the CSS is what gets preloaded', () => {
  const edited = css.replace('w_1920/f_auto,q_auto/1920_g5tl6u.png', 'w_2400/f_auto,q_auto/new_bg.png');
  const last = parse(edited).pop();
  expect(last.href).toContain('w_2400/f_auto,q_auto/new_bg.png');
  expect(last.media).toBe('(min-width: 1365px)');
});
