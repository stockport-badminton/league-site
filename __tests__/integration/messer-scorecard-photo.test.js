// The photo on a Messer draft: saved on submit, served to the approver only.
//
// Until 21 Oct 2026 the Messer form uploaded its photo into a hidden `scoresheet-url` and
// `full_messer_fixture_post` never read it, so no Messer draft has ever had a photo, and
// there was no route that could have shown one.

const request = require('supertest');

// Who is logged in, per test. Default: a messer admin.
let mockUser;
jest.mock('../../middleware/secured', () => (req, res, next) => { req.user = mockUser; next(); });

jest.mock('../../models/division');
jest.mock('../../models/teams');
jest.mock('../../models/players');
jest.mock('../../models/fixture');
jest.mock('../../models/auth.js');
jest.mock('../../utils/ses', () => ({ sendEmail: jest.fn().mockResolvedValue({}) }));
jest.mock('../../db_connect', () => ({
  connect: jest.fn(),
  sessionPool: () => ({ query: () => Promise.resolve({ rows: [] }) }),
  otherConnect: jest.fn(() => Promise.resolve({ query: jest.fn(() => Promise.resolve([[]])) })),
  isObject: jest.fn(obj => obj && typeof obj === 'object'),
}));

const mockS3Objects = new Map();
jest.mock('@aws-sdk/client-s3', () => {
  class NotFound extends Error {
    constructor() { super('NoSuchKey'); this.name = 'NoSuchKey'; }
  }
  return {
    S3Client: class {
      async send(command) {
        if (command.__type !== 'GetObject') return {};
        const stored = mockS3Objects.get(command.input.Key);
        if (!stored) throw new NotFound();
        const { Readable } = require('stream');
        return {
          Body: Readable.from([Buffer.from(stored.body)]),
          ContentType: stored.contentType,
          ContentLength: stored.body.length,
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
const { full_messer_fixture_post } = require('../../controllers/messer-scorecard-controller');

const BUCKET = 'badmintontemp';
const KEY = 'scorecards/20262027/abc-parrswood-a-david-lloyd-a.jpg';
const PHOTO_URL = `https://${BUCKET}.s3.eu-west-1.amazonaws.com/${KEY}`;
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);

const user = claims => ({
  id: 'auth0|test',
  displayName: 'Test User',
  emails: [{ value: 'captain@example.com' }],
  _json: claims,
});
const MESSER_ADMIN = user({ 'https://my-app.example.com/messeradmin': true });
const MEMBER = user({ 'https://my-app.example.com/role': 'captain' });

beforeEach(() => {
  jest.clearAllMocks();
  process.env.S3_BUCKET_NAME = BUCKET;
  mockUser = MESSER_ADMIN;
  mockS3Objects.clear();
  mockS3Objects.set(KEY, { body: JPEG, contentType: 'image/jpeg' });
  Fixture.getMesserScorecardById.mockResolvedValue([{ id: 17, 'scoresheet-url': PHOTO_URL }]);
});

describe('POST /messer-scorecard-beta saves the photo', () => {
  // Called directly: validation is a separate middleware on the route, so with no rules
  // run the handler goes straight to the INSERT, which is the part under test.
  async function submit(body) {
    Fixture.createMesserScorecard.mockResolvedValue([{ id: 17 }]);
    const req = { body: { date: '2026-10-20', homeTeam: '1', awayTeam: '2', ...body }, user: MESSER_ADMIN };
    const res = { redirect: jest.fn() };
    await full_messer_fixture_post(req, res, jest.fn());
    expect(res.redirect).toHaveBeenCalledWith('/populated-messer-scorecard/17');
    return Fixture.createMesserScorecard.mock.calls[0][0];
  }

  it('stores an uploaded photo from our own bucket', async () => {
    const row = await submit({ 'scoresheet-url': PHOTO_URL });
    expect(row['scoresheet-url']).toBe(PHOTO_URL);
  });

  it('drops a URL that is not ours, and still files the result', async () => {
    const row = await submit({ 'scoresheet-url': 'https://evil.example.com/card.jpg' });
    expect(row['scoresheet-url']).toBeNull();
  });

  it('files a card with no photo', async () => {
    const row = await submit({});
    expect(row['scoresheet-url']).toBeNull();
  });

  // `req.user.email` does not exist (CLAUDE.md gotcha 1a); the login address is in emails[].
  it('records the logged-in submitter, not only what the form says', async () => {
    const row = await submit({ email: '' });
    expect(row.email).toBe('captain@example.com');
  });
});

describe('GET /messer-scorecard-photo/:id', () => {
  it('serves the photo to a messer admin', async () => {
    const res = await request(app).get('/messer-scorecard-photo/17');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('image/jpeg');
    expect(Buffer.from(res.body)).toEqual(JPEG);
  });

  it('refuses a logged-in member who is not a messer admin', async () => {
    mockUser = MEMBER;
    const res = await request(app).get('/messer-scorecard-photo/17');
    expect(res.status).toBe(403);
    expect(Fixture.getMesserScorecardById).not.toHaveBeenCalled();
  });

  it('is a 404 when the draft has no photo', async () => {
    Fixture.getMesserScorecardById.mockResolvedValue([{ id: 17, 'scoresheet-url': null }]);
    const res = await request(app).get('/messer-scorecard-photo/17');
    expect(res.status).toBe(404);
  });

  it('is a 404 when the draft does not exist', async () => {
    Fixture.getMesserScorecardById.mockResolvedValue([]);
    const res = await request(app).get('/messer-scorecard-photo/999');
    expect(res.status).toBe(404);
  });
});

describe('GET /messer-result/:id shows the photo', () => {
  const detail = photo => Fixture.getMesserScorecardById.mockResolvedValue([{
    id: 17, date: '2026-10-20', email: 'captain@example.com', 'scoresheet-url': photo,
  }]);

  it('renders the photo through the gated route', async () => {
    detail(PHOTO_URL);
    const res = await request(app).get('/messer-result/17');
    expect(res.status).toBe(200);
    expect(res.text).toContain('src="/messer-scorecard-photo/17"');
    // Never the bucket URL: the object is private and the URL is not the authorization.
    expect(res.text).not.toContain(PHOTO_URL);
  });

  it('shows no photo section when there is none', async () => {
    detail(null);
    const res = await request(app).get('/messer-result/17');
    expect(res.status).toBe(200);
    expect(res.text).not.toContain('Scorecard Photo');
  });
});
