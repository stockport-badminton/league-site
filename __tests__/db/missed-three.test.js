// Players.getMissedThreePlayers against a real Postgres (REARCH-01): nominated players who
// have not appeared in any of their team's last three completed matches this season.
//
// Ported from __tests__/unit/missed-three-query.test.js, which read the statement out of a
// mocked db_connect. Here the situation is built and the rule run against it. Passed
// against the string query first, then unchanged against the typed one.
const db = require('../../db_connect');
const Player = require('../../models/players');
const Season = require('../../models/season');

const run = (text, params) => db.otherConnect().then(c => c.query(text, params)).then(([r]) => [...r]);

// A club with three teams, so A and B each have a team beneath them to promote from.
const A = 1001, B = 1002, C = 1003, OPP = 1004;
const P = n => 40000 + n;
let CLUB;

beforeEach(async () => {
  await run(`INSERT INTO season (id, name, "startDate", "endDate", label)
    SELECT 1001, ?, now() - interval '60 days', now() + interval '300 days', 'test'
    WHERE NOT EXISTS (SELECT 1 FROM season WHERE name = ?)`, [Season.current(), Season.current()]);
  const [club] = await run('SELECT id, venue FROM club WHERE venue IS NOT NULL AND id <> 63 ORDER BY id LIMIT 1');
  CLUB = club.id;
  await run(`INSERT INTO club (id, name, venue) VALUES (1001, 'Missed Three BC', ?)`, [club.venue]);
  await run(`INSERT INTO team (id, name, club, venue, rank) VALUES
    (${A}, 'Missed A', 1001, ${club.venue}, 1), (${B}, 'Missed B', 1001, ${club.venue}, 2),
    (${C}, 'Missed C', 1001, ${club.venue}, 3), (${OPP}, 'Opponent X', ${CLUB}, ${club.venue}, 1)`);

  const player = (n, team, gender, rank) => run(
    `INSERT INTO player (id, first_name, family_name, gender, club, team, rank) VALUES (?, 'P', ?, ?, 1001, ?, ?)`,
    [P(n), `Missed${n}`, gender, team, rank]);
  // A's nominated men 1-4 and ladies 11-13; 4 never plays. 5 is a reserve, 6 has no rank.
  for (const [n, r] of [[1, 1], [2, 2], [3, 3], [4, 4]]) await player(n, A, 'Male', r);
  await player(5, A, 'Male', 99);
  await player(6, A, 'Male', null);
  for (const [n, r] of [[11, 1], [12, 2], [13, 3]]) await player(n, A, 'Female', r);
  await player(21, B, 'Male', 1);   // B's player, borrowed into A's third man's slot
  await player(31, B, 'Male', 2);   // B's nominated man, who never plays

  // A's last three completed matches this season use two of its own men and B's 21, so A
  // has NOT fielded three of its own men — which is when the rule applies at all.
  const fixture = (id, home, days, men, ladies, status = 'complete') => run(
    `INSERT INTO fixture (id, "homeTeam", "awayTeam", date, status, "homeScore", "awayScore",
       "homeMan1", "homeMan2", "homeMan3", "homeLady1", "homeLady2", "homeLady3")
     VALUES (?, ?, ?, date_trunc('day', now()) - make_interval(days => ?), ?, 10, 8, ?, ?, ?, ?, ?, ?)`,
    [id, home, OPP, days, status, ...men, ...ladies]);
  const ladies = [P(11), P(12), P(13)];
  await fixture(1001, A, 10, [P(1), P(2), P(21)], ladies);
  await fixture(1002, A, 20, [P(1), P(2), P(21)], ladies);
  await fixture(1003, A, 30, [P(2), P(1), P(21)], ladies);
  // Before the season started: 4 played here, and it must not count.
  await fixture(1004, A, 400, [P(4), P(3), P(21)], ladies);
  // B has played only twice this season.
  await fixture(1005, B, 10, [P(21), P(21), P(21)], ladies);
  await fixture(1006, B, 20, [P(21), P(21), P(21)], ladies);
});

const mine = async () => (await Player.getMissedThreePlayers())
  .filter(r => [A, B, C].includes(r.team_id))
  .map(r => ({ team: r.team_id, player: r.playerID - 40000, played: Number(r.numPlayed), next: r.next_team_name }));

describe('getMissedThreePlayers', () => {
  it('lists the nominated players who missed all three, with the team beneath to promote from', async () => {
    expect(await mine()).toEqual([
      { team: A, player: 3, played: 0, next: 'Missed B' },
      { team: A, player: 4, played: 0, next: 'Missed B' },
      { team: A, player: 6, played: 0, next: 'Missed B' },
    ]);
  });

  it('only counts matches inside the current season', async () => {
    // Fixture 1004 is last season's, and 3 and 4 played in it; they are still listed.
    expect((await mine()).map(r => r.player)).toEqual(expect.arrayContaining([3, 4]));
  });

  it('treats a NULL rank as nominated, and a reserve (99+) as not', async () => {
    const players = (await mine()).map(r => r.player);
    expect(players).toContain(6);
    expect(players).not.toContain(5);
  });

  it('leaves out a team that has not played three matches this season', async () => {
    expect((await mine()).some(r => r.team === B)).toBe(false);
  });

  it('leaves out a team that fielded three of its own men and three of its own ladies', async () => {
    await run(`UPDATE fixture SET "homeMan3" = ? WHERE id IN (1001, 1002, 1003)`, [P(3)]);
    expect(await mine()).toEqual([]);
  });

  it('never treats the No Club holding pen as a club', async () => {
    expect((await Player.getMissedThreePlayers()).some(r => r.club === 63)).toBe(false);
  });
});
