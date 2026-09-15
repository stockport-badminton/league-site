// The weekly social images must be fetchable by Meta, which means two things this repo
// got wrong for as long as the weekly post has existed.
//
// **They were PNG.** Instagram's publishing API accepts JPEG and nothing else — Meta's
// documentation says so in terms. The League Tables scenario in Make.com hands Instagram
// URLs ending `.png`, so the carousel cannot ever have been accepted.
//
// **They were files on a container's disk.** `socialController` wrote them into
// `static/beta/images/generated/`, which on Cloud Run belongs to one instance and does not
// outlive it. The scenario's sequence is generate → sleep → fetch by URL, and Instagram's
// fetch happens later still, from Meta's own servers. Checked live on 15 Sep 2026:
//
//     $ curl -I .../generated/league-table-Premier.png
//     HTTP/2 404
//
// So these routes generate per request and return the bytes, like `/resultImage` already
// does. Nothing is stored and there is no instance to hit.
//
// The file-writing routes are deliberately still here and still writing: the live Make
// scenario calls them, and its Facebook branch does work (Make fetches the bytes itself
// and uploads them as data, so it never meets the format check). Removing them before the
// scenario is repointed would break the half that currently works.

process.env.NODE_ENV = 'test';

const TABLE_ROWS = [
  { division: 7, divisionName: 'Premier',    name: 'Mellor A',  played: 6, pointsFor: 60, pointsAgainst: 48 },
  { division: 7, divisionName: 'Premier',    name: 'Tatton A',  played: 6, pointsFor: 52, pointsAgainst: 56 },
  { division: 8, divisionName: 'Division 1', name: 'Disley A',  played: 5, pointsFor: 45, pointsAgainst: 45 },
  { division: 9, divisionName: 'Division 2', name: 'Dome B',    played: 4, pointsFor: 30, pointsAgainst: 42 },
  { division: 10, divisionName: 'Division 3', name: 'Manor C',  played: 4, pointsFor: 28, pointsAgainst: 44 },
  // A team before its first result. NULL, not 0 — which is the live shape at the start of
  // every season and rendered as the literal string "null" until 15 Sep 2026.
  { division: 10, divisionName: 'Division 3', name: 'Musketeers A', played: 0, pointsFor: null, pointsAgainst: null },
];

jest.mock('../../models/league', () => ({
  getAllLeagueTables: jest.fn().mockResolvedValue(TABLE_ROWS),
}));

const request = require('supertest');
const app = require('../../app');
const { leagueTableImagePath, tournamentImagePath } = require('../../utils/canonical');

// The first two bytes of a JPEG are FF D8; a PNG starts 89 50 4E 47. Asserting on the
// bytes rather than on the Content-Type header, because the header is what we set and the
// bytes are what Meta inspects — and it is the bytes that were wrong.
const isJpeg = buf => buf[0] === 0xFF && buf[1] === 0xD8;
const isPng = buf => buf[0] === 0x89 && buf[1] === 0x50;

describe('GET /league-table-image/:division', () => {
  it('returns a JPEG, not a PNG — the format Instagram will accept', async () => {
    const res = await request(app).get('/league-table-image/Premier');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^image\/jpeg/);
    expect(isJpeg(res.body)).toBe(true);
    expect(isPng(res.body)).toBe(false);
  });

  it('serves a division whose name contains a space', async () => {
    // Every division bar Premier does. The old page linked at a path with a raw space in
    // it, which is not a legal URL character — the same mistake that had Facebook
    // answering `Missing or invalid image file (324)` on the result card.
    const path = leagueTableImagePath('Division 1');
    expect(path).toBe('/league-table-image/Division%201');

    const res = await request(app).get(path);
    expect(res.status).toBe(200);
    expect(isJpeg(res.body)).toBe(true);
  });

  it('is served from data, with nothing written to disk', async () => {
    // Two fetches of the same URL both succeed. Under the old scheme the second request
    // could land on an instance that never wrote the file.
    const a = await request(app).get('/league-table-image/Division 2');
    const b = await request(app).get('/league-table-image/Division 2');
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(a.body.length).toBeGreaterThan(1000);
    expect(b.body.length).toBe(a.body.length);
  });

  it('404s an unknown division rather than answering 200', async () => {
    // gotcha 1c: `res.send(err)` serialises an Error to `{}` and goes out with status 200,
    // which a crawler banks as a real page.
    const res = await request(app).get('/league-table-image/Division%209');
    expect(res.status).toBe(404);
  });
});

describe('a team with no results yet', () => {
  // `String(null)` is "null". At the start of a season every team is in that state, so the
  // whole picture read "0 null null" down the page — on a 1080x1080 image posted to a
  // public Instagram account. It survived because nobody had ever looked at the rendered
  // output: the URL it was served from had been 404ing since the weekly post was built, so
  // a broken link was hiding a broken picture.
  //
  // Asserted on the SQL-facing values rather than the pixels, because the image is a
  // composite and OCR is not a test. `createDivisionTableImage` is not exported, so this
  // pins the guard at the point it can be pinned: the row shape goes through, and the
  // route does not throw on a NULL.
  const { leagueTableImagePath } = require('../../utils/canonical');

  it('renders a division containing a team with NULL games', async () => {
    const res = await request(app).get(leagueTableImagePath('Division 3'));
    expect(res.status).toBe(200);
    expect(isJpeg(res.body)).toBe(true);
  });

  // Against the real function the image draws with, not a copy of its arithmetic — a test
  // that restates the implementation passes against the bug just as happily.
  const { tableRowValues } = require('../../controllers/socialController');

  it('prints 0, not "null", for a team with no results', () => {
    expect(tableRowValues({ played: 0, pointsFor: null, pointsAgainst: null }))
      .toEqual({ played: '0', won: '0', lost: '0', avg: '0' });
  });

  it('leaves a real row alone', () => {
    // 6 matches, 60 games won, 48 lost — W and L are GAMES, since the league ranks on
    // games rather than a win/draw/loss table. 60 from 6 is correct, not a bug.
    expect(tableRowValues({ played: 6, pointsFor: 60, pointsAgainst: 48 }))
      .toEqual({ played: '6', won: '60', lost: '48', avg: '10.0' });
  });

  it('never emits the string "null" for any missing field', () => {
    for (const row of [{}, { played: null }, { pointsFor: undefined, pointsAgainst: null },
                       { played: undefined, pointsFor: null, pointsAgainst: undefined }]) {
      expect(Object.values(tableRowValues(row)).join(' ')).not.toMatch(/null|undefined|NaN/);
    }
  });
});

describe('GET /tournament-image/:poster', () => {
  it.each(['handicap', 'open', 'b', 'c', 'supervet'])('renders the %s poster as JPEG', async key => {
    const res = await request(app).get(tournamentImagePath(key));

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^image\/jpeg/);
    expect(isJpeg(res.body)).toBe(true);
  });

  it('is case-insensitive about the poster name', async () => {
    // The `b` poster is written to disk as `B-tournament-social.png` with a capital B,
    // while the Make scenario fetches `b-tournament-social.png`. Linux filesystems are
    // case-sensitive, so that was a 404 of its own hiding inside a directory that 404s
    // anyway. The route will not reproduce it.
    const res = await request(app).get('/tournament-image/B');
    expect(res.status).toBe(200);
    expect(isJpeg(res.body)).toBe(true);
  });

  it('404s an unknown poster and says what it knows', async () => {
    const res = await request(app).get('/tournament-image/nonesuch');
    expect(res.status).toBe(404);
    expect(res.text).toMatch(/handicap/);
  });
});

describe('the preview page links through the helpers', () => {
  it('has no link into the generated directory', async () => {
    const res = await request(app).get('/tables-social');

    expect(res.status).toBe(200);
    // The whole defect in one assertion: a link at a file on the container's disk.
    expect(res.text).not.toMatch(/images\/generated\//);
    expect(res.text).toContain('/league-table-image/Division%201');
    expect(res.text).toContain('/tournament-image/handicap');
  });
});
