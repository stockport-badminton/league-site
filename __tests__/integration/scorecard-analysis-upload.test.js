// The OCR uploader's refusals.
//
// Sentry NODE-Z, 4 Sep 2026: a logged-in captain posted two different files to
// /api/analyse-scorecard a minute apart — 144KB and 94KB, from a Windows desktop, so not
// phone photos — and both came back as a 500. multer's fileFilter error went straight to
// the central HTML error handler, and the uploader reads `xhr.responseJSON.error`, which
// an HTML 500 does not carry. So the captain saw only "Could not read the scorecard.
// Please fill in manually." with nothing to say the FILE TYPE was the problem, which is
// why they tried a second file rather than converting the first.

const request = require('supertest');

// Logged in: the route is `secured`, and the real caller was.
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
// The OCR pipeline must never run in a test — it calls out to Vision.
jest.mock('../../controllers/cornerDetection', () => ({ analyseImage: jest.fn() }));
jest.mock('../../controllers/scorecardExtraction', () => ({ extractScorecardData: jest.fn() }));

// S3 must never be real. This is not belt-and-braces: storing the image pulled out of a
// document is a SERVER-side PUT (an image upload uses a presigned PUT from the browser),
// and the first run of this suite without this mock put two objects in the production
// bucket, because `app.js` calls dotenv.config() and so the live credentials are present.
// __tests__/setup.js now also kills the credentials as a backstop; this makes the call
// observable as well as harmless.
const mockS3Puts = [];
let mockPutFails = false;
jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: class {
    async send(command) {
      if (command.__type === 'PutObject') {
        if (mockPutFails) throw new Error('S3 said no');
        mockS3Puts.push(command.input);
      }
      return {};
    }
  },
  PutObjectCommand: class { constructor(input) { this.input = input; this.__type = 'PutObject'; } },
  GetObjectCommand: class { constructor(input) { this.input = input; this.__type = 'GetObject'; } },
  HeadObjectCommand: class { constructor(input) { this.input = input; this.__type = 'HeadObject'; } },
}));
jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: jest.fn().mockResolvedValue('https://example.invalid/signed?X-Amz-Signature=x'),
}));

const app = require('../../app');

const JPEG = Buffer.from('ffd8ffe000104a464946', 'hex');

describe('POST /api/analyse-scorecard — refusing an upload', () => {
  // PDFs are no longer refused at the door - they are accepted and converted (HARD-25
  // Phase 1). One that cannot be converted is refused in the handler instead, with a
  // message that points at what still works. This case is the not-really-a-pdf shape.
  it('explains itself for a pdf whose photo cannot be extracted', async () => {
    const res = await request(app)
      .post('/api/analyse-scorecard')
      .attach('scorecard', Buffer.from('%PDF-1.4 not a photo'), {
        filename: 'card.pdf', contentType: 'application/pdf',
      });

    // Not a 500. The uploader only shows a message it can find in responseJSON.
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/could not be pulled out/i);
    // A route forward, not just a refusal — and one that actually exists. It must NOT
    // offer to attach the document, because /sign-s3 takes images only, so that would
    // send a captain round a loop that cannot close.
    expect(res.body.error).toMatch(/take a photo/i);
    expect(res.body.error).not.toMatch(/attach/i);
  });

  it('answers 400 JSON for any other non-photo, saying what to send', async () => {
    const res = await request(app)
      .post('/api/analyse-scorecard')
      .attach('scorecard', Buffer.from('teams,scores\n'), {
        filename: 'results.csv', contentType: 'text/csv',
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/JPEG, PNG or HEIC/);
  });

  // Some browsers hand a HEIC over as application/octet-stream. Refusing a real photo
  // for the sake of a bad content type is the wrong failure.
  it('accepts a photo whose content type is octet-stream but whose name is not', async () => {
    const res = await request(app)
      .post('/api/analyse-scorecard')
      .attach('scorecard', JPEG, {
        filename: 'IMG_4021.HEIC', contentType: 'application/octet-stream',
      });

    // Past the filter, so the failure is the OCR mock rather than the upload gate.
    expect(res.status).not.toBe(400);
  });

  it('does not answer 500 for any of them', async () => {
    for (const [filename, contentType] of [
      ['card.pdf', 'application/pdf'],
      ['results.csv', 'text/csv'],
      ['notes.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    ]) {
      const res = await request(app).post('/api/analyse-scorecard')
        .attach('scorecard', Buffer.from('x'), { filename, contentType });
      expect(res.status).toBe(400);
    }
  });

  it('still refuses when nothing is attached', async () => {
    const res = await request(app).post('/api/analyse-scorecard');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/No image uploaded/);
  });
});

// Phase 1 of HARD-25: a document scorecard is converted on the way in, so the OCR reader
// sees a photo and the captain never has to know their file was a wrapper.
describe('POST /api/analyse-scorecard -- document scorecards', () => {
  const fs = require('fs');
  const path = require('path');
  const fixture = n => fs.readFileSync(path.join(__dirname, '..', 'fixtures', n));

  it('accepts a .docx and gets as far as OCR', async () => {
    const res = await request(app).post('/api/analyse-scorecard')
      .attach('scorecard', fixture('scorecard-docx-jpeg.docx'), {
        filename: 'card.docx',
        contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      });
    // Past the gate and past extraction, so any failure is the mocked OCR rather than the
    // upload being refused.
    expect(res.status).not.toBe(400);
  });

  it('accepts a /DCTDecode .pdf and gets as far as OCR', async () => {
    const res = await request(app).post('/api/analyse-scorecard')
      .attach('scorecard', fixture('scorecard-pdf-dct.pdf'), {
        filename: 'card.pdf', contentType: 'application/pdf',
      });
    expect(res.status).not.toBe(400);
  });

  // The ~35% Phase 1 does not handle. It must say so plainly rather than 500, and must
  // point at something that still works.
  it('explains itself when the photo cannot be pulled out', async () => {
    const res = await request(app).post('/api/analyse-scorecard')
      .attach('scorecard', fixture('scorecard-pdf-flate.pdf'), {
        filename: 'card.pdf', contentType: 'application/pdf',
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/could not be pulled out/i);
    expect(res.body.error).toMatch(/take a photo/i);
    expect(res.body.error).not.toMatch(/attach/i);
  });

  // ── The storage seam ────────────────────────────────────────────────────────
  //
  // The point of the whole package. `/sign-s3` takes jpeg, png, webp and heic only, so a
  // document cannot go into the bucket and never could since HARD-02 closed the
  // caller-chooses-the-type hole. What goes in is the IMAGE pulled out of it, stored
  // server-side, and the URL comes back for the page to put in `scoresheet-url`.
  describe('storing the extracted photo', () => {
    const { analyseImage } = require('../../controllers/cornerDetection');
    const { extractScorecardData } = require('../../controllers/scorecardExtraction');

    beforeEach(() => {
      mockS3Puts.length = 0;
      mockPutFails = false;
      // Enough of an OCR result to reach the response.
      analyseImage.mockResolvedValue({ textBlocks: [], imageWidth: 600, imageHeight: 400 });
      extractScorecardData.mockResolvedValue({
        metadata: { date: '', division: '', homeTeam: '', awayTeam: '' },
        homePlayers: [], awayPlayers: [], pointsPairs: [],
      });
      require('../../models/teams').getAll.mockResolvedValue([]);
      require('../../models/division').getAll.mockResolvedValue([]);
    });

    it('puts the extracted jpeg in the bucket and hands back its URL', async () => {
      const res = await request(app).post('/api/analyse-scorecard')
        .attach('scorecard', fixture('scorecard-pdf-dct.pdf'), {
          filename: 'card.pdf', contentType: 'application/pdf',
        });

      expect(res.status).toBe(200);
      expect(res.body.photoStored).toBe(true);
      expect(mockS3Puts).toHaveLength(1);
      const put = mockS3Puts[0];

      // The IMAGE, not the pdf.
      expect(put.ContentType).toBe('image/jpeg');
      expect(put.Body.slice(0, 3).toString('hex')).toBe('ffd8ff');
      expect(put.Body.length).toBeLessThan(fixture('scorecard-pdf-dct.pdf').length);

      // Server-generated key under the season prefix, and the extension comes from the
      // content type — so nothing is stored as `.pdf`.
      expect(put.Key).toMatch(/^scorecards\/\d{8}\/[0-9a-f-]{36}-card\.jpg$/);

      // HARD-02b made every object in this bucket private. A public-read object here
      // would be a hole in that, and nothing would report it.
      expect(put.ACL).toBeUndefined();

      // The URL must be one the photo proxy will accept, or the photo is stored and
      // unreachable. This is the actual contract between the two halves.
      const { normalisePhotoUrl } = require('../../utils/scorecardLinks');
      expect(res.body.photoUrl).toContain(put.Key);
      expect(() => normalisePhotoUrl(res.body.photoUrl)).not.toThrow();
    });

    it('stores a docx photo as a jpeg too', async () => {
      const res = await request(app).post('/api/analyse-scorecard')
        .attach('scorecard', fixture('scorecard-docx-jpeg.docx'), {
          filename: 'card.docx',
          contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        });
      expect(res.body.photoStored).toBe(true);
      expect(mockS3Puts[0].ContentType).toBe('image/jpeg');
      expect(mockS3Puts[0].Key).toMatch(/\.jpg$/);
    });

    // A store failure must not cost the captain the OCR as well. They get the prefill and
    // a flag saying the photo did not save, rather than an error and nothing.
    it('still returns the OCR when the store fails', async () => {
      mockPutFails = true;
      const res = await request(app).post('/api/analyse-scorecard')
        .attach('scorecard', fixture('scorecard-pdf-dct.pdf'), {
          filename: 'card.pdf', contentType: 'application/pdf',
        });
      expect(res.status).toBe(200);
      expect(res.body.photoStored).toBe(false);
      expect(res.body.photoUrl).toBeNull();
      expect(res.body).toHaveProperty('_meta');
    });

    // An image upload does its own presigned PUT from the browser and must not be
    // double-stored, nor told about a photoUrl it did not ask for.
    it('does not store or report anything for an image upload', async () => {
      const res = await request(app).post('/api/analyse-scorecard')
        .attach('scorecard', JPEG, { filename: 'card.jpg', contentType: 'image/jpeg' });
      expect(res.status).toBe(200);
      expect(mockS3Puts).toHaveLength(0);
      expect(res.body).not.toHaveProperty('photoUrl');
      expect(res.body).not.toHaveProperty('photoStored');
    });
  });

  it('refuses a zip by name, without reading it', async () => {
    const res = await request(app).post('/api/analyse-scorecard')
      .attach('scorecard', Buffer.from('PK pretend archive'), {
        filename: 'card.zip', contentType: 'application/zip',
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Zip files are not accepted/);
  });

  // Three of the five objects over the old 10MB cap were genuine scorecards a captain
  // filed, so the cap was refusing real cards. 25MB clears the largest (20.3MB) and still
  // refuses the 25.2MB zip.
  it('accepts a file over the old 10MB limit', async () => {
    const twelveMb = Buffer.alloc(12 * 1024 * 1024, 0x41);
    twelveMb.set([0xff, 0xd8, 0xff], 0);
    const res = await request(app).post('/api/analyse-scorecard')
      .attach('scorecard', twelveMb, { filename: 'big.jpg', contentType: 'image/jpeg' });
    // Not refused *for its size*. Deliberately does not require an error at all: whether
    // the OCR behind it succeeds is another test's business, and asserting on
    // `res.body.error` being a string tied this case to the mock happening to reject.
    expect(res.status).not.toBe(413);
    expect(String(res.body.error || '')).not.toMatch(/larger than/i);
  }, 30000);

  it('still refuses something far over the new cap', async () => {
    const res = await request(app).post('/api/analyse-scorecard')
      .attach('scorecard', Buffer.alloc(26 * 1024 * 1024, 0x41), {
        filename: 'huge.jpg', contentType: 'image/jpeg' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/larger than 25MB/i);
  }, 30000);
});
