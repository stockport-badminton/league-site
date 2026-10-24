const request = require('supertest');

jest.mock('../../models/teams');

const Team = require('../../models/teams');
const app = require('../../app');

beforeEach(() => {
  jest.clearAllMocks();
});

// GET /team/:id — returns the team row as JSON.
describe('GET /team/:id', () => {
  it('returns the team for a numeric id', async () => {
    Team.getById.mockResolvedValue([{ id: 4, name: 'Mellor A' }]);

    const res = await request(app).get('/team/4');

    expect(res.status).toBe(200);
    expect(res.body[0].name).toBe('Mellor A');
    expect(Team.getById).toHaveBeenCalledWith('4');
  });

  it('404s a non-numeric id without reaching the database', async () => {
    // A browser asked for /team/members and Postgres answered `invalid input syntax for
    // type integer: "members"` — a 500 (Sentry NODE-19). Not a team, so it is a 404,
    // decided by the route the same way /scorecard/fixture/:id is.
    const res = await request(app).get('/team/members');

    expect(res.status).toBe(404);
    expect(Team.getById).not.toHaveBeenCalled();
  });
});
