// utils/teamStrength.js: the points-based rating, fixture predictions, the season
// projection and the team order checks.
const M = require('../../utils/teamStrength');
const { usableGame } = require('../../controllers/teamStrengthController');

const DAY = 86400000;
const NOW = Date.parse('2026-10-31');

// A deterministic generator for the synthetic leagues below.
function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// Plays rally by rally to 21 (two clear, cap 30) at rally-win probability p.
function playGame(p, rand) {
  let a = 0, b = 0;
  for (;;) {
    if (rand() < p) a++; else b++;
    if ((a >= 21 && a - b >= 2) || a === 30) return [a, b];
    if ((b >= 21 && b - a >= 2) || b === 30) return [a, b];
  }
}

// A league of men with known strengths, playing random doubles over a year.
function league(strengths, nGames, seed, at = () => NOW - 100 * DAY) {
  const rand = rng(seed), ids = Object.keys(strengths).map(Number), games = [];
  for (let i = 0; i < nGames; i++) {
    const pick = [];
    while (pick.length < 4) { const p = ids[Math.floor(rand() * ids.length)]; if (!pick.includes(p)) pick.push(p); }
    const [h1, h2, a1, a2] = pick;
    const x = strengths[h1] + strengths[h2] - strengths[a1] - strengths[a2];
    const [hs, as] = playGame(M.sig(x), rand);
    games.push({ t: at(i), mixed: false, h1, h2, a1, a2, hs, as });
  }
  return games;
}

const male = () => 'Male';
const noDivision = () => null;
const slot = (s, name = 'P', mx = 0) => ({ id: null, name, s, mx });
const lineup = (men, ladies = men) => ({ men: men.map((s, i) => slot(s, `M${i + 1}`)), ladies: ladies.map((s, i) => slot(s, `L${i + 1}`)) });

describe('gameWin', () => {
  it('is even at even rallies and turns small rally edges into big game edges', () => {
    expect(M.gameWin(0.5)).toBeCloseTo(0.5, 6);
    expect(M.gameWin(0.55)).toBeGreaterThan(0.72);
    expect(M.gameWin(0.55)).toBeLessThan(0.78);
    expect(M.gameWin(0.45)).toBeCloseTo(1 - M.gameWin(0.55), 6);
  });
});

describe('fit', () => {
  const TRUE = { 1: 0.3, 2: 0.15, 3: 0.05, 4: 0, 5: -0.05, 6: -0.15, 7: -0.3, 8: 0.1 };

  it('recovers the order of known strengths from simulated games', () => {
    const fit = M.fit(league(TRUE, 1500, 7), NOW, male, noDivision);
    const byFit = Object.keys(TRUE).map(Number).sort((a, b) => fit.s.get(b) - fit.s.get(a));
    const byTruth = Object.keys(TRUE).map(Number).sort((a, b) => TRUE[b] - TRUE[a]);
    expect(byFit).toEqual(byTruth);
    // and the size of the gaps, not just the order
    expect(fit.s.get(1) - fit.s.get(7)).toBeGreaterThan(0.45);
    expect(fit.s.get(1) - fit.s.get(7)).toBeLessThan(0.75);
  });

  it('is surer of a player with more games', () => {
    const games = league(TRUE, 1500, 7).filter(g => ![g.h1, g.h2, g.a1, g.a2].includes(8) || g.hs % 4 === 0);
    const fit = M.fit(games, NOW, male, noDivision);
    expect(fit.se.get(8)).toBeGreaterThan(fit.se.get(4));
  });

  it('counts recent games more: a player who got better rates nearer their new level', () => {
    const before = { ...TRUE, 9: -0.3 }, after = { ...TRUE, 9: 0.3 };
    const old = league(before, 1500, 3, () => NOW - 900 * DAY), recent = league(after, 1500, 4, () => NOW - 30 * DAY);
    const fit = M.fit([...old, ...recent], NOW, male, noDivision);
    expect(fit.s.get(9)).toBeGreaterThan(0.1);
  });

  it('starts a player with few games near their division\'s average', () => {
    // Players 1-4 registered in division 1 and strong; 5-8 in division 2 and weak.
    const strong = { 1: 0.3, 2: 0.3, 3: 0.3, 4: 0.3 }, weak = { 5: -0.3, 6: -0.3, 7: -0.3, 8: -0.3 };
    const games = [...league(strong, 300, 1), ...league(weak, 300, 2), ...league({ ...strong, ...weak }, 300, 5)];
    const divisionOf = p => (p <= 4 ? 1 : 2);
    const fit = M.fit(games, NOW, male, divisionOf);
    // Shrunk towards 0 (heavily, with four players a division), but clearly apart.
    expect(fit.mean('Male', 1)).toBeGreaterThan(0.1);
    expect(fit.mean('Male', 2)).toBeLessThan(-0.1);
  });
});

describe('predictFixture', () => {
  it('plays man n with lady n in the mixed and every pair of the three in level doubles', () => {
    const { rubbers } = M.predictFixture(lineup([0, 0, 0]), lineup([0, 0, 0]), 0);
    expect(rubbers.map(r => [r.type, r.home.join('+')])).toEqual([
      ['FirstMens', 'M1+M2'], ['FirstLadies', 'L1+L2'], ['SecondMens', 'M1+M3'], ['SecondLadies', 'L1+L3'],
      ['ThirdMens', 'M2+M3'], ['ThirdLadies', 'L2+L3'], ['FirstMixed', 'M1+L1'], ['SecondMixed', 'M2+L2'], ['ThirdMixed', 'M3+L3'],
    ]);
  });

  it('calls two equal teams evenly, with 9-9 the likeliest score', () => {
    const f = M.predictFixture(lineup([0, 0, 0]), lineup([0, 0, 0]), 0);
    expect(f.pHome).toBeCloseTo(f.pAway, 6);
    expect(f.pHome + f.pDraw + f.pAway).toBeCloseTo(1, 9);
    expect(f.likely).toEqual({ home: 9, away: 9 });
    expect(f.expected).toBeCloseTo(9, 6);
  });

  it('favours the stronger team, and the fixture swing keeps it short of certain', () => {
    const strong = lineup([0.2, 0.2, 0.2]), weak = lineup([0, 0, 0]);
    const swung = M.predictFixture(strong, weak, 0), independent = M.predictFixture(strong, weak, 0, 0);
    expect(swung.pHome).toBeGreaterThan(0.75);
    expect(independent.pHome).toBeGreaterThan(swung.pHome);
    expect(swung.expected).toBeGreaterThan(12);
  });

  it('adds the mixed adjustments only to the mixed games', () => {
    const home = lineup([0, 0, 0]);
    home.men[0].mx = 0.3;
    const { rubbers } = M.predictFixture(home, lineup([0, 0, 0]), 0);
    const p = Object.fromEntries(rubbers.map(r => [r.type, r.p]));
    expect(p.FirstMixed).toBeGreaterThan(0.7);
    expect(p.FirstMens).toBeCloseTo(0.5, 6);
    expect(p.SecondMixed).toBeCloseTo(0.5, 6);
  });
});

describe('usualThree', () => {
  const p = (id, s) => ({ id, name: `P${id}`, s, mx: 0 });
  const [n1, n2, n3, r1, x] = [p(1, 0.1), p(2, 0.2), p(3, 0.05), p(99, 0.3), p(50, 0.0)];

  it('fields the nominated three, strongest first, before anyone has played', () => {
    expect(M.usualThree([n1, n2, n3], [r1], []).map(q => q.id)).toEqual([2, 1, 3]);
  });

  it('fields whoever has played most, then fills from the nominated list in rank order', () => {
    const played = [{ slot: r1, fixtures: 6 }, { slot: x, fixtures: 4 }, { slot: n1, fixtures: 1 }];
    expect(M.usualThree([n1, n2, n3], [r1], played).map(q => q.id)).toEqual([99, 1, 50]);
    expect(M.usualThree([n1, n2, n3], [r1], [{ slot: r1, fixtures: 2 }]).map(q => q.id)).toEqual([99, 2, 1]);
  });

  it('counts a player once though they are nominated and have played', () => {
    expect(M.usualThree([n1, n2], [], [{ slot: n1, fixtures: 3 }]).map(q => q.id)).toEqual([2, 1]);
  });

  it('breaks a tie in fixtures played by strength', () => {
    const played = [{ slot: n3, fixtures: 2 }, { slot: n1, fixtures: 2 }, { slot: n2, fixtures: 2 }, { slot: r1, fixtures: 2 }];
    expect(M.usualThree([], [], played).map(q => q.id)).toEqual([99, 2, 1]);
  });
});

describe('scoreDistribution', () => {
  it('is a distribution over 0..18 games', () => {
    const d = M.scoreDistribution([0.3, 0.4, 0.5, 0.6, 0.7, 0.5, 0.5, 0.5, 0.9]);
    expect(d).toHaveLength(19);
    expect(d.reduce((a, v) => a + v, 0)).toBeCloseTo(1, 9);
  });
});

describe('projectSeason', () => {
  const uncertain = s => ({ men: [0, 1, 2].map(() => ({ ...slot(s), se: 0.05 })), ladies: [0, 1, 2].map(() => ({ ...slot(s), se: 0.05 })) });
  const division = (teams, extra = {}) => ({ id: 1, name: 'Division 1', rank: 2, promotes: true, relegates: true, teams, ...extra });
  const team = (id, gamesWon, divRank = id) => ({ id, name: `T${id}`, divRank, gamesWon, played: 5, remaining: 2 });
  const lineups = new Map([[1, uncertain(0)], [2, uncertain(0)], [3, uncertain(0)], [4, uncertain(0)]]);
  const remaining = [{ home: 1, away: 2 }, { home: 3, away: 4 }, { home: 2, away: 1 }, { home: 4, away: 3 }];

  it('gives each team a distribution over the places, and repeats exactly with the same seed', () => {
    const d = [division([team(1, 60), team(2, 50), team(3, 45), team(4, 40)])];
    const a = M.projectSeason(d, remaining, lineups, 0, { sims: 400 });
    const b = M.projectSeason(d, remaining, lineups, 0, { sims: 400 });
    expect(a).toEqual(b);
    for (const t of a[0].teams) expect(t.positions.reduce((s, v) => s + v, 0)).toBeCloseTo(1, 9);
  });

  it('cannot take the title from a team out of reach', () => {
    const d = [division([team(1, 200), team(2, 50), team(3, 45), team(4, 40)])];
    const [proj] = M.projectSeason(d, remaining, lineups, 0, { sims: 400 });
    const t1 = proj.teams.find(t => t.id === 1);
    expect(t1.pWinner).toBe(1);
    expect(t1.expectedWon).toBeGreaterThanOrEqual(200);
    expect(t1.expectedWon).toBeLessThanOrEqual(236);
  });

  it('promotes nobody from the top division and relegates nobody from the bottom', () => {
    const d = [division([team(1, 60), team(2, 50), team(3, 45), team(4, 40)], { promotes: false, relegates: false })];
    const [proj] = M.projectSeason(d, remaining, lineups, 0, { sims: 200 });
    expect(proj.teams.every(t => t.pUp === 0 && t.pDown === 0)).toBe(true);
  });

  it('plays only fixtures between teams of the same division with lineups', () => {
    const d = [division([team(1, 0), team(2, 0)])];
    const [proj] = M.projectSeason(d, [{ home: 1, away: 3 }, { home: 1, away: 2 }], lineups, 0, { sims: 200 });
    const total = proj.teams.reduce((s, t) => s + t.expectedWon, 0);
    expect(total).toBeCloseTo(18, 9);
  });
});

describe('orderFlags', () => {
  const rated = (name, rank, r, recent = 20) => ({ id: rank, name, rank, r, s: (r - 1500) / 1000, se: 0.03, recent });
  const squad = (nominated, reserves = [], unset = false) => ({ name: '', nominated, reserves, unset });
  const team = (name, men, ladies = squad([])) => ({ name, men, ladies });

  it('flags a lower-nominated player well above a higher one', () => {
    const flags = M.orderFlags([team('A', squad([rated('One', 1, 1500), rated('Two', 2, 1700), rated('Three', 3, 1400)]))]);
    expect(flags.map(f => [f.kind, f.text])).toEqual([['order', 'Two (man 2) looks stronger than One (man 1)']]);
  });

  it('leaves alone a gap it cannot be sure of, and players with few recent games', () => {
    expect(M.orderFlags([team('A', squad([rated('One', 1, 1500), rated('Two', 2, 1520)]))])).toEqual([]);
    expect(M.orderFlags([team('A', squad([rated('One', 1, 1500), rated('Two', 2, 1800, 3)]))])).toEqual([]);
  });

  it('flags a lower team\'s player above a higher team\'s, and a reserve above the third of the team above', () => {
    const a = team('A', squad([rated('A1', 1, 1800), rated('A2', 2, 1750), rated('A3', 3, 1500)]));
    const b = team('B', squad([rated('B1', 1, 1700), rated('B2', 2, 1400), rated('B3', 3, 1300)], [rated('BR', 99, 1650)]));
    const flags = M.orderFlags([a, b]);
    expect(flags.map(f => f.kind).sort()).toEqual(['lowerStronger', 'reserveTooLow']);
    expect(flags.find(f => f.kind === 'reserveTooLow').text).toBe('BR (reserve, B) looks stronger than A\'s man 3, A3');
    expect(flags.find(f => f.kind === 'lowerStronger').text).toBe('B1 (B man 1) looks stronger than A3 (A man 3)');
  });

  it('flags a reserve who rates below the next team down\'s third', () => {
    const a = team('A', squad([rated('A1', 1, 1800), rated('A2', 2, 1750), rated('A3', 3, 1700)], [rated('AR', 99, 1300)]));
    const b = team('B', squad([rated('B1', 1, 1650), rated('B2', 2, 1600), rated('B3', 3, 1550)]));
    expect(M.orderFlags([a, b]).map(f => [f.kind, f.text]))
      .toEqual([['reserveTooHigh', 'AR (reserve, A) looks weaker than B\'s man 3, B3']]);
  });

  it('skips a team whose nominations are not set', () => {
    const unset = team('A', squad([rated('One', 1, 1500), rated('Two', 2, 1800)], [], true));
    expect(M.orderFlags([unset])).toEqual([]);
  });
});

describe('usableGame', () => {
  const g = (over = {}) => ({ homePlayer1: 1, homePlayer2: 2, awayPlayer1: 3, awayPlayer2: 4, homeScore: 21, awayScore: 15, ...over });
  it('keeps a played game and drops walkovers, missing players and the same player twice', () => {
    expect(usableGame(g())).toBe(true);
    expect(usableGame(g({ awayScore: 0 }))).toBe(false);
    expect(usableGame(g({ homePlayer2: null }))).toBe(false);
    expect(usableGame(g({ awayPlayer2: 1 }))).toBe(false);
    expect(usableGame(g({ homeScore: 15, awayScore: 11 }))).toBe(false);
  });
});
