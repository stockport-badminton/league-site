// The grouping the daily reminder depends on, and the season key that makes the annual
// reset free.

// getStatus's SQL (officers, the season key, which fixtures set the deadline) is tested
// against a real Postgres in __tests__/db/club-registration.test.js (REARCH-01). What is
// left here is getDigest's grouping, which is plain JavaScript over getStatus's rows.
jest.mock('../../models/season', () => ({
  current: () => '20262027',
  assertName: n => n,
}));

const Registration = require('../../models/clubRegistration');

function answer(clubs) {
  jest.spyOn(Registration, 'getStatus').mockResolvedValue(clubs.map(c => ({
    ...c, season: '20262027', received: !!c.receivedAt, chased: !!c.chasedAt, officers: [],
  })));
}
afterEach(() => jest.restoreAllMocks());

const row = (over = {}) => ({
  id: 1, name: 'Aerospace', firstFixture: '2026-09-10', teams: 1, daysAway: 2,
  receivedAt: null, chasedAt: null, chaseCount: 0, note: null, updatedBy: null, ...over,
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
