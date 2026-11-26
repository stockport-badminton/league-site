// models/leagueEvent.js against a real Postgres.
const db = require('../../db_connect');
const LeagueEvent = require('../../models/leagueEvent');

const run = (text, params) => db.otherConnect().then(c => c.query(text, params)).then(([r]) => [...r]);

it('migration 040 seeded this season\'s three Messer dates', async () => {
  expect((await LeagueEvent.getForSeason('20262027')).map(e => [e.day, e.title, e.detail])).toEqual([
    ['2027-04-13', 'Messer A Section Final', null],
    ['2027-04-20', 'Messer B Section Final', null],
    ['2027-05-05', 'Messer Finals', '@ Ladybridge Park Residents Club'],
  ]);
});

const ev = (date, title, more = {}) => LeagueEvent.create({ date, title, detail: null, venue: null, ...more });

describe('leagueEvent', () => {
  beforeEach(async () => {
    // Each test below starts from none (each test's writes, and this delete, are rolled back after it).
    await run('DELETE FROM league_event');
    await run(`INSERT INTO venue (id, name, address, "gMapUrl")
      VALUES (1001, 'Aardvark Leisure', '1 Test St, SK10 1AA', 'https://maps.example/1')`);
  });

  it('create returns the id, and getById reads the day back as written', async () => {
    const id = await ev('2027-04-13', 'Messer A Section Final', { venue: 1001 });
    expect(Number.isInteger(id)).toBe(true);
    expect(await LeagueEvent.getById(id)).toEqual({
      id, day: '2027-04-13', title: 'Messer A Section Final', detail: null, venue: 1001,
    });
  });

  it('getForSeason returns that season\'s events in date order, with the venue', async () => {
    await ev('2027-05-05', 'Messer Finals', { detail: '@ Aardvark', venue: 1001 });
    await ev('2027-04-13', 'Messer A Section Final');
    await ev('2026-04-14', 'Last season\'s final');

    expect([...await LeagueEvent.getForSeason('20262027')]).toEqual([
      { id: expect.any(Number), day: '2027-04-13', title: 'Messer A Section Final', detail: null,
        venueName: null, venueAddress: null, gMapUrl: null },
      { id: expect.any(Number), day: '2027-05-05', title: 'Messer Finals', detail: '@ Aardvark',
        venueName: 'Aardvark Leisure', venueAddress: '1 Test St, SK10 1AA', gMapUrl: 'https://maps.example/1' },
    ]);
    expect((await LeagueEvent.getForSeason('20252026')).map(e => e.title)).toEqual(['Last season\'s final']);
    expect(await LeagueEvent.getForSeason('nonsense')).toEqual([]);
  });

  it('getAll lists every event newest first, with its season (null outside every season)', async () => {
    await ev('2027-04-13', 'This season', { venue: 1001 });
    await ev('2026-04-14', 'Last season');
    await ev('2031-01-01', 'No season');
    expect((await LeagueEvent.getAll()).map(e => [e.title, e.season, e.venueName])).toEqual([
      ['No season', null, null],
      ['This season', '20262027', 'Aardvark Leisure'],
      ['Last season', '20252026', null],
    ]);
  });

  it('seasonOf names the season a date falls in, or nothing', async () => {
    expect(await LeagueEvent.seasonOf('2027-04-13')).toBe('20262027');
    expect(await LeagueEvent.seasonOf('2031-01-01')).toBeUndefined();
  });

  it('updateById overwrites every field and moves updated_at', async () => {
    const id = await ev('2027-04-13', 'Messer A Section Final', { venue: 1001, detail: 'x' });
    await run(`UPDATE league_event SET updated_at = now() - interval '1 day' WHERE id = ?`, [id]);
    await LeagueEvent.updateById(id, { date: '2027-04-14', title: 'Moved', detail: null, venue: null });
    const [row] = await run(`SELECT to_char(date, 'YYYY-MM-DD') AS day, title, detail, venue,
      updated_at > now() - interval '1 minute' AS fresh FROM league_event WHERE id = ?`, [id]);
    expect(row).toEqual({ day: '2027-04-14', title: 'Moved', detail: null, venue: null, fresh: true });
  });

  it('deleteById removes it; a deleted venue leaves the event without one', async () => {
    const gone = await ev('2027-04-13', 'Gone');
    await LeagueEvent.deleteById(gone);
    expect(await LeagueEvent.getById(gone)).toBeUndefined();

    const kept = await ev('2027-04-20', 'Kept', { venue: 1001 });
    await run('DELETE FROM venue WHERE id = 1001');
    expect(await LeagueEvent.getById(kept)).toMatchObject({ venue: null });
  });
});
