// The Messer Trophy score sheet, drawn as a PDF with the current season.
//
// The static spreadsheet it replaced said "MESSER TROPHY 2023-2024" for three seasons
// and told captains to email a Messer secretary. These tests read the text drawn on the
// page, because a 200 with the right Content-Type is exactly what the stale static file
// also returned.

const zlib = require('zlib');
const request = require('supertest');

jest.mock('../../models/season', () => ({
  current: jest.fn(() => '20262027'),
  previous: jest.fn(() => '20252026'),
  getSeasons: jest.fn(() => ({ current: '20262027', previous: '20252026' })),
  assertName: jest.fn(),
  isServable: jest.fn(() => true),
  archived: jest.fn(() => []),
}));

jest.mock('../../db_connect', () => ({
  connect: jest.fn(),
  sessionPool: () => ({ query: () => Promise.resolve({ rows: [] }) }),
  otherConnect: jest.fn(() => Promise.resolve({
    query: jest.fn(() => Promise.resolve([[], []])),
  })),
  withTransaction: jest.fn(fn => fn({ query: jest.fn(() => Promise.resolve([[]])) })),
  isObject: jest.fn(obj => obj === Object(obj)),
}));

const app = require('../../app');

// Every string drawn on the page, in drawing order. pdf-lib writes each drawText as a
// hex string shown with Tj, inside a flate-compressed content stream.
function drawnText(pdf) {
  const raw = pdf.toString('latin1');
  const texts = [];
  for (const m of raw.matchAll(/stream\r?\n/g)) {
    const start = m.index + m[0].length;
    let data = Buffer.from(raw.slice(start, raw.indexOf('endstream', start)), 'latin1');
    try { data = zlib.inflateSync(data); } catch (e) { /* not compressed */ }
    for (const t of data.toString('latin1').matchAll(/<([0-9A-Fa-f]+)> Tj/g)) {
      texts.push(Buffer.from(t[1], 'hex').toString('latin1'));
    }
  }
  return texts;
}

async function fetchSheet() {
  const res = await request(app).get('/forms/messer-score-sheet.pdf').buffer().parse((r, cb) => {
    const chunks = [];
    r.on('data', c => chunks.push(c));
    r.on('end', () => cb(null, Buffer.concat(chunks)));
  });
  return { res, texts: res.status === 200 ? drawnText(res.body) : [] };
}

const count = (texts, s) => texts.filter(t => t === s).length;

describe('GET /forms/messer-score-sheet.pdf', () => {
  it('is a PDF named for the current season', async () => {
    const { res } = await fetchSheet();
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['content-disposition']).toContain('Messer Score Sheet 2026-27.pdf');
    expect(res.body.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('carries the current season in the title of both copies', async () => {
    const { texts } = await fetchSheet();
    expect(count(texts, 'Messer Trophy 2026-2027')).toBe(2);
    expect(texts.join(' ')).not.toMatch(/2023/);
  });

  it('tells the winning captain to upload the result within seven days', async () => {
    const { texts } = await fetchSheet();
    const all = texts.join(' ');
    expect(all).toContain('After each match the Captain of the winning team will be responsible for');
    expect(count(texts, 'League Website.')).toBe(2);
    expect(count(texts, 'This must be done within seven days of the match having been played.')).toBe(2);
    expect(all).not.toMatch(/email/i);
  });

  it('has the nine Messer rubbers and both handicaps on each copy', async () => {
    const { texts } = await fetchSheet();
    expect(count(texts, 'GENTS')).toBe(6);
    expect(count(texts, 'LADIES')).toBe(6 + 4); // three rubbers per copy, plus each team block
    expect(count(texts, 'MIXED')).toBe(6);
    expect(count(texts, 'H/Cp')).toBe(4);
    expect(count(texts, 'Adj H/Cp')).toBe(4);
  });
});

describe('the old spreadsheet URL', () => {
  it('redirects to the generated sheet', async () => {
    const res = await request(app).get('/static/beta/docs/Messer-Score-Sheet.xlsx');
    expect(res.status).toBe(301);
    expect(res.headers.location).toBe('/forms/messer-score-sheet.pdf');
  });
});
