// The PI key, and every caller-supplied value, must reach Postgres as a PARAMETER —
// never as text inside the statement.
//
// `getEmails` pasted DB_PI_KEY in as a string literal five times, once per UNION branch,
// and `console.log(sql)` sat on the line above it: so the key that encrypts every player's
// email and phone number went into Cloud Logging on every distribution-list send. The log
// line went on 7 Sep 2026; this is the rest of it (HARD-27).
//
// Two more sites in the same file had the same defect and are not in the brief — `getById`
// (twice) and `updateBulk` (a template literal, which is why a grep for `+ process.env`
// misses it). The acceptance criterion is file-scoped for that reason.
//
// The WHERE terms were interpolated too. Not exploitable today — the only caller assigns
// them from hardcoded arrays after matching the envelope recipient — but nothing in the
// signature said the arguments had to be trusted, and the next caller would not know.

const mockQuery = jest.fn().mockResolvedValue([[]]);
jest.mock('../../db_connect', () => ({
  connect: jest.fn(),
  isObject: o => o !== null && typeof o === 'object',
  otherConnect: jest.fn(() => Promise.resolve({ query: mockQuery })),
}));

const Player = require('../../models/players');
const KEY = process.env.DB_PI_KEY;

const lastCall = () => {
  const [sql, params] = mockQuery.mock.calls[mockQuery.mock.calls.length - 1];
  return { sql, params: params === undefined ? [] : (Array.isArray(params) ? params : [params]) };
};
const placeholders = sql => (sql.match(/\?/g) || []).length;

beforeEach(() => mockQuery.mockClear());

describe('the PI key is bound, not pasted into the statement', () => {
  it('getEmails binds it once per UNION branch and never writes it into the SQL', async () => {
    await Player.getEmails({});
    const { sql, params } = lastCall();
    expect(sql).not.toContain(KEY);
    expect(params).toEqual([KEY, KEY, KEY, KEY, KEY]);
  });

  it('getById binds it for playerEmail and playerTel', async () => {
    await Player.getById(4);
    const { sql, params } = lastCall();
    expect(sql).not.toContain(KEY);
    expect(params).toEqual([KEY, KEY, 4]);
  });

  it('updateBulk binds it in the pgp_sym_encrypt clause', async () => {
    await Player.updateBulk({
      tablename: 'player',
      fields: ['id', 'playerEmail'],
      data: [[7, 'someone@example.com']],
    });
    const { sql, params } = lastCall();
    expect(sql).not.toContain(KEY);
    expect(sql).toContain('pgp_sym_encrypt(?, ?)');
    // value, then key, then the id in the WHERE — the order the placeholders appear.
    expect(params).toEqual(['someone@example.com', KEY, 7]);
  });
});

describe('getEmails binds its search terms', () => {
  it('parameterises every WHERE term rather than quoting it in', async () => {
    await Player.getEmails({ role: 'club Sec', division: 8, club: 42, teamName: 'Mellor B' });
    const { sql, params } = lastCall();
    expect(sql).toContain('b.role = ? AND b.division = ? AND b.id = ? AND b.teamname = ?');
    expect(params).toEqual([KEY, KEY, KEY, KEY, KEY, 'club Sec', 8, 42, 'Mellor B']);
  });

  it('keeps placeholders and parameters in step for every combination', async () => {
    const terms = [
      {}, { role: 'treasurer' }, { division: 10 }, { club: 39 }, { teamName: 'Tatton A' },
      { role: 'team Captain', division: 7 },
      { role: 'club Sec', division: 8, club: 42, teamName: 'Mellor B' },
    ];
    for (const t of terms) {
      mockQuery.mockClear();
      await Player.getEmails(t);
      const { sql, params } = lastCall();
      // The failure this catches is a bind added without its placeholder, or the reverse:
      // Postgres then either errors or, worse, silently shifts every later parameter.
      expect(placeholders(sql)).toBe(params.length);
      expect(params.length).toBe(5 + Object.keys(t).length);
    }
  });

  it('cannot have its statement altered by a search term', async () => {
    const hostile = "x' OR '1'='1";
    await Player.getEmails({ role: hostile, teamName: "'; DROP TABLE player; --" });
    const { sql, params } = lastCall();
    expect(sql).not.toContain(hostile);
    expect(sql).not.toContain('DROP TABLE');
    expect(params).toContain(hostile);
    expect(placeholders(sql)).toBe(params.length);
  });
});
