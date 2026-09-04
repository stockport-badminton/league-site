// The MJML email pipeline: emails/*.mjml -> npm run build:email -> views/emails/*.ejs
// -> utils/mailer.js.
//
// These assert on the RENDERED HTML and on what reaches SES, not on which function was
// called. An email is the one output nobody sees until it is in somebody's inbox, and
// the templates are compiled — so a test that only checked `mailer.send` was invoked
// would pass while the template was blank, which is precisely how the messer confirmation
// page shipped empty (see the note in CLAUDE.md about asserting on rendered HTML).

const request = require('supertest');

jest.mock('../../models/fixture');
jest.mock('../../models/division');
jest.mock('../../models/players');
jest.mock('../../models/teams');
jest.mock('../../models/game');
jest.mock('../../models/club');
jest.mock('../../models/auth.js');
jest.mock('axios');
jest.mock('../../utils/ses', () => ({ sendEmail: jest.fn().mockResolvedValue({}) }));

const ses = require('../../utils/ses');
const mailer = require('../../utils/mailer');

const sent = () => {
  expect(ses.sendEmail).toHaveBeenCalled();
  return ses.sendEmail.mock.calls[ses.sendEmail.mock.calls.length - 1][0];
};
const htmlOf = p => p.Message.Body.Html.Data;
const textOf = p => p.Message.Body.Text && p.Message.Body.Text.Data;

beforeEach(() => { jest.clearAllMocks(); ses.sendEmail.mockResolvedValue({}); });

describe('utils/mailer', () => {
  const ok = {
    template: 'scorecard-received',
    subject: 'Scorecard received: Mellor A v Aerospace A',
    to: 'results@example.com',
    text: 'plain text alternative',
    whyReceiving: 'Because you are the results secretary.',
    data: {
      homeTeamName: 'Mellor A', awayTeamName: 'Aerospace A',
      divisionName: 'Division 1', matchDate: 'Tuesday 3 September',
      confirmUrl: 'https://stockport-badminton.co.uk/populated-scorecard-beta/1?t=abc',
      photoUrl: '', photoLine: 'A scorecard has been entered, with no photo attached.',
    },
  };

  it('sends html and a plain-text alternative', async () => {
    await mailer.send(ok);
    const p = sent();
    expect(htmlOf(p)).toContain('<!doctype html>');
    // No text part means a worse spam score and an empty body in a text-only client.
    expect(textOf(p)).toBe('plain text alternative');
  });

  it('sends from the one verified address, whatever the caller asks', async () => {
    await mailer.send(ok);
    expect(sent().Source).toBe('results@stockport-badminton.co.uk');
  });

  it('prints the whyReceiving line in the footer', async () => {
    await mailer.send(ok);
    expect(htmlOf(sent())).toContain('Because you are the results secretary.');
  });

  // Both are required rather than defaulted, so a new email cannot quietly ship without
  // them. A transactional email nobody can place is one somebody marks as junk, and with
  // SES a complaint counts against a domain shared with the invoices.
  it.each([['text'], ['whyReceiving']])('refuses to send with no %s', async field => {
    const bad = Object.assign({}, ok); delete bad[field];
    await expect(mailer.send(bad)).rejects.toThrow(new RegExp(field));
    expect(ses.sendEmail).not.toHaveBeenCalled();
  });

  it('uses an absolute logo url, since an email has no request to build one from', async () => {
    await mailer.send(ok);
    expect(htmlOf(sent())).toContain('https://stockport-badminton.co.uk/touch-icon-192x192.png');
  });
});

describe('the scorecard-received template', () => {
  const base = {
    template: 'scorecard-received', subject: 's', to: 'a@b.com', text: 't',
    whyReceiving: 'w',
    data: {
      homeTeamName: 'Mellor A', awayTeamName: 'Aerospace A',
      divisionName: 'Division 1', matchDate: 'Tuesday 3 September',
      confirmUrl: 'https://example.com/confirm', photoUrl: '',
      photoLine: 'A scorecard has been entered, with no photo attached.',
    },
  };

  // The agreed content change: the old email said only "a new scorecard has been
  // entered" and left the reader to open the link to find out which match it meant.
  it('names the match', async () => {
    await mailer.send(base);
    const html = htmlOf(sent());
    expect(html).toContain('Mellor A');
    expect(html).toContain('Aerospace A');
    expect(html).toContain('Division 1');
    expect(html).toContain('Tuesday 3 September');
  });

  it('links the confirmation url', async () => {
    await mailer.send(base);
    expect(htmlOf(sent())).toContain('https://example.com/confirm');
  });

  // The mj-raw conditional. An EJS tag between two MJML components is DISCARDED by the
  // compiler and whatever it guarded renders unconditionally — so without mj-raw this
  // email offers a photo link on every submission, including those with no photo.
  it('offers the photo row only when there is a photo', async () => {
    await mailer.send(base);
    expect(htmlOf(sent())).not.toContain('scorecard photo');

    jest.clearAllMocks();
    await mailer.send(Object.assign({}, base, {
      data: Object.assign({}, base.data, { photoUrl: 'https://example.com/photo/1' }),
    }));
    const html = htmlOf(sent());
    expect(html).toContain('scorecard photo');
    expect(html).toContain('https://example.com/photo/1');
  });
});

describe('the website-updated template', () => {
  const base = {
    template: 'website-updated', subject: 's', to: 'a@b.com', text: 't', whyReceiving: 'w',
    data: {
      homeTeamName: 'Mellor A', awayTeamName: 'Aerospace A', divisionName: 'Division 1',
      homeScore: 13, awayScore: 5, matchStats: [], resultImageUrl: '',
    },
  };

  it('leads with the score', async () => {
    await mailer.send(base);
    const html = htmlOf(sent());
    expect(html).toContain('13');
    expect(html).toContain('5');
    expect(html).toContain('Mellor A');
  });

  it('renders a stats row per player, and omits the table when there are none', async () => {
    await mailer.send(base);
    expect(htmlOf(sent())).not.toContain('Pts against');

    jest.clearAllMocks();
    await mailer.send(Object.assign({}, base, {
      data: Object.assign({}, base.data, {
        matchStats: [
          { name: 'Chris Petty', teamName: 'Mellor A', gamesWon: 4, avgPtsFor: 21, avgPtsAgainst: 14 },
          { name: 'Jo Hilliard', teamName: 'Mellor A', gamesWon: 3, avgPtsFor: 19, avgPtsAgainst: 16 },
        ],
      }),
    }));
    const html = htmlOf(sent());
    expect(html).toContain('Pts against');
    expect(html).toContain('Chris Petty');
    expect(html).toContain('Jo Hilliard');
  });

  it('escapes a player name rather than letting it become markup', async () => {
    await mailer.send(Object.assign({}, base, {
      data: Object.assign({}, base.data, {
        matchStats: [{ name: '<script>x</script>', teamName: 'T', gamesWon: 1, avgPtsFor: 1, avgPtsAgainst: 1 }],
      }),
    }));
    const html = htmlOf(sent());
    expect(html).not.toContain('<script>x</script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

// The compiled .ejs is committed because the Dockerfile runs `npm ci --omit=dev` and mjml
// never reaches the image. That only works if the committed output matches its source, so
// this fails when somebody edits a .ejs directly or forgets to rebuild.
describe('the committed templates match their mjml source', () => {
  it('npm run build:email leaves nothing stale', () => {
    const { execFileSync } = require('child_process');
    expect(() => execFileSync(process.execPath, ['tools/build-emails.js', '--check'],
      { cwd: process.cwd(), stdio: 'pipe' })).not.toThrow();
  }, 60000);
});
