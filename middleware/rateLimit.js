const rateLimit = require('express-rate-limit');
const { MemoryStore } = require('express-rate-limit');
const { clientIp } = require('../utils/clientIp');

// Rate limits for the public surface.
//
// This is the highest-value piece of the anti-spam work because it is the only part
// that caps abuse we haven't specifically thought about. A captcha, a blocklist and a
// honeypot each stop a known technique; a request ceiling stops volume regardless of
// technique, including on endpoints nobody remembered were public.
//
// Keyed on utils/clientIp rather than the default, so the limiters and the IP blocklist
// agree on who a visitor is. The default key generator uses req.ip, which is the same
// value while `trust proxy` is set — going through one function means it stays the same
// if that ever changes. Note the caveat in utils/clientIp.js: the leftmost
// X-Forwarded-For entry is ultimately client-settable, so a determined caller can move
// between buckets. That degrades this to a cost rather than a wall, which is why the
// captcha and honeypot sit alongside it.
//
// In-memory store, so counters are per-instance and reset on deploy. With maxScale 2
// the real ceiling is up to double the numbers below. That is fine for the volumes here
// and avoids giving the DB a write on every request; if it ever needs to be exact, the
// store becomes Postgres.

function keyGenerator(req) {
  return clientIp(req) || 'unknown';
}

// /api/ answers JSON (there's a JSON error handler ahead of the HTML one in
// routes/index.js), everything else is a form post from a browser and gets a page.
function tooMany(req, res) {
  const retryAfterMins = Math.ceil((res.getHeader('Retry-After') || 900) / 60);
  if (req.path.startsWith('/api/')) {
    return res.status(429).json({ error: 'Too many requests. Try again shortly.' });
  }
  return res.status(429).render('429-error', {
    static_path: '/static',
    pageTitle: 'Too many requests',
    pageDescription: 'Please wait a little before trying again',
    retryAfterMins,
    canonical: undefined,
  });
}

const base = {
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator,
  handler: tooMany,
};

// Each limiter gets its own store, kept here so tests can clear the counters between
// cases. Without that, an existing suite that posts a scorecard twenty times starts
// getting 429s from a limiter it isn't testing — which is the limiter working, but it
// makes unrelated failures look like regressions.
const stores = [];
function makeLimiter(options) {
  const store = new MemoryStore();
  stores.push(store);
  return rateLimit({ ...base, ...options, store });
}

function resetRateLimits() {
  for (const store of stores) {
    if (typeof store.resetAll === 'function') store.resetAll();
  }
}

// Anything that sends an email or writes a row from an unauthenticated request.
// Deliberately tight: a captain submits a scorecard once a week, and a visitor asks for
// one reminder. Ten an hour is far above legitimate use and far below useful abuse.
const publicFormLimiter = makeLimiter({
  windowMs: 60 * 60 * 1000,
  limit: 10,
});

// The contact form specifically — the one with a human writing prose, and the one that
// has been attracting spam.
const contactLimiter = makeLimiter({
  windowMs: 60 * 60 * 1000,
  limit: 5,
});

// SNS delivers in bursts and retries, and messages are signature-checked before this
// matters, so this is a backstop against a flood rather than a behaviour limit.
const webhookLimiter = makeLimiter({
  windowMs: 5 * 60 * 1000,
  limit: 120,
});

// Sitewide backstop. Generous enough that no real visitor meets it — a page with images
// and scripts is one request here (static assets are mounted before the router), and
// crawlers stay well under it.
// Never rate-limit the crawl surface: a 429 to Googlebot on the sitemap costs
// indexing, and these are cheap GETs. Exported so it can be tested directly —
// express-rate-limit doesn't expose the option back off the middleware it returns.
function skipCrawlSurface(req) {
  return req.method === 'GET'
    && (req.path === '/sitemap.xml' || req.path === '/robots.txt');
}

const globalLimiter = makeLimiter({
  windowMs: 15 * 60 * 1000,
  limit: 600,
  skip: skipCrawlSurface,
});

module.exports = {
  publicFormLimiter,
  contactLimiter,
  webhookLimiter,
  globalLimiter,
  keyGenerator,
  skipCrawlSurface,
  resetRateLimits,
};
