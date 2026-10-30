// /admin/team-strength: the page shows the latest nightly run; POST …/run makes one.
const request = require('supertest');

let mockCurrentUser = null;
jest.mock('../../middleware/secured', () => (req, res, next) => {
  if (mockCurrentUser) req.user = mockCurrentUser;
  next();
});
// The run route is a cron gate, not `secured`: a superadmin is recognised from the session
// user every request carries, which userInViews puts there.
jest.mock('../../models/userInViews', () => () => (req, res, next) => {
  if (mockCurrentUser) req.user = mockCurrentUser;
  next();
});
jest.mock('../../models/teamStrength');
jest.mock('../../models/league');

const TeamStrength = require('../../models/teamStrength');
const League = require('../../models/league');
const app = require('../../app');

const SUPERADMIN = { id: 'a', displayName: 'Results Secretary', _json: { 'https://my-app.example.com/role': 'superadmin', 'https://my-app.example.com/club': 'All' } };
const CLUB_ADMIN = { id: 'b', displayName: 'Club Admin', _json: { 'https://my-app.example.com/role': 'admin', 'https://my-app.example.com/club': 'Dome' } };

// A two-team division: Strong A's three men and three ladies beat Weak B's most games.
const SEASON = require('../../models/season').current();
const people = [];
const games = [];
const HOME = 501, AWAY = 502;
let pid = 9000;
const squad = team => ['Male', 'Female'].flatMap(g => [1, 2, 3].map(rank => {
  const p = { id: ++pid, first_name: `${team === HOME ? 'Strong' : 'Weak'}${g[0]}`, family_name: String(rank), gender: g, team, rank };
  people.push(p);
  return p;
}));
const home = squad(HOME), away = squad(AWAY);
for (let i = 0; i < 40; i++) {
  const [h1, h2] = [home[i % 3], home[(i + 1) % 3]], [a1, a2] = [away[i % 3], away[(i + 1) % 3]];
  games.push({ id: i, gameType: 'FirstMens', homePlayer1: h1.id, homePlayer2: h2.id, awayPlayer1: a1.id, awayPlayer2: a2.id,
    homeScore: 21, awayScore: 12, date: new Date(Date.now() - (i + 1) * 86400000), season: SEASON });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockCurrentUser = SUPERADMIN;
  TeamStrength.games.mockResolvedValue(games);
  TeamStrength.registrations.mockResolvedValue(people.map(p => ({ season: SEASON, id: p.id, gender: p.gender, divRank: 2 })));
  TeamStrength.squads.mockResolvedValue({
    teams: [
      { id: HOME, name: 'Strong A', rank: 1, divRank: 1, clubId: 1, clubName: 'Strong', divisionId: 8, divisionName: 'Division 1', divisionRank: 2 },
      { id: AWAY, name: 'Weak B', rank: 1, divRank: 2, clubId: 2, clubName: 'Weak', divisionId: 8, divisionName: 'Division 1', divisionRank: 2 },
    ],
    players: people,
  });
  TeamStrength.remainingFixtures.mockResolvedValue([
    { id: 77, homeTeam: HOME, awayTeam: AWAY, date: new Date(), dayLabel: 'Tue 3 Nov', thisWeek: true },
    { id: 78, homeTeam: AWAY, awayTeam: HOME, date: new Date(), dayLabel: 'Tue 1 Dec', thisWeek: false },
  ]);
  League.getRunIn.mockResolvedValue([
    { division: 8, divisionName: 'Division 1', divisionRank: 2, id: HOME, name: 'Strong A', divRank: 1, played: 2, remaining: 2, gamesWon: 30, gamesLost: 6 },
    { division: 8, divisionName: 'Division 1', divisionRank: 2, id: AWAY, name: 'Weak B', divRank: 2, played: 2, remaining: 2, gamesWon: 6, gamesLost: 30 },
  ]);
  TeamStrength.save.mockResolvedValue(1);
});

// Runs the job for real (against the mocked reads) and hands the page what it stored.
async function runAndStore() {
  await request(app).post('/admin/team-strength/run');
  const saved = TeamStrength.save.mock.calls[0][0];
  TeamStrength.latest.mockResolvedValue({ id: 1, ran_at: new Date(), season: SEASON, caller: saved.caller,
    games: saved.games, took_ms: saved.tookMs, payload: JSON.parse(JSON.stringify(saved.payload)) });
  return saved;
}

it('is superadmin-only', async () => {
  mockCurrentUser = CLUB_ADMIN;
  expect((await request(app).get('/admin/team-strength')).status).toBe(403);
});

it('refuses a run from anyone without the token or a superadmin session', async () => {
  mockCurrentUser = null;
  expect((await request(app).post('/admin/team-strength/run')).status).toBe(403);
  mockCurrentUser = CLUB_ADMIN;
  expect((await request(app).post('/admin/team-strength/run')).status).toBe(403);
  expect(TeamStrength.save).not.toHaveBeenCalled();
});

it('says there is no run yet before the first', async () => {
  TeamStrength.latest.mockResolvedValue(null);
  const res = await request(app).get('/admin/team-strength');
  expect(res.status).toBe(200);
  expect(res.text).toContain('No run yet.');
  expect(res.text).toContain('action="/admin/team-strength/run"');
});

it('a superadmin\'s run stores the result and comes back to the page', async () => {
  const res = await request(app).post('/admin/team-strength/run');
  expect(res.status).toBe(303);
  expect(res.headers.location).toBe('/admin/team-strength');
  expect(TeamStrength.save).toHaveBeenCalledTimes(1);
  expect(TeamStrength.save.mock.calls[0][0]).toMatchObject({ caller: 'superadmin', games: 40, season: SEASON });
});

it('shows this week\'s fixture with the stronger home side favoured', async () => {
  await runAndStore();
  const res = await request(app).get('/admin/team-strength');
  expect(res.status).toBe(200);
  const block = res.text.match(/<div class="ts-fixture" data-fixture="77">([\s\S]*?)<div class="collapse"/)[1];
  expect(block).toContain('<strong>Strong A</strong> v <strong>Weak B</strong>');
  expect(block).toContain('Tue 3 Nov · Division 1');
  const [, h, a] = block.match(/<strong class="ts-likely">(\d+)–(\d+)<\/strong>/);
  expect(Number(h)).toBeGreaterThan(Number(a));
  expect(res.text).not.toContain('data-fixture="78"');
});

it('shows the projected table with each team\'s games won now and at the end', async () => {
  await runAndStore();
  const res = await request(app).get('/admin/team-strength');
  const rows = [...res.text.matchAll(/<tr data-team="([^"]+)">\s*<td>[^<]*<\/td>\s*<td class="ts-num">(\d+) /g)].map(m => [m[1], Number(m[2])]);
  expect(rows).toEqual([['Strong A', 30], ['Weak B', 6]]);
});

it('lists each club with its team sheet ratings', async () => {
  await runAndStore();
  const res = await request(app).get('/admin/team-strength');
  expect(res.text).toContain('data-club="Strong"');
  expect(res.text).toContain('<td>StrongM 1</td>');
});
