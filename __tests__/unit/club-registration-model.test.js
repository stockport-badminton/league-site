// The grouping the daily reminder depends on, and the season key that makes the annual
// reset free.

const mockQuery = jest.fn();
jest.mock('../../db_connect', () => ({
  connect: jest.fn(),
  otherConnect: jest.fn(() => Promise.resolve({ query: mockQuery })),
}));
jest.mock('../../models/season', () => ({
  current: () => '20262027',
  assertName: n => n,
}));

const Registration = require('../../models/clubRegistration');

// getStatus runs two queries: the club/status join, then the officers.
function answer(clubs, officers = []) {
  mockQuery.mockReset();
  mockQuery
    .mockResolvedValueOnce([clubs])
    .mockResolvedValueOnce([officers]);
}

const row = (over = {}) => ({
  id: 1, name: 'Aerospace', firstFixture: '2026-09-10', teams: 1, daysAway: 2,
  receivedAt: null, chasedAt: null, chaseCount: 0, note: null, updatedBy: null, ...over,
});

describe('getStatus', () => {
  it('attaches each club its own officers', async () => {
    answer([row({ id: 1 }), row({ id: 2, name: 'Mellor' })], [
      { clubId: 1, name: 'Anne', email: 'anne@example.com', role: 'club secretary' },
      { clubId: 2, name: 'Bob',  email: 'bob@example.com',  role: 'match secretary' },
    ]);
    const [a, b] = await Registration.getStatus('20262027');
    expect(a.officers).toEqual([{ name: 'Anne', email: 'anne@example.com', role: 'club secretary' }]);
    expect(b.officers).toEqual([{ name: 'Bob', email: 'bob@example.com', role: 'match secretary' }]);
  });

  it('leaves a club with no officers contactable-by-nobody rather than undefined', async () => {
    answer([row()], []);
    const [only] = await Registration.getStatus('20262027');
    expect(only.officers).toEqual([]);
  });

  // The season is bound as a parameter into both the status join and the LEFT JOIN onto
  // club_registration. If it were not, every season would read the same rows.
  it('scopes to the season it is asked for', async () => {
    answer([row()], []);
    await Registration.getStatus('20252026');
    expect(mockQuery.mock.calls[0][1]).toEqual(expect.arrayContaining(['20252026']));
  });

  // The PI key is bound, never interpolated — one query in this codebase had it as a
  // string literal until Aug 2026.
  it('binds the decryption key as a parameter', async () => {
    process.env.DB_PI_KEY = 'the-key';
    answer([row()], []);
    await Registration.getStatus('20262027');
    const [sql, params] = mockQuery.mock.calls[1];
    expect(sql).not.toMatch(/the-key/);
    expect(params).toContain('the-key');
  });
});

describe('getDigest', () => {
  it('splits due-soon from chased-and-waiting, and drops anything received', async () => {
    answer([
      row({ id: 1, name: 'DueSoon',   daysAway: 2 }),
      row({ id: 2, name: 'Chased',    daysAway: 20, chasedAt: '2026-09-01' }),
      row({ id: 3, name: 'Quiet',     daysAway: 20 }),
      row({ id: 4, name: 'Done',      daysAway: 1, receivedAt: '2026-09-01' }),
    ]);
    const d = await Registration.getDigest('20262027', 3);

    expect(d.dueSoon.map(c => c.name)).toEqual(['DueSoon']);
    expect(d.chased.map(c => c.name)).toEqual(['Chased']);
    // Not due yet and never chased: nothing to report, and reporting it daily is how the
    // email becomes noise.
    expect(d.received).toBe(1);
    expect(d.total).toBe(4);
  });

  // A deadline that has passed is MORE urgent, not less. Dropping it the morning it
  // expires is how a club plays a match unregistered.
  it('keeps a club whose first fixture has already gone', async () => {
    answer([row({ name: 'Overdue', daysAway: -4 })]);
    const d = await Registration.getDigest('20262027', 3);
    expect(d.dueSoon.map(c => c.name)).toEqual(['Overdue']);
  });

  // A club chased AND due soon belongs in the urgent list, once, not in both.
  it('does not report a chased club twice', async () => {
    answer([row({ name: 'Both', daysAway: 1, chasedAt: '2026-09-01' })]);
    const d = await Registration.getDigest('20262027', 3);
    expect(d.dueSoon.map(c => c.name)).toEqual(['Both']);
    expect(d.chased).toEqual([]);
  });
});

// The whole reason status is keyed by season. There is no annual wipe to remember,
// because a new season simply has no rows — and if that ever stopped being true it would
// show up once, in August, as eighteen clubs mysteriously already done.
describe('the season rollover', () => {
  it('reads a new season as nothing received and nothing chased', async () => {
    // The LEFT JOIN finds no club_registration row, so every status column is null.
    answer([
      row({ id: 1, name: 'Aerospace', receivedAt: null, chasedAt: null, chaseCount: 0 }),
      row({ id: 2, name: 'Mellor',    receivedAt: null, chasedAt: null, chaseCount: 0 }),
    ]);
    const d = await Registration.getDigest('20272028', 3);
    expect(d.received).toBe(0);
    expect(d.dueSoon.every(c => !c.received && !c.chased)).toBe(true);
  });
});

// A match that has been moved, or is being moved, does not set the deadline — the club is
// not playing that night, so registrations are not due by it.
//
// This is asserted against the SQL text, which is not something to do lightly. It is done
// here because there is no local database to run the query against (DATABASE_URL is
// production), and both failures are invisible: dropping the exclusion moves a deadline
// EARLIER and chases a club that has weeks left, while a bare NOT IN drops any fixture
// with a NULL status, which moves a deadline LATER or removes it altogether. The second is
// the one that matters — a club silently losing its earliest fixture is the exact outcome
// this page exists to prevent.
describe('which fixtures set the deadline', () => {
  // The SQL is built once at module load, so reading it back is enough.
  async function statusPredicate() {
    answer([row()], []);
    await Registration.getStatus('20262027');
    const sql = mockQuery.mock.calls[0][0];
    const line = sql.split('\n').find(l => /f\.status/.test(l) && !/^\s*--/.test(l));
    return { sql, line: (line || '').trim() };
  }

  it('excludes both rearranged and rearranging', async () => {
    const { sql } = await statusPredicate();
    expect(sql).toMatch(/rearranged/);
    expect(sql).toMatch(/rearranging/);
  });

  // `status NOT IN (...)` is NULL for a NULL status, which is not true, so the row goes.
  // Any form that keeps it is fine; a bare NOT IN is not.
  it('keeps a fixture whose status is NULL', async () => {
    const { line } = await statusPredicate();
    expect(line).toMatch(/f\.status\s+IS\s+NULL|COALESCE\s*\(\s*f\.status/i);
  });
});
