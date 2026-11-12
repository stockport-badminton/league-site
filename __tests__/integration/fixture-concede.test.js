// POST /admin/fixture/:id/concede — a superadmin marks a fixture conceded, or undoes it —
// and the links on the admin results grid that call it. The model is mocked: what is
// asserted is the gate, that a refused request never reaches the model, and how the
// model's answer maps onto a status. The SQL's eligibility rules are proved in
// __tests__/db/fixture-concede.test.js.
const request = require('supertest');

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
  _json: { 'https://my-app.example.com/role': 'superadmin', 'https://my-app.example.com/club': 'All' },
};
const CAPTAIN = {
  id: 'auth0|captain',
  _json: { 'https://my-app.example.com/role': 'captain', 'https://my-app.example.com/club': 'Mellor' },
};

const concede = (id, body) => request(app).post(`/admin/fixture/${id}/concede`).type('form').send(body);

beforeEach(() => {
  jest.clearAllMocks();
  mockCurrentUser = null;
  Fixture.setConceded.mockResolvedValue({ ok: true, fixture: { id: 7200, status: 'conceded', homeScore: 0, awayScore: 18 } });
});

describe('POST /admin/fixture/:id/concede — gate', () => {
  it('sends an anonymous caller to login and touches nothing', async () => {
    const res = await concede(7200, { concededBy: 'home' });
    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/^\/login/);
    expect(Fixture.setConceded).not.toHaveBeenCalled();
  });

  it('refuses a captain with 403 and touches nothing', async () => {
    mockCurrentUser = CAPTAIN;
    const res = await concede(7200, { concededBy: 'home' });
    expect(res.status).toBe(403);
    expect(Fixture.setConceded).not.toHaveBeenCalled();
  });

  it('rejects an unknown or missing concededBy before reaching the model', async () => {
    mockCurrentUser = SUPERADMIN;
    for (const body of [{ concededBy: 'both' }, {}]) {
      expect((await concede(7200, body)).status).toBe(400);
    }
    expect(Fixture.setConceded).not.toHaveBeenCalled();
  });

  it('does not answer a non-numeric id', async () => {
    mockCurrentUser = SUPERADMIN;
    expect((await concede('abc', { concededBy: 'home' })).status).toBe(404);
    expect(Fixture.setConceded).not.toHaveBeenCalled();
  });
});

describe('POST /admin/fixture/:id/concede — as superadmin', () => {
  beforeEach(() => { mockCurrentUser = SUPERADMIN; });

  it('passes the id as a number and the side, and returns the updated fixture', async () => {
    const res = await concede(7200, { concededBy: 'home' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, fixture: { id: 7200, status: 'conceded', homeScore: 0, awayScore: 18 } });
    expect(Fixture.setConceded).toHaveBeenCalledWith(7200, 'home');
  });

  it('accepts concededBy=none as an undo', async () => {
    Fixture.setConceded.mockResolvedValue({ ok: true, fixture: { id: 7200, status: 'outstanding' } });
    expect((await concede(7200, { concededBy: 'none' })).status).toBe(200);
    expect(Fixture.setConceded).toHaveBeenCalledWith(7200, 'none');
  });

  it('404s a fixture that does not exist', async () => {
    Fixture.setConceded.mockResolvedValue({ ok: false, reason: 'not-found' });
    expect((await concede(99999, { concededBy: 'away' })).status).toBe(404);
  });

  it('409s a fixture that already has a result, naming its status', async () => {
    Fixture.setConceded.mockResolvedValue({ ok: false, reason: 'not-concedable', status: 'complete' });
    const res = await concede(7100, { concededBy: 'away' });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/complete fixture cannot be conceded/);
  });
});

describe('the admin results grid', () => {
  const row = (id, status, score) => ({
    id, status, date: '2026-10-01T00:00:00.000Z', homeTeam: `Home ${id}`, awayTeam: `Away ${id}`,
    homeScore: score ? score[0] : null, awayScore: score ? score[1] : null,
    divisionName: 'Premier', homeClub: 'Mellor', venueLink: '#',
  });

  beforeEach(() => {
    Fixture.getFixtureDetails.mockResolvedValue([
      row(1, 'outstanding'), row(2, 'rearranging'), row(3, 'rearranged'),
      row(4, 'complete', [12, 6]), row(5, 'conceded', [18, 0]), row(6, 'void'),
    ]);
  });

  it('offers Concede on outstanding and rearranging fixtures only, and Undo on conceded ones', async () => {
    mockCurrentUser = SUPERADMIN;
    const res = await request(app).get('/admin/results/Premier');
    expect(res.status).toBe(200);
    const concedable = [...res.text.matchAll(/class="concede-link" data-fixture-id="(\d+)"/g)].map(m => m[1]);
    const undoable = [...res.text.matchAll(/class="concede-undo-link" data-fixture-id="(\d+)"/g)].map(m => m[1]);
    expect(concedable).toEqual(['1', '2']);
    expect(undoable).toEqual(['5']);
    expect(res.text).toContain('id="concedeModal"');
  });

  it('shows a non-superadmin no concede controls', async () => {
    mockCurrentUser = { id: 'auth0|admin', _json: { 'https://my-app.example.com/role': 'admin', 'https://my-app.example.com/club': 'All' } };
    const res = await request(app).get('/admin/results/Premier');
    expect(res.status).toBe(200);
    expect(res.text).not.toMatch(/concede-link|concede-undo-link|concedeModal/);
  });
});
