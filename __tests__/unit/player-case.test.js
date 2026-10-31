// utils/playerCase.js: the results behind putting one player above another.
const playerCase = require('../../utils/playerCase');

const A = { id: 1, name: 'Amy A' }, B = { id: 2, name: 'Bea B' };
const NAMES = { 1: 'Amy A', 2: 'Bea B', 3: 'Pat Partner', 7: 'Opp Seven', 8: 'Opp Eight', 9: 'Opp Nine', 4: 'Ann Four', 5: 'Bo Five' };
const nameOf = id => NAMES[id] || String(id);

let fixture = 0;
// One game: home pair v away pair, in a fixture between two teams.
const game = (fixtureId, home, away, hs, as, extra = {}) => ({
  league: 'stockport', fixture: fixtureId, date: '2026-10-01', season: '20262027', mixed: false,
  home: { name: 'Club A', division: 'Division 1', players: home },
  away: { name: 'Rivals A', division: 'Division 1', players: away }, hs, as, ...extra,
});

// `n` nights on which both played for Club A: Amy with Pat beats Seven and Eight, Bea with Pat
// loses to Seven and Nine, and the game Amy and Bea play together is a big loss.
function nights(n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const f = ++fixture;
    out.push(game(f, [1, 3], [7, 8], 21, 12), game(f, [2, 3], [7, 9], 15, 21), game(f, [1, 2], [8, 9], 2, 21));
  }
  return out;
}

it('compares the two on the nights they played for the same team, leaving out the games they played together', () => {
  const c = playerCase.build(A, B, nights(4), nameOf);
  expect(c.nights).toHaveLength(4);
  expect(c.nightTotal.a).toEqual({ won: 4, played: 4, for: 84, against: 48 });
  expect(c.nightTotal.b).toEqual({ won: 0, played: 4, for: 60, against: 84 });
  expect(c.findings.find(f => f.key === 'nights')).toMatchObject({ favours: 'a' });
  expect(c.findings.find(f => f.key === 'nights').text)
    .toBe('On the 4 nights both played for Club A, Amy A won 4 of 4 games (64% of points) and Bea B won 0 of 4 games (42% of points), against the same opposition.');
});

it('compares them with the partners and against the opponents they have in common', () => {
  const c = playerCase.build(A, B, nights(4), nameOf);
  expect(c.partners.map(p => [p.name, p.a.won, p.b.won])).toEqual([['Pat Partner', 4, 0]]);
  expect(c.opponents.map(p => p.name)).toEqual(['Opp Seven']);
  expect(c.findings.find(f => f.key === 'partners').favours).toBe('a');
  expect(c.findings.find(f => f.key === 'opponents').favours).toBe('a');
});

it('says it cannot tell with too few games', () => {
  const c = playerCase.build(A, B, nights(1), nameOf);
  expect(c.findings.find(f => f.key === 'nights').favours).toBe('thin');
  expect(c.findings.find(f => f.key === 'headToHead')).toMatchObject({ favours: 'thin', text: 'They have not played against each other.' });
});

it('compares partner by partner, so playing more often with a stronger partner does not count', () => {
  const games = [];
  // Both do exactly as well with each partner; Amy mostly plays with the weaker one.
  for (let i = 0; i < 4; i++) games.push(game(++fixture, [1, 3], [7, 8], 21, 15), game(++fixture, [2, 4], [7, 8], 15, 21));
  for (let i = 0; i < 40; i++) games.push(game(++fixture, [1, 4], [7, 8], 15, 21), game(++fixture, [2, 3], [7, 8], 21, 15));
  const c = playerCase.build(A, B, games, nameOf);
  expect(c.partnerSum).toEqual({ weight: 8, a: c.partnerSum.b, b: c.partnerSum.b });
  expect(c.findings.find(f => f.key === 'partners').favours).toBe('even');
  expect(c.findings.find(f => f.key === 'overall').favours).toBe('b'); // the raw record says Bea
});

it('reads the head to head from the first player\'s side', () => {
  const games = [1, 2, 3, 4].map(() => game(++fixture, [2, 5], [1, 4], 14, 21));
  const c = playerCase.build(A, B, games, nameOf);
  expect(c.headToHead.rec).toEqual({ won: 4, played: 4, for: 84, against: 56 });
  expect(c.headToHead.games[0]).toMatchObject({ pair: ['Amy A', 'Ann Four'], against: ['Bea B', 'Bo Five'], score: '21–14' });
  expect(c.findings.find(f => f.key === 'headToHead').favours).toBe('a');
});

it('keeps mixed games and other leagues out of the Stockport comparisons, reporting them separately', () => {
  const games = [
    ...nights(4),
    game(++fixture, [2, 3], [7, 8], 21, 3, { mixed: true }),
    ...[1, 2, 3, 4].map(() => game(null, [2, 'tameside:x'], ['tameside:y', 'tameside:z'], 21, 10, { league: 'tameside', season: null })),
  ];
  const c = playerCase.build(A, B, games, nameOf);
  expect(c.overall.b.played).toBe(8); // four nights, two games each with Bea in them
  expect(c.mixed.b).toMatchObject({ won: 1, played: 1 });
  expect(c.leagues).toEqual([{ league: 'tameside', a: { won: 0, played: 0, for: 0, against: 0 }, b: { won: 4, played: 4, for: 84, against: 40 } }]);
  expect(c.findings.find(f => f.key === 'other:tameside')).toMatchObject({ favours: 'thin',
    text: 'In the Tameside league, Amy A has no games and Bea B won 4 of 4 games (68% of points).' });
});

it('lays out the case for sending: for, against, level and the sections too thin to count', () => {
  const games = [...nights(4), ...[1, 2, 3, 4].map(() => game(++fixture, [2, 5], [1, 4], 21, 14))];
  const text = playerCase.caseText(playerCase.build(A, B, games, nameOf),
    { window: 'this season', rating: { a: 1650, b: 1540, p: 0.91 } });
  expect(text.split('\n').slice(0, 4)).toEqual([
    'Amy A above Bea B: the results (this season, level doubles)', '',
    'Ratings: Amy A 1650, Bea B 1540; 91% likely Amy A is the stronger player.', '']);
  expect(text).toMatch(/\nFor:\n- On the 4 nights/);
  expect(text).toMatch(/\nAgainst:\n- Across the net from each other, Amy A won 0 of 4 games/);
  expect(text).not.toContain('Too few games');
});
