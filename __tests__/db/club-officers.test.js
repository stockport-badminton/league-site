// models/clubOfficers.js against a real Postgres: a secretary's writes stay inside their
// own club, on the columns the officer readers use (player.club for secretaries,
// player.team for captains).
const db = require('../../db_connect');
const ClubOfficers = require('../../models/clubOfficers');

const run = (text, params) => db.otherConnect().then(c => c.query(text, params)).then(([r]) => [...r]);
const KEY = () => require('../../config').DB_PI_KEY;

const CLUB = 9001, OTHER = 9002;
const A = 1001, B = 1002, X = 1003; // A and B are CLUB's, X is OTHER's
const P = n => 10000 + n;

async function player(n, team, club, flags = {}, email = null) {
  await run(`INSERT INTO player (id, first_name, family_name, gender, club, team, "clubSecretary", "matchSecrertary", "teamCaptain", "playerEmail", "authEmail")
    VALUES (?, 'Test', ?, 'Male', ?, ?, ?, ?, ?, CASE WHEN ?::text IS NULL THEN NULL ELSE pgp_sym_encrypt(?::text, ?) END, NULL)`,
    [P(n), `Player${n}`, club, team, flags.cs ? 1 : 0, flags.ms ? 1 : 0, flags.tc ? 1 : 0, email, email, KEY()]);
}
const flags = async n => (await run(`SELECT "clubSecretary" cs, "matchSecrertary" ms, "teamCaptain" tc,
  CASE WHEN "playerEmail" IS NULL THEN NULL ELSE pgp_sym_decrypt("playerEmail", ?) END AS email,
  CASE WHEN "playerTel" IS NULL THEN NULL ELSE pgp_sym_decrypt("playerTel", ?) END AS tel
  FROM player WHERE id = ?`, [KEY(), KEY(), P(n)]))[0];

beforeEach(async () => {
  const [{ venue }] = await run('SELECT venue FROM club WHERE venue IS NOT NULL ORDER BY id LIMIT 1');
  await run(`INSERT INTO club (id, name) VALUES (${CLUB}, 'Aardvark BC'), (${OTHER}, 'Zebra BC')`);
  await run(`INSERT INTO team (id, name, club, venue, rank) VALUES
    (${A}, 'Aardvark A', ${CLUB}, ${venue}, 1), (${B}, 'Aardvark B', ${CLUB}, ${venue}, 2), (${X}, 'Zebra A', ${OTHER}, ${venue}, 1)`);
  await player(1, A, CLUB, { cs: true }, 'Sec@Example.invalid');   // club secretary
  await player(2, A, CLUB, { tc: true });                          // A's captain
  await player(3, A, CLUB);                                        // plain member of A
  await player(4, B, CLUB);                                        // plain member of B
  await player(5, X, OTHER, { ms: true }, 'other@example.invalid'); // another club's secretary
  await player(6, X, OTHER, { tc: true });                          // another club's captain
});

describe('secretaryClubs', () => {
  it('finds a secretary by contact address, ignoring case, and nobody else', async () => {
    expect(await ClubOfficers.secretaryClubs('sec@example.INVALID')).toEqual([{ playerId: P(1), clubId: CLUB, clubName: 'Aardvark BC' }]);
    expect(await ClubOfficers.secretaryClubs('nobody@example.invalid')).toEqual([]);
    expect(await ClubOfficers.secretaryClubs('')).toEqual([]);
  });

  it('finds one by login address too, and not once the flag is gone', async () => {
    await run(`UPDATE player SET "authEmail" = pgp_sym_encrypt('login@example.invalid', ?) WHERE id = ?`, [KEY(), P(1)]);
    expect((await ClubOfficers.secretaryClubs('login@example.invalid')).map(c => c.clubId)).toEqual([CLUB]);
    await run('UPDATE player SET "clubSecretary" = 0 WHERE id = ?', [P(1)]);
    expect(await ClubOfficers.secretaryClubs('login@example.invalid')).toEqual([]);
  });
});

describe('getClubOfficers', () => {
  it('lists the club, its teams, and its players with flags and decrypted contacts', async () => {
    const d = await ClubOfficers.getClubOfficers(CLUB);
    expect(d.club).toEqual({ id: CLUB, name: 'Aardvark BC' });
    expect(d.teams.map(t => t.name)).toEqual(['Aardvark A', 'Aardvark B']);
    expect(d.players.map(p => p.id)).toEqual([P(1), P(2), P(3), P(4)]);
    expect(d.players[0]).toMatchObject({ name: 'Test Player1', clubSecretary: true, matchSecretary: false, teamCaptain: false,
      email: 'Sec@Example.invalid', tel: null, teamId: A, clubId: CLUB });
    expect(await ClubOfficers.getClubOfficers(987654)).toBeUndefined();
  });

  it('leaves out a withdrawn team', async () => {
    await run('UPDATE team SET withdrawn = now() WHERE id = ?', [B]);
    expect((await ClubOfficers.getClubOfficers(CLUB)).teams.map(t => t.id)).toEqual([A]);
  });
});

describe('setContact', () => {
  it('writes an officer\'s email and phone, and blank clears to NULL', async () => {
    expect(await ClubOfficers.setContact(CLUB, P(2), { email: 'cap@example.invalid', tel: '0161 000 0000' })).toBe(1);
    expect(await flags(2)).toMatchObject({ email: 'cap@example.invalid', tel: '0161 000 0000' });
    expect(await ClubOfficers.setContact(CLUB, P(2), { email: null, tel: null })).toBe(1);
    expect(await run('SELECT "playerEmail" e, "playerTel" t FROM player WHERE id = ?', [P(2)])).toEqual([{ e: null, t: null }]);
  });

  it('refuses a player who holds no office, and another club\'s officers', async () => {
    expect(await ClubOfficers.setContact(CLUB, P(3), { email: 'x@example.invalid', tel: null })).toBe(0);
    expect(await ClubOfficers.setContact(CLUB, P(5), { email: 'x@example.invalid', tel: null })).toBe(0);
    expect(await ClubOfficers.setContact(CLUB, P(6), { email: 'x@example.invalid', tel: null })).toBe(0);
    expect((await flags(5)).email).toBe('other@example.invalid');
  });
});

describe('setSecretary', () => {
  it('gives and takes a flag for a player at the club', async () => {
    expect(await ClubOfficers.setSecretary(CLUB, P(4), 'matchSecrertary', true)).toBe(1);
    expect(await flags(4)).toMatchObject({ ms: 1, cs: 0 });
    expect(await ClubOfficers.setSecretary(CLUB, P(1), 'clubSecretary', false)).toBe(1);
    expect((await flags(1)).cs).toBe(0);
  });

  it('touches nobody at another club, and only the two secretary columns', async () => {
    expect(await ClubOfficers.setSecretary(CLUB, P(5), 'matchSecrertary', false)).toBe(0);
    expect((await flags(5)).ms).toBe(1);
    await expect(ClubOfficers.setSecretary(CLUB, P(3), 'teamCaptain', true)).rejects.toThrow('Not a secretary column');
  });
});

describe('setCaptain', () => {
  it('replaces the captain, leaving the team exactly one', async () => {
    expect(await ClubOfficers.setCaptain(CLUB, A, P(3))).toBe(true);
    expect([(await flags(2)).tc, (await flags(3)).tc]).toEqual([0, 1]);
  });

  it('can leave a team with no captain', async () => {
    expect(await ClubOfficers.setCaptain(CLUB, A, null)).toBe(true);
    expect((await run('SELECT count(*)::int n FROM player WHERE team = ? AND "teamCaptain" = 1', [A]))[0].n).toBe(0);
  });

  it('changes nothing for a player not on the team, or another club\'s team', async () => {
    expect(await ClubOfficers.setCaptain(CLUB, A, P(4))).toBe(false);  // on B
    expect(await ClubOfficers.setCaptain(CLUB, X, P(5))).toBe(false);  // OTHER's team
    expect(await ClubOfficers.setCaptain(CLUB, X, null)).toBe(false);
    expect([(await flags(2)).tc, (await flags(6)).tc]).toEqual([1, 1]);
  });
});
