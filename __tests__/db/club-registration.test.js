// models/clubRegistration.js against a real Postgres (REARCH-01): the three writes, and
// getStatus's two queries. Each was written and passed against the string queries first,
// then run unchanged against the typed ones. getDigest's grouping is plain JavaScript over
// getStatus, and is tested in __tests__/unit/club-registration-model.test.js.
const db = require('../../db_connect');
const config = require('../../config');
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

describe('clubRegistration status', () => {
  // Westway (club 4) is team 5, players 51–58; Ridgeline (club 5) is team 7. Westway's
  // first fixture of 2026/27 in the seed is 14 Sep 2026.
  const WESTWAY = 4, RIDGELINE = 5;
  const status = async (season, club) => (await Registration.getStatus(season)).find(c => c.id === club);
  const ymd = d => [d.getFullYear(), d.getMonth() + 1, d.getDate()].map(n => String(n).padStart(2, '0')).join('-');
  const nameOf = async id => (await run(`SELECT trim(first_name || ' ' || family_name) AS n FROM player WHERE id = ?`, [id]))[0].n;

  it('attaches each club its own officers, club secretary first, a blank email as null', async () => {
    await run('UPDATE player SET "clubSecretary" = 0, "matchSecrertary" = 0 WHERE team IN (5, 7)');
    await run(`UPDATE player SET "matchSecrertary" = 1, "playerEmail" = pgp_sym_encrypt('', ?) WHERE id = 51`, [config.DB_PI_KEY]);
    await run(`UPDATE player SET "clubSecretary" = 1, "playerEmail" = pgp_sym_encrypt(' sec@example.invalid ', ?) WHERE id = 54`, [config.DB_PI_KEY]);

    expect((await status(SEASON, WESTWAY)).officers).toEqual([
      { name: await nameOf(54), email: 'sec@example.invalid', role: 'club secretary' },
      { name: await nameOf(51), email: null, role: 'match secretary' },
    ]);
    // A club with nobody flagged is contactable by nobody, not undefined.
    expect((await status(SEASON, RIDGELINE)).officers).toEqual([]);
  });

  // The season is bound into both the fixture window and the join onto club_registration;
  // if either were not, every season would read the same rows.
  it('reads the season it is asked for', async () => {
    await Registration.markReceived(SEASON, WESTWAY, 'admin');
    expect(await status(SEASON, WESTWAY)).toMatchObject({ season: SEASON, received: true });
    const last = await status('20252026', WESTWAY);
    expect(last).toMatchObject({ season: '20252026', received: false });
    expect(ymd(last.firstFixture)).toBe('2025-10-06');
  });

  // A match that has been moved, or is being moved, does not set the deadline: the club is
  // not playing that night.
  it('takes the deadline from the first match that is not being moved', async () => {
    expect(ymd((await status(SEASON, WESTWAY)).firstFixture)).toBe('2026-09-14');
    await run(`INSERT INTO fixture (id, "homeTeam", "awayTeam", date, status) VALUES
      (990001, 5, 6, '2026-08-02', 'rearranged'), (990002, 6, 5, '2026-08-03', 'rearranging')`);
    expect(ymd((await status(SEASON, WESTWAY)).firstFixture)).toBe('2026-09-14');
    await run(`INSERT INTO fixture (id, "homeTeam", "awayTeam", date, status) VALUES (990003, 5, 6, '2026-08-04', 'outstanding')`);
    expect(ymd((await status(SEASON, WESTWAY)).firstFixture)).toBe('2026-08-04');
  });
});
