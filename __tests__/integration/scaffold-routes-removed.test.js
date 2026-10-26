const request = require('supertest');

// REARCH-04 step 0. Two leftovers from the Express-generator scaffold the site started from.
//
// GET /player/:id answered anyone, signed in or not, with Player.getById as JSON — which
// decrypts playerEmail and playerTel. Ids are sequential, so every player's contact details
// could be read by counting. Found 26 Oct 2026 by walking the router stack; nothing in this
// repo or the Remnants site requests it, and the only GETs in 30 days of logs were the ones
// that confirmed the leak. Removed, not gated: no page needs the JSON.
//
// It also shadowed GET /player/create (registered later), so that form had never rendered.
// It now does, and is superadmin-only like the POST it submits to.
//
// The 22 other routes below only ever answered `NOT IMPLEMENTED: …`, ungated. No GET in
// 30 days of logs, and nothing links to them.

let mockCurrentUser = null;
jest.mock('../../middleware/secured', () => (req, res, next) => {
  if (mockCurrentUser) req.user = mockCurrentUser;
  next();
});
jest.mock('../../models/players');
jest.mock('../../models/club');
jest.mock('../../models/league');

const Player = require('../../models/players');
const Club = require('../../models/club');
const League = require('../../models/league');
const app = require('../../app');

const SUPERADMIN = { id: 'a', displayName: 'Results Secretary', _json: { 'https://my-app.example.com/role': 'superadmin', 'https://my-app.example.com/club': 'All' } };
const CLUB_ADMIN = { id: 'b', displayName: 'Club Admin', _json: { 'https://my-app.example.com/role': 'admin', 'https://my-app.example.com/club': 'Dome' } };

const STUBS = [
  '/player/5/delete',
  '/team/create', '/team/5/delete', '/team/5/update',
  '/league/create', '/league/5/delete', '/league/5/update',
  '/club/create', '/club/5/delete', '/club/5/update',
  '/division/create', '/division/5/delete', '/division/5/update',
  '/fixture/create', '/fixture/5/delete', '/fixture/5/update',
  '/game/create', '/game/5/delete', '/game/5/update',
  '/venue/create', '/venue/5/delete', '/venue/5/update',
];

beforeEach(() => {
  jest.clearAllMocks();
  mockCurrentUser = null;
  Player.getById.mockResolvedValue([{ id: 5, first_name: 'A', family_name: 'B', playerEmail: 'a@example.com', playerTel: '0161' }]);
  Club.getAll.mockResolvedValue([{ id: 1, name: 'Dome' }]);
  League.getById.mockResolvedValue([]);
});

describe('GET /player/:id is gone', () => {
  it.each([['signed out', null], ['a club admin', CLUB_ADMIN], ['a superadmin', SUPERADMIN]])(
    'for %s', async (_, user) => {
      mockCurrentUser = user;
      const res = await request(app).get('/player/5');
      expect(res.status).toBe(404);
      expect(res.text).not.toContain('a@example.com');
      expect(Player.getById).not.toHaveBeenCalled();
    });
});

describe('GET /player/create', () => {
  it('renders the form for a superadmin', async () => {
    mockCurrentUser = SUPERADMIN;
    const res = await request(app).get('/player/create');
    expect(res.status).toBe(200);
    expect(res.text).toContain('action="/player/create"');
  });

  it('refuses a club admin', async () => {
    mockCurrentUser = CLUB_ADMIN;
    const res = await request(app).get('/player/create');
    expect(res.status).toBe(403);
    expect(res.text).not.toContain('action="/player/create"');
  });
});

describe('the NOT IMPLEMENTED scaffold is gone', () => {
  it('lists all 22', () => {
    expect(STUBS).toHaveLength(22);
  });

  // Two now fall through to real routes, GET /league/:id and GET /club/:id, so those are
  // asserted only on the body.
  const FALLS_THROUGH = ['/league/create', '/club/create'];
  it.each(STUBS)('GET %s', async (path) => {
    const res = await request(app).get(path);
    expect(res.text).not.toContain('NOT IMPLEMENTED');
    if (!FALLS_THROUGH.includes(path)) expect(res.status).toBe(404);
  });
});
