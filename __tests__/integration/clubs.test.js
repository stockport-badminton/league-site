const request = require('supertest');

jest.mock('../../models/club');
jest.mock('../../models/venue');

const Club = require('../../models/club');
const app = require('../../app');

const mockClubs = [
  { id: 1, name: 'Bramhall Village' },
  { id: 2, name: 'Canute' },
];

beforeEach(() => {
  jest.clearAllMocks();
});

// GET /clubs is unauthenticated — returns JSON array
describe('GET /clubs', () => {
  it('returns 200 with club array', async () => {
    Club.getAll.mockResolvedValue(mockClubs);
    const res = await request(app).get('/clubs');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body[0].name).toBe('Bramhall Village');
  });

  it('calls Club.getAll exactly once', async () => {
    Club.getAll.mockResolvedValue(mockClubs);
    await request(app).get('/clubs');
    expect(Club.getAll).toHaveBeenCalledTimes(1);
  });

  it('returns 500 when Club.getAll rejects', async () => {
    Club.getAll.mockRejectedValue(new Error('DB connection lost'));
    const res = await request(app).get('/clubs');
    expect(res.status).toBe(500);
  });

  it('returns empty array when no clubs exist', async () => {
    Club.getAll.mockResolvedValue([]);
    const res = await request(app).get('/clubs');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});

// Note: GET /club-api/:id and GET /info/clubs require auth (secured middleware)
// and are not tested here.
