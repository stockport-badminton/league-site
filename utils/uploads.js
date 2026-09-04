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

// The bucket lives in eu-west-1 and `/sign-s3` has always hardcoded that, in both the
// client and the URL it hands back. Kept literal rather than read from AWS_REGION so
// this cannot start minting URLs for a region the objects are not in.
const REGION = 'eu-west-1';

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

// The public URL of an object, in the virtual-hosted style. One definition, because
// `/sign-s3` returns this to the upload widget, `storeImage` returns it to the OCR
// uploader, and `utils/scorecardLinks.normalisePhotoUrl` has to accept both — three
// places that must agree on a string, which is how they drift.
//
// The key is not escaped, and does not need to be: `buildUploadKey` emits letters,
// digits, dashes, slashes and one dot. Anything else would be a bug there, not here.
function objectUrl(key) {
  const bucket = String(process.env.S3_BUCKET_NAME || '').trim();
  return `https://${bucket}.s3.${REGION}.amazonaws.com/${key}`;
}

// Store bytes we produced ourselves, server-side.
//
// This is the counterpart to `/sign-s3` for the one case that cannot use it: a document
// scorecard, where the browser holds a pdf and the thing worth keeping is the image
// inside it (see utils/documentImage.js). The client never sees a presigned PUT for
// these — it posts the document to the OCR endpoint and gets back the URL of the image
// that came out — so the type allowlist below is still the only way into the bucket.
//
// It goes through `buildUploadKey`, so an extracted image that is not a type we accept
// (a gif, say) is refused here exactly as it would be at `/sign-s3`. Deliberately sets
// no ACL: HARD-02b made every object in this bucket private, served through
// `GET /scorecard-photo/:id`, and a public-read object here would be a hole in that.
async function storeImage({ buffer, contentType, hint }, deps = {}) {
  const { key } = buildUploadKey(contentType, hint);
  const {
    S3Client, PutObjectCommand,
  } = deps.s3 || require('@aws-sdk/client-s3');
  const client = new S3Client({ region: REGION });
  await client.send(new PutObjectCommand({
    Bucket: process.env.S3_BUCKET_NAME,
    Key: key,
    ContentType: contentType,
    Body: buffer,
  }));
  return { key, url: objectUrl(key) };
}

module.exports = {
  ALLOWED_TYPES,
  PREFIX,
  REGION,
  buildUploadKey,
  objectUrl,
  sanitiseHint,
  seasonSegment,
  storeImage
};
