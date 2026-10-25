// models/players.js's searches against a real Postgres (REARCH-01).
//
// Ported from __tests__/unit/player-search.test.js and the `search` and `getById` cases of
// players-sql-binding.test.js, which captured the SQL a faked db_connect was sent. What
// those pinned was behaviour — a player who exists must be found — so it is asserted here
// on rows. Passed against the string queries first, then unchanged against the typed ones.
const db = require('../../db_connect');
const Player = require('../../models/players');

const run = (text, params) => db.otherConnect().then(c => c.query(text, params)).then(([r]) => [...r]);

const TEAM = 1001;
let CLUB, CLUB_NAME, DIVISION_NAME;

beforeEach(async () => {
  const [club] = await run('SELECT id, name, venue FROM club WHERE venue IS NOT NULL AND id <> 63 ORDER BY id LIMIT 1');
  const [division] = await run('SELECT id, name FROM division ORDER BY id LIMIT 1');
  [CLUB, CLUB_NAME, DIVISION_NAME] = [club.id, club.name, division.name];
  await run(`INSERT INTO team (id, name, club, venue, rank, division) VALUES (?, 'Searchable A', ?, ?, 1, ?)`,
    [TEAM, CLUB, club.venue, division.id]);
});

async function player(id, first, family, gender = 'Male', team = TEAM, club = CLUB) {
  await run('INSERT INTO player (id, first_name, family_name, gender, club, team, rank) VALUES (?, ?, ?, ?, ?, ?, 1)',
    [id, first, family, gender, club, team]);
}

describe('searchPlayers', () => {
  // 378 of 1,107 rows had stray whitespace, almost always in front of family_name, so
  // "Chris Petty" typed by a human matched nothing.
  it('finds a stored name with stray spaces, from what a person types, and returns it tidied', async () => {
    await player(20001, 'Chrisx', '  Pettyq ');
    for (const typed of ['Chrisx Pettyq', '  chrisx   pettyq ']) {
      const rows = await Player.searchPlayers(typed, {});
      expect(rows.map(r => r.id)).toContain(20001);
      expect(rows.find(r => r.id === 20001).name).toBe('Chrisx Pettyq');
    }
  });

  it('sorts a listing on the trimmed surname, so " Petty" files under P', async () => {
    await player(20001, 'A', ' Pqzz');
    await player(20002, 'B', 'Aqzz');
    await player(20003, 'C', 'Zqzz');
    const rows = await Player.searchPlayers('', { team: 'Searchable A' });
    expect(rows.map(r => r.id)).toEqual([20002, 20001, 20003]);
  });

  // The joins exist only for the filters. When they were INNER, team 52 "No Team" (division
  // 0, which no division row has) hid 490 players — a returning member could not be found.
  it('still finds a player whose team, club or division resolves to nothing', async () => {
    await run(`INSERT INTO team (id, name, club, venue, rank, division) SELECT 1002, 'Orphan A', ?, venue, 1, 999999 FROM club WHERE id = ?`, [CLUB, CLUB]);
    await player(20004, 'Returning', 'Memberqx', 'Female', 1002);
    await player(20005, 'Teamless', 'Memberqx', 'Female', null);
    const ids = (await Player.searchPlayers('Memberqx', {})).map(r => r.id);
    expect(ids).toEqual(expect.arrayContaining([20004, 20005]));
  });

  it('applies each filter it is given', async () => {
    await player(20001, 'Fil', 'Terqx', 'Male');
    await player(20002, 'Fil', 'Terqx', 'Female');
    const by = async f => (await Player.searchPlayers('Fil Terqx', f)).map(r => r.id).sort();
    expect(await by({})).toEqual([20001, 20002]);
    expect(await by({ gender: 'Female' })).toEqual([20002]);
    expect(await by({ club: CLUB_NAME, team: 'Searchable A', division: DIVISION_NAME })).toEqual([20001, 20002]);
    expect(await by({ club: 'Nowhere BC' })).toEqual([]);
    expect(await by({ team: 'Other Team' })).toEqual([]);
  });

  it('caps a listing at 20 in SQL, and a name search at 20 after ranking', async () => {
    for (let i = 0; i < 25; i++) await player(20100 + i, `Cap${i}`, 'Capqx');
    expect(await Player.searchPlayers('', { team: 'Searchable A' })).toHaveLength(20);
    expect((await Player.searchPlayers('Capqx', {})).length).toBeLessThanOrEqual(20);
  });

  it('finds a misspelt name', async () => {
    await player(20001, 'Marry', 'Whitleqx', 'Female');
    expect((await Player.searchPlayers('Mary Whitleqx', {})).map(r => r.id)).toContain(20001);
  });
});

// Unrouted today (player_list has no route), but it took req.params whole and pasted
// gender, teamid and clubid into the statement.
describe('search', () => {
  it('filters by team, gender and club, ordered by gender then rank', async () => {
    await player(20001, 'One', 'Sq', 'Male');
    await player(20002, 'Two', 'Sq', 'Female');
    const rows = await Player.search({ teamid: TEAM });
    expect(rows.map(r => r.id)).toEqual([20002, 20001]);
    expect((await Player.search({ teamid: TEAM, gender: 'Male', clubid: CLUB })).map(r => r.id)).toEqual([20001]);
  });

  it('binds hostile terms as values: they match nothing, or are refused as not an integer', async () => {
    await player(20001, 'One', 'Sq', 'Male');
    expect([...await Player.search({ gender: "x' OR '1'='1" })]).toEqual([]);
    await expect(Player.search({ teamid: '4 OR 1=1' })).rejects.toThrow(/invalid input syntax for type integer/);
  });
});

describe('getById', () => {
  it('decrypts the contact details with the bound key', async () => {
    await player(20001, 'Contact', 'Able');
    await run('UPDATE player SET "playerEmail" = pgp_sym_encrypt(?, ?), "playerTel" = pgp_sym_encrypt(?, ?) WHERE id = 20001',
      ['contact@example.invalid', process.env.DB_PI_KEY, '07700 900111', process.env.DB_PI_KEY]);
    const [p] = await Player.getById(20001);
    expect(p).toMatchObject({ id: 20001, first_name: 'Contact', playerEmail: 'contact@example.invalid', playerTel: '07700 900111' });
  });
});
