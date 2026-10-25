// models/fixture.js against a real Postgres (REARCH-08, Part 2).
//
// Each of these is a bug that lived behind a green mocked test. A mock answers whatever
// its author believed the database would answer; these ask the database.
const db = require('../../db_connect');
const Fixture = require('../../models/fixture');

// A plain array: the wrapper hangs affectedRows/changedRows on the rows it returns, and
// toEqual counts those as a difference.
const read = async (sql, params) => [...(await (await db.otherConnect()).query(sql, params))[0]];

// The NOT NULL columns of a draft, all zero: every player slot and every game score.
async function draftRow(extra) {
  const cols = await read(
    `SELECT column_name FROM information_schema.columns
      WHERE table_name = 'scorecardstore' AND is_nullable = 'NO' AND column_default IS NULL`);
  const row = Object.fromEntries(cols.map(c => [c.column_name, 0]));
  return Object.assign(row, extra);
}

describe('gotcha 2b — an INSERT has no insertId; its id comes from RETURNING', () => {
  it('createScorecard hands back the new draft id, and that id is the row it wrote', async () => {
    const result = await Fixture.createScorecard(await draftRow({
      division: 1, homeTeam: 2, awayTeam: 1, date: '2027-02-10', email: 'db-test@example.invalid',
    }));

    // The caller builds the confirmation link from result[0].id. Without RETURNING id the
    // result is an empty array and the link was /populated-scorecard-beta/undefined.
    expect(result).toHaveLength(1);
    expect(Number.isInteger(result[0].id)).toBe(true);
    const [row] = await read('SELECT email FROM scorecardstore WHERE id = ?', [result[0].id]);
    expect(row.email).toBe('db-test@example.invalid');
  });

  it('rearrangeByTeamNames returns the replacement fixture it inserted', async () => {
    const out = await Fixture.rearrangeByTeamNames({
      homeTeam: 'Southgate A', awayTeam: 'Northfield A', date: '2027-03-03',
    });

    expect(out).toMatchObject({ ok: true, action: 'rearranged', fixtureId: 302 });
    expect(Number.isInteger(out.replacementId)).toBe(true);
    const rows = await read(
      `SELECT id, status, "homeTeam", "awayTeam", to_char(date, 'YYYY-MM-DD') AS day
         FROM fixture WHERE id IN (?, ?) ORDER BY id`, [302, out.replacementId]);
    expect(rows).toEqual([
      { id: 302, status: 'rearranged', homeTeam: 2, awayTeam: 1, day: '2027-02-10' },
      { id: out.replacementId, status: 'outstanding', homeTeam: 2, awayTeam: 1, day: '2027-03-03' },
    ]);
  });

  it('rearrangeByTeamNames writes nothing when a team name matches nothing', async () => {
    const before = await read('SELECT count(*)::int AS n FROM fixture');
    await expect(Fixture.rearrangeByTeamNames({
      homeTeam: 'Southgate A', awayTeam: 'Nobody FC', date: '2027-03-03',
    })).rejects.toThrow();
    // The old INSERT resolved names inline and wrote a fixture with a NULL team.
    expect(await read('SELECT count(*)::int AS n FROM fixture')).toEqual(before);
    const [f] = await read('SELECT status FROM fixture WHERE id = 302');
    expect(f.status).toBe('outstanding');
  });
});

describe('gotcha 2d — the affected-row count hangs off the rows array', () => {
  it('supersedeEarlierDrafts reports how many drafts it marked', async () => {
    // Seed draft 1 is for this match; file a second and supersede the first with it.
    const [{ id: newId }] = await Fixture.createScorecard(await draftRow({
      division: 1, homeTeam: 2, awayTeam: 1, date: '2027-02-10',
    }));
    const marked = await Fixture.supersedeEarlierDrafts(newId, { homeTeam: 2, awayTeam: 1, date: '2027-02-10' });

    expect(marked).toBe(1);
    expect(await Fixture.getDraftSupersession(1)).toEqual({ id: 1, supersededBy: newId });
  });

  it('updateScorecardPhoto reports 1 for a write and 0 when the guard refuses one', async () => {
    const first = await Fixture.updateScorecardPhoto(2, 'scorecards/db-test-1.jpg');
    const second = await Fixture.updateScorecardPhoto(2, 'scorecards/db-test-2.jpg');

    // The caller answers 409 on 0 rather than emailing about a write that did not happen.
    expect(first.affectedRows).toBe(1);
    expect(second.affectedRows).toBe(0);
    const [row] = await read('SELECT "scoresheet-url" AS url FROM scorecardstore WHERE id = 2');
    expect(row.url).toBe('scorecards/db-test-1.jpg');
  });
});

describe('the harness itself', () => {
  // If rollback ever stopped working, the tests above would leak into each other and the
  // suite would depend on its order. Two halves: one writes, the next must not see it.
  it('a write made in one test…', async () => {
    await read("UPDATE team SET name = 'Leaked' WHERE id = 1");
    expect((await read('SELECT name FROM team WHERE id = 1'))[0].name).toBe('Leaked');
  });

  it('…is gone in the next', async () => {
    expect((await read('SELECT name FROM team WHERE id = 1'))[0].name).toBe('Northfield A');
  });

  it('a failed statement does not poison the next, as with a real pool', async () => {
    await expect(read('SELECT no_such_column FROM team')).rejects.toThrow(/does not exist/);
    expect(await read('SELECT count(*)::int AS n FROM team')).toEqual([{ n: 8 }]);
  });
});
