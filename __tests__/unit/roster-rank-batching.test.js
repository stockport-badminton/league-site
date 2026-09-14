// Reordering a roster writes one statement, not one per player.
//
// Sentry NODE-13, 9 occurrences between 9 and 13 Sep 2026: an N+1 on
// `POST /api/teams/:id/order`, `UPDATE player SET rank = $1 WHERE id = $2`. Both renumber
// paths ran that query inside a `for` loop, inside the transaction — so a squad of 8-12
// was 8-12 sequential round trips to Supabase, each paying the pooler's latency, with a
// transaction held open across all of them.
//
// The batching itself is easy. What is worth guarding is that it STAYS batched: this is
// exactly the shape that gets reintroduced by someone adding a per-player concern (an
// audit row, a conditional) inside the loop and reaching for `await conn.query` again.
//
// It is also why the no-op skip is asserted here. Batching must not quietly start writing
// rows that did not change — `updated` is what the endpoint answers with, and the skip is
// what keeps it honest.
//
// The roster integration tests mock db_connect wholesale, so they cannot see how many
// statements were issued. This drives the model directly with a connection that counts.

const Roster = require('../../models/roster');

// A fake transaction connection: answers the initial SELECT from `rows`, records
// everything else.
function fakeConn(rows) {
  const queries = [];
  return {
    queries,
    query: (sql, params) => {
      queries.push({ sql, params });
      if (/^\s*SELECT/i.test(sql)) return Promise.resolve([rows]);
      return Promise.resolve([[]]);
    },
  };
}

const updates = conn => conn.queries.filter(q => /UPDATE/i.test(q.sql));

describe('renumberGender writes ranks in one statement', () => {
  // Four men, currently ranked 1-4. The payload reverses them, so all four change.
  const current = [
    { id: 1, rank: 1 }, { id: 2, rank: 2 }, { id: 3, rank: 3 }, { id: 4, rank: 4 },
  ];

  it('issues exactly one UPDATE for four changed players', async () => {
    const conn = fakeConn(current);

    const updated = await Roster.renumberGender(conn, 10, 'Male', {
      nominated: [4, 3, 2, 1],
      reserve: [],
    });

    expect(updates(conn)).toHaveLength(1);
    expect(updated).toEqual([
      { id: 4, rank: 1 }, { id: 3, rank: 2 }, { id: 2, rank: 3 }, { id: 1, rank: 4 },
    ]);
  });

  it('binds the ids and ranks as arrays, with no SQL built from the batch size', async () => {
    const conn = fakeConn(current);

    await Roster.renumberGender(conn, 10, 'Male', { nominated: [4, 3, 2, 1], reserve: [] });

    const [u] = updates(conn);
    expect(u.sql).toMatch(/unnest/i);
    // Two placeholders whatever the batch size. A generated VALUES list would grow here,
    // which is the thing that makes such a statement worth reading twice.
    expect((u.sql.match(/\?/g) || [])).toHaveLength(2);
    expect(u.params).toEqual([[4, 3, 2, 1], [1, 2, 3, 4]]);
  });

  it('no longer issues the per-player statement at all', async () => {
    const conn = fakeConn(current);

    await Roster.renumberGender(conn, 10, 'Male', { nominated: [4, 3, 2, 1], reserve: [] });

    for (const q of conn.queries) {
      expect(q.sql).not.toMatch(/UPDATE player SET rank = \? WHERE id = \?/);
    }
  });

  // The skip is what keeps `updated` an honest answer, so batching must not lose it.
  it('writes nothing when the order is unchanged', async () => {
    const conn = fakeConn(current);

    const updated = await Roster.renumberGender(conn, 10, 'Male', {
      nominated: [1, 2, 3, 4],
      reserve: [],
    });

    expect(updated).toEqual([]);
    expect(updates(conn)).toHaveLength(0);
  });

  // Both sections of a gender settle together (see renumberGender's own note), so they
  // must also be written together rather than one statement per section.
  it('covers nominated and reserve in the same statement', async () => {
    const conn = fakeConn([
      { id: 1, rank: 1 }, { id: 2, rank: 2 },
      { id: 3, rank: 99 }, { id: 4, rank: 100 },
    ]);

    const updated = await Roster.renumberGender(conn, 10, 'Male', {
      nominated: [2, 1],
      reserve: [4, 3],
    });

    expect(updates(conn)).toHaveLength(1);
    const [ids, ranks] = updates(conn)[0].params;
    expect(ids).toEqual([2, 1, 4, 3]);
    // Reserves start at RESERVE_BASE, and a reserve is `>= 99`, never `=== 99`.
    expect(ranks).toEqual([1, 2, Roster.RESERVE_BASE, Roster.RESERVE_BASE + 1]);
    expect(updated).toHaveLength(4);
  });
});

describe('renumberSection writes ranks in one statement', () => {
  it('issues one UPDATE, and still skips the unchanged', async () => {
    const conn = fakeConn([
      { id: 1, rank: 1 }, { id: 2, rank: 2 }, { id: 3, rank: 3 },
    ]);

    // Only the last two swap; player 1 keeps rank 1 and must not be written.
    const updated = await Roster.renumberSection(conn, 10, 'Male', 'nominated', [1, 3, 2]);

    expect(updates(conn)).toHaveLength(1);
    expect(updated).toEqual([{ id: 3, rank: 2 }, { id: 2, rank: 3 }]);
    expect(updates(conn)[0].params).toEqual([[3, 2], [2, 3]]);
  });
});
