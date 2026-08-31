// HARD-02b — turning a stored `scoresheet-url` back into an S3 object key, and deciding
// what content type the proxy is allowed to serve it as.
//
// The read path has to exist before the bucket can stop being public, and it has to
// serve rows going back years. There are three shapes in
// `scorecardstore."scoresheet-url"`: virtual-hosted URLs, path-style URLs, and both
// spellings of the S3 hostname (989 rows use `s3-eu-west-1`, 490 use `s3.eu-west-1`).
// A reader that only understands the shape today's uploader writes would blank every
// archived season, silently.

const {
  photoKeyFromStored,
  contentTypeFor,
  DENIED_PREFIXES,
} = require('../../utils/scorecardPhoto');
const { photoPath, photoUrl } = require('../../utils/scorecardLinks');

const BUCKET = 'badmintontemp';

beforeEach(() => {
  process.env.S3_BUCKET_NAME = BUCKET;
});

describe('photoKeyFromStored', () => {
  it('reads the key out of a virtual-hosted URL', () => {
    expect(photoKeyFromStored(
      `https://${BUCKET}.s3.eu-west-1.amazonaws.com/scorecards/20262027/abc.jpg`
    )).toBe('scorecards/20262027/abc.jpg');
  });

  // The older spelling. It is the majority of the historical rows, so a reader that
  // misses it blanks most of the archive.
  it('reads the key out of the dashed-region hostname', () => {
    expect(photoKeyFromStored(
      `https://${BUCKET}.s3-eu-west-1.amazonaws.com/20182019-Shell%20A-Mellor%20A.jpg`
    )).toBe('20182019-Shell A-Mellor A.jpg');
  });

  it('reads the key out of a path-style URL, dropping the bucket segment', () => {
    expect(photoKeyFromStored(
      `https://s3.eu-west-1.amazonaws.com/${BUCKET}/scorecards/abc.png`
    )).toBe('scorecards/abc.png');
  });

  it('reads the global-endpoint spelling too', () => {
    expect(photoKeyFromStored(
      `https://${BUCKET}.s3.amazonaws.com/old/photo.jpg`
    )).toBe('old/photo.jpg');
  });

  // So that storing the bare key for new uploads is a later decision, not a migration.
  it('accepts a bare key', () => {
    expect(photoKeyFromStored('scorecards/20262027/abc.jpg')).toBe('scorecards/20262027/abc.jpg');
  });

  it('percent-decodes the key, because that is what a browser sent to S3', () => {
    expect(photoKeyFromStored(
      `https://${BUCKET}.s3.eu-west-1.amazonaws.com/scorecards/a%2Bb%20c.jpg`
    )).toBe('scorecards/a+b c.jpg');
  });

  it('is empty for a blank or missing value', () => {
    for (const value of ['', '   ', null, undefined, 0, {}]) {
      expect(photoKeyFromStored(value)).toBeNull();
    }
  });

  // The whole point: the proxy must not become a way to read the bucket. Even though
  // the key comes from a database row rather than the request, rows written before
  // HARD-03 could hold anything at all — POST /add-scorecard-photo/:id accepted any
  // string for years.
  it('refuses a URL for someone else\'s bucket', () => {
    expect(photoKeyFromStored('https://evil.example.com/x.jpg')).toBeNull();
    expect(photoKeyFromStored('https://other-bucket.s3.eu-west-1.amazonaws.com/x.jpg')).toBeNull();
    expect(photoKeyFromStored(`https://s3.eu-west-1.amazonaws.com/other-bucket/x.jpg`)).toBeNull();
  });

  it('refuses a non-https URL', () => {
    expect(photoKeyFromStored(`http://${BUCKET}.s3.eu-west-1.amazonaws.com/x.jpg`)).toBeNull();
    expect(photoKeyFromStored('file:///etc/passwd')).toBeNull();
  });

  it('refuses traversal and empty keys', () => {
    expect(photoKeyFromStored(`https://${BUCKET}.s3.eu-west-1.amazonaws.com/`)).toBeNull();
    expect(photoKeyFromStored('../../etc/passwd')).toBeNull();
    expect(photoKeyFromStored('scorecards/../../secret.jpg')).toBeNull();
  });

  // Named prefixes belonging to other things in the same bucket. The content-type rule
  // below is the real containment; this is here so the route's purpose is legible and
  // so a row pointing at the venues map cannot make the proxy serve it.
  it('refuses the prefixes that belong to the generated assets', () => {
    expect(DENIED_PREFIXES.length).toBeGreaterThan(0);
    expect(photoKeyFromStored('venues-map.png')).toBeNull();
    expect(photoKeyFromStored(
      `https://${BUCKET}.s3.eu-west-1.amazonaws.com/social-videos/week.mp4`
    )).toBeNull();
  });

  // Fails closed. Without the bucket name there is nothing to compare a host against,
  // and "serve it anyway" is the bug.
  it('refuses everything when S3_BUCKET_NAME is unset', () => {
    delete process.env.S3_BUCKET_NAME;
    expect(photoKeyFromStored('https://x.s3.eu-west-1.amazonaws.com/a.jpg')).toBeNull();
    expect(photoKeyFromStored('scorecards/a.jpg')).toBeNull();
  });
});

describe('contentTypeFor', () => {
  it('trusts an image type S3 reports', () => {
    expect(contentTypeFor('scorecards/a.jpg', 'image/jpeg')).toBe('image/jpeg');
    expect(contentTypeFor('scorecards/a.heic', 'image/heic')).toBe('image/heic');
  });

  it('strips a charset parameter', () => {
    expect(contentTypeFor('scorecards/a.png', 'image/png; charset=binary')).toBe('image/png');
  });

  // The bucket has held objects since before HARD-02 fixed the content type on upload,
  // so a legacy object can carry anything. This is what stops the proxy becoming a way
  // to serve HTML or a script from our own origin — which is strictly worse than from
  // the bucket, because here it is same-origin with the session cookie.
  it('never echoes a type that is not an image', () => {
    expect(contentTypeFor('scorecards/a.jpg', 'text/html')).toBe('image/jpeg');
    expect(contentTypeFor('scorecards/a.png', 'application/javascript')).toBe('image/png');
    expect(contentTypeFor('scorecards/a.jpg', 'image/svg+xml')).toBe('image/jpeg');
  });

  it('falls back to the extension when S3 reports nothing useful', () => {
    expect(contentTypeFor('scorecards/a.jpg', undefined)).toBe('image/jpeg');
    expect(contentTypeFor('scorecards/a.JPEG', '')).toBe('image/jpeg');
    expect(contentTypeFor('scorecards/a.webp', 'binary/octet-stream')).toBe('image/webp');
  });

  it('gives up when neither the type nor the extension is an image', () => {
    expect(contentTypeFor('inbound/raw-email', 'text/plain')).toBeNull();
    expect(contentTypeFor('a.mp4', 'video/mp4')).toBeNull();
    expect(contentTypeFor('a.html', 'text/html')).toBeNull();
  });
});

// Built here rather than beside a caller, for the same reason confirmationPath is: the
// token rule (including the grandfather clause) has exactly one definition.
describe('photoPath / photoUrl', () => {
  it('carries the draft token when the draft has one', () => {
    expect(photoPath(42, 'tok-en')).toBe('/scorecard-photo/42?t=tok-en');
  });

  it('omits it for a draft filed before the token column existed', () => {
    expect(photoPath(42, null)).toBe('/scorecard-photo/42');
    expect(photoPath(42, '')).toBe('/scorecard-photo/42');
    expect(photoPath(42, '   ')).toBe('/scorecard-photo/42');
  });

  it('escapes both parts', () => {
    expect(photoPath('4 2', 'a/b?c')).toBe('/scorecard-photo/4%202?t=a%2Fb%3Fc');
  });

  // Emailed, so never from req.headers.host — see gotcha 1b.
  it('is absolute on the site\'s own origin', () => {
    expect(photoUrl(42, 'tok')).toMatch(/^https:\/\/[^/]+\/scorecard-photo\/42\?t=tok$/);
    expect(photoUrl(42, 'tok')).not.toContain('run.app');
  });
});
