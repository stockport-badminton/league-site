// models/teams.js's writes against a real Postgres (REARCH-01). The reads are covered by
// snapshots; createFull and updateById build their column list from the caller's object.
const db = require('../../db_connect');
const Team = require('../../models/teams');

const run = (text, params) => db.otherConnect().then(c => c.query(text, params)).then(([r]) => [...r]);

// What teamController's buildTeamObj produces: every key present, blanks as null.
// team.venue is NOT NULL, so the form always carries one.
const form = (club, over) => Object.assign({
  name: 'Zebra A', starttime: '20:00', endtime: null, matchDay: 'Tuesday', section: null, handicap: null,
  club, division: null, venue: club.venue, courtspace: 2,
}, over, { club: club.id });

describe('team writes', () => {
  let club;
  beforeEach(async () => { [club] = await run('SELECT id, venue FROM club WHERE venue IS NOT NULL ORDER BY id LIMIT 1'); });

  it('createFull writes the camelCase columns it is given', async () => {
    await Team.createFull(form(club, { rank: 1, divRank: 1 }));
    const [t] = await Team.getByName('Zebra A');
    expect(t).toMatchObject({ name: 'Zebra A', matchDay: 'Tuesday', starttime: '20:00', club: club.id, venue: club.venue, division: null, courtspace: 2 });
  });

  it('updateById writes the keys given, nulls included, and leaves the rest alone', async () => {
    await Team.createFull(form(club, { rank: 1, divRank: 1 }));
    const [{ id }] = await Team.getByName('Zebra A');
    await Team.updateById(form(club, { matchDay: null, courtspace: 3 }), id);
    const [t] = await Team.getById(id);
    expect(t).toMatchObject({ matchDay: null, courtspace: 3, rank: 1, divRank: 1 });
  });

  it('moving a team into a division puts it at the bottom, as teamController does', async () => {
    await Team.createFull(form(club, { rank: 1, divRank: 1 }));
    const [{ id }] = await Team.getByName('Zebra A');
    const [{ division }] = await run('SELECT division FROM team WHERE division IS NOT NULL ORDER BY id LIMIT 1');
    const [{ max }] = await run('SELECT max("divRank") AS max FROM team WHERE division = ?', [division]);

    const divRank = await Team.getNextDivRank(division);
    expect(divRank).toBe(max + 1);
    await Team.updateById({ division, divRank }, id);
    expect(await Team.getNextDivRank(division)).toBe(max + 2);
  });

  it('refuses anything that is not an object', async () => {
    await expect(Team.createFull('name')).rejects.toThrow('not valid object');
    await expect(Team.updateById(null, 1)).rejects.toThrow('not valid object');
    await expect(Team.getTeams('x')).rejects.toThrow('not object');
  });
});
