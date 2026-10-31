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
jest.mock('../../models/externalGame');
// The network is never touched: Manchester's page is a fake, Tameside is unconfigured in tests.
jest.mock('../../utils/externalLeagues', () => ({
  ...jest.requireActual('../../utils/externalLeagues'),
  fetchMcrblSeason: jest.fn(),
}));

const TeamStrength = require('../../models/teamStrength');
const League = require('../../models/league');
const ExternalGame = require('../../models/externalGame');
const externalLeagues = require('../../utils/externalLeagues');
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
// Strong A's reserve, who has turned out more than any nominated man: the predictions field him.
const regular = { id: ++pid, first_name: 'Regular', family_name: 'Reserve', gender: 'Male', team: HOME, rank: 99 };
people.push(regular);
const game = (i, h1, h2, a1, a2) => games.push({ id: i, fixture: i, gameType: 'FirstMens',
  homePlayer1: h1.id, homePlayer2: h2.id, awayPlayer1: a1.id, awayPlayer2: a2.id, homeTeam: HOME, awayTeam: AWAY,
  homeScore: 21, awayScore: 12, date: new Date(Date.now() - (i % 100 + 1) * 86400000), season: SEASON });
for (let i = 0; i < 40; i++) game(i, home[i % 3], home[(i + 1) % 3], away[i % 3], away[(i + 1) % 3]);
for (let i = 100; i < 160; i++) game(i, home[0], regular, away[0], away[1]);

// Four nights on which Strong A's men 1 and 2 both played: man 2 with man 3 wins, man 1 with
// man 3 loses. The case for man 2 above man 1.
const [m1, m2, m3] = home;
const pairRows = [];
for (let f = 900; f < 904; f++) {
  const row = (h1, h2, a1, a2, hs, as) => pairRows.push({ id: pairRows.length, fixture: f, gameType: 'FirstMens',
    homePlayer1: h1.id, homePlayer2: h2.id, awayPlayer1: a1.id, awayPlayer2: a2.id, homeScore: hs, awayScore: as,
    date: new Date('2026-10-01'), homeTeam: HOME, awayTeam: AWAY, season: SEASON, homeTeamName: 'Strong A', awayTeamName: 'Weak B',
    homeDivision: 'Division 1', awayDivision: 'Division 1', homeDivRank: 2, awayDivRank: 2 });
  row(m2, m3, away[0], away[1], 21, 10);
  row(m1, m3, away[0], away[2], 14, 21);
  row(m1, m2, away[1], away[2], 21, 19);
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
    { id: 76, homeTeam: AWAY, awayTeam: HOME, date: new Date(), dayLabel: 'Thu 29 Oct', thisWeek: true, overdue: true },
    { id: 77, homeTeam: HOME, awayTeam: AWAY, date: new Date(), dayLabel: 'Tue 3 Nov', thisWeek: true, overdue: false },
    { id: 78, homeTeam: AWAY, awayTeam: HOME, date: new Date(), dayLabel: 'Tue 1 Dec', thisWeek: false },
  ]);
  League.getRunIn.mockResolvedValue([
    { division: 8, divisionName: 'Division 1', divisionRank: 2, id: HOME, name: 'Strong A', divRank: 1, played: 2, remaining: 2, gamesWon: 30, gamesLost: 6 },
    { division: 8, divisionName: 'Division 1', divisionRank: 2, id: AWAY, name: 'Weak B', divRank: 2, played: 2, remaining: 2, gamesWon: 6, gamesLost: 30 },
  ]);
  TeamStrength.save.mockResolvedValue(1);
  TeamStrength.registrations.mockResolvedValue(people.map(p => ({ season: SEASON, id: p.id, gender: p.gender,
    first_name: p.first_name, family_name: p.family_name, divRank: 2 })));
  // One Tameside game: Strong A's man 1 plays there too, with three Tameside players.
  ExternalGame.all.mockResolvedValue([{ league: 'tameside', played_on: '2026-09-15', game_type: 'FirstMens', mixed: false,
    home1: 'StrongM 1', home2: 'Tam One', away1: 'Tam Two', away2: 'Tam Three',
    home1_gender: 'Male', home2_gender: 'Male', away1_gender: 'Male', away2_gender: 'Male', home_score: 21, away_score: 16 }]);
  ExternalGame.add.mockImplementation(async rows => rows.length);
  TeamStrength.pairGames.mockResolvedValue(pairRows);
  ExternalGame.summary.mockResolvedValue([{ league: 'mcrbl', games: '2', latest: '2026-10-28' }]);
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
  expect(TeamStrength.save.mock.calls[0][0]).toMatchObject({ caller: 'superadmin', games: 101, season: SEASON });
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
  expect(block).not.toContain('Awaiting result');
  expect(res.text).not.toContain('data-fixture="78"');
});

it('keeps a fixture whose date has passed without a result on this week\'s list, marked', async () => {
  await runAndStore();
  const res = await request(app).get('/admin/team-strength');
  const block = res.text.match(/<div class="ts-fixture" data-fixture="76">([\s\S]*?)<div class="collapse"/)[1];
  expect(block).toContain('<span class="badge badge-warning ts-overdue">Awaiting result</span> Thu 29 Oct');
});

it('fields the players who have been turning out, not only the nominated ones', async () => {
  await runAndStore();
  const res = await request(app).get('/admin/team-strength');
  const rubbers = res.text.match(/<div class="collapse" id="rubbers-77">([\s\S]*?)<\/table>/)[1];
  expect(rubbers).toContain('Regular Reserve');
  // the nominated man 2 or 3 has made way: only three men are fielded
  const men = new Set([...rubbers.matchAll(/(StrongM \d|Regular Reserve)/g)].map(m => m[1]));
  expect(men.size).toBe(3);
});

it('shows the projected table with each team\'s games won now and at the end', async () => {
  await runAndStore();
  const res = await request(app).get('/admin/team-strength');
  const rows = [...res.text.matchAll(/<tr data-team="([^"]+)">\s*<td>[^<]*<\/td>\s*<td class="ts-num">(\d+) /g)].map(m => [m[1], Number(m[2])]);
  expect(rows).toEqual([['Strong A', 30], ['Weak B', 6]]);
});

it('lists the players linked from another league, and counts its games in', async () => {
  const saved = await runAndStore();
  expect(saved.payload.sources).toEqual({ stockport: 100, tameside: 1, mcrbl: 0 });
  expect(saved.games).toBe(101);
  const res = await request(app).get('/admin/team-strength');
  const tameside = res.text.match(/<div class="col-lg-6" data-league="tameside">([\s\S]*?)<\/table>/)[1];
  expect(tameside).toContain('<td>StrongM 1</td><td>Strong A</td><td class="ts-num">1</td>');
  expect(tameside).not.toContain('Tam One');
});

describe('POST /admin/team-strength/import', () => {
  it('refuses anyone without the token or a superadmin session', async () => {
    mockCurrentUser = null;
    expect((await request(app).post('/admin/team-strength/import')).status).toBe(403);
    expect(ExternalGame.add).not.toHaveBeenCalled();
  });

  it('imports this season\'s Manchester page, and skips Tameside when it is not configured', async () => {
    externalLeagues.fetchMcrblSeason.mockResolvedValue('<table></table>');
    const res = await request(app).post('/admin/team-strength/import');
    expect(res.status).toBe(200);
    expect(externalLeagues.fetchMcrblSeason).toHaveBeenCalledTimes(1);
    expect(externalLeagues.fetchMcrblSeason).toHaveBeenCalledWith(externalLeagues.mcrblSeason());
    expect(res.body).toMatchObject({ ok: true, tameside: { skipped: 'TAMESIDE_DATABASE_URL is not set' },
      mcrbl: [{ season: externalLeagues.mcrblSeason(), cards: 0, games: 0, added: 0 }] });
  });

  it('says so when Manchester\'s page cannot be fetched', async () => {
    externalLeagues.fetchMcrblSeason.mockRejectedValue(new Error('mcrbl.org.uk answered 503 for 2026-27'));
    const res = await request(app).post('/admin/team-strength/import');
    expect(res.status).toBe(502);
    expect(res.body.mcrbl[0].error).toBe('mcrbl.org.uk answered 503 for 2026-27');
  });
});

it('lists each club with its team sheet ratings', async () => {
  await runAndStore();
  const res = await request(app).get('/admin/team-strength');
  expect(res.text).toContain('data-club="Strong"');
  expect(res.text).toContain('<td>StrongM 1</td>');
});

describe('compare', () => {
  it('is superadmin-only', async () => {
    mockCurrentUser = CLUB_ADMIN;
    expect((await request(app).get(`/admin/team-strength/compare?a=${m2.id}&b=${m1.id}`)).status).toBe(403);
  });

  it('offers a picker of this season\'s players before two are chosen', async () => {
    const res = await request(app).get('/admin/team-strength/compare');
    expect(res.status).toBe(200);
    expect(res.text).toContain(`<optgroup label="Strong A">`);
    expect(res.text).toContain(`<option value="${m2.id}">StrongM 2</option>`);
    expect(res.text).not.toContain('What the results say');
    expect(TeamStrength.pairGames).not.toHaveBeenCalled();
  });

  it('sets out the results for one player above another, with their ratings from the latest run', async () => {
    await runAndStore();
    const res = await request(app).get(`/admin/team-strength/compare?a=${m2.id}&b=${m1.id}&seasons=1`);
    expect(res.status).toBe(200);
    expect(TeamStrength.pairGames).toHaveBeenCalledWith([m2.id, m1.id], [SEASON]);
    expect(res.text).toContain('StrongM 2 above StrongM 1');
    expect(res.text).toMatch(/<p class="mb-0" data-rating>\s*Ratings: <strong>StrongM 2 \d{4}<\/strong>/);
    expect(res.text).toContain('<li class="mb-2" data-finding="nights" data-favours="a">');
    expect(res.text).toContain('On the 4 nights both played for Strong A, StrongM 2 won 4 of 4 games (68% of points) and StrongM 1 won 0 of 4 games (40% of points)');
    expect(res.text).toMatch(/<textarea[^>]*id="case-text"[^>]*>StrongM 2 above StrongM 1: the results \(this season, level doubles\)/);
    expect(res.text).toContain(`<a href="/scorecard/fixture/903">2026-10-01</a>`);
  });

  it('refuses a man against a lady', async () => {
    const res = await request(app).get(`/admin/team-strength/compare?a=${m1.id}&b=${home[3].id}`);
    expect(res.text).toContain('Pick two men or two ladies');
    expect(TeamStrength.pairGames).not.toHaveBeenCalled();
  });

  it('stores player ids in the run, so each order flag links to its case', async () => {
    const saved = await runAndStore();
    const strongA = saved.payload.checks.find(c => c.name === 'Strong').teams[0];
    expect(strongA.men.nominated.map(p => p.id)).toEqual([m1.id, m2.id, m3.id]);
  });

  it('links an order flag to the case for it', async () => {
    const saved = await runAndStore();
    const payload = JSON.parse(JSON.stringify(saved.payload));
    payload.checks[0].flags.push({ kind: 'order', gender: 'men', team: 'Strong A', text: 'StrongM 2 (man 2) looks stronger than StrongM 1 (man 1)',
      p: 0.9, stronger: 1600, weaker: 1500, strongerId: m2.id, weakerId: m1.id });
    TeamStrength.latest.mockResolvedValue({ ...(await TeamStrength.latest()), payload });
    const res = await request(app).get('/admin/team-strength');
    expect(res.text).toContain(`<a class="small ts-case" href="/admin/team-strength/compare?a=${m2.id}&amp;b=${m1.id}">The results</a>`);
  });
});
