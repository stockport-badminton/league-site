const request = require('supertest');

// One mutable user, so the same file can exercise anonymous, captain and superadmin
// against the same route. Named `mock*` so jest's hoisted factory may close over it.
let mockCurrentUser = null;
jest.mock('../../middleware/secured', () => (req, res, next) => {
  if (!mockCurrentUser) {
    return res.redirect('/login?returnTo=' + encodeURIComponent(req.originalUrl));
  }
  req.user = mockCurrentUser;
  req.isAuthenticated = () => true;
  next();
});

jest.mock('../../models/fixture');
jest.mock('../../models/division');
jest.mock('../../models/players');
jest.mock('../../models/game');
jest.mock('../../models/teams');
jest.mock('../../models/club');
jest.mock('../../models/auth.js');
jest.mock('axios');

const Fixture = require('../../models/fixture');
const app = require('../../app');

const SUPERADMIN = {
  id: 'auth0|boss',
  _json: {
    'https://my-app.example.com/role': 'superadmin',
    'https://my-app.example.com/club': 'All',
  },
};

const CAPTAIN = {
  id: 'auth0|captain',
  _json: {
    'https://my-app.example.com/role': 'captain',
    'https://my-app.example.com/club': 'Mellor',
  },
};

const BODY = { homeTeam: 'Mellor A', awayTeam: 'Aerospace A', date: '2026-11-05' };

beforeEach(() => {
  jest.clearAllMocks();
  mockCurrentUser = null;
  Fixture.rearrangeByTeamNames.mockResolvedValue({
    ok: true, action: 'rearranged', fixtureId: 7200, replacementId: 7401, date: '2026-11-05',
  });
});

// Until Sep 2026 this route carried a rate limiter and nothing else. Anyone who could
// POST could archive a real fixture and insert a replacement on a date of their
// choosing — no login, no club, no relationship to either team. The only UI for it has
// always been inside `if (superadmin)` in views/fixtures-results.ejs.
describe('POST /fixture/rearrangement — authorization', () => {
  it('refuses an anonymous caller and writes nothing', async () => {
    const res = await request(app).post('/fixture/rearrangement').type('form').send(BODY);

    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/^\/login/);
    expect(Fixture.rearrangeByTeamNames).not.toHaveBeenCalled();
  });

  it('refuses a logged-in captain and writes nothing', async () => {
    mockCurrentUser = CAPTAIN;

    const res = await request(app).post('/fixture/rearrangement').type('form').send(BODY);

    expect(res.status).toBe(403);
    expect(Fixture.rearrangeByTeamNames).not.toHaveBeenCalled();
  });

  it("refuses a captain of one of the two teams — being involved is not being the secretary", async () => {
    mockCurrentUser = { ...CAPTAIN, _json: { ...CAPTAIN._json, 'https://my-app.example.com/club': 'Mellor' } };

    const res = await request(app).post('/fixture/rearrangement').type('form')
      .send({ ...BODY, homeTeam: 'Mellor A' });

    expect(res.status).toBe(403);
    expect(Fixture.rearrangeByTeamNames).not.toHaveBeenCalled();
  });

  it('allows a superadmin', async () => {
    mockCurrentUser = SUPERADMIN;

    const res = await request(app).post('/fixture/rearrangement').type('form').send(BODY);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, action: 'rearranged', replacementId: 7401 });
    expect(Fixture.rearrangeByTeamNames).toHaveBeenCalledWith(
      expect.objectContaining({ homeTeam: 'Mellor A', awayTeam: 'Aerospace A', date: '2026-11-05' })
    );
  });
});

describe('POST /fixture/rearrangement — error reporting', () => {
  beforeEach(() => { mockCurrentUser = SUPERADMIN; });

  it('passes a 4xx from the model through as JSON', async () => {
    const err = new Error('no team by that name: "Mellow A"');
    err.status = 400;
    Fixture.rearrangeByTeamNames.mockRejectedValue(err);

    const res = await request(app).post('/fixture/rearrangement').type('form')
      .send({ ...BODY, homeTeam: 'Mellow A' });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ ok: false });
    expect(res.body.error).toMatch(/no team by that name/);
  });

  it('answers 404 when the pairing matches no current-season fixture', async () => {
    const err = new Error('no current-season fixture for Mellor A v Aerospace A');
    err.status = 404;
    Fixture.rearrangeByTeamNames.mockRejectedValue(err);

    const res = await request(app).post('/fixture/rearrangement').type('form').send(BODY);

    expect(res.status).toBe(404);
    expect(res.body.ok).toBe(false);
  });

  it('does not leak a 500 message to the client', async () => {
    Fixture.rearrangeByTeamNames.mockRejectedValue(
      new Error('syntax error at or near "SELECT f."homeTeam"')
    );

    const res = await request(app).post('/fixture/rearrangement').type('form').send(BODY);

    expect(res.status).toBe(500);
    expect(res.text).not.toMatch(/syntax error/);
  });
});
