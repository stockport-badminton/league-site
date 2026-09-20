// The weekly video's read path, and the gate on generating it (HARD-21 phase 1).
//
// The objects in `social-videos/` are private — `uploadVideoToS3` sets no ACL and no
// bucket policy grants public read — while the generate endpoint answered with
// `https://<bucket>.s3.eu-west-1.amazonaws.com/…`, which 403s for everyone. The handoff
// had never worked. This is the read path that replaces it, the third instance of a
// pattern already in `app.js` (venues map) and `/scorecard-photo/:id`.
//
// Unauthenticated on purpose: **Meta fetches `video_url` from Meta's own servers**, so
// anything gated here could not be posted at all. Generating, by contrast, starts a ~36
// second ffmpeg encode on Cloud Run and was open to the internet.

process.env.NODE_ENV = 'test';

const mockS3Objects = new Map();
const mockKeysRequested = [];

jest.mock('@aws-sdk/client-s3', () => {
  class NotFound extends Error {
    constructor() { super('NoSuchKey'); this.name = 'NoSuchKey'; this.$metadata = { httpStatusCode: 404 }; }
  }
  return {
    S3Client: class {
      async send(command) {
        if (command.__type !== 'GetObject') return {};
        mockKeysRequested.push(command.input.Key);
        const stored = mockS3Objects.get(command.input.Key);
        if (!stored) throw new NotFound();
        const { Readable } = require('stream');
        return {
          Body: Readable.from([Buffer.from(stored)]),
          ContentType: 'video/mp4',
          ContentLength: Buffer.byteLength(stored),
        };
      }
    },
    GetObjectCommand: class { constructor(input) { this.input = input; this.__type = 'GetObject'; } },
    PutObjectCommand: class { constructor(input) { this.input = input; this.__type = 'PutObject'; } },
    HeadObjectCommand: class { constructor(input) { this.input = input; this.__type = 'HeadObject'; } },
    DeleteObjectCommand: class { constructor(input) { this.input = input; this.__type = 'DeleteObject'; } },
  };
});

const request = require('supertest');
const app = require('../../app');
const { VIDEO_KEYS } = require('../../controllers/socialVideoController');
const { socialVideoPath } = require('../../utils/canonical');

const MP4 = 'fake mp4 bytes';

beforeEach(() => {
  mockS3Objects.clear();
  mockKeysRequested.length = 0;
  for (const key of Object.values(VIDEO_KEYS)) mockS3Objects.set(key, MP4);
});

describe('GET /social-video/:aspect', () => {
  it.each(Object.keys(VIDEO_KEYS))('serves the %s video as video/mp4', async aspect => {
    const res = await request(app).get(socialVideoPath(aspect));

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^video\/mp4/);
    expect(res.body.toString()).toBe(MP4);
  });

  // `public`, unlike the scorecard photo this is modelled on: there is nothing private
  // here, it is about to be posted publicly. Short, because the video is regenerated
  // weekly and on demand, so a long-lived copy could outlast the results it shows.
  it('caches a hit publicly and briefly', async () => {
    const res = await request(app).get(socialVideoPath(Object.keys(VIDEO_KEYS)[0]));
    expect(res.headers['cache-control']).toMatch(/public/);
    expect(res.headers['cache-control']).toMatch(/max-age=300/);
  });

  it('does not sniff the content type', async () => {
    const res = await request(app).get(socialVideoPath(Object.keys(VIDEO_KEYS)[0]));
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  // The aspect is a LOOKUP, never a path fragment.
  //
  // Asserting only the 404 would prove nothing: a handler that interpolated the aspect
  // straight into the key would ALSO 404 here, simply because the mocked bucket holds no
  // such object. So this asserts the key that actually reached S3 — the only version of
  // the question that distinguishes the two implementations. (The first draft of this test
  // did check only the status, and a mutation that built the key from `req.params` passed
  // it.)
  it.each([
    'nonesuch',
    '../scorecards/20262027/private.jpg',
    '..%2F..%2Fvenues-map.png',
    'weekly-video-4_5.mp4',
    '16-9',
    '',
  ])('404s an aspect it does not know, without asking S3 for it: %p', async aspect => {
    const res = await request(app).get('/social-video/' + encodeURIComponent(aspect));

    expect(res.status).toBe(404);
    // Refused before any lookup: an unknown aspect never becomes a key at all.
    expect(mockKeysRequested).toEqual([]);
  });

  it('only ever asks S3 for one of the two keys it owns', async () => {
    for (const aspect of [...Object.keys(VIDEO_KEYS), 'nonesuch', '../../venues-map.png']) {
      await request(app).get('/social-video/' + encodeURIComponent(aspect));
    }
    const known = Object.values(VIDEO_KEYS);
    expect(mockKeysRequested.length).toBeGreaterThan(0);
    for (const key of mockKeysRequested) expect(known).toContain(key);
  });

  // Meta retries, and Firebase caches a response that sets no Cache-Control. A cached
  // miss therefore outlives the fault that caused it — which is how a deploy-in-flight
  // 404 survives the deploy that fixed it.
  it.each(['nonesuch', ...Object.keys(VIDEO_KEYS)])('never lets a 404 be cached: %s', async aspect => {
    mockS3Objects.clear();                       // nothing generated yet
    const res = await request(app).get(socialVideoPath(aspect));
    expect(res.status).toBe(404);
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('404s rather than 500s when the object is not in the bucket', async () => {
    mockS3Objects.clear();
    const res = await request(app).get(socialVideoPath('1-1'));
    expect(res.status).toBe(404);
    expect(res.text).toMatch(/not been generated/i);
  });
});

describe('GET /api/social/generate-weekly-video', () => {
  // It starts a ~36s ffmpeg encode on Cloud Run. It used to be open to the internet.
  it('refuses an anonymous caller with 403, not a redirect', async () => {
    const res = await request(app).get('/api/social/generate-weekly-video');
    expect(res.status).toBe(403);
    expect(res.headers.location).toBeUndefined();
  });

  it('an unset token closes the path rather than opening it', async () => {
    delete process.env.SOCIAL_CRON_TOKEN;
    const res = await request(app).get('/api/social/generate-weekly-video')
      .set('X-Social-Token', 'anything');
    expect(res.status).toBe(403);
  });
});

// The whole point of the package: what the generator hands out must be fetchable.
describe('the URLs handed to a third party', () => {
  it('are on our own domain, never the bucket', () => {
    const { absoluteUrl } = require('../../utils/canonical');
    for (const aspect of Object.keys(VIDEO_KEYS)) {
      const url = absoluteUrl(socialVideoPath(aspect));
      expect(url).toBe('https://stockport-badminton.co.uk/social-video/' + aspect);
      expect(url).not.toMatch(/amazonaws\.com/);
    }
  });

  // Built with absoluteUrl, never req.get('host') — behind Firebase that header is the
  // Cloud Run hostname, and this URL goes to Meta (gotcha 1b).
  // Pinned explicitly, and the only place in this file that names an aspect: everything
  // else reads VIDEO_KEYS so it follows a change rather than breaking on one. 16:9 was
  // dropped on 20 Sep — a landscape frame carrying 1080x1350 portrait cards, so most of
  // its width was black bars. 4:5 matches the cards exactly and adds no bars at all
  // (verified: the output's corner pixels are the source's, not black).
  it('name the two aspects the generator actually writes', () => {
    expect(Object.keys(VIDEO_KEYS).sort()).toEqual(['1-1', '4-5']);
    expect(Object.keys(VIDEO_KEYS)).not.toContain('16-9');
    for (const key of Object.values(VIDEO_KEYS)) {
      expect(key.startsWith('social-videos/')).toBe(true);
    }
  });
});
