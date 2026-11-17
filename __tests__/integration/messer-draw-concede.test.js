const request = require('supertest');

// Conceding a Messer match from the draw page: who may, and what the page shows. Set up as
// messer-draw-swap.test.js is — the draw is public, so the user arrives through devMode on
// every request. The rules on the draw itself are in __tests__/db/messer.test.js; the
// handler's redirects in messer-scorecard.test.js.
let mockClaims = null;
jest.mock('../../middleware/devMode', () => (req, res, next) => {
  if (mockClaims) req.user = { id: 'auth0|test', displayName: 'Test User', _json: mockClaims };
  next();
});
jest.mock('../../middleware/secured', () => (req, res, next) =>
  (req.user ? next() : res.redirect('/login')));

jest.mock('../../models/fixture');
jest.mock('../../models/teams');
jest.mock('axios');
jest.mock('../../db_connect', () => ({
  connect: jest.fn(),
  sessionPool: () => ({ query: () => Promise.resolve({ rows: [] }) }),
  otherConnect: jest.fn(() => Promise.resolve({ query: jest.fn(() => Promise.resolve([[]])) })),
  isObject: jest.fn(obj => obj && typeof obj === 'object'),
}));

const Fixture = require('../../models/fixture');
const Team = require('../../models/teams');
const app = require('../../app');

const MESSER_ADMIN = { 'https://my-app.example.com/role': 'captain', 'https://my-app.example.com/messeradmin': true };
const CAPTAIN = { 'https://my-app.example.com/role': 'captain' };

beforeEach(() => {
  jest.clearAllMocks();
  mockClaims = MESSER_ADMIN;
});

describe('POST /messer-draw/:section/concede/:id', () => {
  it('is forbidden to a member who is not a messer admin', async () => {
    mockClaims = CAPTAIN;
    const res = await request(app).post('/messer-draw/a-section/concede/504').type('form').send({ concededBy: 'home' });
    expect(res.status).toBe(403);
    expect(Fixture.concedeMesserMatch).not.toHaveBeenCalled();
  });

  it('sends a visitor to the login page', async () => {
    mockClaims = null;
    const res = await request(app).post('/messer-draw/a-section/concede/504').type('form').send({ concededBy: 'home' });
    expect(res.headers.location).toBe('/login');
    expect(Fixture.concedeMesserMatch).not.toHaveBeenCalled();
  });
});

describe('GET /messer-draw/:section — concessions', () => {
  const row = (drawPos, id, home, away, scores = {}) => ({
    drawPos, id,
    homeTeam: home[0], homeTeamName: home[1], homeTeamHandicap: '+3',
    awayTeam: away[0], awayTeamName: away[1], awayTeamHandicap: '-2',
    homeScore: null, awayScore: null, concededBy: null, ...scores,
  });
  const NO_TEAM = [52, 'No Team'];
  const ROWS = [
    row(2, 502, [8, 'Racketeers B'], [10, 'Alderley Park A'], { homeScore: 9, awayScore: 6 }),          // played
    row(3, 503, [19, 'Alderley Park B'], [4, 'Racketeers A'], { homeScore: 15, awayScore: 0, concededBy: 'away' }),
    row(4, 504, [12, 'College Green A'], [55, 'Featherforce A']),                                        // unplayed
    row(11, 511, [20, 'Syddal Park B'], NO_TEAM),                                                        // one side TBC
  ];
  beforeEach(() => Team.getMesser.mockResolvedValue(ROWS));

  const concedeButtons = text => [...text.matchAll(/data-target="#concedeModal"[^>]*data-match="(\d+)"/g)].map(m => m[1]);

  it('offers it on unplayed matches with both teams, and on concessions, to a messer admin', async () => {
    const res = await request(app).get('/messer-draw/a-section');
    expect(res.status).toBe(200);
    expect(concedeButtons(res.text).sort()).toEqual(['503', '504']);
    expect(res.text).toContain('id="concedeModal"');
    expect(res.text).toMatch(/data-match="503"[^>]*data-conceded="away"/);
  });

  it.each([['a captain', CAPTAIN], ['a visitor', null]])('never offers it to %s', async (_l, claims) => {
    mockClaims = claims;
    const res = await request(app).get('/messer-draw/a-section');
    expect(res.status).toBe(200);
    expect(concedeButtons(res.text)).toEqual([]);
    expect(res.text).not.toContain('id="concedeModal"');
  });

  it('does not offer it on an archived season', async () => {
    const res = await request(app).get('/messer-draw/20252026/a-section');
    expect(concedeButtons(res.text)).toEqual([]);
  });

  it('shows everyone a conceded side as w/o, not 0', async () => {
    mockClaims = null;
    const res = await request(app).get('/messer-draw/a-section');
    expect(res.text.match(/md-wo/g)).toHaveLength(1);
    expect(res.text).toMatch(/Racketeers A[\s\S]*?<span class="md-score md-wo" title="Conceded">w\/o<\/span>/);
  });

  it('says what a concession did', async () => {
    const res = await request(app).get('/messer-draw/a-section?conceded=3');
    expect(res.text).toMatch(/Conceded: Racketeers A concede to Alderley Park B, recorded 15-0\./);
    expect(res.text).toMatch(/Alderley Park B go through to the next round\./);
  });

  it('says when the winner could not be sent on', async () => {
    const res = await request(app).get('/messer-draw/a-section?conceded=3&notAdvanced=1');
    expect(res.text).toMatch(/could not be put into the next round automatically/);
  });

  it('says why one was refused, and only for a code it knows', async () => {
    let res = await request(app).get('/messer-draw/a-section?concedeError=next-played');
    expect(res.text).toMatch(/can no longer be changed or undone/);
    res = await request(app).get('/messer-draw/a-section?concedeError=%3Cscript%3E');
    expect(res.text).not.toContain('<script>alert');
    expect(res.text).not.toMatch(/alert-danger/);
  });

  it('shows none of that to someone who is not an admin', async () => {
    mockClaims = CAPTAIN;
    const res = await request(app).get('/messer-draw/a-section?conceded=3&concedeError=pending');
    expect(res.text).not.toMatch(/Conceded: /);
    expect(res.text).not.toMatch(/waiting for approval/);
  });
});
