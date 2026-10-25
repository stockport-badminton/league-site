// models/socialToken.js against a real Postgres (REARCH-01).
//
// The local database holds no social_token row, so a snapshot of this model could only
// ever show null. This test is its before-and-after instead: it was written and run
// against the string queries, then against the typed ones, unchanged.
const db = require('../../db_connect');
const SocialToken = require('../../models/socialToken');

const run = (text, params) => db.otherConnect().then(c => c.query(text, params)).then(([r]) => [...r]);

const STATUS_KEYS = ['accountId', 'expiresAt', 'generation', 'lastError', 'lastErrorAt', 'obtainedAt',
  'platform', 'refreshedAt', 'updatedAt', 'updatedBy', 'username'];

const login = (over = {}) => SocialToken.saveLogin('threads', Object.assign(
  { accountId: 28753684917596556n.toString(), username: 'stockport.badders.results', token: 'THAA-first',
    expiresIn: 3600, updatedBy: 'admin@example.invalid' }, over));

describe('socialToken', () => {
  it('status describes the connection and never carries the token', async () => {
    expect(await SocialToken.status('threads')).toBeNull();
    expect(await login()).toBe(1);

    const s = await SocialToken.status('threads');
    expect(Object.keys(s).sort()).toEqual(STATUS_KEYS);
    expect(s).toMatchObject({
      platform: 'threads', accountId: '28753684917596556', username: 'stockport.badders.results',
      generation: 1, refreshedAt: null, lastError: null, lastErrorAt: null, updatedBy: 'admin@example.invalid',
    });
    expect((s.expiresAt - s.obtainedAt) / 1000).toBe(3600);
  });

  it('stores the token encrypted, and withToken decrypts it', async () => {
    await login();
    const [raw] = await run("SELECT encode(token, 'escape') AS bytes FROM social_token WHERE platform = 'threads'");
    expect(raw.bytes).not.toContain('THAA-first');

    const w = await SocialToken.withToken('threads');
    expect(Object.keys(w).sort()).toEqual([...STATUS_KEYS, 'token'].sort());
    expect(w.token).toBe('THAA-first');
  });

  it('a second login replaces the account and clears the refresh state', async () => {
    await login();
    await SocialToken.recordError('threads', 'expired');
    expect(await login({ accountId: '42', username: 'someone.else', token: 'THAA-second' })).toBe(2);
    expect(await SocialToken.withToken('threads')).toMatchObject({
      accountId: '42', username: 'someone.else', token: 'THAA-second', generation: 2, lastError: null, lastErrorAt: null,
    });
  });

  it('a refresh writes only over the generation it read, so a login in between is kept', async () => {
    await login();
    expect(await SocialToken.saveRefresh('threads', { token: 'THAA-stale', expiresIn: 60, generation: 0 })).toBe(0);
    expect((await SocialToken.withToken('threads')).token).toBe('THAA-first');

    expect(await SocialToken.saveRefresh('threads', { token: 'THAA-renewed', expiresIn: 7200, generation: 1, updatedBy: 'cron' })).toBe(1);
    const w = await SocialToken.withToken('threads');
    expect(w).toMatchObject({ token: 'THAA-renewed', generation: 2, updatedBy: 'cron', lastError: null });
    expect(w.refreshedAt).toBeInstanceOf(Date);
    expect((w.expiresAt - w.obtainedAt) / 1000).toBe(7200);
  });

  it('recordError keeps the token and truncates the message to 1000 characters', async () => {
    await login();
    await SocialToken.recordError('threads', 'x'.repeat(1500));
    const w = await SocialToken.withToken('threads');
    expect(w.token).toBe('THAA-first');
    expect(w.lastError).toHaveLength(1000);
    expect(w.lastErrorAt).toBeInstanceOf(Date);
  });

  it('usable answers the account, or why not', async () => {
    expect(await SocialToken.usable('threads')).toEqual({ error: expect.stringMatching(/No Threads account/) });
    await login({ expiresIn: -60 });
    expect(await SocialToken.usable('threads')).toEqual({ error: expect.stringMatching(/expired/) });
    await login();
    expect((await SocialToken.usable('threads')).account.token).toBe('THAA-first');
  });
});
