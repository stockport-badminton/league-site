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
  it('answers 400 JSON for a PDF, naming it and saying what still works', async () => {
    const res = await request(app)
      .post('/api/analyse-scorecard')
      .attach('scorecard', Buffer.from('%PDF-1.4 not a photo'), {
        filename: 'card.pdf', contentType: 'application/pdf',
      });

    // Not a 500. The uploader only shows a message it can find in responseJSON.
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/PDF/);
    expect(res.body.error).toMatch(/photo/i);
    // A route forward, not just a refusal: PDFs are 7% of the scorecards on record.
    expect(res.body.error).toMatch(/attach the PDF/i);
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
