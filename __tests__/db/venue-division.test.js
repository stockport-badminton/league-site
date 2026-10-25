// models/venue.js and models/division.js against a real Postgres (REARCH-01).
//
// getVenueClubs used to be guarded by reading its SQL as text (venue-popup.test.js),
// because nothing could run it. These run it.
const db = require('../../db_connect');
const Venue = require('../../models/venue');
const Division = require('../../models/division');

const run = (text, params) => db.otherConnect().then(c => c.query(text, params));

describe('venue.getVenueClubs', () => {
  beforeEach(async () => {
    await run(`INSERT INTO venue (id, name, address, "gMapUrl") VALUES
      (1001, 'Aardvark Leisure', '1 Test St', 'https://maps.example/1'),
      (1002, 'Aardvark Empty', '2 Test St', 'https://maps.example/2'),
      (1003, 'Aardvark Withdrawn', '3 Test St', 'https://maps.example/3')`);
    await run(`INSERT INTO club (id, name, venue, "clubWebsite", "clubNightText", "matchNightText")
      VALUES (1001, 'Zebra BC', 1001, 'https://zebra.example', 'Mon 8pm', 'Weds & Thurs 8pm')`);
    await run(`INSERT INTO team (id, name, venue, club, division, rank, "matchDay", withdrawn) VALUES
      (1001, 'Zebra B', 1001, 1001, 2, 1, 'Thursday 8pm', NULL),
      (1002, 'Zebra A', 1001, 1001, 1, 1, 'Wednesday 8pm', NULL),
      (1003, 'Zebra C', 1003, 1001, 3, 1, 'Friday 8pm', now())`);
  });

  const mine = async () => (await Venue.getVenueClubs()).filter(v => v.venueName.startsWith('Aardvark'));

  it("takes each team's own match night, not the club's summary", async () => {
    const [venue] = await mine();
    expect(venue).toEqual({
      venueName: 'Aardvark Leisure', Lat: null, Lng: null,
      address: '1 Test St', gMapUrl: 'https://maps.example/1',
      matchTeams: [
        { club: 'Zebra BC', website: 'https://zebra.example', team: 'Zebra A', matchDay: 'Wednesday 8pm' },
        { club: 'Zebra BC', website: 'https://zebra.example', team: 'Zebra B', matchDay: 'Thursday 8pm' },
      ],
      clubNights: [{ club: 'Zebra BC', website: 'https://zebra.example', clubNightText: 'Mon 8pm' }],
    });
    // Data, not markup: the escaping lives in venue-popup.js.
    expect(JSON.stringify(venue)).not.toMatch(/</);
  });

  it('leaves withdrawn teams, and venues with nothing else, off the map', async () => {
    expect((await mine()).map(v => v.venueName)).toEqual(['Aardvark Leisure']);
  });

  it('answers null, not [], for a venue with club nights and no teams', async () => {
    await run('UPDATE club SET venue = 1002 WHERE id = 1001');
    const empty = (await mine()).find(v => v.venueName === 'Aardvark Empty');
    expect(empty.matchTeams).toBeNull();
    expect(empty.clubNights).toHaveLength(1);
  });
});

describe('division', () => {
  it('marks the selected division by id, whether the id arrives as a number or a string', async () => {
    for (const id of [2, '2']) {
      const rows = await Division.getAllAndSelectedById(1, id);
      expect(rows.filter(r => r.selected).map(r => r.name)).toEqual(['Division 1']);
      expect(rows.every(r => typeof r.selected === 'boolean')).toBe(true);
    }
  });

  it('marks nothing when no division is named', async () => {
    const rows = await Division.getAllAndSelectedByName(1, undefined);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.some(r => r.selected)).toBe(false);
  });

  it('turns the first hyphen of a URL segment into a space', async () => {
    const [byName] = await Division.getByName('Division 1');
    expect(await Division.getIdByURLParam('Division-1')).toEqual([{ id: byName.id }]);
  });
});
