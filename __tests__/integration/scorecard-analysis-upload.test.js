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
    // A route forward, not just a refusal.
    expect(res.body.error).toMatch(/attached to the scorecard/i);
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
    expect(res.body.error).toMatch(/attached to the scorecard/i);
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
    expect(res.body.error).not.toMatch(/larger than/i);
  }, 30000);

  it('still refuses something far over the new cap', async () => {
    const res = await request(app).post('/api/analyse-scorecard')
      .attach('scorecard', Buffer.alloc(26 * 1024 * 1024, 0x41), {
        filename: 'huge.jpg', contentType: 'image/jpeg' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/larger than 25MB/i);
  }, 30000);
});
