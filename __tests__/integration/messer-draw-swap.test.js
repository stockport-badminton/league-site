const request = require('supertest');

// The draw is a public page, so the user arrives the way a real session's does — on
// every request, before routing — rather than only through `secured`. `null` is a
// visitor who is not logged in.
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

// A messer admin is usually a captain too; the flag, not the role, is what admits her.
const MESSER_ADMIN = { 'https://my-app.example.com/role': 'captain', 'https://my-app.example.com/messeradmin': true };
const SUPERADMIN = { 'https://my-app.example.com/role': 'superadmin' };
const CAPTAIN = { 'https://my-app.example.com/role': 'captain' };

const err = (code, status) => Object.assign(new Error(code), { code, status });

beforeEach(() => {
  jest.clearAllMocks();
  mockClaims = MESSER_ADMIN;
});

describe('POST /messer-draw/:section/swap/:id', () => {
  it('swaps for a messer admin and returns to the draw', async () => {
    Fixture.swapMesserHomeAway.mockResolvedValue({ id: 511, drawPos: 11, feedersFlipped: 2 });
    const res = await request(app).post('/messer-draw/a-section/swap/511');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/messer-draw/a-section?swapped=11');
    expect(Fixture.swapMesserHomeAway).toHaveBeenCalledWith('A', 511);
  });

  it('is forbidden to a logged-in member who is not a messer admin', async () => {
    mockClaims = CAPTAIN;
    const res = await request(app).post('/messer-draw/a-section/swap/511');
    expect(res.status).toBe(403);
    expect(Fixture.swapMesserHomeAway).not.toHaveBeenCalled();
  });

  it('sends a visitor who is not logged in to the login page', async () => {
    mockClaims = null;
    const res = await request(app).post('/messer-draw/a-section/swap/511');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/login');
    expect(Fixture.swapMesserHomeAway).not.toHaveBeenCalled();
  });

  it.each([
    ['/messer-draw/c-section/swap/511'],
    ['/messer-draw/a-section/swap/abc'],
  ])('rejects %s before touching the model', async (url) => {
    const res = await request(app).post(url);
    expect(res.status).toBe(400);
    expect(Fixture.swapMesserHomeAway).not.toHaveBeenCalled();
  });

  it.each(['played', 'pending', 'empty', 'missing'])('reports a %s refusal on the draw', async (code) => {
    Fixture.swapMesserHomeAway.mockRejectedValue(err(code, 409));
    const res = await request(app).post('/messer-draw/b-section/swap/9');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(`/messer-draw/b-section?swapError=${code}`);
  });
});

describe('GET /messer-draw/:section — the Swap button', () => {
  const row = (drawPos, id, home, away, scores = {}) => ({
    drawPos, id,
    homeTeam: home[0], homeTeamName: home[1], homeTeamHandicap: '+3',
    awayTeam: away[0], awayTeamName: away[1], awayTeamHandicap: '-2',
    homeScore: null, awayScore: null, ...scores,
  });
  const NO_TEAM = [52, 'No Team'];
  const ROWS = [
    row(2, 502, [8, 'Racketeers B'], [10, 'Alderley Park A'], { homeScore: 0, awayScore: 15 }), // played
    row(4, 504, [12, 'College Green A'], [55, 'Featherforce A']),                             // both known
    row(11, 511, [20, 'Syddal Park B'], NO_TEAM),                                              // one known
    row(13, 513, NO_TEAM, NO_TEAM),                                                            // none yet
  ];
  beforeEach(() => Team.getMesser.mockResolvedValue(ROWS));

  const swapForms = text => [...text.matchAll(/action="\/messer-draw\/a-section\/swap\/(\d+)"/g)].map(m => m[1]);

  it('offers it on unplayed matches with at least one team, to a messer admin', async () => {
    const res = await request(app).get('/messer-draw/a-section');
    expect(res.status).toBe(200);
    expect(swapForms(res.text).sort()).toEqual(['504', '511']);
  });

  it('offers the same to a superadmin', async () => {
    mockClaims = SUPERADMIN;
    const res = await request(app).get('/messer-draw/a-section');
    expect(swapForms(res.text).sort()).toEqual(['504', '511']);
  });

  it.each([['a captain', CAPTAIN], ['a visitor', null]])('never shows it to %s', async (_l, claims) => {
    mockClaims = claims;
    const res = await request(app).get('/messer-draw/a-section');
    expect(res.status).toBe(200);
    expect(res.text).toContain('College Green A');
    expect(swapForms(res.text)).toEqual([]);
  });

  it('does not offer it on an archived season, which the swap does not touch', async () => {
    const res = await request(app).get('/messer-draw/20252026/a-section');
    expect(res.status).toBe(200);
    expect(swapForms(res.text)).toEqual([]);
  });

  it('says what changed after a swap', async () => {
    const res = await request(app).get('/messer-draw/a-section?swapped=4');
    expect(res.text).toContain('Swapped: College Green A are now at home to Featherforce A');
  });

  it('explains a pending-scorecard refusal and links to where it is resolved', async () => {
    const res = await request(app).get('/messer-draw/a-section?swapError=pending');
    expect(res.text).toContain('waiting for approval');
    expect(res.text).toContain('href="/messer-results"');
  });

  it('shows no swap messages to anyone who is not a messer admin', async () => {
    mockClaims = CAPTAIN;
    const res = await request(app).get('/messer-draw/a-section?swapped=4&swapError=played');
    expect(res.text).not.toContain('Swapped:');
    expect(res.text).not.toContain('alert-danger');
  });

  it('ignores a swapError it does not recognise', async () => {
    const res = await request(app).get('/messer-draw/a-section?swapError=constructor');
    expect(res.status).toBe(200);
    expect(res.text).not.toContain('alert-danger');
  });
});

describe('POST /admin/messer-bracket/:section — Save wiring', () => {
  // Two rows as the form posts them: parallel arrays, the was* fields as rendered.
  const form = (over = {}) => ({
    id: ['19', '20'], round: ['2', '2'], nextDrawPos: ['30', '30'], nextSlot: ['H', 'A'],
    wasRound: ['2', '2'], wasNextDrawPos: ['30', '30'], wasNextSlot: ['H', 'A'], ...over,
  });
  const post = body => request(app).post('/admin/messer-bracket/b-section').type('form').send(body);

  it('passes each row with what the page showed, and reports how many changed', async () => {
    Fixture.saveMesserBracketLinks.mockResolvedValue({ saved: 1, conflicts: [] });
    const res = await post(form({ nextSlot: ['A', 'A'] }));
    expect(res.headers.location).toBe('/admin/messer-bracket/b-section?saved=1');
    expect(Fixture.saveMesserBracketLinks).toHaveBeenCalledWith([
      { id: 19, round: 2, nextDrawPos: 30, nextSlot: 'A', was: { round: 2, nextDrawPos: 30, nextSlot: 'H' } },
      { id: 20, round: 2, nextDrawPos: 30, nextSlot: 'A', was: { round: 2, nextDrawPos: 30, nextSlot: 'A' } },
    ]);
  });

  it('sends a conflict back to the page, naming the slots', async () => {
    Fixture.saveMesserBracketLinks.mockResolvedValue({ saved: 0, conflicts: [26, 25] });
    const res = await post(form());
    expect(res.headers.location).toBe('/admin/messer-bracket/b-section?conflict=26,25');
  });

  it('refuses a page rendered before it carried the was* fields, without writing', async () => {
    const { wasRound, wasNextDrawPos, wasNextSlot, ...old } = form();
    const res = await post(old);
    expect(res.headers.location).toBe('/admin/messer-bracket/b-section?stale=1');
    expect(Fixture.saveMesserBracketLinks).not.toHaveBeenCalled();
  });

  it('is forbidden to a member who is not a messer admin', async () => {
    mockClaims = CAPTAIN;
    const res = await post(form());
    expect(res.status).toBe(403);
    expect(Fixture.saveMesserBracketLinks).not.toHaveBeenCalled();
  });

  describe('the page', () => {
    beforeEach(() => Fixture.getMesserBracket.mockResolvedValue([
      { id: 20, section: 'B', drawPos: 26, round: 2, nextDrawPos: 30, nextSlot: 'A', homeTeamName: 'Mellor B', awayTeamName: 'Cheadle Hulme A', homeScore: 5, awayScore: 10 },
      { id: 32, section: 'B', drawPos: 32, round: 4, nextDrawPos: null, nextSlot: null, homeTeamName: 'No Team', awayTeamName: 'No Team', homeScore: null, awayScore: null },
    ]));

    it('renders what it showed alongside each row', async () => {
      const res = await request(app).get('/admin/messer-bracket/b-section');
      expect(res.text).toContain('name="wasNextSlot" value="A"');
      expect(res.text).toContain('name="wasNextDrawPos" value="30"');
      // A final: blank, not "null".
      expect(res.text).toMatch(/name="wasNextDrawPos" value=""/);
      expect(res.text).not.toContain('value="null"');
    });

    it('explains a conflict', async () => {
      const res = await request(app).get('/admin/messer-bracket/b-section?conflict=26');
      expect(res.text).toMatch(/Nothing was saved: the wiring for slot\s+26 changed/);
    });

    it('says when nothing had changed', async () => {
      const res = await request(app).get('/admin/messer-bracket/b-section?saved=0');
      expect(res.text).toContain('Nothing had changed, so nothing was saved.');
    });
  });
});
