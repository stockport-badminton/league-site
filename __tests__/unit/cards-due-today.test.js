// Fixture.getCardsDueToday feeds the daily missing-scorecard email. It used to exclude
// only 'rearranged'/'rearranging', so a withdrawn team's voided fixtures (Dome A, Oct 2026)
// were reported missing one by one. Only an 'outstanding' fixture is owed a scorecard.

jest.mock('../../db_connect', () => ({
  isObject: obj => obj === Object(obj),
  otherConnect: jest.fn(),
}));
jest.mock('../../models/season', () => ({ current: () => '20262027' }));
jest.mock('axios');

const db = require('../../db_connect');
const Fixture = require('../../models/fixture');

it('asks only for outstanding fixtures', async () => {
  const query = jest.fn().mockResolvedValue([[]]);
  db.otherConnect.mockResolvedValue({ query });

  await Fixture.getCardsDueToday();

  const sql = query.mock.calls[0][0].replace(/\s+/g, ' ');
  expect(sql).toMatch(/fixture\.status = 'outstanding'/);
  expect(sql).not.toMatch(/NOT IN/);
});
