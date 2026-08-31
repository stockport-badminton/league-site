// Rules for what may be uploaded to the scorecard bucket, and under what name.
//
// `/sign-s3` used to take `file-name` and `file-type` straight from the query string
// and hand back a presigned PUT with `ACL: public-read`. Both were attacker-chosen, so
// anyone on the internet could:
//
//   - overwrite any existing object, by asking for its key. The bucket also holds the
//     venues map (utils/venues-map-generator.js) and the generated weekly social videos
//     (controllers/socialVideoController.js), so that is defacement, not just nuisance.
//   - have the bucket serve HTML or an executable from our own storage, by asking for
//     that content type.
//
// Both are closed here: the key is generated on the server under a fixed prefix, and
// the content type has to be an image we recognise. The extension comes from the
// content type rather than from the filename, so a `.jpg` claiming to be `text/html`
// is refused rather than renamed.

const crypto = require('crypto');

// Deliberately not a general image list. These are what a phone camera or a scanner
// produces, which is what a scorecard photo actually is.
const ALLOWED_TYPES = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/heif': 'heif'
};

const PREFIX = 'scorecards';

// The season the upload belongs to, for a browsable prefix. Mirrors the rollover the
// rest of the site uses (August), and falls back rather than throwing — a wrong folder
// is not worth failing an upload over.
function seasonSegment(now = new Date()) {
  const year = now.getFullYear();
  const start = now.getMonth() < 7 ? year - 1 : year;
  return `${start}${start + 1}`;
}

// A human hint kept alongside the random part, so the results secretary browsing the
// bucket can still see which match a photo belongs to.
//
// Aggressively reduced because it is the one part of the key the client still
// influences: letters, digits and single dashes only, nothing else survives. No dots
// (so no second extension), no slashes (so no path traversal), and capped so a long
// name cannot push the key past S3's limit.
function sanitiseHint(raw) {
  if (typeof raw !== 'string') return '';
  return raw
    .normalize('NFKD')
    .replace(/\.[^.]*$/, '')        // drop anything that looks like an extension
    .replace(/[^a-zA-Z0-9]+/g, '-') // everything else becomes a single dash
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .toLowerCase();
}

// Returns { key, extension } or throws a 400-shaped error.
//
// `hint` is advisory only and never trusted; the uniqueness comes entirely from the
// random segment, so two uploads can never collide and an existing object can never be
// targeted.
function buildUploadKey(contentType, hint, now = new Date()) {
  const extension = ALLOWED_TYPES[String(contentType || '').toLowerCase().trim()];
  if (!extension) {
    const err = new Error(
      'That file type is not accepted. Upload a photo of the scorecard — JPEG, PNG, WebP or HEIC.'
    );
    err.status = 400;
    throw err;
  }
  const unique = crypto.randomUUID();
  const cleaned = sanitiseHint(hint);
  const name = cleaned ? `${unique}-${cleaned}` : unique;
  return { key: `${PREFIX}/${seasonSegment(now)}/${name}.${extension}`, extension };
}

module.exports = {
  ALLOWED_TYPES,
  PREFIX,
  buildUploadKey,
  sanitiseHint,
  seasonSegment
};
