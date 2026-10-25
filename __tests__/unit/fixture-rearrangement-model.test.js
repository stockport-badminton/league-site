// Fixture.rearrangeByTeamNames — the writes behind the rearrangement modal.
//
// What is left here is the validation, which refuses a request before any statement runs.
// The writes moved to a real Postgres when the function went onto the typed query layer
// (REARCH-01): team resolution, the current-season scope, both outcomes, the wall-clock
// date and the transaction are in __tests__/db/fixture-scorecards.test.js and
// __tests__/db/fixture.test.js. The old version resolved team ids inline inside the
// INSERT, so an unmatched name inserted a fixture with a NULL team instead of failing, and
// ran the UPDATE and the INSERT as two unrelated statements; both are pinned there.

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
      if (/FROM team WHERE/.test(sql)) {
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
