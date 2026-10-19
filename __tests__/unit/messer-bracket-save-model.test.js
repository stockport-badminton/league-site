// Fixture.saveMesserBracketLinks — Save wiring on /admin/messer-bracket.
//
// It used to write every row of the form blindly. A wiring page opened before a swap on
// the draw (which flips its feeders' nextSlot) put the old sides back when it was saved —
// B-30, 19 Oct 2026, where the next winner would have been written over Cheadle Hulme A.
// These pin that only changed rows are written, each only if it still holds what the
// page showed, and that one moved-on row rolls the whole save back.

jest.mock('../../db_connect', () => ({
  isObject: obj => obj === Object(obj),
  withTransaction: jest.fn(),
  otherConnect: jest.fn(),
}));
jest.mock('../../models/season', () => ({ current: () => '20262027' }));
jest.mock('axios');

const db = require('../../db_connect');
const Fixture = require('../../models/fixture');

const link = (id, now, was = now) => ({ id, ...now, was });
const W = (round, nextDrawPos, nextSlot) => ({ round, nextDrawPos, nextSlot });

// `stale` is the ids whose row no longer holds the page's values.
function fakeConn({ stale = [], drawPos = id => id + 6 } = {}) {
  const calls = [];
  return {
    calls,
    query: jest.fn(async (sql, params) => {
      const flat = sql.replace(/\s+/g, ' ').trim();
      calls.push({ sql: flat, params });
      if (/^UPDATE messer/.test(flat)) {
        const ok = !stale.includes(params[3]);
        const rows = ok ? [{ drawPos: drawPos(params[3]) }] : [];
        rows.affectedRows = ok ? 1 : 0;
        return [rows];
      }
      if (/^SELECT "drawPos"/.test(flat)) return [[{ drawPos: drawPos(params[0]) }]];
      throw new Error('unexpected SQL: ' + flat);
    }),
  };
}

const updates = conn => conn.calls.filter(c => /^UPDATE/.test(c.sql));

beforeEach(() => jest.clearAllMocks());

it('writes nothing, and opens no transaction, when nothing was changed', async () => {
  const out = await Fixture.saveMesserBracketLinks([
    link(19, W(2, 30, 'H')),
    link(20, W(2, 30, 'A')),
    link(31, W(4, null, null), W(4, null, null)),
  ]);
  expect(out).toEqual({ saved: 0, conflicts: [] });
  expect(db.withTransaction).not.toHaveBeenCalled();
});

it('writes only the changed row, guarded by what the page showed', async () => {
  const conn = fakeConn();
  db.withTransaction.mockImplementation(fn => fn(conn));

  const out = await Fixture.saveMesserBracketLinks([
    link(19, W(2, 30, 'H')),                      // untouched
    link(20, W(2, 30, 'H'), W(2, 30, 'A')),       // side changed A -> H
  ]);

  expect(out).toEqual({ saved: 1, conflicts: [] });
  expect(updates(conn)).toHaveLength(1);
  const [u] = updates(conn);
  expect(u.sql).toMatch(/WHERE id = \? AND "round" IS NOT DISTINCT FROM \? AND "nextDrawPos" IS NOT DISTINCT FROM \? AND "nextSlot" IS NOT DISTINCT FROM \?/);
  expect(u.params).toEqual([2, 30, 'H', 20, 2, 30, 'A']);
});

it('treats a blank as NULL on both sides, so a final left blank is not a change', async () => {
  const out = await Fixture.saveMesserBracketLinks([link(31, W(4, null, null), W(4, undefined, undefined))]);
  expect(out.saved).toBe(0);
});

// The B-30 case: the page still shows B-26 feeding away, a swap has since made it home,
// and the admin changes some other row and saves.
it('refuses the whole save when any changed row has moved on, naming its slot', async () => {
  const conn = fakeConn({ stale: [20] });
  db.withTransaction.mockImplementation(async fn => {
    try { return await fn(conn); } catch (e) { conn.rolledBack = true; throw e; }
  });

  const out = await Fixture.saveMesserBracketLinks([
    link(19, W(2, 30, 'A'), W(2, 30, 'H')),
    link(20, W(3, 30, 'A'), W(2, 30, 'A')),
  ]);

  expect(out).toEqual({ saved: 0, conflicts: [26] });
  expect(conn.rolledBack).toBe(true);
});

it('does not overwrite a row that moved on when the admin did not touch it', async () => {
  // Same stale page as above, but only row 19 was edited: row 20 is unchanged on the
  // page, so it is not written at all and the swap's flip on it survives.
  const conn = fakeConn({ stale: [20] });
  db.withTransaction.mockImplementation(fn => fn(conn));
  const out = await Fixture.saveMesserBracketLinks([
    link(19, W(3, 30, 'H'), W(2, 30, 'H')),
    link(20, W(2, 30, 'A')),
  ]);
  expect(out).toEqual({ saved: 1, conflicts: [] });
  expect(updates(conn).map(u => u.params[3])).toEqual([19]);
});

it('lets a real database error through', async () => {
  db.withTransaction.mockRejectedValue(new Error('connection reset'));
  await expect(Fixture.saveMesserBracketLinks([link(19, W(3, 30, 'H'), W(2, 30, 'H'))]))
    .rejects.toThrow('connection reset');
});
