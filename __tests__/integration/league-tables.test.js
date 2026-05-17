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
