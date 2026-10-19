const request = require('supertest');

// Approving a Messer result has to find the match in the draw, and the scorecard can be
// filed the other way round from it. The exact-orientation lookup this replaced found
// nothing in that case, so the result was saved with no messer_id, the draw was never
// updated, the winner never advanced, and the approver was told "Result approved and
// messer table updated" — Manor A v College Green C, B-25, 19 Oct 2026.

jest.mock('../../middleware/secured', () => (req, res, next) => {
  req.user = {
    id: 'auth0|test', displayName: 'Test User',
    _json: { 'https://my-app.example.com/role': 'captain', 'https://my-app.example.com/messeradmin': true },
  };
  next();
});
jest.mock('../../models/fixture');
jest.mock('../../models/teams');
jest.mock('axios');
jest.mock('../../db_connect', () => ({
  connect: jest.fn(),
  sessionPool: () => ({ query: () => Promise.resolve({ rows: [] }) }),
  otherConnect: jest.fn(() => Promise.resolve({ query: jest.fn(() => Promise.resolve([[]])) })),
  isObject: jest.fn(obj => obj && typeof obj === 'object'),
}));
jest.mock('../../utils/ses', () => ({ sendEmail: jest.fn().mockResolvedValue({}) }));

const Fixture = require('../../models/fixture');
const Team = require('../../models/teams');
const app = require('../../app');

const COLLEGE_GREEN_C = 33;
const MANOR_A = 26;

// As filed: College Green C at home, Manor A away, Manor A winning 10-5.
function scorecard() {
  const sc = { id: 16, date: '2026-10-14', homeTeam: COLLEGE_GREEN_C, awayTeam: MANOR_A, status: 'submitted', email: 'c@example.com' };
  for (let i = 1; i <= 15; i++) {
    const homeWins = i <= 5;
    sc[`Game${i}homeScore`] = homeWins ? 21 : 15;
    sc[`Game${i}awayScore`] = homeWins ? 15 : 21;
  }
  return sc;
}

// B-25 as the draw had it: Manor A at home. Winner goes to B-30's home side.
const B25 = { id: 19, section: 'B', drawPos: 25, nextDrawPos: 30, nextSlot: 'H' };

const order = [];
beforeEach(() => {
  jest.clearAllMocks();
  order.length = 0;
  Fixture.getMesserScorecardById.mockResolvedValue([scorecard()]);
  Fixture.createMesserResult.mockImplementation(async () => { order.push('result'); return [{ id: 1 }]; });
  Fixture.updateMesserTable.mockImplementation(async () => { order.push('draw'); return []; });
  Fixture.updateMesserScorecardStatus.mockResolvedValue([]);
  Fixture.advanceMesserWinner.mockImplementation(async () => { order.push('advance'); return { advanced: true, slot: 'H' }; });
  Fixture.swapMesserHomeAway.mockImplementation(async () => { order.push('swap'); return { id: 19, drawPos: 25, feedersFlipped: 0 }; });
  Team.getById.mockResolvedValue([{ id: 1, name: 'Team' }]);
});

const approve = () => request(app).post('/messer-result/16/approve');

describe('a scorecard filed the same way round as the draw', () => {
  beforeEach(() => Fixture.findMesserMatch.mockResolvedValue({ ...B25, reversed: false }));

  it('updates the draw, advances the winner and links the result, without swapping', async () => {
    const res = await approve();
    expect(res.status).toBe(200);
    expect(Fixture.swapMesserHomeAway).not.toHaveBeenCalled();
    expect(Fixture.updateMesserTable).toHaveBeenCalledWith(19, { homeScore: 5, awayScore: 10, winningTeam: MANOR_A });
    expect(Fixture.advanceMesserWinner).toHaveBeenCalledWith(expect.objectContaining({ id: 19, nextDrawPos: 30 }), MANOR_A);
    expect(Fixture.createMesserResult).toHaveBeenCalledWith(expect.objectContaining({ messer_id: 19 }));
    expect(res.body.message).toMatch(/messer table updated/);
    expect(res.body.message).not.toMatch(/other way round/);
  });
});

describe('a scorecard filed the other way round from the draw', () => {
  beforeEach(() => Fixture.findMesserMatch.mockResolvedValue({ ...B25, reversed: true }));

  it('swaps the draw to agree with the scorecard before recording anything against it', async () => {
    const res = await approve();
    expect(res.status).toBe(200);
    expect(Fixture.findMesserMatch).toHaveBeenCalledWith(COLLEGE_GREEN_C, MANOR_A);
    expect(Fixture.swapMesserHomeAway).toHaveBeenCalledWith('B', 19);
    expect(order.indexOf('swap')).toBeLessThan(order.indexOf('draw'));
  });

  it('then records it exactly as an exact match would be — the scorecard home is now the draw home', async () => {
    const res = await approve();
    expect(Fixture.updateMesserTable).toHaveBeenCalledWith(19, { homeScore: 5, awayScore: 10, winningTeam: MANOR_A });
    expect(Fixture.advanceMesserWinner).toHaveBeenCalledWith(expect.objectContaining({ id: 19 }), MANOR_A);
    expect(Fixture.createMesserResult).toHaveBeenCalledWith(expect.objectContaining({ messer_id: 19 }));
    expect(res.body.message).toMatch(/filed the other way round, so the draw was swapped to match/);
  });

  it.each(['pending', 'played'])('leaves the draw alone and says so when the swap is refused (%s)', async (code) => {
    Fixture.swapMesserHomeAway.mockRejectedValue(Object.assign(new Error(code), { code, status: 409 }));
    const res = await approve();
    expect(res.status).toBe(200);
    expect(Fixture.updateMesserTable).not.toHaveBeenCalled();
    expect(Fixture.advanceMesserWinner).not.toHaveBeenCalled();
    expect(Fixture.createMesserResult.mock.calls[0][0].messer_id).toBeUndefined();
    expect(res.body.message).toMatch(new RegExp(`could not be swapped to match \\(${code}\\).*NOT updated`));
  });

  it('fails the approval, recording nothing, when the swap breaks for any other reason', async () => {
    Fixture.swapMesserHomeAway.mockRejectedValue(new Error('connection reset'));
    const res = await approve();
    expect(res.status).toBe(500);
    expect(Fixture.createMesserResult).not.toHaveBeenCalled();
    expect(Fixture.updateMesserScorecardStatus).not.toHaveBeenCalled();
  });
});

describe('a scorecard for a match that is not in the draw at all', () => {
  beforeEach(() => Fixture.findMesserMatch.mockResolvedValue(null));

  it('still records the result but tells the approver the draw was NOT updated', async () => {
    const res = await approve();
    expect(res.status).toBe(200);
    expect(Fixture.createMesserResult).toHaveBeenCalled();
    expect(Fixture.updateMesserTable).not.toHaveBeenCalled();
    expect(res.body.message).toMatch(/not found in the draw — the draw was NOT updated/);
    expect(res.body.message).not.toMatch(/messer table updated/);
  });
});

describe('a database error while finding the match', () => {
  it('fails the approval instead of reading as "not in the draw"', async () => {
    Fixture.findMesserMatch.mockRejectedValue(new Error('EMAXCONNSESSION'));
    const res = await approve();
    expect(res.status).toBe(500);
    expect(Fixture.createMesserResult).not.toHaveBeenCalled();
  });
});
