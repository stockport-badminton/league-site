// models/fixture.js's scorecard-side functions against a real Postgres (REARCH-01): the
// outstanding and due-today lists, the uploader's candidate pairs, the reminder contacts,
// the missing-photo list and the photo write, and the rearrangement.
//
// Several of these were tested by reading SQL out of a mocked db_connect
// (cards-due-today.test.js, fixture-rearrangement-model.test.js); the rules they pinned are
// asserted here on rows. Written and passed against the string queries first, then run
// unchanged against the typed ones.
const db = require('../../db_connect');
const Fixture = require('../../models/fixture');
const Season = require('../../models/season');

const KEY = () => process.env.DB_PI_KEY;
const run = (text, params) => db.otherConnect().then(c => c.query(text, params)).then(([r]) => [...r]);

const H = 1001, A = 1002;
let CLUB;
const RESULTS = 'stockport.badders.results@gmail.com';

beforeEach(async () => {
  await run(`INSERT INTO season (id, name, "startDate", "endDate", label)
    SELECT 1001, ?, now() - interval '120 days', now() + interval '300 days', 'test'
    WHERE NOT EXISTS (SELECT 1 FROM season WHERE name = ?)`, [Season.current(), Season.current()]);
  const [club] = await run('SELECT id, venue FROM club WHERE venue IS NOT NULL AND id <> 63 ORDER BY id LIMIT 1');
  CLUB = club.id;
  await run(`INSERT INTO team (id, name, club, venue, rank, division) VALUES
    (${H}, 'Cardhome A', ${CLUB}, ${club.venue}, 1, NULL), (${A}, 'Cardaway A', ${CLUB}, ${club.venue}, 2, NULL)`);
});

// A fixture `days` from today (negative is past), at UK local midnight as stored.
const fixture = (id, days, status = 'outstanding', score = null) => run(
  `INSERT INTO fixture (id, "homeTeam", "awayTeam", date, status, "homeScore", "awayScore")
   VALUES (?, ?, ?, date_trunc('day', now()) + make_interval(days => ?), ?, ?, ?)`,
  [id, H, A, days, status, score, score]);
const ids = rows => rows.map(r => r.id ?? r.fixtureid ?? r.fixId ?? r.fixid).sort((a, b) => a - b);

// A draft for fixture `id`, every NOT NULL column zero, as fixture.test.js builds one.
async function draft(fixtureId, extra = {}) {
  const [f] = await run('SELECT date, "homeTeam", "awayTeam" FROM fixture WHERE id = ?', [fixtureId]);
  const cols = await run(`SELECT column_name FROM information_schema.columns
    WHERE table_name = 'scorecardstore' AND is_nullable = 'NO' AND column_default IS NULL`);
  const row = Object.assign(Object.fromEntries(cols.map(c => [c.column_name, 0])),
    { date: f.date, homeTeam: f.homeTeam, awayTeam: f.awayTeam, email: 'captain@example.invalid', 'scoresheet-url': '' }, extra);
  const keys = Object.keys(row);
  const [{ id }] = await run(`INSERT INTO scorecardstore (${keys.map(k => `"${k}"`).join(',')})
    VALUES (${keys.map(() => '?').join(',')}) RETURNING id`, Object.values(row));
  return id;
}

describe('getOutstandingScorecards', () => {
  it('lists this season\'s played fixtures with no draft, and nothing else', async () => {
    await fixture(9001, -3);
    await fixture(9002, -4); await draft(9002);
    await fixture(9003, -5, 'rearranged');
    await fixture(9004, -6, 'void');
    await fixture(9005, 4);
    const mine = (await Fixture.getOutstandingScorecards()).filter(r => r.homeId === H);
    expect(mine.map(r => r.homeTeam)).toEqual(['Cardhome A']);
    expect(mine[0]).toMatchObject({ awayTeam: 'Cardaway A', awayId: A, status: 'outstanding', scoreCardId: null });
  });
});

describe('getScorecardCandidates', () => {
  it('offers outstanding fixtures up to a week ahead, played or not', async () => {
    await fixture(9001, -10);
    await fixture(9002, 5);
    await fixture(9003, 9);
    await fixture(9004, -2, 'complete', 10);
    const mine = (await Fixture.getScorecardCandidates()).filter(r => r.homeId === H);
    expect(ids(mine)).toEqual([9001, 9002]);
    expect(mine[0]).toMatchObject({ homeName: 'Cardhome A', awayName: 'Cardaway A', awayId: A });
  });
});

describe('getCardsDueToday', () => {
  // Only 'outstanding' is owed a scorecard: when Dome A withdrew and its fixtures were
  // voided, every one was reported missing in turn.
  it('reports outstanding fixtures played six to seven days ago, and not voided or completed ones', async () => {
    await run(`INSERT INTO fixture (id, "homeTeam", "awayTeam", date, status) VALUES
      (9001, ${H}, ${A}, now() - interval '6 days 12 hours', 'outstanding'),
      (9002, ${H}, ${A}, now() - interval '6 days 12 hours', 'void'),
      (9003, ${H}, ${A}, now() - interval '3 days', 'outstanding')`);
    const mine = (await Fixture.getCardsDueToday()).filter(r => r.homeTeam === 'Cardhome A');
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ fixid: 9001, status: 'outstanding', awayTeam: 'Cardaway A', homeScore: null });
  });
});

describe('getReminderContacts', () => {
  it('names the home club\'s secretaries and the home captain, in that order, with decrypted addresses', async () => {
    await fixture(9001, -3);
    await run(`UPDATE player SET "clubSecretary" = 0, "matchSecrertary" = 0 WHERE club = ?`, [CLUB]);
    const player = (id, cols, email) => run(
      `INSERT INTO player (id, first_name, family_name, gender, club, team, ${cols}, "playerEmail")
       VALUES (?, ' Pat', ?, 'Male', ?, ?, 1, ${email === null ? 'NULL' : 'pgp_sym_encrypt(?, ?)'})`,
      email === null ? [id, `Officer${id}`, CLUB, H] : [id, `Officer${id}`, CLUB, H, email, KEY()]);
    await player(50001, '"teamCaptain"', 'cap@example.invalid');
    await player(50002, '"clubSecretary"', ' sec@example.invalid ');
    await player(50003, '"matchSecrertary"', null);

    const out = await Fixture.getReminderContacts(9001);
    expect(out.fixture).toMatchObject({ id: 9001, homeTeam: 'Cardhome A', awayTeam: 'Cardaway A' });
    expect([...out.contacts]).toEqual([
      { role: 'Club secretary', name: 'Pat Officer50002', email: 'sec@example.invalid' },
      { role: 'Match secretary', name: 'Pat Officer50003', email: null },
      { role: 'Team captain', name: 'Pat Officer50001', email: 'cap@example.invalid' },
    ]);
    expect(await Fixture.getReminderContacts(999999)).toBeNull();
  });
});

describe('the scorecard photo', () => {
  it('getMissingScorecardPhotos: the results secretary sees every draft with no photo; a captain sees their own unpublished ones', async () => {
    await fixture(9001, -3); await fixture(9002, -4, 'complete', 10);
    const own = await draft(9001);
    const done = await draft(9002);
    await draft(9001, { email: 'someone.else@example.invalid' });

    const results = (await Fixture.getMissingScorecardPhotos(RESULTS)).filter(r => [9001, 9002].includes(r.fixtureid));
    expect(results.length).toBe(3);
    const captain = await Fixture.getMissingScorecardPhotos('captain@example.invalid');
    expect(captain.map(r => r.id)).toContain(own);
    expect(captain.map(r => r.id)).not.toContain(done);
    expect(captain.every(r => r.email === 'captain@example.invalid')).toBe(true);
  });

  // The controller answers 409 from affectedRows === 0, so the count must come back.
  it('updateScorecardPhoto writes only to a draft with no photo, and says how many it wrote', async () => {
    await fixture(9001, -3);
    const id = await draft(9001);
    expect((await Fixture.updateScorecardPhoto(id, 'scorecards/one.jpg')).affectedRows).toBe(1);
    expect((await Fixture.updateScorecardPhoto(id, 'scorecards/two.jpg')).affectedRows).toBe(0);
    expect((await run('SELECT "scoresheet-url" AS u FROM scorecardstore WHERE id = ?', [id]))[0].u).toBe('scorecards/one.jpg');
  });
});

describe('rearrangeByTeamNames', () => {
  const ranked = () => run(`SELECT id, status, to_char(date, 'YYYY-MM-DD HH24:MI') AS day FROM fixture
    WHERE "homeTeam" = ${H} AND "awayTeam" = ${A} ORDER BY date, id`);

  it('with no agreed date, flags the fixture rearranging and creates nothing', async () => {
    await fixture(9001, 5);
    for (const body of [{ homeTeam: 'Cardhome A', awayTeam: 'Cardaway A', date: '' },
      { homeTeam: '  Cardhome A ', awayTeam: 'Cardaway A' }]) {
      expect(await Fixture.rearrangeByTeamNames(body)).toEqual({ ok: true, action: 'rearranging', fixtureId: 9001, replacementId: null });
    }
    expect((await ranked()).map(r => r.status)).toEqual(['rearranging']);
  });

  it('with a date, archives the fixture and inserts the replacement at local midnight on that day', async () => {
    await fixture(9001, 5);
    const out = await Fixture.rearrangeByTeamNames({ homeTeam: 'Cardhome A', awayTeam: 'Cardaway A', date: '2027-04-01' });
    expect(out).toMatchObject({ ok: true, action: 'rearranged', fixtureId: 9001, date: '2027-04-01' });
    expect(await ranked()).toEqual([
      { id: 9001, status: 'rearranged', day: expect.any(String) },
      { id: out.replacementId, status: 'outstanding', day: '2027-04-01 00:00' },
    ]);
  });

  it('takes the latest fixture of the pairing in the current season, and none from before it', async () => {
    await run(`INSERT INTO fixture (id, "homeTeam", "awayTeam", date, status) VALUES
      (9009, ${H}, ${A}, (SELECT "startDate" FROM season WHERE name = ?) - interval '30 days', 'outstanding')`, [Season.current()]);
    await expect(Fixture.rearrangeByTeamNames({ homeTeam: 'Cardhome A', awayTeam: 'Cardaway A' }))
      .rejects.toMatchObject({ status: 404 });
    await fixture(9001, 5); await fixture(9002, 12);
    expect((await Fixture.rearrangeByTeamNames({ homeTeam: 'Cardhome A', awayTeam: 'Cardaway A' })).fixtureId).toBe(9002);
  });

  // HARD-11 reinstates deleted teams as withdrawn rows under their old names; resolving to
  // one would write a fixture pointing at a defunct team.
  it('ignores a withdrawn team of the same name, and names a team it cannot find', async () => {
    await fixture(9001, 5);
    await run(`UPDATE team SET withdrawn = now() WHERE id = ?`, [A]);
    await expect(Fixture.rearrangeByTeamNames({ homeTeam: 'Cardhome A', awayTeam: 'Cardaway A' }))
      .rejects.toMatchObject({ status: 400, message: expect.stringContaining('"Cardaway A"') });
    expect((await ranked()).map(r => r.status)).toEqual(['outstanding']);
  });

  // The archive and the replacement are one transaction: a replacement that cannot be
  // written must not leave the original marked rearranged with nothing to replace it.
  it('rolls the archive back if the replacement cannot be written', async () => {
    await fixture(9001, 5);
    await run(`CREATE FUNCTION pg_temp.refuse() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'refused by test'; END $$ LANGUAGE plpgsql`);
    await run(`CREATE TRIGGER refuse_insert BEFORE INSERT ON fixture FOR EACH ROW EXECUTE FUNCTION pg_temp.refuse()`);
    await expect(Fixture.rearrangeByTeamNames({ homeTeam: 'Cardhome A', awayTeam: 'Cardaway A', date: '2027-04-01' }))
      .rejects.toThrow('refused by test');
    expect((await ranked()).map(r => r.status)).toEqual(['outstanding']);
  });
});
