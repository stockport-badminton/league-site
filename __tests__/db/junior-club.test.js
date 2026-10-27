// models/juniorClub.js against a real Postgres.
const db = require('../../db_connect');
const JuniorClub = require('../../models/juniorClub');

const run = (text, params) => db.otherConnect().then(c => c.query(text, params)).then(([r]) => [...r]);

const blank = {
  venue: null, venue_note: null, session_times: null, fees: null, contact_email: null,
  website: null, notes: null, active: true,
};

beforeEach(async () => {
  await run(`INSERT INTO venue (id, name, address, "gMapUrl")
    VALUES (1001, 'Aardvark Leisure', '1 Test St, SK10 1AA', 'https://maps.example/1')`);
});

describe('juniorClub', () => {
  it('create returns the new id, and getById reads it back', async () => {
    const id = await JuniorClub.create({ ...blank, name: 'Zebra Juniors', venue: 1001, fees: '£50 per term' });
    expect(Number.isInteger(id)).toBe(true);
    expect(await JuniorClub.getById(id)).toMatchObject({ name: 'Zebra Juniors', venue: 1001, fees: '£50 per term', active: true });
  });

  it('getActive joins the venue, keeps a club with none, and leaves out hidden clubs', async () => {
    await JuniorClub.create({ ...blank, name: 'Yak Juniors', venue: 1001, venue_note: 'Main hall',
      session_times: 'Fridays 5.30pm', contact_email: 'yak@example.invalid' });
    await JuniorClub.create({ ...blank, name: 'Xerus Juniors', website: 'https://xerus.example' });
    await JuniorClub.create({ ...blank, name: 'Hidden Juniors', active: false });

    expect([...await JuniorClub.getActive()]).toEqual([
      { id: expect.any(Number), name: 'Xerus Juniors', venue_note: null, session_times: null, fees: null,
        has_email: false, website: 'https://xerus.example', notes: null,
        venueName: null, venueAddress: null, gMapUrl: null },
      { id: expect.any(Number), name: 'Yak Juniors', venue_note: 'Main hall', session_times: 'Fridays 5.30pm',
        fees: null, has_email: true, website: null, notes: null,
        venueName: 'Aardvark Leisure', venueAddress: '1 Test St, SK10 1AA', gMapUrl: 'https://maps.example/1' },
    ]);
  });

  it('getContactable lists shown clubs with an address, and never the address', async () => {
    await JuniorClub.create({ ...blank, name: 'Yak Juniors', contact_email: 'yak@example.invalid' });
    await JuniorClub.create({ ...blank, name: 'Xerus Juniors', website: 'https://xerus.example' });
    await JuniorClub.create({ ...blank, name: 'Hidden Juniors', contact_email: 'h@example.invalid', active: false });
    expect([...await JuniorClub.getContactable()]).toEqual([{ id: expect.any(Number), name: 'Yak Juniors' }]);
  });

  it('getAll includes hidden clubs, with the venue name', async () => {
    await JuniorClub.create({ ...blank, name: 'Hidden Juniors', venue: 1001, active: false });
    const [row] = (await JuniorClub.getAll()).filter(r => r.name === 'Hidden Juniors');
    expect(row).toMatchObject({ active: false, venueName: 'Aardvark Leisure' });
  });

  it('updateById overwrites every field, can clear one, and moves updated_at', async () => {
    const id = await JuniorClub.create({ ...blank, name: 'Zebra Juniors', fees: '£50', venue: 1001 });
    await run(`UPDATE junior_club SET updated_at = now() - interval '1 day' WHERE id = ?`, [id]);
    await JuniorClub.updateById(id, { ...blank, name: 'Zebra Juniors', website: 'https://z.example', active: false });
    const [row] = await run(`SELECT fees, venue, website, active, updated_at > now() - interval '1 minute' AS fresh
      FROM junior_club WHERE id = ?`, [id]);
    expect(row).toEqual({ fees: null, venue: null, website: 'https://z.example', active: false, fresh: true });
  });

  it('deleteById removes the club', async () => {
    const id = await JuniorClub.create({ ...blank, name: 'Zebra Juniors' });
    await JuniorClub.deleteById(id);
    expect(await JuniorClub.getById(id)).toBeUndefined();
  });

  it('a deleted venue leaves the club in place without one', async () => {
    const id = await JuniorClub.create({ ...blank, name: 'Zebra Juniors', venue: 1001 });
    await run('DELETE FROM venue WHERE id = 1001');
    expect(await JuniorClub.getById(id)).toMatchObject({ venue: null });
  });
});
