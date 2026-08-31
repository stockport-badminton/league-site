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
  // A JFIF file is a JPEG. Seven rows use the extension, all of them real scorecards
  // from captains whose phone or scanner chose it.
  jfif: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  heic: 'image/heic',
  heif: 'image/heif',
};

// Not images, but real scorecards, and the reason this list exists at all.
//
// Of the 1,479 photos on record, 93 are PDFs and 16 are Word documents — 7% of every
// scorecard ever filed. HARD-02 stopped *new* uploads being anything but an image, which
// is right, but these were filed years before that rule and were being served perfectly
// well from the public bucket. A proxy that 404s them turns "make photos private" into
// "silently lose 7% of the archive", which is a worse outcome than the one it is
// preventing.
//
// They are served as a download rather than inline. A PDF rendered inline runs in our
// origin and PDFs can carry script; as an attachment the browser saves it and nothing
// executes. The route pairs this with `X-Content-Type-Options: nosniff` so the type
// cannot be re-guessed.
const DOWNLOAD_TYPE_BY_EXTENSION = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  doc: 'application/msword',
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

  // `+` in a stored URL means a space, and the object's real key has the space.
  //
  // The upload widget used to rebuild the object URL by trimming the signature off the
  // presigned one and rewriting `%20` as `+` (fixed in HARD-03), so several years of rows
  // hold URLs like `.../20252026-Manor+A-Disley+A.jpg` for an object actually keyed
  // `20252026-Manor A-Disley A.jpg`.
  //
  // Those URLs worked, which is why nobody noticed: S3's REST endpoint decodes `+` in a
  // path as a space, so the browser fetched the right object. `GetObject` does not — it
  // takes the key literally — so proxying them without this line asks for a key that has
  // never existed and answers 404 for **every historical photo on the site**. Confirmed
  // against the real bucket: HeadObject on the `+` form is NotFound, on the space form it
  // is found, while both URLs answer 200 over HTTPS.
  //
  // Safe to apply unconditionally on this branch: it runs only for values that arrived as
  // a URL, where `+` is the URL spelling of a space. Keys minted since HARD-02 come from
  // `buildUploadKey`, which sanitises to letters, digits and single dashes, so no key this
  // codebase creates can contain a literal `+` to be mangled by it.
  path = path.replace(/\+/g, ' ');

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

// The type for an object that is a genuine scorecard but not an image — a PDF or a Word
// document from before HARD-02 restricted uploads. Never inferred from what S3 declares:
// the extension alone decides, so a legacy object claiming `text/html` cannot talk its
// way into being served as HTML from our origin.
//
// The route serves whatever this returns as an attachment. Kept as a separate function
// from contentTypeFor so a caller cannot accidentally render one of these inline — the
// two answers mean different things and the disposition is not optional.
function downloadTypeFor(key) {
  const match = String(key || '').match(/\.([a-z0-9]+)$/i);
  if (!match) return null;
  return DOWNLOAD_TYPE_BY_EXTENSION[match[1].toLowerCase()] || null;
}

// The filename offered to the browser when serving an attachment. Path segments and
// quotes are stripped so the value cannot break out of the Content-Disposition header;
// the key is attacker-influenced only in the sense that it comes from a database column
// that once accepted any string at all, which is reason enough not to trust it.
function downloadNameFor(key) {
  const base = String(key || '').split('/').pop() || 'scorecard';
  const safe = base.replace(/["\\\r\n]/g, '').trim();
  return safe || 'scorecard';
}

module.exports = {
  photoKeyFromStored,
  contentTypeFor,
  downloadTypeFor,
  downloadNameFor,
  DOWNLOAD_TYPE_BY_EXTENSION,
  cleanKey,
  DENIED_PREFIXES,
  TYPE_BY_EXTENSION,
};
