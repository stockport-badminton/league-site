// The login cull's SQL against a real Postgres: models/authCull.js (migration 034), and the
// two player reads/writes it uses (Player.getAuthEmailIndex, Player.clearAuthEmail).
const db = require('../../db_connect');
const config = require('../../config');
const AuthCull = require('../../models/authCull');
const Player = require('../../models/players');

const run = (text, params) => db.otherConnect().then(c => c.query(text, params)).then(([r]) => [...r]);

describe('auth_account_notice', () => {
  it('records a warning, finds it by its token, and spends the token once', async () => {
    await AuthCull.recordNotice('auth0|a', 'token-1');
    const all = await AuthCull.getAll();
    expect(all.get('auth0|a').notified_at).toBeInstanceOf(Date);
    expect(all.get('auth0|a').kept_at).toBeNull();

    expect(await AuthCull.findByToken('token-1')).toMatchObject({ user_id: 'auth0|a' });
    expect(await AuthCull.findByToken('nope')).toBeUndefined();
    // The GET's lookup changes nothing.
    expect((await AuthCull.getAll()).get('auth0|a').kept_at).toBeNull();

    expect(await AuthCull.keepByToken('token-1')).toEqual({ user_id: 'auth0|a' });
    expect((await AuthCull.getAll()).get('auth0|a').kept_at).toBeInstanceOf(Date);
    expect(await AuthCull.keepByToken('token-1')).toBeUndefined();
  });

  it('stores only a hash of the token', async () => {
    await AuthCull.recordNotice('auth0|h', 'raw-token-value');
    const [row] = await run(`SELECT encode(keep_token_hash, 'escape') AS h FROM auth_account_notice WHERE user_id = 'auth0|h'`);
    expect(row.h).not.toContain('raw-token-value');
  });

  it('a new warning replaces the old token and forgets an earlier keep', async () => {
    await AuthCull.recordNotice('auth0|b', 'old');
    await AuthCull.keepByToken('old');
    await AuthCull.recordNotice('auth0|b', 'new');
    expect((await AuthCull.getAll()).get('auth0|b').kept_at).toBeNull();
    expect(await AuthCull.findByToken('old')).toBeUndefined();
    expect(await AuthCull.findByToken('new')).toMatchObject({ user_id: 'auth0|b' });
  });

  it('a superadmin keep works with or without a warning, and spends any token', async () => {
    await AuthCull.keep('auth0|never-warned');
    expect((await AuthCull.getAll()).get('auth0|never-warned').kept_at).toBeInstanceOf(Date);
    await AuthCull.recordNotice('auth0|c', 'tok');
    await AuthCull.keep('auth0|c');
    expect(await AuthCull.findByToken('tok')).toBeUndefined();
  });

  it('remove deletes the row', async () => {
    await AuthCull.recordNotice('auth0|d', 'x');
    await AuthCull.remove('auth0|d');
    expect((await AuthCull.getAll()).has('auth0|d')).toBe(false);
  });
});

describe('player login addresses', () => {
  let CLUB;
  const insert = (id, authEmail, playerEmail) => run(
    `INSERT INTO player (id, first_name, family_name, gender, club, "authEmail", "playerEmail")
     VALUES (?, 'Cull', ?, 'Male', ?, ${authEmail === null ? 'NULL' : 'pgp_sym_encrypt(?, ?)'}, ${playerEmail === null ? 'NULL' : 'pgp_sym_encrypt(?, ?)'})`,
    [id, `Player${id}`, CLUB,
      ...(authEmail === null ? [] : [authEmail, config.DB_PI_KEY]),
      ...(playerEmail === null ? [] : [playerEmail, config.DB_PI_KEY])]);

  beforeEach(async () => {
    [{ id: CLUB }] = await run('SELECT id FROM club ORDER BY id LIMIT 1');
    await insert(91001, 'Login@Example.com', 'contact@example.com');
    await insert(91002, null, 'only-contact@example.com');
    // Another player's contact address is someone else's login: the login wins.
    await insert(91003, null, 'login@example.com');
  });

  it('indexes every address, lowercased, and a login address beats a contact one', async () => {
    const index = await Player.getAuthEmailIndex();
    expect(index.get('login@example.com')).toMatchObject({ id: 91001, first_name: 'Cull' });
    expect(index.get('contact@example.com').id).toBe(91001);
    expect(index.get('only-contact@example.com').id).toBe(91002);
  });

  it('clearAuthEmail forgets the login, case-insensitively, and keeps the contact address', async () => {
    expect(await Player.clearAuthEmail('LOGIN@example.com')).toEqual([{ id: 91001 }]);
    const [row] = await run(`SELECT "authEmail", pgp_sym_decrypt("playerEmail", ?)::text AS contact FROM player WHERE id = 91001`, [config.DB_PI_KEY]);
    expect(row.authEmail).toBeNull();
    expect(row.contact).toBe('contact@example.com');
    expect(await Player.clearAuthEmail('nobody@example.com')).toEqual([]);
  });
});
