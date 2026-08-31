const request = require('supertest');

// HARD-02b — GET /scorecard-photo/:id, the read path that has to exist before the
// bucket can stop being public.
//
// Scorecard photos were `ACL: public-read` and rendered straight from S3, so the
// authorization on a photo was "know the URL", and the URL was in an email. This route
// is the only way a photo is read now, and it answers the same question the
// confirmation page answers — may this caller see this draft? — using the same token
// (HARD-03, utils/scorecardLinks.js). It is keyed by *draft id*, never by object key,
// so it cannot be pointed at anything else in the bucket.

jest.mock('../../middleware/secured', () => (req, res, next) => next());

jest.mock('../../models/division');
jest.mock('../../models/teams');
jest.mock('../../models/players');
jest.mock('../../models/fixture');
jest.mock('../../models/game');
jest.mock('../../models/auth.js');

jest.mock('../../utils/ses', () => ({ sendEmail: jest.fn().mockResolvedValue({}) }));

jest.mock('../../db_connect', () => ({
  connect: jest.fn(),
  end: jest.fn().mockResolvedValue(undefined),
  otherConnect: jest.fn(() => Promise.resolve({
    query: jest.fn(() => Promise.resolve([[]]))
  })),
  withTransaction: jest.fn(fn => fn({ query: jest.fn(() => Promise.resolve([[]])) })),
  isObject: jest.fn(obj => obj === Object(obj)),
}));

// The AWS boundary. There is no bucket and no credentials in this worktree, so the
// object store is a map from key to { body, contentType } and `send` answers from it.
const mockS3Objects = new Map();
const mockS3Sends = [];

jest.mock('@aws-sdk/client-s3', () => {
  class NotFound extends Error {
    constructor() { super('NoSuchKey'); this.name = 'NoSuchKey'; this.$metadata = { httpStatusCode: 404 }; }
  }
  return {
    S3Client: class {
      async send(command) {
        mockS3Sends.push(command);
        if (command.__type !== 'GetObject') return {};
        const stored = mockS3Objects.get(command.input.Key);
        if (!stored) throw new NotFound();
        const { Readable } = require('stream');
        return {
          Body: Readable.from([Buffer.from(stored.body)]),
          ContentType: stored.contentType,
          ContentLength: Buffer.byteLength(stored.body),
        };
      }
    },
    GetObjectCommand: class { constructor(input) { this.input = input; this.__type = 'GetObject'; } },
    PutObjectCommand: class { constructor(input) { this.input = input; this.__type = 'PutObject'; } },
    HeadObjectCommand: class { constructor(input) { this.input = input; this.__type = 'HeadObject'; } },
    DeleteObjectCommand: class { constructor(input) { this.input = input; this.__type = 'DeleteObject'; } },
  };
});

const Fixture = require('../../models/fixture');
const app = require('../../app');

const BUCKET = 'badmintontemp';
const KEY = 'scorecards/20262027/abc-card.jpg';
const PHOTO_URL = `https://${BUCKET}.s3.eu-west-1.amazonaws.com/${KEY}`;
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);

const draft = (overrides = {}) => [Object.assign({
  id: 7,
  division: 1, homeTeam: 10, awayTeam: 20,
  'scoresheet-url': PHOTO_URL,
  confirmToken: null,
}, overrides)];

beforeEach(() => {
  jest.clearAllMocks();
  process.env.S3_BUCKET_NAME = BUCKET;
  mockS3Objects.clear();
  mockS3Sends.length = 0;
  mockS3Objects.set(KEY, { body: JPEG, contentType: 'image/jpeg' });
  Fixture.getScorecardById.mockResolvedValue(draft());
});

describe('GET /scorecard-photo/:id', () => {
  it('serves the photo the draft points at', async () => {
    const res = await request(app).get('/scorecard-photo/7');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('image/jpeg');
    expect(Buffer.from(res.body)).toEqual(JPEG);
    // Keyed by draft id, and the key came from the row — not from the request.
    const get = mockS3Sends.find(c => c.__type === 'GetObject');
    expect(get.input).toMatchObject({ Bucket: BUCKET, Key: KEY });
  });

  // The historical rows. 989 of them use the dashed spelling of the S3 host and the
  // keys predate the `scorecards/` prefix, so a reader built only for today's uploads
  // would 404 the whole archive.
  it('serves a photo stored under the older URL shapes', async () => {
    const legacyKey = '20182019-Shell A-Mellor A.jpg';
    mockS3Objects.set(legacyKey, { body: JPEG, contentType: 'image/jpeg' });

    for (const stored of [
      `https://${BUCKET}.s3-eu-west-1.amazonaws.com/20182019-Shell%20A-Mellor%20A.jpg`,
      `https://${BUCKET}.s3.amazonaws.com/20182019-Shell%20A-Mellor%20A.jpg`,
      `https://s3.eu-west-1.amazonaws.com/${BUCKET}/20182019-Shell%20A-Mellor%20A.jpg`,
      legacyKey,
    ]) {
      Fixture.getScorecardById.mockResolvedValue(draft({ 'scoresheet-url': stored }));
      const res = await request(app).get('/scorecard-photo/7');
      expect([stored, res.status]).toEqual([stored, 200]);
    }
  });

  it('404s a draft that does not exist', async () => {
    Fixture.getScorecardById.mockResolvedValue([]);
    const res = await request(app).get('/scorecard-photo/7');
    expect(res.status).toBe(404);
    expect(mockS3Sends.filter(c => c.__type === 'GetObject')).toHaveLength(0);
  });

  it('404s a draft with no photo', async () => {
    Fixture.getScorecardById.mockResolvedValue(draft({ 'scoresheet-url': '' }));
    const res = await request(app).get('/scorecard-photo/7');
    expect(res.status).toBe(404);
    expect(mockS3Sends.filter(c => c.__type === 'GetObject')).toHaveLength(0);
  });

  it('404s when the object has gone from the bucket', async () => {
    mockS3Objects.clear();
    const res = await request(app).get('/scorecard-photo/7');
    expect(res.status).toBe(404);
  });

  // ── who may see a photo ─────────────────────────────────────────────────────

  describe('authorization', () => {
    it('refuses a draft with a token when the request has none', async () => {
      Fixture.getScorecardById.mockResolvedValue(draft({ confirmToken: 'the-real-token' }));

      const res = await request(app).get('/scorecard-photo/7');

      expect(res.status).toBe(403);
      // Not merely "no image" — the object was never fetched, so nothing leaked.
      expect(mockS3Sends.filter(c => c.__type === 'GetObject')).toHaveLength(0);
    });

    it('refuses a guessed token', async () => {
      Fixture.getScorecardById.mockResolvedValue(draft({ confirmToken: 'the-real-token' }));
      const res = await request(app).get('/scorecard-photo/7?t=a-guess');
      expect(res.status).toBe(403);
    });

    it('serves it for the right token', async () => {
      Fixture.getScorecardById.mockResolvedValue(draft({ confirmToken: 'the-real-token' }));
      const res = await request(app).get('/scorecard-photo/7?t=the-real-token');
      expect(res.status).toBe(200);
    });

    // The same grandfather clause as the confirmation page: links filed before
    // migration 011 are already in captains' inboxes and have no token to present.
    it('serves a tokenless draft, as the confirmation page does', async () => {
      const res = await request(app).get('/scorecard-photo/7');
      expect(res.status).toBe(200);
    });
  });

  // ── containment ─────────────────────────────────────────────────────────────
  //
  // A read path that streams any object from the bucket has moved the problem, not
  // solved it. The key is never taken from the request, and even the row cannot name
  // an arbitrary object: POST /add-scorecard-photo/:id accepted any string for years,
  // so a row could hold a URL for something else in the bucket.

  describe('what it will not serve', () => {
    it('will not serve another object in the bucket named by the row', async () => {
      mockS3Objects.set('venues-map.png', { body: JPEG, contentType: 'image/png' });
      mockS3Objects.set('social-videos/week.mp4', { body: JPEG, contentType: 'video/mp4' });

      for (const stored of ['venues-map.png', 'social-videos/week.mp4']) {
        Fixture.getScorecardById.mockResolvedValue(draft({ 'scoresheet-url': stored }));
        const res = await request(app).get('/scorecard-photo/7');
        expect([stored, res.status]).toEqual([stored, 404]);
      }
      expect(mockS3Sends.filter(c => c.__type === 'GetObject')).toHaveLength(0);
    });

    it('will not serve an object in someone else\'s bucket named by the row', async () => {
      Fixture.getScorecardById.mockResolvedValue(
        draft({ 'scoresheet-url': 'https://evil.example.com/payload.jpg' })
      );
      const res = await request(app).get('/scorecard-photo/7');
      expect(res.status).toBe(404);
      expect(mockS3Sends.filter(c => c.__type === 'GetObject')).toHaveLength(0);
    });

    // Serving HTML from our own origin is strictly worse than from the bucket: here it
    // is same-origin with the session cookie. The bucket predates HARD-02's content
    // type check, so a legacy object can carry any type at all.
    it('never echoes a content type that is not an image', async () => {
      mockS3Objects.set(KEY, { body: Buffer.from('<script>alert(1)</script>'), contentType: 'text/html' });

      const res = await request(app).get('/scorecard-photo/7');

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toBe('image/jpeg');
      expect(res.headers['content-type']).not.toContain('html');
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      // A browser told "image/jpeg" and nosniff will not run this, whatever it is.
      expect(res.headers['content-disposition']).toMatch(/^inline/);
    });

    it('404s an object whose type and extension are both non-images', async () => {
      Fixture.getScorecardById.mockResolvedValue(
        draft({ 'scoresheet-url': `https://${BUCKET}.s3.eu-west-1.amazonaws.com/inbound/raw-email` })
      );
      mockS3Objects.set('inbound/raw-email', { body: Buffer.from('From: x'), contentType: 'text/plain' });

      const res = await request(app).get('/scorecard-photo/7');
      expect(res.status).toBe(404);
    });

    it('is not cached by shared caches, since the token is the authorization', async () => {
      const res = await request(app).get('/scorecard-photo/7');
      expect(res.headers['cache-control']).toMatch(/private/);
      expect(res.headers['cache-control']).not.toMatch(/\bpublic\b/);
    });
  });
});

// ── the confirmation page is where a photo is seen ────────────────────────────
//
// Before this, no page on the site rendered a photo that a human could see: both
// `<img src="<%= scorecard['scoresheet-url'] %>">` blocks read the *dropdown* object,
// which has no such key, so they emitted `src="undefined"`. The photo was only ever
// visible as a raw S3 link in the results secretary's email. Since the confirmation
// page already gets the draft row and already checks the token, it is the one place a
// photo can be shown without inventing a second authorization model.

describe('GET /populated-scorecard-beta/:id renders the photo', () => {
  const Division = require('../../models/division');
  const Team = require('../../models/teams');
  const Player = require('../../models/players');

  beforeEach(() => {
    Division.getAllAndSelectedById.mockResolvedValue([{ id: 1, name: 'Division 1', selected: 1 }]);
    Team.getAllAndSelectedById.mockResolvedValue([{ id: 10, name: 'Mellor A', selected: 1 }]);
    Player.getEligiblePlayersAndSelectedById.mockResolvedValue([
      { id: 1, first_name: 'Player', family_name: 'One', first: 1 }
    ]);
  });

  it('points the img at the proxy, not at the bucket', async () => {
    const res = await request(app).get('/populated-scorecard-beta/7');

    expect(res.status).toBe(200);
    expect(res.text).toContain('src="/scorecard-photo/7"');
    // The stored bucket URL never reaches the page. (`amazonaws.com` on its own is too
    // broad an assertion — the footer's social icons are hosted on someone else's S3.)
    expect(res.text).not.toContain(PHOTO_URL);
    expect(res.text).not.toContain(`${BUCKET}.s3`);
  });

  it('carries the token through to the img so the photo loads on a tokened link', async () => {
    Fixture.getScorecardById.mockResolvedValue(draft({ confirmToken: 'the-real-token' }));

    const res = await request(app).get('/populated-scorecard-beta/7?t=the-real-token');

    expect(res.status).toBe(200);
    expect(res.text).toContain('/scorecard-photo/7?t=the-real-token');
  });

  // The old template emitted `<img src="undefined">` on every render, because the
  // local it read was the dropdown data.
  it('renders no img at all when the draft has no photo', async () => {
    Fixture.getScorecardById.mockResolvedValue(draft({ 'scoresheet-url': '' }));

    const res = await request(app).get('/populated-scorecard-beta/7');

    expect(res.status).toBe(200);
    expect(res.text).not.toContain('/scorecard-photo/');
    expect(res.text).not.toContain('src="undefined"');
  });
});
