// Season name validation.
//
// A season is not a bind parameter — it is a table-name suffix interpolated into
// SQL as `team${season}` / `club${season}` / `messer${season}` in nine model
// functions across four models. A table name cannot be parameterised, so the value
// has to be validated before it reaches a query.
//
// It was not. Requesting /tables/All/20252026%20AS%20team%20WHERE%20false%20--
// came back `syntax error at or near "WHERE"` — the URL text was being parsed as
// SQL. The payloads below are the ones used to establish that.

jest.mock('../../db_connect', () => ({
  connect: jest.fn(),
  otherConnect: jest.fn(() => Promise.resolve({
    query: jest.fn(() => Promise.resolve([[], []]))
  })),
  isObject: jest.fn(obj => obj === Object(obj)),
}));

const seasonModel = require('../../models/season');

describe('season.isValidName', () => {
  it('accepts real season names', () => {
    ['20252026', '20122013', '20262027'].forEach(s => {
      expect(seasonModel.isValidName(s)).toBe(true);
    });
  });

  it('rejects anything that is not exactly eight digits from 20xx', () => {
    [
      '2025', '202520261', '19992000', 'current', '', 'All',
      '2025-2026', '2025 2026', '0252026a',
    ].forEach(s => {
      expect(seasonModel.isValidName(s)).toBe(false);
    });
  });

  it('rejects SQL payloads that the old parseInt check let through', () => {
    // parseInt stops at the first non-digit, so parseInt('2026 AS team WHERE ...')
    // is 2026 — every one of these passed checkSeason's year arithmetic and was
    // interpolated straight into the query.
    [
      '20252026 AS team WHERE false --',
      '20252026 AS team CROSS JOIN (SELECT current_user) cu --',
      "20252026; DROP TABLE fixture; --",
      '20252026 UNION SELECT 1',
      '20252026\n--',
    ].forEach(payload => {
      expect(seasonModel.isValidName(payload)).toBe(false);
    });
  });
});

describe('season.assertName', () => {
  it('returns the season unchanged when valid', () => {
    expect(seasonModel.assertName('20252026')).toBe('20252026');
  });

  it('treats absent as "use the live tables" rather than an error', () => {
    expect(seasonModel.assertName(undefined)).toBe('');
    expect(seasonModel.assertName(null)).toBe('');
    expect(seasonModel.assertName('')).toBe('');
  });

  it('throws a 404-flagged error for anything else', () => {
    // 404 rather than 500: a junk season in a URL is a bad request, and the central
    // handler skips Sentry for 4xx so this cannot refill the issue list.
    expect.assertions(3);
    try {
      seasonModel.assertName('20252026 AS team WHERE false --');
    } catch (err) {
      expect(err.message).toMatch(/invalid season name/);
      expect(err.status).toBe(404);
      expect(err.message).toContain('AS team');
    }
  });
});

describe('season.isServable', () => {
  it('allows an absent season (meaning the current one)', () => {
    expect(seasonModel.isServable(undefined)).toBe(true);
    expect(seasonModel.isServable('')).toBe(true);
  });

  it('rejects a malformed season regardless of the allowlist', () => {
    expect(seasonModel.isServable('_nope')).toBe(false);
    expect(seasonModel.isServable('20252026 AS t --')).toBe(false);
  });

  it('falls back to shape-only when the allowlist has not loaded', () => {
    // A DB hiccup at boot should mean some 500s, not a 404 on every archive page.
    expect(seasonModel.isServable('20252027')).toBe(true);
  });

  it('rejects a well-formed season with no data once the allowlist is loaded', async () => {
    const db = require('../../db_connect');
    db.otherConnect.mockResolvedValue({
      query: jest.fn(() => Promise.resolve([[{ name: '20252026', label: '2025 - 2026' }], []])),
    });

    const size = await seasonModel.loadServable();
    expect(size).toBeGreaterThan(0);

    expect(seasonModel.isServable('20252026')).toBe(true);
    // 20252027 is the season from Sentry NODE-Q: correct shape, no team20252027
    // table, so it used to 500 with `relation "team20252027" does not exist`.
    expect(seasonModel.isServable('20252027')).toBe(false);
  });
});
