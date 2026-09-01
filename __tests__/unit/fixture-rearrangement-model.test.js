// Fixture.rearrangeByTeamNames — the writes behind the rearrangement modal.
//
// The old version resolved team ids inline inside the INSERT, so an unmatched name
// inserted a fixture with a NULL team instead of failing, and it ran the UPDATE and
// the INSERT as two unrelated statements, so a pairing that archived nothing still
// created a replacement. These pin both, plus the transaction.

jest.mock('../../db_connect', () => ({
  isObject: obj => obj === Object(obj),
  withTransaction: jest.fn(),
  otherConnect: jest.fn(),
}));
jest.mock('../../models/season', () => ({ current: () => '20262027' }));
jest.mock('axios');

const db = require('../../db_connect');
const Fixture = require('../../models/fixture');

const TEAMS = [
  { id: 11, name: 'Mellor A' },
  { id: 22, name: 'Aerospace A' },
];

// A stand-in for the transaction connection: records every statement, and answers
// from `plan` so a test can say "no team matched" or "no fixture matched".
function fakeConn({ teams = TEAMS, fixtureId = 7200, insertedId = 7401 } = {}) {
  const calls = [];
  return {
    calls,
    query: jest.fn(async (sql, params) => {
      calls.push({ sql: sql.replace(/\s+/g, ' ').trim(), params });
      if (/FROM team WHERE name/.test(sql)) {
        return [teams.filter(t => params.includes(t.name))];
      }
      if (/FROM fixture f/.test(sql)) {
        const rows = fixtureId == null ? [] : [{ id: fixtureId }];
        return [rows];
      }
      if (/^\s*UPDATE fixture/.test(sql)) {
        const rows = []; rows.affectedRows = 1; return [rows];
      }
      if (/INSERT INTO fixture/.test(sql)) {
        return [[{ id: insertedId }]];
      }
      throw new Error('unexpected SQL: ' + sql);
    }),
  };
}

function runWith(conn) {
  db.withTransaction.mockImplementation(fn => fn(conn));
}

beforeEach(() => jest.clearAllMocks());

describe('validation — rejected before any statement runs', () => {
  const cases = [
    ['a missing body', 'not-an-object'],
    ['a missing homeTeam', { awayTeam: 'Aerospace A', date: '2026-11-05' }],
    ['a blank awayTeam', { homeTeam: 'Mellor A', awayTeam: '   ', date: '2026-11-05' }],
    ['a team against itself', { homeTeam: 'Mellor A', awayTeam: 'Mellor A' }],
    ['a malformed date', { homeTeam: 'Mellor A', awayTeam: 'Aerospace A', date: '05/11/2026' }],
    ['a date with time attached', { homeTeam: 'Mellor A', awayTeam: 'Aerospace A', date: '2026-11-05T00:00' }],
  ];

  it.each(cases)('rejects %s', async (_label, body) => {
    await expect(Fixture.rearrangeByTeamNames(body)).rejects.toMatchObject({ status: 400 });
    expect(db.withTransaction).not.toHaveBeenCalled();
  });
});

describe('team resolution', () => {
  it('refuses a name that matches no team, rather than inserting a NULL team', async () => {
    const conn = fakeConn({ teams: [TEAMS[0]] });
    runWith(conn);

    await expect(Fixture.rearrangeByTeamNames({
      homeTeam: 'Mellor A', awayTeam: 'Aerospacce A', date: '2026-11-05',
    })).rejects.toMatchObject({ status: 400 });

    // Neither write may run: the point of resolving the ids first is that a bad
    // name fails before anything is archived.
    expect(conn.calls.some(c => /INSERT/.test(c.sql))).toBe(false);
    expect(conn.calls.some(c => /UPDATE/.test(c.sql))).toBe(false);
  });

  it('names the team it could not find', async () => {
    runWith(fakeConn({ teams: [TEAMS[0]] }));
    await expect(Fixture.rearrangeByTeamNames({
      homeTeam: 'Mellor A', awayTeam: 'Aerospacce A', date: '2026-11-05',
    })).rejects.toThrow(/Aerospacce A/);
  });
});

describe('fixture resolution', () => {
  it('archives nothing and inserts nothing when the pairing matches no fixture', async () => {
    const conn = fakeConn({ fixtureId: null });
    runWith(conn);

    await expect(Fixture.rearrangeByTeamNames({
      homeTeam: 'Mellor A', awayTeam: 'Aerospace A', date: '2026-11-05',
    })).rejects.toMatchObject({ status: 404 });

    expect(conn.calls.some(c => /UPDATE|INSERT/.test(c.sql))).toBe(false);
  });

  it('scopes the search to the current season', async () => {
    const conn = fakeConn();
    runWith(conn);
    await Fixture.rearrangeByTeamNames({ homeTeam: 'Mellor A', awayTeam: 'Aerospace A' });

    const lookup = conn.calls.find(c => /FROM fixture f/.test(c.sql));
    expect(lookup.params).toContain('20262027');
    // Bound, not interpolated — the season name reaches SQL as a parameter.
    expect(lookup.sql).not.toContain('20262027');
  });
});

describe('the two outcomes', () => {
  it("flags the fixture 'rearranging' and creates no replacement when no date is agreed", async () => {
    const conn = fakeConn();
    runWith(conn);

    const out = await Fixture.rearrangeByTeamNames({
      homeTeam: 'Mellor A', awayTeam: 'Aerospace A', date: '',
    });

    expect(out).toMatchObject({ ok: true, action: 'rearranging', fixtureId: 7200, replacementId: null });
    expect(conn.calls.some(c => /INSERT/.test(c.sql))).toBe(false);
    expect(conn.calls.find(c => /UPDATE/.test(c.sql)).sql).toMatch(/'rearranging'/);
  });

  it('treats a missing date the same as a blank one', async () => {
    const conn = fakeConn();
    runWith(conn);
    const out = await Fixture.rearrangeByTeamNames({ homeTeam: 'Mellor A', awayTeam: 'Aerospace A' });
    expect(out.action).toBe('rearranging');
  });

  it("archives the old fixture and inserts the replacement against resolved team ids", async () => {
    const conn = fakeConn();
    runWith(conn);

    const out = await Fixture.rearrangeByTeamNames({
      homeTeam: 'Mellor A', awayTeam: 'Aerospace A', date: '2026-11-05',
    });

    expect(out).toMatchObject({
      ok: true, action: 'rearranged', fixtureId: 7200, replacementId: 7401, date: '2026-11-05',
    });

    expect(conn.calls.find(c => /UPDATE/.test(c.sql))).toMatchObject({ params: [7200] });

    const insert = conn.calls.find(c => /INSERT/.test(c.sql));
    expect(insert.params).toEqual([11, 22, '2026-11-05 00:00:00']);
    // Ids, never a `(SELECT id FROM team WHERE name = ?)` that can yield NULL.
    expect(insert.sql).not.toMatch(/SELECT id FROM team/);
    // Postgres reports no insertId; without RETURNING the new id is undefined.
    expect(insert.sql).toMatch(/RETURNING id/);
  });

  it('stores the date as a wall-clock string, not a JS Date', async () => {
    const conn = fakeConn();
    runWith(conn);
    await Fixture.rearrangeByTeamNames({
      homeTeam: 'Mellor A', awayTeam: 'Aerospace A', date: '2026-11-05',
    });
    const dateParam = conn.calls.find(c => /INSERT/.test(c.sql)).params[2];
    expect(typeof dateParam).toBe('string');
    expect(dateParam).toBe('2026-11-05 00:00:00');
  });

  it('does both writes inside one transaction', async () => {
    const conn = fakeConn();
    runWith(conn);
    await Fixture.rearrangeByTeamNames({
      homeTeam: 'Mellor A', awayTeam: 'Aerospace A', date: '2026-11-05',
    });
    expect(db.withTransaction).toHaveBeenCalledTimes(1);
  });

  it('trims surrounding whitespace off the team names the modal scrapes from the table', async () => {
    const conn = fakeConn();
    runWith(conn);
    await Fixture.rearrangeByTeamNames({
      homeTeam: '  Mellor A ', awayTeam: '\nAerospace A\t', date: '2026-11-05',
    });
    const lookup = conn.calls.find(c => /FROM team WHERE name/.test(c.sql));
    expect(lookup.params).toEqual(['Mellor A', 'Aerospace A']);
  });
});
