// An image the scorecard reader cannot read must be kept, so the failure can be checked.
//
// HARD-36. `POST /api/analyse-scorecard` used to read `req.file.buffer` and discard it
// unless the analysis SUCCEEDED, so a failure left a log line and a request size and
// nothing else. On 16 Sep 2026 a captain's first two photos failed and the third worked:
//
//     07:40:36  422  3,778,686 bytes   Missing corner anchors: DATE
//     07:41:21  422  3,811,219 bytes   Missing corner anchors: DATE
//     07:42:05  200  3,740,264 bytes   ok
//
// Three different photos. Diagnosing the failures meant working from the only image left,
// which had by definition succeeded — and that cannot say what was different about the two
// that did not. `a44d16b` made the message distinguish "we refused it" from "it was not
// there"; this is what makes that message checkable, because `outside[yMax=0.45]` is only
// believable if somebody can look at the photo it describes.
//
// The two properties that matter, and both are asserted below:
//
//   - it goes under its own prefix, which is where the 14-day lifecycle expiry is attached.
//     A scorecard photo is the league's record of a result and is kept; this is diagnostic
//     scrap carrying twelve players' names and two captains' signatures, and is not.
//   - **a failed store changes nothing the captain sees.** Their problem is that the
//     auto-fill did not work. "We also could not save your photo" helps nobody and is not
//     theirs to act on.

process.env.NODE_ENV = 'test';

// Both routes here are `secured` and the real caller was logged in — same shape as
// __tests__/integration/scorecard-analysis-upload.test.js.
jest.mock('../../middleware/secured', () => (req, res, next) => {
  req.user = { id: 'auth0|captain', _json: {
    'https://my-app.example.com/role': 'captain',
    'https://my-app.example.com/club': 'Mellor',
  } };
  next();
});

jest.mock('../../models/fixture');
jest.mock('../../models/division');
jest.mock('../../models/players');
jest.mock('../../models/teams');
jest.mock('../../models/game');
jest.mock('../../models/club');
jest.mock('../../models/auth.js');
jest.mock('axios');
// S3 must never be real here. utils/uploads is mocked below so storeImage never reaches
// it, but the first run of the sibling suite without this put two objects in the
// PRODUCTION bucket — app.js calls dotenv.config(), so the live credentials are present.
// Belt and braces on the one path that writes server-side.
jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn(() => ({ send: jest.fn().mockResolvedValue({}) })),
  PutObjectCommand: jest.fn(),
  GetObjectCommand: jest.fn(),
}));
jest.mock('../../controllers/scorecardExtraction', () => ({ extractScorecardData: jest.fn() }));

jest.mock('../../utils/uploads', () => {
  const actual = jest.requireActual('../../utils/uploads');
  return { ...actual, storeImage: jest.fn() };
});

jest.mock('../../controllers/cornerDetection', () => ({ analyseImage: jest.fn() }));

// Only reached for a document upload, so the image tests above are unaffected.
jest.mock('../../utils/documentImage', () => {
  const actual = jest.requireActual('../../utils/documentImage');
  return { ...actual, extractEmbeddedImage: jest.fn() };
});

const request = require('supertest');
const app = require('../../app');
const { storeImage, FAILED_PREFIX, FAILED_UPLOAD_TYPES } = require('../../utils/uploads');
const { extractEmbeddedImage } = require('../../utils/documentImage');
const { analyseImage } = require('../../controllers/cornerDetection');

// A real-enough JPEG: the two magic bytes are all any of this cares about.
const JPEG = Buffer.concat([Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]), Buffer.alloc(2048, 7)]);

const unreadable = () => {
  const err = new Error('The reader could not line up this scorecard…');
  err.status = 422;
  err.detail = 'Missing corner anchors: DATE="DATE"@(0.2,0.62) outside[yMin=0,yMax=0.45]';
  return err;
};

const upload = () => request(app)
  .post('/api/analyse-scorecard')
  .attach('scorecard', JPEG, { filename: 'tatton-a-v-manor-b.jpg', contentType: 'image/jpeg' });

beforeEach(() => {
  jest.clearAllMocks();
  storeImage.mockResolvedValue({ key: `${FAILED_PREFIX}/20262027/abc-card.jpg`, url: 'https://x/y.jpg' });
});

describe('when the reader cannot read the card', () => {
  it('keeps the image, under the failed-analysis prefix', async () => {
    analyseImage.mockRejectedValue(unreadable());

    const res = await upload();

    expect(res.status).toBe(422);
    expect(storeImage).toHaveBeenCalledTimes(1);
    const arg = storeImage.mock.calls[0][0];
    expect(arg.prefix).toBe(FAILED_PREFIX);
    expect(arg.buffer.length).toBe(JPEG.length);
    expect(arg.contentType).toBe('image/jpeg');
  });

  // The prefix is not cosmetic: the lifecycle rule is attached to it, so an object is
  // expired by virtue of being written there. Retention that depends on somebody
  // remembering is not retention.
  it('uses a prefix distinct from the one real scorecard photos live under', () => {
    const actual = jest.requireActual('../../utils/uploads');
    expect(FAILED_PREFIX).not.toBe(actual.PREFIX);
    expect(FAILED_PREFIX.startsWith(actual.PREFIX)).toBe(true);   // still inside the bucket's scorecard area
  });

  it('still answers the captain with the friendly 422, not a store error', async () => {
    analyseImage.mockRejectedValue(unreadable());

    const res = await upload();

    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/could not line up/i);
    expect(JSON.stringify(res.body)).not.toMatch(/failed-analysis|s3|bucket/i);
  });

  // The whole point of the helper: this must not turn a 422 into a 500.
  it('answers exactly the same when the store itself fails', async () => {
    analyseImage.mockRejectedValue(unreadable());
    storeImage.mockRejectedValue(new Error('S3 is having a day'));

    const res = await upload();

    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/could not line up/i);
  });
});

describe('when the reader succeeds', () => {
  it('stores nothing extra — the page attaches the photo itself', async () => {
    analyseImage.mockResolvedValue({ textBlocks: [], imageWidth: 100, imageHeight: 100 });
    require('../../controllers/scorecardExtraction').extractScorecardData.mockResolvedValue({
      metadata: { date: '', division: '', homeTeam: '', awayTeam: '' },
      homePlayers: [], awayPlayers: [], pointsPairs: [],
    });
    require('../../models/teams').getAll.mockResolvedValue([]);
    require('../../models/division').getAll.mockResolvedValue([]);

    await upload();

    expect(storeImage).not.toHaveBeenCalled();
  });
});

describe('a genuine 500', () => {
  it('keeps the image too, because that is the case most worth having', async () => {
    // A 4xx is the captain's photo being unreadable; a 500 is our bug. The image is
    // arguably more useful in the second case, so the store is not conditional on status.
    analyseImage.mockRejectedValue(new Error('something unexpected'));

    const res = await upload();

    expect(res.status).toBe(500);
    expect(storeImage).toHaveBeenCalledTimes(1);
    expect(storeImage.mock.calls[0][0].prefix).toBe(FAILED_PREFIX);
  });
});

// ── The same failure, on the document path — the hole HARD-36 left ───────────
//
// HARD-36 covered `analyse_scorecard`'s catch block. It could not cover a **4xx refusal**,
// because those return from inside the try and never reach the catch, and it deliberately
// skipped documents on the reasoning that `convertDocument` has already stored the image
// before the OCR runs.
//
// That reasoning holds only when extraction SUCCEEDS. When no image can be pulled out,
// nothing was stored under the ordinary prefix, the wrapper is discarded, and the refusal
// logged nothing at all — so the one failure that most needs evidence kept none.
//
// Found in production on 17 Sep 2026. A captain's Aerospace card was refused:
//
//     13:41:21  400  41,713 bytes  POST /api/convert-scorecard-document
//
// and there was no log line, no Sentry event and no object anywhere. Three different
// branches return 400 there and nothing recorded which one fired.
const DOCX_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const DOCX = Buffer.concat([Buffer.from([0x50, 0x4B, 0x03, 0x04]), Buffer.alloc(4096, 3)]);

const uploadDoc = (route) => request(app)
  .post(route)
  .attach('scorecard', DOCX, { filename: 'aerospace-a-v-shell-c.docx', contentType: DOCX_TYPE });

describe('when no image can be pulled out of a document', () => {
  beforeEach(() => {
    extractEmbeddedImage.mockReturnValue(null);
    storeImage.mockResolvedValue({ key: `${FAILED_PREFIX}/20262027/abc-card.docx`, url: 'https://x/y.docx' });
  });

  it.each(['/api/convert-scorecard-document', '/api/analyse-scorecard'])(
    'keeps the document itself, under the failed-analysis prefix: %s', async route => {
      const res = await uploadDoc(route);

      expect(res.status).toBe(400);
      expect(storeImage).toHaveBeenCalledTimes(1);
      const arg = storeImage.mock.calls[0][0];
      expect(arg.prefix).toBe(FAILED_PREFIX);
      // The WRAPPER, not an image — there is no image, which is the whole failure.
      expect(arg.buffer.length).toBe(DOCX.length);
      expect(arg.contentType).toBe(DOCX_TYPE);
      // ALLOWED_TYPES has no docx and must not gain one: it guards the presigned PUT,
      // where the content type is attacker-chosen.
      expect(arg.types).toBe(FAILED_UPLOAD_TYPES);
    });

  it('says which check refused it, and where the file went', async () => {
    const err = jest.spyOn(console, 'error').mockImplementation(() => {});
    await uploadDoc('/api/convert-scorecard-document');

    const logged = err.mock.calls.map(c => c.join(' ')).join('\n');
    expect(logged).toMatch(/no image could be extracted/);
    expect(logged).toMatch(new RegExp(FAILED_PREFIX));
    err.mockRestore();
  });

  it('tells the captain the same thing as before, leaking nothing', async () => {
    const res = await uploadDoc('/api/convert-scorecard-document');
    expect(res.body.error).toMatch(/could not be pulled out of that file/i);
    expect(JSON.stringify(res.body)).not.toMatch(/failed-analysis|s3|bucket|mimetype/i);
  });

  it('answers exactly the same when the store itself fails', async () => {
    storeImage.mockRejectedValue(new Error('S3 is having a day'));
    const res = await uploadDoc('/api/convert-scorecard-document');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/could not be pulled out of that file/i);
  });
});

describe('a document that converts fine', () => {
  it('is not also kept as diagnostic scrap', async () => {
    extractEmbeddedImage.mockReturnValue({ buffer: JPEG, contentType: 'image/jpeg' });
    storeImage.mockResolvedValue({ key: 'scorecards/20262027/real.jpg', url: 'https://x/real.jpg' });

    const res = await uploadDoc('/api/convert-scorecard-document');

    expect(res.status).toBe(200);
    // Exactly one store, and it is the ordinary prefix — not a second copy under a
    // 14-day expiry, which would quietly delete a photo the league is meant to keep.
    expect(storeImage).toHaveBeenCalledTimes(1);
    expect(storeImage.mock.calls[0][0].prefix).not.toBe(FAILED_PREFIX);
  });
});

// The one refusal that keeps NOTHING, deliberately.
//
// This is a complaint about routing, not about content: an image posted to the document
// endpoint. The content type explains it completely and is in the log line, so the bytes
// would add nothing — and a scorecard photo carries twelve players' names and both
// captains' signatures. "Keep everything we refused" is the easy rule and the wrong one.
describe('a photo sent to the document endpoint', () => {
  it('is refused and logged, but not kept', async () => {
    const err = jest.spyOn(console, 'error').mockImplementation(() => {});

    const res = await request(app)
      .post('/api/convert-scorecard-document')
      .attach('scorecard', JPEG, { filename: 'card.jpg', contentType: 'image/jpeg' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/not a PDF or Word file/i);
    expect(storeImage).not.toHaveBeenCalled();

    const logged = err.mock.calls.map(c => c.join(' ')).join('\n');
    expect(logged).toMatch(/not a document/);
    expect(logged).toMatch(/image\/jpeg/);          // the whole diagnosis, in the line
    expect(logged).toMatch(/nothing to learn from it/);
    err.mockRestore();
  });
});
