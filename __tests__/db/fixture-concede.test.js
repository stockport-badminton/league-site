// Fixture.setConceded against a real Postgres. The eligibility rules live in the UPDATE's
// WHERE, so they are only proved here.
//
// Seed (2026/27): 302 Southgate A v Northfield A is outstanding with no games; 301 is
// played, with 18 game rows.
const db = require('../../db_connect');
const Fixture = require('../../models/fixture');

const run = (text, params) => db.otherConnect().then(c => c.query(text, params)).then(([r]) => [...r]);
const fixture = id => run('SELECT status, "homeScore", "awayScore" FROM fixture WHERE id = ?', [id]).then(r => r[0]);

describe('Fixture.setConceded', () => {
  it('awards 18-0 to the side that did not concede, writing no games', async () => {
    const out = await Fixture.setConceded(302, 'home');
    expect(out).toEqual({ ok: true, fixture: { id: 302, status: 'conceded', homeScore: 0, awayScore: 18 } });
    expect(await fixture(302)).toEqual({ status: 'conceded', homeScore: 0, awayScore: 18 });
    expect(await run('SELECT count(*)::int AS n FROM game WHERE fixture = 302')).toEqual([{ n: 0 }]);
  });

  it('re-concedes the other way, and undo puts it back to outstanding with no score', async () => {
    await Fixture.setConceded(302, 'home');
    expect((await Fixture.setConceded(302, 'away')).fixture).toMatchObject({ homeScore: 18, awayScore: 0 });
    expect(await Fixture.setConceded(302, 'none')).toMatchObject({ ok: true });
    expect(await fixture(302)).toEqual({ status: 'outstanding', homeScore: null, awayScore: null });
  });

  it('concedes a rearranging fixture', async () => {
    await run(`UPDATE fixture SET status = 'rearranging' WHERE id = 302`);
    expect(await Fixture.setConceded(302, 'away')).toMatchObject({ ok: true });
  });

  it('refuses a played fixture and leaves it alone', async () => {
    const before = await fixture(301);
    expect(await Fixture.setConceded(301, 'home')).toEqual({ ok: false, reason: 'not-concedable', status: 'complete' });
    expect(await fixture(301)).toEqual(before);
  });

  it('refuses a superseded rearranged original — the match would count twice', async () => {
    await run(`UPDATE fixture SET status = 'rearranged' WHERE id = 302`);
    expect(await Fixture.setConceded(302, 'home')).toEqual({ ok: false, reason: 'not-concedable', status: 'rearranged' });
  });

  it('refuses an outstanding fixture that already has games filed', async () => {
    await run(`UPDATE fixture SET status = 'outstanding', "homeScore" = NULL, "awayScore" = NULL WHERE id = 301`);
    expect(await Fixture.setConceded(301, 'home')).toMatchObject({ ok: false, reason: 'not-concedable' });
  });

  it('will not undo anything but a game-less concession', async () => {
    expect(await Fixture.setConceded(302, 'none')).toEqual({ ok: false, reason: 'not-concedable', status: 'outstanding' });
    await run(`UPDATE fixture SET status = 'conceded' WHERE id = 301`);
    expect(await Fixture.setConceded(301, 'none')).toMatchObject({ ok: false, reason: 'not-concedable' });
    expect((await fixture(301)).status).toBe('conceded');
  });

  it('says not-found for a fixture that does not exist', async () => {
    expect(await Fixture.setConceded(999999, 'home')).toEqual({ ok: false, reason: 'not-found' });
  });
});
