// models/externalGame.js against a real Postgres: other leagues' games for team strength.
const ExternalGame = require('../../models/externalGame');

const game = (over = {}) => ({
  league: 'mcrbl', source_key: '2025-09-03|Home One|Away One|MENS A&B|1', played_on: '2025-09-03',
  game_type: 'MENS A&B', mixed: false, home1: 'Haider Ali', home2: 'Jason Hui', away1: 'Dan Otto', away2: 'Pete Taylor',
  home1_gender: 'Male', home2_gender: 'Male', away1_gender: 'Male', away2_gender: 'Male', home_score: 14, away_score: 21,
  ...over,
});

describe('add', () => {
  it('adds new games and skips ones already held, so an import can be re-run', async () => {
    expect(await ExternalGame.add([game(), game({ source_key: 'second' })])).toBe(2);
    expect(await ExternalGame.add([game(), game({ source_key: 'third' })])).toBe(1);
    expect((await ExternalGame.all()).length).toBe(3);
  });

  it('keeps the same source key apart across leagues', async () => {
    expect(await ExternalGame.add([game(), game({ league: 'tameside' })])).toBe(2);
  });

  it('adds a large import in batches', async () => {
    const rows = Array.from({ length: 1201 }, (_, i) => game({ source_key: `k${i}` }));
    expect(await ExternalGame.add(rows)).toBe(1201);
  });
});

describe('all and summary', () => {
  it('returns games oldest first, with a gender the card did not give as null', async () => {
    await ExternalGame.add([game({ source_key: 'late', played_on: '2026-06-10' }),
      game({ source_key: 'early', played_on: '2024-02-01', home1_gender: null, mixed: true })]);
    const rows = await ExternalGame.all();
    // as text: a summer date must not come back as the day before
    expect(rows.map(r => r.played_on)).toEqual(['2024-02-01', '2026-06-10']);
    expect(rows[0]).toMatchObject({ league: 'mcrbl', mixed: true, home1_gender: null, home_score: 14, away_score: 21 });
  });

  it('counts the games held per league with the latest date', async () => {
    await ExternalGame.add([game(), game({ source_key: 'b', played_on: '2026-10-28' }), game({ league: 'tameside' })]);
    const s = await ExternalGame.summary();
    expect(s.map(r => [r.league, Number(r.games), r.latest]))
      .toEqual([['mcrbl', 2, '2026-10-28'], ['tameside', 1, '2025-09-03']]);
  });
});
