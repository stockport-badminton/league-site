// Fixture.swapMesserHomeAway — the messer admin swapping which team is at home.
//
// The swap is two writes, and the second is the one that matters: approving a result
// writes the winner into a fixed side (`nextSlot`) of the next match, so a swapped match
// whose feeders still point at the old sides would have the next winner written over the
// team already sitting there. These pin that both writes happen, in one transaction, and
// that the swap is refused where it would leave a result or a pending approval wrong.

jest.mock('../../db_connect', () => ({
  isObject: obj => obj === Object(obj),
  withTransaction: jest.fn(),
  otherConnect: jest.fn(),
}));
jest.mock('../../models/season', () => ({ current: () => '20262027' }));
jest.mock('axios');

const db = require('../../db_connect');
const Fixture = require('../../models/fixture');

// Slot 11 of the A section as it stood in production on 19 Oct 2026: Syddal Park B
// already advanced into the home side from slot 3, the away side still to come from 4.
const SLOT_11 = { id: 511, section: 'A', drawPos: 11, homeTeam: 20, awayTeam: 52, homeScore: null, awayScore: null };

function fakeConn({ match = SLOT_11, pending = [], feeders = 2 } = {}) {
  const calls = [];
  return {
    calls,
    query: jest.fn(async (sql, params) => {
      const flat = sql.replace(/\s+/g, ' ').trim();
      calls.push({ sql: flat, params });
      if (/^SELECT .* FROM messer WHERE/.test(flat)) return [match ? [match] : []];
      if (/FROM messer_scorecard/.test(flat)) return [pending];
      if (/^UPDATE messer SET "homeTeam"/.test(flat)) { const r = []; r.affectedRows = 1; return [r]; }
      if (/^UPDATE messer SET "nextSlot"/.test(flat)) { const r = []; r.affectedRows = feeders; return [r]; }
      throw new Error('unexpected SQL: ' + flat);
    }),
  };
}

function runWith(conn) {
  db.withTransaction.mockImplementation(fn => fn(conn));
}

beforeEach(() => jest.clearAllMocks());

describe('a swap', () => {
  it('swaps the two teams and flips the sides of the matches feeding it, in one transaction', async () => {
    const conn = fakeConn();
    runWith(conn);

    const out = await Fixture.swapMesserHomeAway('A', 511);

    expect(db.withTransaction).toHaveBeenCalledTimes(1);
    const swap = conn.calls.find(c => /^UPDATE messer SET "homeTeam"/.test(c.sql));
    expect(swap.sql).toContain('"homeTeam" = "awayTeam", "awayTeam" = "homeTeam"');
    expect(swap.params).toEqual([511]);

    const flip = conn.calls.find(c => /^UPDATE messer SET "nextSlot"/.test(c.sql));
    expect(flip.sql).toContain(`CASE "nextSlot" WHEN 'H' THEN 'A' ELSE 'H' END`);
    // Feeders are found by section and by the drawPos they point at, not by id.
    expect(flip.params).toEqual(['A', 11]);

    expect(out).toEqual({ id: 511, drawPos: 11, feedersFlipped: 2 });
  });

  it('locks the row and scopes the lookup to the section in the URL', async () => {
    const conn = fakeConn();
    runWith(conn);
    await Fixture.swapMesserHomeAway('A', 511);
    const select = conn.calls[0];
    expect(select.sql).toMatch(/WHERE id = \? AND section = \? FOR UPDATE/);
    expect(select.params).toEqual([511, 'A']);
  });

  it('looks for a pending scorecard in the CURRENT orientation only', async () => {
    const conn = fakeConn();
    runWith(conn);
    await Fixture.swapMesserHomeAway('A', 511);
    const check = conn.calls.find(c => /FROM messer_scorecard/.test(c.sql));
    expect(check.params).toEqual([20, 52]);
    expect(check.sql).toContain(`status IN ('draft', 'submitted')`);
  });
});

describe('refusals — nothing is written', () => {
  const writes = conn => conn.calls.filter(c => /^UPDATE/.test(c.sql));

  it('refuses a match with no team on either side yet', async () => {
    const conn = fakeConn({ match: { ...SLOT_11, homeTeam: 52, awayTeam: 52 } });
    runWith(conn);
    await expect(Fixture.swapMesserHomeAway('A', 511)).rejects.toMatchObject({ status: 409, code: 'empty' });
    expect(writes(conn)).toHaveLength(0);
  });

  it('refuses a slot that is not in this section', async () => {
    const conn = fakeConn({ match: null });
    runWith(conn);
    await expect(Fixture.swapMesserHomeAway('B', 511)).rejects.toMatchObject({ status: 404, code: 'missing' });
    expect(writes(conn)).toHaveLength(0);
  });

  it.each([
    ['both scores', { homeScore: 8, awayScore: 7 }],
    ['a 0-15 result', { homeScore: 0, awayScore: 15 }],
    ['only one score', { homeScore: null, awayScore: 0 }],
  ])('refuses a match with a result (%s)', async (_label, scores) => {
    const conn = fakeConn({ match: { ...SLOT_11, ...scores } });
    runWith(conn);
    await expect(Fixture.swapMesserHomeAway('A', 511)).rejects.toMatchObject({ status: 409, code: 'played' });
    expect(writes(conn)).toHaveLength(0);
  });

  it('refuses while a scorecard filed this way round awaits approval', async () => {
    const conn = fakeConn({ pending: [{ id: 77 }] });
    runWith(conn);
    await expect(Fixture.swapMesserHomeAway('A', 511)).rejects.toMatchObject({ status: 409, code: 'pending' });
    expect(writes(conn)).toHaveLength(0);
  });
});
