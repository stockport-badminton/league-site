// models/teamStrength.js against a real Postgres: what the nightly strength run reads,
// and how it keeps its record.
const db = require('../../db_connect');
const TeamStrength = require('../../models/teamStrength');
const Season = require('../../models/season');

const run = (text, params) => db.otherConnect().then(c => c.query(text, params)).then(([r]) => [...r]);

const HOME = 1001, AWAY = 1002, GONE = 1003;
const P = { hm1: 90001, hm2: 90002, am1: 90003, am2: 90004 };
let DIVISION, CLUB;

beforeEach(async () => {
  await run(`INSERT INTO season (id, name, "startDate", "endDate", label)
    SELECT 1001, ?, now() - interval '30 days', now() + interval '300 days', 'test'
    WHERE NOT EXISTS (SELECT 1 FROM season WHERE name = ?)`, [Season.current(), Season.current()]);
  [CLUB] = await run('SELECT id, venue FROM club WHERE venue IS NOT NULL AND id <> 63 ORDER BY id LIMIT 1');
  [DIVISION] = await run(`INSERT INTO division (id, name, league, rank) VALUES (1001, 'Strength Division', 1, 7)
    RETURNING id, rank`);
  await run(`INSERT INTO team (id, name, club, venue, rank, division, "divRank", penalties, withdrawn) VALUES
    (${HOME}, 'Strength Home A', ${CLUB.id}, ${CLUB.venue}, 1, ${DIVISION.id}, 1, 0, NULL),
    (${AWAY}, 'Strength Home B', ${CLUB.id}, ${CLUB.venue}, 2, ${DIVISION.id}, 2, 0, NULL),
    (${GONE}, 'Strength Withdrawn', ${CLUB.id}, ${CLUB.venue}, 3, ${DIVISION.id}, 3, 0, now())`);
  const player = (id, gender, team, rank) => run(`INSERT INTO player (id, first_name, family_name, gender, team, club, rank)
    VALUES (?, 'Test', ?, ?, ?, ?, ?)`, [id, `Player${id}`, gender, team, CLUB.id, rank]);
  await player(P.hm1, 'Male', HOME, 1);
  await player(P.hm2, 'Male', HOME, 2);
  await player(P.am1, 'Male', AWAY, 1);
  await player(P.am2, 'Male', AWAY, 99);
  await player(90005, 'Male', GONE, 1);

  await run(`INSERT INTO fixture (id, "homeTeam", "awayTeam", date, status, "homeScore", "awayScore") VALUES
    (1001, ?, ?, date_trunc('day', now()) - interval '7 days', 'complete', 11, 7),
    (1002, ?, ?, date_trunc('day', now()) + interval '2 days', 'outstanding', NULL, NULL),
    (1003, ?, ?, date_trunc('day', now()) + interval '20 days', 'outstanding', NULL, NULL),
    (1004, ?, ?, date_trunc('day', now()) + interval '3 days', 'void', NULL, NULL),
    (1005, ?, ?, date_trunc('day', now()) + interval '4 days', 'rearranged', NULL, NULL)`,
  [HOME, AWAY, AWAY, HOME, HOME, AWAY, HOME, AWAY, HOME, AWAY]);
  const game = (fixture, h2, score) => run(`INSERT INTO game (fixture, "gameType", "homePlayer1", "homePlayer2", "awayPlayer1", "awayPlayer2",
      "homeScore", "awayScore", "homePlayer1Start", "homePlayer2Start", "awayPlayer1Start", "awayPlayer2Start")
    VALUES (?, 'FirstMens', ?, ?, ?, ?, ?, ?, 0, 0, 0, 0)`, [fixture, P.hm1, h2, P.am1, P.am2, ...score]);
  await game(1001, P.hm2, [21, 15]);
  await game(1001, null, [21, 0]);
});

describe('games', () => {
  it('returns scored games with all four players, with their season', async () => {
    const rows = (await TeamStrength.games()).filter(g => g.homePlayer1 === P.hm1);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ fixture: 1001, gameType: 'FirstMens', homePlayer2: P.hm2, awayPlayer2: P.am2,
      homeScore: 21, awayScore: 15, homeTeam: HOME, awayTeam: AWAY, season: Season.current() });
    expect(rows[0].date).toBeInstanceOf(Date);
  });
});

describe('registrations', () => {
  it('gives each player this season their name and the rank of their team\'s division', async () => {
    const rows = (await TeamStrength.registrations()).filter(r => r.season === Season.current() && r.id === P.hm1);
    expect(rows).toEqual([{ season: Season.current(), id: P.hm1, gender: 'Male', first_name: 'Test',
      family_name: `Player${P.hm1}`, divRank: DIVISION.rank }]);
  });
});

describe('squads', () => {
  it('lists the playing teams with their club and players, leaving out a withdrawn team', async () => {
    const { teams, players } = await TeamStrength.squads();
    const ours = teams.filter(t => t.clubId === CLUB.id && [HOME, AWAY, GONE].includes(t.id));
    expect(ours.map(t => [t.name, t.rank, t.divisionRank])).toEqual([['Strength Home A', 1, 7], ['Strength Home B', 2, 7]]);
    expect(players.filter(p => [HOME, AWAY].includes(p.team)).map(p => [p.id, p.team, p.rank]).sort())
      .toEqual([[P.hm1, HOME, 1], [P.hm2, HOME, 2], [P.am1, AWAY, 1], [P.am2, AWAY, 99]].sort());
    expect(players.some(p => p.team === GONE)).toBe(false);
  });
});

describe('remainingFixtures', () => {
  it('lists unplayed fixtures, marks the coming week, and leaves out void and rearranged ones', async () => {
    const rows = (await TeamStrength.remainingFixtures()).filter(f => f.id >= 1001 && f.id <= 1005);
    expect(rows.map(f => [f.id, f.homeTeam, f.awayTeam, f.thisWeek])).toEqual([[1002, AWAY, HOME, true], [1003, HOME, AWAY, false]]);
    expect(rows[0].dayLabel).toMatch(/^[A-Z][a-z]{2} \d{1,2} [A-Z][a-z]{2}$/);
  });
});

describe('save and latest', () => {
  it('returns the newest run with its payload as an object', async () => {
    expect(await TeamStrength.latest()).toBeNull();
    await TeamStrength.save({ season: Season.current(), caller: 'test', games: 1, tookMs: 5, payload: { n: 1 } });
    await TeamStrength.save({ season: Season.current(), caller: 'test', games: 2, tookMs: 5, payload: { n: 2, list: [1, 2] } });
    expect(await TeamStrength.latest()).toMatchObject({ games: 2, caller: 'test', payload: { n: 2, list: [1, 2] } });
  });

  it(`keeps only the last ${TeamStrength.KEEP_RUNS} runs`, async () => {
    for (let n = 1; n <= TeamStrength.KEEP_RUNS + 2; n++) {
      await TeamStrength.save({ season: Season.current(), caller: 'test', games: n, tookMs: 1, payload: { n } });
    }
    const rows = await run('SELECT games FROM strength_run ORDER BY id');
    expect(rows.map(r => r.games)).toEqual(Array.from({ length: TeamStrength.KEEP_RUNS }, (_, i) => i + 3));
  });
});
