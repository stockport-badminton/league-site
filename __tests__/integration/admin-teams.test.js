const request = require('supertest');

// Auth bypass — the admin team routes gate on the superadmin role claim.
jest.mock('../../middleware/secured', () => (req, res, next) => {
  req.user = {
    id: 'auth0|test',
    _json: {
      'https://my-app.example.com/role': 'superadmin',
      'https://my-app.example.com/club': 'All',
    },
  };
  next();
});

jest.mock('../../models/teams');
jest.mock('../../models/club');
jest.mock('../../models/division');
jest.mock('../../models/venue');
jest.mock('../../models/league');

jest.mock('../../db_connect', () => ({
  connect: jest.fn(),
  otherConnect: jest.fn(() => Promise.resolve({
    query: jest.fn(() => Promise.resolve([[], []]))
  })),
  isObject: jest.fn(obj => obj === Object(obj)),
}));

const Team = require('../../models/teams');
const app = require('../../app');

// Mirrors the `team` table: name varchar(45), matchDay varchar(50), handicap
// varchar(45). Postgres rejected an over-long value with `value too long for type
// character varying(50)` — a 500 that told the admin nothing about which field was
// at fault, and reported to Sentry as NODE-W. These assert it is caught first, and
// crucially that no write is attempted.
const VALID_BODY = {
  name: 'Shell C', club: '40', division: '8', venue: '3',
  matchDay: 'Wednesday', rank: '3', starttime: '20:00', endtime: '22:00',
  handicap: '+2', courtspace: '2',
};

describe('POST /admin/teams/:id — field length validation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Team.getById.mockResolvedValue([{ id: 14, division: 8, rank: 3 }]);
    Team.getNextDivRank.mockResolvedValue(9);
    Team.updateById.mockResolvedValue({ affectedRows: 1 });
    Team.createFull.mockResolvedValue({ insertId: 99 });
  });

  it('accepts values within the column widths', async () => {
    const res = await request(app).post('/admin/teams/14').type('form').send(VALID_BODY);
    expect(res.status).toBe(302);
    expect(Team.updateById).toHaveBeenCalled();
  });

  it('rejects a matchDay over 50 characters without touching the database', async () => {
    const res = await request(app).post('/admin/teams/14').type('form')
      .send({ ...VALID_BODY, matchDay: 'W'.repeat(51) });

    expect(res.status).toBe(400);
    expect(res.text).toMatch(/matchDay is too long \(51 characters; the maximum is 50\)/);
    // The point of the check: Postgres never sees it.
    expect(Team.updateById).not.toHaveBeenCalled();
  });

  it('rejects an over-long name and handicap too', async () => {
    const longName = await request(app).post('/admin/teams/14').type('form')
      .send({ ...VALID_BODY, name: 'N'.repeat(46) });
    expect(longName.status).toBe(400);
    expect(longName.text).toMatch(/name is too long/);

    const longHandicap = await request(app).post('/admin/teams/14').type('form')
      .send({ ...VALID_BODY, handicap: 'H'.repeat(46) });
    expect(longHandicap.status).toBe(400);
    expect(longHandicap.text).toMatch(/handicap is too long/);

    expect(Team.updateById).not.toHaveBeenCalled();
  });

  it('allows a value exactly on the limit', async () => {
    const res = await request(app).post('/admin/teams/14').type('form')
      .send({ ...VALID_BODY, matchDay: 'W'.repeat(50) });
    expect(res.status).toBe(302);
    expect(Team.updateById).toHaveBeenCalled();
  });

  it('applies the same check when creating a team', async () => {
    const res = await request(app).post('/admin/teams').type('form')
      .send({ ...VALID_BODY, matchDay: 'W'.repeat(51) });
    expect(res.status).toBe(400);
    expect(res.text).toMatch(/matchDay is too long/);
    expect(Team.createFull).not.toHaveBeenCalled();
  });

  it('still enforces the pre-existing required-field checks', async () => {
    const noName = await request(app).post('/admin/teams/14').type('form')
      .send({ ...VALID_BODY, name: '' });
    expect(noName.status).toBe(400);
    expect(noName.text).toMatch(/Team name is required/);
  });
});
