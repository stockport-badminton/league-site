// models/clubRegistration.js's three writes against a real Postgres (REARCH-01). getStatus
// and getDigest belong to REARCH-02. Written and passed against the string queries
// first, then run unchanged against the typed ones.
const db = require('../../db_connect');
const Registration = require('../../models/clubRegistration');

const run = (text, params) => db.otherConnect().then(c => c.query(text, params)).then(([r]) => [...r]);
const SEASON = '20262027';

describe('clubRegistration writes', () => {
  let club;
  beforeEach(async () => { [{ id: club }] = await run('SELECT id FROM club WHERE id <> 63 ORDER BY id LIMIT 1'); });
  const row = () => run('SELECT received_at, chased_at, chase_count, updated_by FROM club_registration WHERE season = ? AND club = ?', [SEASON, club]);

  it('markReceived creates the row on the first event, and markNotReceived clears it', async () => {
    const id = await Registration.markReceived(SEASON, club, 'admin@example.invalid');
    expect(Number.isInteger(id)).toBe(true);
    const [r] = await row();
    expect(r.received_at).toBeInstanceOf(Date);
    expect(r).toMatchObject({ chase_count: 0, chased_at: null, updated_by: 'admin@example.invalid' });

    expect(await Registration.markNotReceived(SEASON, club, 'other@example.invalid')).toBe(id);
    expect(await row()).toEqual([{ received_at: null, chased_at: null, chase_count: 0, updated_by: 'other@example.invalid' }]);
  });

  it('recordChase counts every chase, starting from one', async () => {
    await Registration.recordChase(SEASON, club, 'cron');
    expect((await row())[0]).toMatchObject({ chase_count: 1 });
    await run("UPDATE club_registration SET chased_at = now() - interval '2 days' WHERE season = ? AND club = ?", [SEASON, club]);
    await Registration.recordChase(SEASON, String(club), null);
    const [r] = await row();
    expect(r).toMatchObject({ chase_count: 2, updated_by: null });
    expect(Date.now() - r.chased_at.getTime()).toBeLessThan(60000);
  });

  it('a chase does not disturb a received date, nor a receipt the chase count', async () => {
    await Registration.recordChase(SEASON, club, 'cron');
    await Registration.markReceived(SEASON, club, 'admin');
    await Registration.recordChase(SEASON, club, 'cron');
    const [r] = await row();
    expect(r.received_at).toBeInstanceOf(Date);
    expect(r.chase_count).toBe(2);
  });

  it('refuses a season that is not a season name', async () => {
    await expect(Registration.markReceived("2026'; --", club, 'x')).rejects.toMatchObject({ status: 404 });
  });
});
