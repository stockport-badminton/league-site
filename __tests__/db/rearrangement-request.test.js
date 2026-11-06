// models/rearrangementRequest.js and Fixture.rearrangeById against a real Postgres.
//
// The seed's current season (2026/27) has Southgate A v Northfield A (302) on Wed 10 Feb
// 2027 and Southgate B v Westway A (306) the same night, both outstanding; 301 is played.
const db = require('../../db_connect');
const Requests = require('../../models/rearrangementRequest');
const Fixture = require('../../models/fixture');

const run = (text, params) => db.otherConnect().then(c => c.query(text, params)).then(([r]) => [...r]);
const NO_CLUB = 63;

const email = (over = {}) => Object.assign({
  messageId: 'rearr-1', forwardedBy: 'results@example.invalid', originalFrom: 'adam.southgatea@example.invalid',
  subject: 'Southgate A v Northfield A', bodyText: 'Original date 10/02/2027, new date 17/02/2027',
  reading: { dates: [{ ymd: '2027-02-10', role: 'original' }], clubIds: [1, 2], teamIds: [], noDateYet: false },
}, over);

describe('rearrangementRequest queue', () => {
  it('create queues an email once; a redelivery answers null', async () => {
    const id = await Requests.create(email());
    expect(typeof id).toBe('number');
    expect(await Requests.create(email())).toBeNull();
    const got = await Requests.getById(id);
    expect(got).toMatchObject({ status: 'pending', outcome: null, reading: email().reading });
    expect((await Requests.list('pending')).map(r => r.id)).toContain(id);
    expect(await Requests.getById(999999)).toBeNull();
  });

  it('recordOutcome closes a pending request once, and refuses a closed one', async () => {
    const before = await Requests.countPending();
    const id = await Requests.create(email());
    expect(await Requests.countPending()).toBe(before + 1);

    const outcome = { action: 'rearranged', fixtureId: 302, replacementId: 999, date: '2027-02-17' };
    const { kysely } = require('../../db');
    expect(await Requests.recordOutcome(kysely, id, outcome, 'admin@example.invalid')).toBe(true);
    expect(await Requests.getById(id)).toMatchObject({ status: 'done', outcome, closedBy: 'admin@example.invalid' });
    expect(await Requests.recordOutcome(kysely, id, outcome, 'admin@example.invalid')).toBe(false);
    expect(await Requests.countPending()).toBe(before);
  });

  it('setStatus closes and reopens', async () => {
    const id = await Requests.create(email());
    expect(await Requests.setStatus(id, 'dismissed', 'a')).toBe(true);
    expect(await Requests.getById(id)).toMatchObject({ status: 'dismissed', closedBy: 'a' });
    expect(await Requests.setStatus(id, 'pending', 'a')).toBe(true);
    expect(await Requests.getById(id)).toMatchObject({ status: 'pending', closedBy: null, closedAt: null });
  });
});

describe('rearrangementRequest fixture reads', () => {
  it('clubsAndTeams leaves out No Club', async () => {
    const { clubs, teams } = await Requests.clubsAndTeams(NO_CLUB);
    expect(clubs.map(c => c.name)).toEqual(['Eastbank', 'Northfield', 'Ridgeline', 'Southgate', 'Westway']);
    expect(teams.find(t => t.name === 'Southgate A')).toEqual({ id: 2, name: 'Southgate A', clubId: 2 });
  });

  it('candidateFixtures finds this season\'s fixture on a mentioned date for a named club, as a plain date', async () => {
    const found = await Requests.candidateFixtures({ dates: ['2027-02-10'], clubIds: [1] });
    expect(found.map(f => f.id)).toEqual([302]);
    expect(found[0]).toMatchObject({
      date: '2027-02-10', dayLabel: 'Wed 10 Feb 2027', status: 'outstanding',
      homeTeamId: 2, awayTeamId: 1, homeTeam: 'Southgate A', awayTeam: 'Northfield A',
      homeClubId: 2, awayClubId: 1,
    });
    // No club named: everything on the date.
    expect((await Requests.candidateFixtures({ dates: ['2027-02-10'], clubIds: [] })).map(f => f.id).sort())
      .toEqual([302, 306]);
    // Last season's fixture on a date is not a candidate.
    expect(await Requests.candidateFixtures({ dates: ['2026-02-11'], clubIds: [] })).toEqual([]);
  });

  it('candidateFixtures finds a rearranging fixture between two named clubs without its date', async () => {
    await run("UPDATE fixture SET status = 'rearranging' WHERE id = 302");
    expect((await Requests.candidateFixtures({ dates: [], clubIds: [1, 2] })).map(f => f.id)).toEqual([302]);
    expect(await Requests.candidateFixtures({ dates: [], clubIds: [1] })).toEqual([]);
  });

  it('candidateFixtures lists a chosen team\'s remaining fixtures, not its played ones', async () => {
    const ids = (await Requests.candidateFixtures({ dates: [], clubIds: [], teamId: 1 })).map(f => f.id)
    expect(ids).toEqual([302]);
  });

  it('homeWeekdays counts the home team\'s fixtures by weekday, Sunday = 0', async () => {
    // Southgate A at home: 302 only this season, a Wednesday.
    expect(await Requests.homeWeekdays(2)).toEqual([{ dow: 3, n: 1 }]);
  });

  it('fixturesOn finds either team\'s other fixture that day, and not the one being moved', async () => {
    await run(`INSERT INTO fixture ("homeTeam", "awayTeam", date, status) VALUES (1, 3, '2027-02-17', 'outstanding')`);
    expect((await Requests.fixturesOn('2027-02-17', [2, 1], 302)).map(f => [f.homeTeam, f.awayTeam]))
      .toEqual([['Northfield A', 'Eastbank A']]);
    expect(await Requests.fixturesOn('2027-02-10', [2, 1], 302)).toEqual([]);
  });

  it('playersByEmail finds a player by contact address, case-insensitively', async () => {
    const [p] = await Requests.playersByEmail('Adam.SouthgateA@example.invalid');
    expect(p).toMatchObject({ id: 21, firstName: 'Adam', team: 'Southgate A', club: 'Southgate', clubId: 2 });
    expect(await Requests.playersByEmail('nobody@example.invalid')).toEqual([]);
    expect(await Requests.playersByEmail('')).toEqual([]);
  });

  it('seasonEnd is the current season\'s end date', async () => {
    expect(await Requests.seasonEnd()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('Fixture.rearrangeById', () => {
  const day = id => run(`SELECT status, "homeTeam", "awayTeam", to_char(date, 'YYYY-MM-DD') AS day FROM fixture WHERE id = ?`, [id]);

  it('archives the fixture and inserts its replacement on the new date; replacementOf finds it', async () => {
    const out = await Fixture.rearrangeById(302, '2027-02-17');
    expect(out).toMatchObject({ ok: true, action: 'rearranged', fixtureId: 302, date: '2027-02-17' });
    expect(await day(302)).toEqual([{ status: 'rearranged', homeTeam: 2, awayTeam: 1, day: '2027-02-10' }]);
    expect(await day(out.replacementId)).toEqual([{ status: 'outstanding', homeTeam: 2, awayTeam: 1, day: '2027-02-17' }]);

    const f = await Requests.fixtureById(302);
    expect(await Requests.replacementOf(f)).toMatchObject({ id: out.replacementId, date: '2027-02-17' });
  });

  it('with no date marks it rearranging and inserts nothing; a later date then moves it', async () => {
    const [{ n }] = await run('SELECT count(*)::int AS n FROM fixture');
    expect(await Fixture.rearrangeById(302, null)).toMatchObject({ action: 'rearranging', replacementId: null });
    expect((await day(302))[0].status).toBe('rearranging');
    expect(await run('SELECT count(*)::int AS n FROM fixture')).toEqual([{ n }]);

    expect(await Fixture.rearrangeById(302, '2027-03-03')).toMatchObject({ action: 'rearranged' });
  });

  it('refuses a played or already-rearranged fixture with 409, and a missing one with 404', async () => {
    await expect(Fixture.rearrangeById(301, '2027-02-17')).rejects.toMatchObject({ status: 409 });
    await Fixture.rearrangeById(302, '2027-02-17');
    // A second Apply must not archive the fixture again and add a second replacement.
    await expect(Fixture.rearrangeById(302, '2027-02-24')).rejects.toMatchObject({ status: 409 });
    expect(await run('SELECT count(*)::int AS n FROM fixture WHERE "homeTeam" = 2 AND "awayTeam" = 1 AND date > ?', ['2027-01-01']))
      .toEqual([{ n: 2 }]);
    await expect(Fixture.rearrangeById(999999, null)).rejects.toMatchObject({ status: 404 });
  });

  it('refuses the date it already has, and a malformed date', async () => {
    await expect(Fixture.rearrangeById(302, '2027-02-10')).rejects.toMatchObject({ status: 400 });
    await expect(Fixture.rearrangeById(302, '17/02/2027')).rejects.toMatchObject({ status: 400 });
    expect((await day(302))[0].status).toBe('outstanding');
  });

  it('rolls the fixture change back when the caller\'s record of it fails', async () => {
    const id = await Requests.create(email());
    await Requests.setStatus(id, 'dismissed', 'x');
    await expect(Fixture.rearrangeById(302, '2027-02-17', async (trx, result) => {
      if (!(await Requests.recordOutcome(trx, id, result, 'a'))) throw Object.assign(new Error('closed'), { status: 409 });
    })).rejects.toMatchObject({ status: 409 });
    expect((await day(302))[0].status).toBe('outstanding');
    expect(await run('SELECT count(*)::int AS n FROM fixture WHERE date = ?', ['2027-02-17'])).toEqual([{ n: 0 }]);
  });
});
