// The live scorecard's rules (utils/liveScorecard.js). The ones that matter most are the
// ones it shares with the paper-card path: a card that signs off a score or a line-up the
// draft path would refuse becomes a draft the results secretary cannot publish.

const live = require('../../utils/liveScorecard');

function fullCard() {
  const players = {};
  live.SLOTS.forEach((s, i) => { players[s] = 100 + i; });
  const games = {};
  live.GAMES.forEach(g => { games[String(g.n)] = g.n % 3 ? { h: 21, a: 15 } : { h: 18, a: 21 }; });
  return { players, games };
}

describe('game layout', () => {
  test('18 games, two per pairing, in the order the paper card uses', () => {
    expect(live.GAMES).toHaveLength(18);
    expect(live.GAMES.map(g => g.type)).toEqual([
      'FirstMens', 'FirstMens', 'FirstLadies', 'FirstLadies', 'SecondMens', 'SecondMens',
      'SecondLadies', 'SecondLadies', 'ThirdMens', 'ThirdMens', 'ThirdLadies', 'ThirdLadies',
      'FirstMixed', 'FirstMixed', 'SecondMixed', 'SecondMixed', 'ThirdMixed', 'ThirdMixed',
    ]);
  });

  test('pairings match scorecardController gameObject', () => {
    const byType = {};
    live.GAMES.forEach(g => { byType[g.type] = g.home.concat(g.away); });
    expect(byType.SecondMens).toEqual(['homeMan1', 'homeMan3', 'awayMan1', 'awayMan3']);
    expect(byType.ThirdLadies).toEqual(['homeLady2', 'homeLady3', 'awayLady2', 'awayLady3']);
    expect(byType.SecondMixed).toEqual(['homeMan2', 'homeLady2', 'awayMan2', 'awayLady2']);
  });

  test('every game type is one the game table accepts', () => {
    const allowed = ['FirstMens', 'SecondMens', 'ThirdMens', 'FirstLadies', 'SecondLadies',
      'ThirdLadies', 'FirstMixed', 'SecondMixed', 'ThirdMixed'];
    live.GAMES.forEach(g => expect(allowed).toContain(g.type));
  });
});

describe('scoreProblem — the draft path\'s rules', () => {
  test.each([
    [21, 0], [21, 19], [23, 21], [30, 29], [29, 30], [0, 21], [25, 23],
  ])('%i-%i is accepted', (h, a) => expect(live.scoreProblem(h, a)).toBeNull());

  test.each([
    [20, 18, 'reach 21'], [21, 20, 'two-point'], [21, 21, 'two-point'],
    [31, 29, '0 to 30'], [-1, 21, '0 to 30'], [21.5, 10, '0 to 30'], [NaN, 21, '0 to 30'],
  ])('%i-%i is refused', (h, a, why) => expect(live.scoreProblem(h, a)).toMatch(why));
});

describe('parseGame', () => {
  test('both blank clears', () => expect(live.parseGame({ home: '', away: '' })).toEqual({ clear: true }));
  test('numeric strings parse', () => expect(live.parseGame({ home: '21', away: '17' })).toEqual({ h: 21, a: 17 }));
  test('one half blank is an error, not a clear', () => {
    expect(live.parseGame({ home: '21', away: '' }).error).toBeTruthy();
  });
});

describe('problems — readiness to sign', () => {
  test('a complete card has none', () => expect(live.problems(fullCard())).toEqual([]));

  test('empty slots and missing games are both reported', () => {
    const p = live.problems({ players: {}, games: {} });
    expect(p.join('|')).toMatch(/12 player slots/);
    expect(p.join('|')).toMatch(/18 of 18 games/);
  });

  test('No Player (0) may appear more than once on a side', () => {
    const card = fullCard();
    card.players.homeLady2 = 0;
    card.players.homeLady3 = 0;
    expect(live.problems(card)).toEqual([]);
  });

  test('a real player twice on one side is refused', () => {
    const card = fullCard();
    card.players.awayMan3 = card.players.awayMan1;
    expect(live.problems(card).join()).toMatch(/twice for the away side/);
  });

  test('the same player id on opposite sides is not a duplicate', () => {
    const card = fullCard();
    card.players.awayMan1 = card.players.homeMan1;
    expect(live.problems(card)).toEqual([]);
  });

  test('a stored score that breaks the rules counts as unplayed', () => {
    const card = fullCard();
    card.games['7'] = { h: 21, a: 20 };
    expect(live.problems(card).join()).toMatch(/1 of 18 games/);
  });
});

describe('tally', () => {
  test('games and points so far', () => {
    const t = live.tally({ 1: { h: 21, a: 10 }, 2: { h: 15, a: 21 }, 3: { h: 21, a: 19 } });
    expect(t).toMatchObject({ home: 2, away: 1, played: 3, homePoints: 57, awayPoints: 50 });
  });
});

describe('toDraftRow', () => {
  const ctx = { dateText: '2026-10-08 00:00:00', divisionId: 7, homeTeamId: 10, awayTeamId: 11 };

  test('copies slots, mirrors mixed slots, and fills all 36 scores', () => {
    const card = fullCard();
    const row = live.toDraftRow(card, ctx, { email: 'c@example.com', confirmToken: 'tok' });
    expect(row).toMatchObject({ date: '2026-10-08 00:00:00', division: 7, homeTeam: 10, awayTeam: 11,
      email: 'c@example.com', confirmToken: 'tok', 'scoresheet-url': '' });
    expect(row.SecondMixedhomeLady2).toBe(card.players.homeLady2);
    expect(row.ThirdMixedawayMan3).toBe(card.players.awayMan3);
    for (let n = 1; n <= 18; n++) {
      expect(Number.isInteger(row['Game' + n + 'homeScore'])).toBe(true);
      expect(Number.isInteger(row['Game' + n + 'awayScore'])).toBe(true);
    }
  });

  // Every key must be a real scorecardstore column; createScorecard builds its INSERT
  // from them. 4 + 12 + 12 + 36 + url + email + token.
  test('produces exactly the columns a draft has', () => {
    const row = live.toDraftRow(fullCard(), ctx, { confirmToken: 'x' });
    expect(Object.keys(row)).toHaveLength(67);
  });
});

describe('publicState', () => {
  test('never carries a token', () => {
    const card = Object.assign(fullCard(), {
      id: 1, rev: 3, version: 2, status: 'live',
      edit_token: 'EDIT', home_token: 'HOME', away_token: 'AWAY',
    });
    const json = JSON.stringify(live.publicState(card));
    expect(json).not.toMatch(/EDIT|HOME|AWAY/);
  });
});

describe('cleanName', () => {
  test('trims, collapses, strips control characters and caps', () => {
    expect(live.cleanName('  Neil\n  Cooper ')).toBe('Neil Cooper');
    expect(live.cleanName('x'.repeat(100))).toHaveLength(40);
    expect(live.cleanName(42)).toBe('');
  });
});
