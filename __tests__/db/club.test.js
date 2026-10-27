// models/club.js's writes against a real Postgres (REARCH-01). The reads are covered by
// snapshots; createFull and updateFull build their column list from the caller's object,
// which is exactly the kind of thing a snapshot cannot see.
const db = require('../../db_connect');
const Club = require('../../models/club');

const run = (text, params) => db.otherConnect().then(c => c.query(text, params)).then(([r]) => [...r]);

// What clubController's buildClubObj produces: every key present, blanks as null.
const form = over => Object.assign({
  name: 'Zebra BC', matchNightText: 'Tue 8pm', clubNightText: null, clubNight: null,
  clubWebsite: 'https://zebra.example', contactUs: null, facebook: null, instagram: 'zebra_bc', twitter: null,
  venue: null, matchVenue: null, clubNightCourts: 3,
}, over);

describe('club writes', () => {
  it('createFull writes the camelCase columns it is given', async () => {
    await Club.createFull(form());
    expect(await run(`SELECT name, "matchNightText", "clubWebsite", instagram, "clubNightCourts", venue
      FROM club WHERE name = 'Zebra BC'`)).toEqual([{
      name: 'Zebra BC', matchNightText: 'Tue 8pm', clubWebsite: 'https://zebra.example',
      instagram: 'zebra_bc', clubNightCourts: 3, venue: null,
    }]);
  });

  it('updateFull writes the keys given, nulls included, and leaves the rest alone', async () => {
    await Club.createFull(form());
    const [{ id }] = await run("SELECT id FROM club WHERE name = 'Zebra BC'");
    await run('UPDATE club SET "matchSec" = 0 WHERE id = ?', [id]);

    await Club.updateFull(form({ matchNightText: null, clubNightCourts: 4 }), id);
    const [after] = await Club.getById(id);
    expect(after).toMatchObject({ name: 'Zebra BC', matchNightText: null, clubNightCourts: 4, instagram: 'zebra_bc' });
    // Not in the form, so not touched.
    expect(after.matchSec).toBe(0);
  });

  it('refuses anything that is not an object', async () => {
    await expect(Club.createFull('name')).rejects.toThrow('not valid object');
    await expect(Club.updateFull(null, 1)).rejects.toThrow('not valid object');
  });

  it('getInstagramHandles strips a leading @ and drops anything not handle-shaped', async () => {
    await Club.createFull(form({ name: 'Yak BC', instagram: '@yak.bc' }));
    await Club.createFull(form({ name: 'Ibex BC', instagram: 'https://instagram.com/ibex' }));
    const handles = await Club.getInstagramHandles();
    expect(handles).toEqual(expect.arrayContaining([{ name: 'Yak BC', handle: 'yak.bc' }]));
    expect(handles.some(h => h.name === 'Ibex BC')).toBe(false);
  });

  // Moved from __tests__/unit/withdrawn-team-filters.test.js, which read the SQL text out
  // of a mocked db_connect. A withdrawn team is kept for referential integrity (HARD-11)
  // and must not be listed on its club's page.
  it('getTeamsForClub leaves out a withdrawn team and the No Team sentinel', async () => {
    const [club] = await run(`SELECT club, count(*)::int AS n FROM team WHERE withdrawn IS NULL
      GROUP BY club HAVING count(*) >= 2 ORDER BY club LIMIT 1`);
    const before = await Club.getTeamsForClub(club.club, -1);
    expect(before).toHaveLength(club.n);

    await run('UPDATE team SET withdrawn = now() WHERE id = ?', [before[0].id]);
    const after = await Club.getTeamsForClub(club.club, -1);
    expect(after.map(t => t.id)).toEqual(before.slice(1).map(t => t.id));

    expect(await Club.getTeamsForClub(club.club, before[1].id)).toEqual([]);
  });
});

// An officer is the role flag on a player at that club or team (REARCH-03). The old
// pointers (club."clubSec", club."matchSec", team.captain) were a second record that
// could disagree with the flags; none of the officer readers follows one any more.
describe('club officers come from the role flags only', () => {
  const KEY = () => process.env.DB_PI_KEY;
  let CLUB, TEAM;
  beforeEach(async () => {
    const [club] = await run('SELECT id, name, venue, "matchVenue" FROM club WHERE venue IS NOT NULL AND "matchVenue" IS NOT NULL AND id <> 63 ORDER BY id LIMIT 1');
    CLUB = club;
    [{ id: TEAM }] = await run(`SELECT id FROM team WHERE club = ? ORDER BY id LIMIT 1`, [club.id]);
    // Nobody at the club is flagged, so a pointer is the only thing that could name an
    // officer — and it names a member of the club who holds no role.
    await run('UPDATE player SET "clubSecretary" = 0, "matchSecrertary" = 0, "teamCaptain" = 0 WHERE club = ?', [club.id]);
    await run(`INSERT INTO player (id, first_name, family_name, gender, club, team, rank, "playerEmail")
      VALUES (30101, 'Pointed', 'Unflagged', 'Female', ?, ?, 1, pgp_sym_encrypt('pointed@example.invalid', ?))`, [club.id, TEAM, KEY()]);
    await run('UPDATE club SET "clubSec" = 30101, "matchSec" = 30101 WHERE id = ?', [club.id]);
    await run('UPDATE team SET captain = 30101 WHERE id = ?', [TEAM]);
  });

  it('getOfficerEmails does not list a player the club pointer names', async () => {
    const rows = await Club.getOfficerEmails([CLUB.id]);
    expect(rows.map(r => r.playerId)).not.toContain(30101);
  });

  it('getContactDetailsById does not show them as club secretary or captain', async () => {
    const rows = await Club.getContactDetailsById(CLUB.id);
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect([r.clubsecretary, r.matchsecretary, r.teamcaptain]).not.toContain('Pointed Unflagged');
    }
  });

  it('getClubRegistration does not prefill them', async () => {
    const { core, teams } = await Club.getClubRegistration(CLUB.name);
    expect([core.clubSecName, core.matchSecName]).not.toContain('Pointed Unflagged');
    expect(teams.map(t => t.captainName)).not.toContain('Pointed Unflagged');
  });
});
