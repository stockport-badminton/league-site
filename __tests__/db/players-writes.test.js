// models/players.js's writes, and the two reads that decide who someone is, against a
// real Postgres (REARCH-01). Passed against the string queries first, then unchanged
// against the typed ones.
//
// getAuthRoleByEmail runs on every login (app.js) and decides a user's role; setAuthRole is
// the superadmin's approval of a signup; getEmails builds every distribution list. A
// mistake in any of the three is silent — someone loses access, or a list loses a person.
const db = require('../../db_connect');
const Player = require('../../models/players');

const KEY = () => process.env.DB_PI_KEY;
const run = (text, params) => db.otherConnect().then(c => c.query(text, params)).then(([r]) => [...r]);
const decrypted = async (id, col) => (await run(`SELECT pgp_sym_decrypt("${col}", ?)::text AS v FROM player WHERE id = ?`, [KEY(), id]))[0].v;

const TEAM = 1001;
let CLUB, CLUB_NAME, DIVISION;
beforeEach(async () => {
  const [club] = await run('SELECT id, name, venue FROM club WHERE venue IS NOT NULL AND id <> 63 ORDER BY id LIMIT 1');
  const [division] = await run('SELECT id FROM division ORDER BY id LIMIT 1');
  [CLUB, CLUB_NAME, DIVISION] = [club.id, club.name, division.id];
  await run(`INSERT INTO team (id, name, club, venue, rank, division) VALUES (?, 'Writable A', ?, ?, 1, ?)`, [TEAM, CLUB, club.venue, DIVISION]);
});
const player = (id, extra = '') => run(
  `INSERT INTO player (id, first_name, family_name, gender, club, team, rank) VALUES (?, 'Test', ?, 'Male', ?, ?, 1)`,
  [id, `Writer${id}${extra}`, CLUB, TEAM]);

describe('create', () => {
  it('returns the new id and stores the player, registered today', async () => {
    const result = await Player.create('New', 'Createdplayer', TEAM, CLUB, 'Female');
    expect(result).toHaveLength(1);
    const [row] = await run('SELECT first_name, family_name, team, club, gender, date_of_registration::date = CURRENT_DATE AS today FROM player WHERE id = ?', [result[0].id]);
    expect(row).toEqual({ first_name: 'New', family_name: 'Createdplayer', team: TEAM, club: CLUB, gender: 'Female', today: true });
  });
});

describe('updateBulk', () => {
  it('writes the allowed columns per row, encrypting the contact details', async () => {
    await player(30001); await player(30002);
    await Player.updateBulk({ tablename: 'player', fields: ['id', 'rank', 'playerEmail', 'playerTel'],
      data: [[30001, 4, 'one@example.invalid', '07700 900001'], [30002, 99, 'two@example.invalid', 7700900002]] });
    expect(await run('SELECT id, rank FROM player WHERE id IN (30001, 30002) ORDER BY id')).toEqual([{ id: 30001, rank: 4 }, { id: 30002, rank: 99 }]);
    expect(await decrypted(30001, 'playerEmail')).toBe('one@example.invalid');
    // A number is stored as its text, as String() made it.
    expect(await decrypted(30002, 'playerTel')).toBe('7700900002');
  });

  it('refuses an authorization column, another table, or a non-object, writing nothing', async () => {
    await player(30001);
    await expect(Player.updateBulk({ fields: ['id', 'role'], data: [[30001, 'superadmin']] })).rejects.toThrow(/cannot write these columns: role/);
    await expect(Player.updateBulk({ tablename: 'club', fields: ['id'], data: [] })).rejects.toThrow(/only writes the player table/);
    await expect(Player.updateBulk('x')).rejects.toThrow('not object');
    expect((await run('SELECT role FROM player WHERE id = 30001'))[0].role).toBeNull();
  });
});

describe('getAuthRoleByEmail — who a login is', () => {
  beforeEach(async () => {
    await player(30001);
    await run(`UPDATE player SET role = 'admin', "authEmail" = pgp_sym_encrypt('Login@Example.invalid', ?),
      "playerEmail" = pgp_sym_encrypt('contact@example.invalid', ?) WHERE id = 30001`, [KEY(), KEY()]);
  });

  it('matches the login address or the contact address, ignoring case', async () => {
    for (const email of ['login@example.invalid', 'LOGIN@EXAMPLE.INVALID', 'Contact@Example.invalid']) {
      expect(await Player.getAuthRoleByEmail(email)).toMatchObject({ id: 30001, role: 'admin', clubName: CLUB_NAME });
    }
  });

  it('finds nobody without a role or messer flag, or for an unknown address', async () => {
    expect(await Player.getAuthRoleByEmail('nobody@example.invalid')).toBeUndefined();
    await run('UPDATE player SET role = NULL WHERE id = 30001');
    expect(await Player.getAuthRoleByEmail('login@example.invalid')).toBeUndefined();
    await run('UPDATE player SET "messerAdmin" = 1 WHERE id = 30001');
    expect(await Player.getAuthRoleByEmail('login@example.invalid')).toMatchObject({ id: 30001, role: null, messerAdmin: 1 });
  });
});

describe('setAuthRole — approving a signup', () => {
  it('sets the role and login address, and seeds a blank contact address from it', async () => {
    await player(30001);
    await Player.setAuthRole(30001, { role: 'admin', messerAdmin: true, authEmail: 'signup@example.invalid' });
    expect(await run('SELECT role, "messerAdmin" FROM player WHERE id = 30001')).toEqual([{ role: 'admin', messerAdmin: 1 }]);
    expect(await decrypted(30001, 'authEmail')).toBe('signup@example.invalid');
    expect(await decrypted(30001, 'playerEmail')).toBe('signup@example.invalid');
  });

  // A blank is sometimes NULL and sometimes an encrypted empty string (CLAUDE.md).
  it('treats an encrypted empty contact address as blank, and never overwrites a real one', async () => {
    await player(30001); await player(30002);
    await run(`UPDATE player SET "playerEmail" = pgp_sym_encrypt('  ', ?) WHERE id = 30001`, [KEY()]);
    await run(`UPDATE player SET "playerEmail" = pgp_sym_encrypt('kept@example.invalid', ?) WHERE id = 30002`, [KEY()]);
    await Player.setAuthRole(30001, { role: null, authEmail: 'a@example.invalid' });
    await Player.setAuthRole(30002, { role: null, authEmail: 'b@example.invalid' });
    expect(await decrypted(30001, 'playerEmail')).toBe('a@example.invalid');
    expect(await decrypted(30002, 'playerEmail')).toBe('kept@example.invalid');
  });

  it('without a login address, sets only the role and flag, and leaves the address alone', async () => {
    await player(30001);
    await run(`UPDATE player SET "authEmail" = pgp_sym_encrypt('old@example.invalid', ?) WHERE id = 30001`, [KEY()]);
    await Player.setAuthRole(30001, { role: 'admin', messerAdmin: false });
    expect(await run('SELECT role, "messerAdmin" FROM player WHERE id = 30001')).toEqual([{ role: 'admin', messerAdmin: 0 }]);
    expect(await decrypted(30001, 'authEmail')).toBe('old@example.invalid');
  });
});

describe('getEmails — the distribution lists', () => {
  const flag = async (id, column, email) => {
    await player(id);
    await run(`UPDATE player SET "${column}" = 1, "playerEmail" = pgp_sym_encrypt(?, ?) WHERE id = ?`, [email, KEY(), id]);
  };

  it('collects each role, filtered by club, division and team, once per address', async () => {
    await flag(30001, 'clubSecretary', 'sec@example.invalid');
    await flag(30002, 'teamCaptain', 'cap@example.invalid');
    await flag(30003, 'treasurer', 'tre@example.invalid');
    await flag(30004, 'otherComms', 'oth@example.invalid');
    await flag(30005, 'matchSecrertary', 'match@example.invalid');

    const list = f => Player.getEmails(f).then(e => [...e].sort());
    expect(await list({ club: CLUB, role: 'club Sec' })).toContain('sec@example.invalid');
    expect(await list({ teamName: 'Writable A', role: 'team Captain' })).toEqual(['cap@example.invalid']);
    expect(await list({ teamName: 'Writable A', role: 'treasurer' })).toEqual(['tre@example.invalid']);
    expect(await list({ teamName: 'Writable A', role: 'otherComms' })).toEqual(['oth@example.invalid']);
    // Club-level roles (club and match secretary) are listed against every team of the club,
    // so the club's existing officers are on this team's list too.
    expect(await list({ teamName: 'Writable A', division: DIVISION })).toEqual(expect.arrayContaining(
      ['cap@example.invalid', 'match@example.invalid', 'oth@example.invalid', 'sec@example.invalid', 'tre@example.invalid']));
    expect(await list({ teamName: 'No Such Team' })).toEqual([]);
  });

  // The flag is the one record of an officer (REARCH-03). The old club pointer matched
  // whoever it named wherever they now played, which kept a player who had left a club on
  // its division's list until her mailbox bounced (18 Sep 2026). A pointer is no longer
  // read; REARCH-03's migration then drops the column.
  it('ignores the old club pointer, and drops addresses without an @', async () => {
    await player(30006);
    await run(`UPDATE player SET "playerEmail" = pgp_sym_encrypt('pointer@example.invalid', ?) WHERE id = 30006`, [KEY()]);
    await run('UPDATE club SET "matchSec" = 30006 WHERE id = ?', [CLUB]);
    await flag(30007, 'clubSecretary', 'not-an-address');
    const emails = await Player.getEmails({ teamName: 'Writable A' });
    expect(emails).not.toContain('pointer@example.invalid');
    expect(emails).not.toContain('not-an-address');
  });
});

describe('setRatings', () => {
  it('writes each player\'s rating in one statement', async () => {
    await player(30001); await player(30002);
    await Player.setRatings([[30001, 1612], [30002, 1388]]);
    expect(await run('SELECT id, rating FROM player WHERE id IN (30001, 30002) ORDER BY id')).toEqual([{ id: 30001, rating: 1612 }, { id: 30002, rating: 1388 }]);
    await expect(Player.setRatings([])).resolves.toBeUndefined();
  });
});
