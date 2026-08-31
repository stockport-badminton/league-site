// Confirmation links for scorecard drafts, and the rule for what may be stored (and
// emailed) as a scorecard photo.
//
// Two findings from the August 2026 audit, both about the same email:
//
// SEC-2 — `POST /add-scorecard-photo/:id` took `req.body.imgURL` and interpolated it
// unescaped into an HTML mail from results@stockport-badminton.co.uk. Any value at all
// was accepted, so the message could be rewritten by the sender: a phishing mail from
// our own verified domain, arriving at the one inbox that is expecting exactly that
// email. `normalisePhotoUrl` is the gate — the value has to be an https URL for an
// object in our own bucket, and anything else is a 400.
//
// SEASON-5 — the confirmation link was `/populated-scorecard-beta/<id>` where the id is
// the draft's sequential primary key, with no token and no login. Ids run to about
// 2,400, so every scorecard ever filed could be walked by counting, and an outsider
// could confirm a result neither captain had agreed. Hence the per-draft token below.

const crypto = require('crypto');
const { absoluteUrl } = require('./canonical');

// 24 bytes -> 32 base64url characters. Comfortably unguessable, and short enough that
// the link still survives an email client that wraps long URLs.
const TOKEN_BYTES = 24;

function newDraftToken() {
  return crypto.randomBytes(TOKEN_BYTES).toString('base64url');
}

// Whether this draft is one that has to prove itself.
//
// **Grandfather clause.** A draft filed before the token column existed has no token,
// and its confirmation link is already sitting in a captain's inbox. Those drafts get
// confirmed within days, but rejecting one would silently lock a captain out of
// confirming a result they have already played — the exact class of failure this
// backlog exists to prevent — so a stored token of NULL/'' means "no token required".
// A draft WITH a token always has to match.
//
// Deliberately no backfill: minting tokens for existing rows is precisely what would
// invalidate the links this clause protects.
//
// **What removes it:** once no unconfirmed draft is left without a token, delete this
// function's early-out and make a missing token a refusal.
//
//   node tools/dbq.js "SELECT count(*) FROM scorecardstore WHERE \"confirmToken\" IS NULL"
//
// (that count only falls as old drafts are processed; it will not reach zero on its own
// while the rows are kept, so the judgement is "no *outstanding* tokenless draft".)
function draftRequiresToken(storedToken) {
  return typeof storedToken === 'string' && storedToken.trim() !== '';
}

// Constant-time compare, so a wrong token cannot be tuned a character at a time.
function tokenMatches(storedToken, providedToken) {
  if (typeof storedToken !== 'string' || typeof providedToken !== 'string') return false;
  const a = Buffer.from(storedToken);
  const b = Buffer.from(providedToken);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// True when this draft may be shown to whoever asked, given the token they presented.
function mayOpenDraft(storedToken, providedToken) {
  if (!draftRequiresToken(storedToken)) return true;
  return tokenMatches(storedToken, providedToken);
}

function confirmationPath(draftId, token) {
  const base = '/populated-scorecard-beta/' + encodeURIComponent(String(draftId));
  return draftRequiresToken(token) ? base + '?t=' + encodeURIComponent(token) : base;
}

// Emailed links go through absoluteUrl, never `req.headers.host`: behind Firebase that
// header is the Cloud Run hostname, so the captain would be sent to
// league-site-…-nw.a.run.app. See utils/canonical.js.
function confirmationUrl(draftId, token) {
  return absoluteUrl(confirmationPath(draftId, token));
}

// --- scorecard photo URLs ---------------------------------------------------

// Hostnames S3 serves this bucket under: `s3.amazonaws.com`, `s3.<region>.amazonaws.com`
// and the older `s3-<region>.amazonaws.com`. All three appear in the data — 989 of the
// stored URLs use the dashed spelling and 490 the dotted one — so the check is by shape
// rather than by a list of exact hosts.
const S3_HOST = /^s3([.-][a-z0-9-]+)?\.amazonaws\.com$/;

// Characters that have no business in an S3 object URL and every business in an
// injection payload. A key with a space arrives percent-encoded (or, from the upload
// page's own rewrite, as `+`), so nothing legitimate is turned away by this.
const HOSTILE = /[\s"'<>`\\{}|^\[\]]/;

function badPhotoUrl() {
  const err = new Error(
    'That does not look like a scorecard photo we uploaded. Upload the photo through the ' +
    'scorecard page rather than pasting a link.'
  );
  err.status = 400;
  return err;
}

// Returns the URL to store, or throws a 400-shaped error.
//
// Fails closed when S3_BUCKET_NAME is unset: without it there is nothing to compare
// against, and "accept anything" is the bug being fixed.
//
// The query string is dropped. What the upload page posts here is the presigned PUT URL
// with the signature cut off by string arithmetic; anything left over would be a
// temporary credential stored as if it were a permanent link.
function normalisePhotoUrl(raw) {
  if (typeof raw !== 'string') throw badPhotoUrl();
  const value = raw.trim();
  if (!value || HOSTILE.test(value)) throw badPhotoUrl();

  const bucket = String(process.env.S3_BUCKET_NAME || '').trim().toLowerCase();
  if (!bucket) throw badPhotoUrl();

  let url;
  try {
    url = new URL(value);
  } catch (err) {
    throw badPhotoUrl();
  }

  if (url.protocol !== 'https:') throw badPhotoUrl();
  // `https://bucket.s3…amazonaws.com@evil.example.com/x` parses with the real host in
  // the userinfo and `evil.example.com` as the host. The host check below already
  // catches it; this is here so that stays true if the check is ever loosened.
  if (url.username || url.password) throw badPhotoUrl();

  const host = url.hostname.toLowerCase();
  const path = url.pathname.replace(/^\/+/, '');
  const prefix = bucket + '.';

  if (host.startsWith(prefix) && S3_HOST.test(host.slice(prefix.length))) {
    // Virtual-hosted style: the whole path is the key.
    if (!path) throw badPhotoUrl();
  } else if (S3_HOST.test(host)) {
    // Path style: the first segment has to be our bucket, and something has to follow.
    if (!path.startsWith(bucket + '/') || path.length <= bucket.length + 1) throw badPhotoUrl();
  } else {
    throw badPhotoUrl();
  }

  return 'https://' + host + url.pathname;
}

// The same rule as a predicate, for the submission path — where an unacceptable URL
// must not cost the captain the result they just typed in.
function isPhotoUrl(raw) {
  try {
    normalisePhotoUrl(raw);
    return true;
  } catch (err) {
    return false;
  }
}

module.exports = {
  newDraftToken,
  draftRequiresToken,
  tokenMatches,
  mayOpenDraft,
  confirmationPath,
  confirmationUrl,
  normalisePhotoUrl,
  isPhotoUrl,
  TOKEN_BYTES,
};
