// Reading a scorecard photo back out of S3.
//
// HARD-02 stopped the caller choosing the object key and the content type on upload.
// What it could not do was make the objects private: they were `ACL: public-read` and
// rendered straight from the bucket, with the URL stored in
// `scorecardstore."scoresheet-url"`. So the authorization on a scorecard photo was
// "know the URL", and the URL was sitting in an email.
//
// This module is the read half. `GET /scorecard-photo/:id` (routes/index.js) is keyed by
// **draft id**, resolves the object from the row, and asks the same question the
// confirmation page asks — may this caller see this draft? — with the same per-draft
// token (HARD-03, utils/scorecardLinks.js). There is deliberately no endpoint that takes
// an object key: a proxy that streams any object in the bucket to anyone who knows a
// name has moved the problem rather than solved it.
//
// Two things make this awkward, and both are why the reader is tolerant rather than
// strict:
//
//   1. **The photos go back years and the stored URLs disagree with each other.** Three
//      host spellings appear in the data (`s3.amazonaws.com`, `s3.eu-west-1…` and the
//      older `s3-eu-west-1…` — the dashed one is the majority), in both virtual-hosted
//      and path style, and the keys predate the `scorecards/<season>/` prefix that
//      utils/uploads.js now generates. A reader built for the shape today's uploader
//      writes would 404 the entire archive, silently, including on archived seasons.
//   2. **A bare key is accepted as well as a URL**, so that storing the key for new
//      uploads becomes a later one-line decision rather than a migration of a column of
//      historical URLs. Rewriting that column is a one-way door and is left to the
//      owner.

const { normalisePhotoUrl } = require('./scorecardLinks');
const { ALLOWED_TYPES } = require('./uploads');

// Extension -> the type to *serve*. Built explicitly rather than by inverting
// ALLOWED_TYPES, which maps both `image/jpeg` and `image/jpg` onto `jpg` and so would
// invert to whichever happened to be last.
const TYPE_BY_EXTENSION = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  heic: 'image/heic',
  heif: 'image/heif',
};

// Other things living in the same bucket. The content-type rule below is the real
// containment — none of these is an image we would serve — but naming them keeps the
// route's purpose legible, and stops a row that points at the venues map (rows written
// before HARD-03 could hold any string at all) making the proxy serve it.
const DENIED_PREFIXES = [
  'venues-map.png',   // utils/venues-map-generator.js
  'social-videos/',   // controllers/socialVideoController.js
  'static/',
];

function cleanKey(raw) {
  if (typeof raw !== 'string') return null;

  // Percent-decoding is what a browser did on its way to S3, so the key we ask for has
  // to be the decoded one. A malformed sequence throws; that is not a photo.
  let key;
  try {
    key = decodeURIComponent(raw.replace(/^\/+/, ''));
  } catch (err) {
    return null;
  }

  if (!key || key.length > 1024) return null;
  // No traversal, no absolute paths, no control characters. S3 has no directories so
  // `..` is only ever a literal segment, but a key containing one is not something we
  // put there.
  if (key.startsWith('/') || key.split('/').includes('..')) return null;
  // Control characters only. Spaces are legitimate: plenty of the historical keys
  // are `20182019-Shell A-Mellor A.jpg`, from when the filename was the key.
  if (/[\x00-\x1f\x7f]/.test(key)) return null;

  const lower = key.toLowerCase();
  if (DENIED_PREFIXES.some(prefix => lower.startsWith(prefix))) return null;

  return key;
}

// The S3 object key a stored `scoresheet-url` refers to, or null if the value is not one
// of our own scorecard photos.
//
// Fails closed when S3_BUCKET_NAME is unset: without it there is nothing to compare a
// host against, and "serve it anyway" is the bug being fixed.
function photoKeyFromStored(stored) {
  if (typeof stored !== 'string') return null;
  const value = stored.trim();
  if (!value) return null;

  const bucket = String(process.env.S3_BUCKET_NAME || '').trim().toLowerCase();
  if (!bucket) return null;

  // A bare key. Anything with a scheme has to be validated as a URL first.
  if (!/^[a-z][a-z0-9+.-]*:/i.test(value)) return cleanKey(value);

  // Reuse the host rule rather than restating it: normalisePhotoUrl is the one place
  // that knows which hosts are ours, and it is already the gate on the write side.
  let normalised;
  try {
    normalised = normalisePhotoUrl(value);
  } catch (err) {
    return null;
  }

  const url = new URL(normalised);
  const host = url.hostname.toLowerCase();
  let path = url.pathname.replace(/^\/+/, '');

  // Path style puts the bucket in the first segment; virtual-hosted style puts it in
  // the host, and the whole path is the key. normalisePhotoUrl has already established
  // that it is one of the two.
  if (!host.startsWith(bucket + '.')) path = path.slice(bucket.length + 1);

  return cleanKey(path);
}

// The Content-Type the proxy will admit to, or null if this object is not servable.
//
// The type S3 reports is only used when it is an image we recognise. Objects predating
// HARD-02 were uploaded with a caller-chosen content type, so a legacy object can claim
// anything — and echoing that back would make this route a way to serve HTML or a script
// from our own origin, which is strictly worse than from the bucket because here it is
// same-origin with the session cookie. When the declared type is unusable the extension
// decides; when neither is an image the answer is "not a photo" and the route 404s.
function contentTypeFor(key, declaredType) {
  const declared = String(declaredType || '').toLowerCase().split(';')[0].trim();
  if (ALLOWED_TYPES[declared]) return TYPE_BY_EXTENSION[ALLOWED_TYPES[declared]] || null;

  const match = String(key || '').match(/\.([a-z0-9]+)$/i);
  if (!match) return null;
  return TYPE_BY_EXTENSION[match[1].toLowerCase()] || null;
}

module.exports = {
  photoKeyFromStored,
  contentTypeFor,
  cleanKey,
  DENIED_PREFIXES,
  TYPE_BY_EXTENSION,
};
