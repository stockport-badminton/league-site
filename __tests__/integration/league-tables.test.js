const request = require('supertest');

jest.mock('../../models/league');

const League = require('../../models/league');
const app = require('../../app');

const mockDivisionRows = [
  { name: 'Mellor A', played: 10, pointsFor: 80, pointsAgainst: 40 },
  { name: 'Disley A', played: 10, pointsFor: 60, pointsAgainst: 50 },
];

const mockAllTablesRows = [
  { name: 'Mellor A', division: 'Division 1', played: 10, pointsFor: 80, pointsAgainst: 40 },
  { name: 'Disley A', division: 'Division 2', played: 10, pointsFor: 60, pointsAgainst: 50 },
];

beforeEach(() => {
  jest.clearAllMocks();
});

describe('GET /tables/:division', () => {
  it('returns 200', async () => {
    League.getLeagueTable.mockResolvedValue(mockDivisionRows);
    const res = await request(app).get('/tables/Division-1');
    expect(res.status).toBe(200);
  });

  it('calls League.getLeagueTable with division and undefined season', async () => {
    League.getLeagueTable.mockResolvedValue(mockDivisionRows);
    await request(app).get('/tables/Division-1');
    expect(League.getLeagueTable).toHaveBeenCalledWith('Division-1', undefined);
  });

  it('passes season param when provided', async () => {
    League.getLeagueTable.mockResolvedValue(mockDivisionRows);
    await request(app).get('/tables/Division-1/20242025');
    expect(League.getLeagueTable).toHaveBeenCalledWith('Division-1', '20242025');
  });

  it('returns 500 when League.getLeagueTable rejects', async () => {
    League.getLeagueTable.mockRejectedValue(new Error('DB error'));
    const res = await request(app).get('/tables/Division-1');
    expect(res.status).toBe(500);
  });
});

describe('GET /tables/All', () => {
  it('returns 200', async () => {
    League.getAllLeagueTables.mockResolvedValue(mockAllTablesRows);
    const res = await request(app).get('/tables/All');
    expect(res.status).toBe(200);
  });

  it('calls League.getAllLeagueTables with undefined season', async () => {
    League.getAllLeagueTables.mockResolvedValue(mockAllTablesRows);
    await request(app).get('/tables/All');
    expect(League.getAllLeagueTables).toHaveBeenCalledWith(undefined);
  });

  it('passes season param when provided', async () => {
    League.getAllLeagueTables.mockResolvedValue(mockAllTablesRows);
    await request(app).get('/tables/All/20242025');
    expect(League.getAllLeagueTables).toHaveBeenCalledWith('20242025');
  });

  it('returns 500 when League.getAllLeagueTables rejects', async () => {
    League.getAllLeagueTables.mockRejectedValue(new Error('DB error'));
    const res = await request(app).get('/tables/All');
    expect(res.status).toBe(500);
  });
});

// Season guard on the archive routes (middleware/validateSeason.js).
//
// /tables/All/20252027 asked for a season with no team20252027 table, so the
// interpolated query came back `relation "team20252027" does not exist` and the
// page 500'd — 9 events as Sentry NODE-Q. A season we hold no data for is a missing
// page, not a server fault.
describe('season guard on /tables', () => {
  const seasonModel = require('../../models/season');

  beforeEach(() => {
    League.getAllLeagueTables.mockResolvedValue(mockAllTablesRows);
    League.getLeagueTable.mockResolvedValue(mockDivisionRows);
    // Pretend only 20252026 has an archived snapshot.
    jest.spyOn(seasonModel, 'isServable').mockImplementation(
      s => !s || s === '20252026');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('serves a season we have data for', async () => {
    const res = await request(app).get('/tables/All/20252026');
    expect(res.status).toBe(200);
    expect(League.getAllLeagueTables).toHaveBeenCalledWith('20252026');
  });

  it('404s a well-formed season we have no data for', async () => {
    const res = await request(app).get('/tables/All/20252027');
    expect(res.status).toBe(404);
    // The point of the guard: the model is never reached, so no SQL is built from
    // the value.
    expect(League.getAllLeagueTables).not.toHaveBeenCalled();
  });

  it('404s a malformed season on the division route too', async () => {
    const res = await request(app).get('/tables/Division-1/_nope');
    expect(res.status).toBe(404);
    expect(League.getLeagueTable).not.toHaveBeenCalled();
  });

  it('404s a SQL payload without it reaching the model', async () => {
    const res = await request(app)
      .get('/tables/All/' + encodeURIComponent('20252026 AS team WHERE false --'));
    expect(res.status).toBe(404);
    expect(League.getAllLeagueTables).not.toHaveBeenCalled();
  });

  it('still serves the current season with no season segment', async () => {
    const res = await request(app).get('/tables/All');
    expect(res.status).toBe(200);
  });
});
