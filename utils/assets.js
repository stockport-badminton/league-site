'use strict';

// Versioned asset URLs and the cache policy that goes with them (HARD-42).
//
// Every asset used to go out as `max-age=0`, Express's default, so each page view from
// each visitor went to the container for the same five files. The fix is the usual one:
// put a version in the URL and cache THAT URL for a year. The version is a hash of the
// file's contents rather than K_REVISION, because there are ~60 deploys a month and most
// of them do not touch custom.css.
//
// Views call `asset('/scripts/jquery/dist/jquery.min.js')` (app.locals.asset) and never
// build an asset URL by hand. A path this module cannot resolve comes back unchanged, so a
// mistake lands on the short-cache path rather than on a stale one.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

// What /scripts serves. It used to be the whole of node_modules, which published every
// installed package's files; these are the only ones a page asks for. Font Awesome's
// all.css pulls its fonts from ../webfonts/, so that directory has to be here too.
const VENDOR_DIRS = [
  'bootstrap/dist',
  'jquery/dist',
  'popper.js/dist',
  '@fortawesome/fontawesome-free/css',
  '@fortawesome/fontawesome-free/webfonts'
];

const YEAR = 'public, max-age=31536000, immutable';
const HOUR = 'public, max-age=3600';
const NONE = 'public, max-age=0';

// Written at runtime by the social routes, so a held copy is a wrong copy.
const UNCACHED_PREFIXES = ['/static/generated/', '/static/beta/images/generated/'];

// URL path -> absolute file, or null if it is not something the static mounts serve.
function resolve(urlPath) {
  let base, inner;
  if (urlPath.startsWith('/static/')) {
    base = path.join(ROOT, 'static');
    inner = urlPath.slice('/static/'.length);
  } else if (urlPath.startsWith('/scripts/')) {
    const rest = urlPath.slice('/scripts/'.length);
    const dir = VENDOR_DIRS.find((d) => rest.startsWith(d + '/'));
    if (!dir) return null;
    base = path.join(ROOT, 'node_modules', dir);
    inner = rest.slice(dir.length + 1);
  } else {
    return null;
  }
  const abs = path.join(base, inner);
  // path.join normalises `..`, so anything that climbed out of its own mount is not ours.
  if (!abs.startsWith(base + path.sep)) return null;
  return abs;
}

// Keyed on mtime and size so an edit during local development produces a new URL rather
// than an old URL holding new bytes. One stat per call is cheap against a page render.
const hashes = new Map();

function hashFor(urlPath) {
  const file = resolve(urlPath);
  if (!file) return null;
  let stat;
  try { stat = fs.statSync(file); } catch (e) { return null; }
  if (!stat.isFile()) return null;
  const cached = hashes.get(file);
  if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) return cached.hash;
  const hash = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').slice(0, 12);
  hashes.set(file, { mtimeMs: stat.mtimeMs, size: stat.size, hash });
  return hash;
}

function asset(urlPath) {
  const hash = hashFor(urlPath);
  return hash ? urlPath + '?v=' + hash : urlPath;
}

// The Cache-Control for a request to the static mounts.
//
// Immutable only when the version in the URL is the hash of the file THIS instance holds.
// During a deploy two revisions serve side by side for a few seconds, so a page from the
// new one can send its `?v=<new>` request to the old one. Without the comparison the old
// bytes would be stored at the CDN and in browsers under the new URL for a year.
function cacheControlFor(urlPath, version) {
  if (UNCACHED_PREFIXES.some((p) => urlPath.startsWith(p))) return NONE;
  if (version !== undefined) {
    return version === hashFor(urlPath) ? YEAR : 'no-cache';
  }
  return HOUR;
}

function isServedFile(urlPath) {
  const file = resolve(urlPath);
  if (!file) return false;
  try { return fs.statSync(file).isFile(); } catch (e) { return false; }
}

function cacheHeaders(req, res, next) {
  // Mounted at /static and /scripts, so req.path has the mount stripped off.
  const urlPath = req.baseUrl + req.path;
  // Only a file the static mount will actually serve. Anything else falls through to the
  // site's 404 page, and an hour's public max-age on that is wrong twice over: a URL
  // requested before the deploy that adds its file stays a 404 at the CDN for an hour, and
  // the page carries the nav, so it is one `user: req.user` away from handing one person's
  // page to everyone. (It is anonymous today: the 404 handler passes no user.) Found on
  // production minutes after this first deployed, as an x-cache HIT on a missing URL.
  if (!isServedFile(urlPath)) return next();
  const v = typeof req.query.v === 'string' ? req.query.v : undefined;
  res.set('Cache-Control', cacheControlFor(urlPath, v));
  next();
}

module.exports = { asset, hashFor, resolve, cacheControlFor, cacheHeaders, VENDOR_DIRS };
