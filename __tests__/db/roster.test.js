// models/roster.js's rank rules against a real Postgres (REARCH-01).
//
// These were unit tests that faked db_connect and decoded the ranks out of the SQL the
// model sent — necessary when they were written, because there was no database to run
// them against. Every rule is kept; what changed is the evidence. Each case now builds a
// scratch team, runs the function, and reads the ranks that were actually stored.
// Ported and passed against the string queries first, then run unchanged against the
// typed ones.
//
// The rules (see the rosters skill): rank 1..N nominated, 99+ reserves in order, per
// (team, gender); a save settles a gender's two lists together, taking membership from
// the payload; a move renumbers both ends; everything is one transaction.
const db = require('../../db_connect');
const Roster = require('../../models/roster');

const run = (text, params) => db.otherConnect().then(c => c.query(text, params)).then(([r]) => [...r]);

let CLUB, OTHER_CLUB, VENUE;
const A = 1001, B = 1002;

beforeEach(async () => {
  const clubs = await run('SELECT id, venue FROM club WHERE venue IS NOT NULL AND id <> 63 ORDER BY id LIMIT 2');
  [CLUB, OTHER_CLUB] = clubs.map(c => c.id);
  VENUE = clubs[0].venue;
  await run(`INSERT INTO team (id, name, club, venue, rank) VALUES
    (${A}, 'Scratch A', ${CLUB}, ${VENUE}, 1), (${B}, 'Scratch B', ${OTHER_CLUB}, ${VENUE}, 1)`);
});

// players(A, 'Male', { 7: 1, 8: 2 }) — ids are offset into the test range.
const P = n => 10000 + n;
async function players(team, gender, ranks) {
  const club = team === A ? CLUB : OTHER_CLUB;
  for (const [n, rank] of Object.entries(ranks)) {
    await run('INSERT INTO player (id, first_name, family_name, gender, club, team, rank) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [P(Number(n)), 'Test', `Player${n}`, gender, club, team, rank]);
  }
}
// { 7: 1, 8: 2 } back out of the table, for one team and gender.
async function ranks(team, gender) {
  const rows = await run('SELECT id, rank FROM player WHERE team = ? AND gender = ? ORDER BY rank NULLS LAST, id', [team, gender]);
  return Object.fromEntries(rows.map(r => [r.id - 10000, r.rank]));
}
const ids = list => list.map(P);
const back = updated => updated.map(u => ({ id: Number(u.id) - 10000, rank: u.rank }));

describe('saveTeamOrder', () => {
  it('numbers a nominated section from 1 in the order given', async () => {
    await players(A, 'Male', { 7: 1, 8: 2, 9: 3 });
    await Roster.saveTeamOrder(A, [{ gender: 'Male', section: 'nominated', playerIds: ids([9, 7, 8]) }]);
    expect(await ranks(A, 'Male')).toEqual({ 9: 1, 7: 2, 8: 3 });
  });

  // The headline reserve fix: sequential from 99 rather than all-99.
  it('numbers a reserve section sequentially from 99', async () => {
    await players(A, 'Female', { 21: 99, 22: 99, 23: 99 });
    const updated = await Roster.saveTeamOrder(A, [{ gender: 'Female', section: 'reserve', playerIds: ids([23, 21, 22]) }]);
    expect(await ranks(A, 'Female')).toEqual({ 23: 99, 21: 100, 22: 101 });
    // 23 already held 99, so it was not written.
    expect(back(updated)).toEqual([{ id: 21, rank: 100 }, { id: 22, rank: 101 }]);
  });

  it('writes nothing for a list already in order', async () => {
    await players(A, 'Male', { 7: 1, 8: 2 });
    expect(await Roster.saveTeamOrder(A, [{ gender: 'Male', section: 'nominated', playerIds: ids([7, 8]) }])).toEqual([]);
  });

  // Repairs the gaps the old client-side renumbering left behind.
  it('closes gaps in an existing sequence', async () => {
    await players(A, 'Male', { 7: 1, 8: 2, 9: 4, 10: 6 });
    await Roster.saveTeamOrder(A, [{ gender: 'Male', section: 'nominated', playerIds: ids([7, 8, 9, 10]) }]);
    expect(await ranks(A, 'Male')).toEqual({ 7: 1, 8: 2, 9: 3, 10: 4 });
  });

  // A stale page could otherwise pull a player into a team just by naming them.
  it('ignores ids that do not belong to the team and gender', async () => {
    await players(A, 'Male', { 7: 1, 8: 2 });
    await players(A, 'Female', { 30: 1 });
    await players(B, 'Male', { 40: 1 });
    await Roster.saveTeamOrder(A, [{ gender: 'Male', section: 'nominated', playerIds: ids([40, 30, 8, 7]) }]);
    expect(await ranks(A, 'Male')).toEqual({ 8: 1, 7: 2 });
    expect(await ranks(A, 'Female')).toEqual({ 30: 1 });
    expect(await ranks(B, 'Male')).toEqual({ 40: 1 });
  });

  it('appends section members the payload left out', async () => {
    await players(A, 'Male', { 7: 1, 8: 2, 9: 3 });
    await Roster.saveTeamOrder(A, [{ gender: 'Male', section: 'nominated', playerIds: ids([9]) }]);
    expect(await ranks(A, 'Male')).toEqual({ 9: 1, 7: 2, 8: 3 });
  });

  it('leaves the other section alone when only one is posted', async () => {
    await players(A, 'Male', { 7: 1, 8: 99, 9: 100 });
    expect(await Roster.saveTeamOrder(A, [{ gender: 'Male', section: 'nominated', playerIds: ids([7]) }])).toEqual([]);
  });

  it('settles all four lists of a team card', async () => {
    await players(A, 'Male', { 1: 2, 3: 100 });
    await players(A, 'Female', { 2: 3, 4: 105 });
    await Roster.saveTeamOrder(A, [
      { gender: 'Male', section: 'nominated', playerIds: ids([1]) },
      { gender: 'Female', section: 'nominated', playerIds: ids([2]) },
      { gender: 'Male', section: 'reserve', playerIds: ids([3]) },
      { gender: 'Female', section: 'reserve', playerIds: ids([4]) },
    ]);
    expect(await ranks(A, 'Male')).toEqual({ 1: 1, 3: 99 });
    expect(await ranks(A, 'Female')).toEqual({ 2: 1, 4: 99 });
  });

  // The live bug: Featherforce A's only reserve man would not stick as nominated. The
  // save wrote nothing and reported success.
  it('promotes a reserve into the nominated list', async () => {
    await players(A, 'Male', { 1: 1, 2: 2, 3: 3, 4: 4, 5: 99 });
    const updated = await Roster.saveTeamOrder(A, [
      { gender: 'Male', section: 'nominated', playerIds: ids([1, 2, 3, 4, 5]) },
      { gender: 'Male', section: 'reserve', playerIds: [] },
    ]);
    expect(back(updated)).toEqual([{ id: 5, rank: 5 }]);
    expect(await ranks(A, 'Male')).toEqual({ 1: 1, 2: 2, 3: 3, 4: 4, 5: 5 });
  });

  it('demotes a nominated player into the reserves and closes the gap', async () => {
    await players(A, 'Male', { 7: 1, 8: 2, 9: 3, 21: 99 });
    await Roster.saveTeamOrder(A, [
      { gender: 'Male', section: 'nominated', playerIds: ids([7, 9]) },
      { gender: 'Male', section: 'reserve', playerIds: ids([21, 8]) },
    ]);
    expect(await ranks(A, 'Male')).toEqual({ 7: 1, 9: 2, 21: 99, 8: 100 });
  });

  it('handles a swap in both directions at once', async () => {
    await players(A, 'Male', { 7: 1, 8: 2, 21: 99 });
    await Roster.saveTeamOrder(A, [
      { gender: 'Male', section: 'nominated', playerIds: ids([7, 21]) },
      { gender: 'Male', section: 'reserve', playerIds: ids([8]) },
    ]);
    expect(await ranks(A, 'Male')).toEqual({ 7: 1, 21: 2, 8: 99 });
  });

  it('gives the nominated list first claim on a player named in both', async () => {
    await players(A, 'Male', { 7: 1, 8: 99 });
    await Roster.saveTeamOrder(A, [
      { gender: 'Male', section: 'nominated', playerIds: ids([7, 8]) },
      { gender: 'Male', section: 'reserve', playerIds: ids([8]) },
    ]);
    expect(await ranks(A, 'Male')).toEqual({ 7: 1, 8: 2 });
  });

  it('still refuses an id from another team even when it is named as nominated', async () => {
    await players(A, 'Male', { 7: 1 });
    await players(B, 'Male', { 40: 3 });
    await Roster.saveTeamOrder(A, [
      { gender: 'Male', section: 'nominated', playerIds: ids([7, 40]) },
      { gender: 'Male', section: 'reserve', playerIds: [] },
    ]);
    expect(await ranks(B, 'Male')).toEqual({ 40: 3 });
  });

  // A real failure, not a simulated one: a trigger refuses the second gender's write, and
  // the first gender's — already sent — must not survive it.
  it('rolls back rather than half-applying', async () => {
    await players(A, 'Male', { 7: 5, 8: 6 });
    await players(A, 'Female', { 30: 5 });
    await run(`CREATE FUNCTION pg_temp.refuse() RETURNS trigger AS $$
      BEGIN RAISE EXCEPTION 'refused by test'; END $$ LANGUAGE plpgsql`);
    await run(`CREATE TRIGGER refuse_female BEFORE UPDATE ON player FOR EACH ROW
      WHEN (NEW.id = ${P(30)}) EXECUTE FUNCTION pg_temp.refuse()`);

    await expect(Roster.saveTeamOrder(A, [
      { gender: 'Male', section: 'nominated', playerIds: ids([7, 8]) },
      { gender: 'Female', section: 'nominated', playerIds: ids([30]) },
    ])).rejects.toThrow('refused by test');
    expect(await ranks(A, 'Male')).toEqual({ 7: 5, 8: 6 });
  });
});

describe('movePlayer', () => {
  it('appends to the destination, re-homes the player, and closes the gap in the source', async () => {
    await players(A, 'Male', { 7: 1, 5: 2, 9: 3 });
    await players(B, 'Male', { 1: 1, 2: 2, 3: 3 });
    const result = await Roster.movePlayer(P(5), B, 'nominated');
    expect(result).toMatchObject({ playerId: P(5), teamId: B, rank: 4, name: 'Test Player5' });
    expect(await ranks(A, 'Male')).toEqual({ 7: 1, 9: 2 });
    expect(await ranks(B, 'Male')).toEqual({ 1: 1, 2: 2, 3: 3, 5: 4 });
    expect((await run('SELECT club FROM player WHERE id = ?', [P(5)]))[0].club).toBe(OTHER_CLUB);
  });

  it('appends to a reserve destination from 99, not from 1', async () => {
    await players(A, 'Male', { 5: 1 });
    await players(B, 'Male', { 1: 1 });
    expect((await Roster.movePlayer(P(5), B, 'reserve')).rank).toBe(99);
  });

  it('continues an existing reserve sequence', async () => {
    await players(A, 'Male', { 5: 1 });
    await players(B, 'Male', { 1: 99, 2: 100 });
    expect((await Roster.movePlayer(P(5), B, 'reserve')).rank).toBe(101);
  });

  it('renumbers both ends when only the section changes', async () => {
    await players(A, 'Male', { 1: 1, 2: 2, 5: 99, 6: 100 });
    await Roster.movePlayer(P(5), A, 'nominated');
    expect(await ranks(A, 'Male')).toEqual({ 1: 1, 2: 2, 5: 3, 6: 99 });
  });

  it('404s for an unknown player instead of writing anything', async () => {
    await expect(Roster.movePlayer(P(999), B, 'nominated')).rejects.toMatchObject({ status: 404 });
  });

  it('404s for an unknown destination team and leaves the player where they were', async () => {
    await players(A, 'Male', { 5: 1 });
    await expect(Roster.movePlayer(P(5), 999999, 'nominated')).rejects.toMatchObject({ status: 404 });
    expect(await ranks(A, 'Male')).toEqual({ 5: 1 });
  });
});

describe('releasePlayer', () => {
  it('parks the player on the No Club / No Team sentinel and compacts the old team', async () => {
    await players(A, 'Male', { 7: 1, 5: 2, 9: 3 });
    expect(await Roster.releasePlayer(P(5))).toMatchObject({ playerId: P(5), name: 'Test Player5', from: 'Scratch A' });
    expect(await run('SELECT club, team, rank FROM player WHERE id = ?', [P(5)]))
      .toEqual([{ club: Roster.NO_CLUB_ID, team: Roster.NO_TEAM_ID, rank: 99 }]);
    expect(Roster.NO_CLUB_ID).toBe(63);
    expect(Roster.NO_TEAM_ID).toBe(52);
    expect(await ranks(A, 'Male')).toEqual({ 7: 1, 9: 2 });
  });

  it('404s for an unknown player', async () => {
    await expect(Roster.releasePlayer(P(999))).rejects.toMatchObject({ status: 404 });
  });
});

describe('addToTeam', () => {
  it('adds as the next reserve, at the team\'s club', async () => {
    await players(A, 'Female', { 77: 1 });
    await players(B, 'Female', { 1: 99 });
    expect(await Roster.addToTeam(P(77), B, 'reserve')).toEqual({ playerId: P(77), teamId: B, rank: 100 });
    expect((await run('SELECT club FROM player WHERE id = ?', [P(77)]))[0].club).toBe(OTHER_CLUB);
  });

  it('adds as the next nominated player', async () => {
    await players(A, 'Male', { 77: 99 });
    await players(B, 'Male', { 1: 1, 2: 2 });
    expect((await Roster.addToTeam(P(77), B, 'nominated')).rank).toBe(3);
  });

  it('404s for an unknown player', async () => {
    await expect(Roster.addToTeam(P(999), B, 'reserve')).rejects.toMatchObject({ status: 404 });
  });
});

describe('createPlayer', () => {
  it('returns the new id, placed in the team', async () => {
    await players(B, 'Male', { 1: 99 });
    const placed = await Roster.createPlayer({ firstName: 'New', familyName: 'Rosterplayer', gender: 'Male',
      clubId: OTHER_CLUB, teamId: B, section: 'reserve' });
    expect(placed).toMatchObject({ teamId: B, rank: 100 });
    expect(await run('SELECT first_name, family_name, team, rank FROM player WHERE id = ?', [placed.playerId]))
      .toEqual([{ first_name: 'New', family_name: 'Rosterplayer', team: B, rank: 100 }]);
  });

  // The INSERT and the placement were two transactions, so a failure between them left a
  // player on the team with no rank while the captain was told it had failed.
  it('creates and places in ONE transaction: a placement that fails takes the insert with it', async () => {
    await expect(Roster.createPlayer({ firstName: 'New', familyName: 'Rosterorphan', gender: 'Male',
      clubId: CLUB, teamId: 999999, section: 'nominated' })).rejects.toBeTruthy();
    expect(await run("SELECT id FROM player WHERE family_name = 'Rosterorphan'")).toEqual([]);
  });
});

describe('findCandidates', () => {
  // It was two `ILIKE '%term%'` queries, so "Mary Whitle" could not find the "Marry
  // Whitle" on file and the modal suggested creating her again.
  it('finds a stored name from a misspelt search, and splits matches by club', async () => {
    await players(A, 'Female', { 50: 1 });
    await run(`UPDATE player SET first_name = 'Marry', family_name = 'Whitle' WHERE id = ?`, [P(50)]);
    const [{ name: clubName }] = await run('SELECT name FROM club WHERE id = ?', [CLUB]);
    const own = await Roster.findCandidates('Mary Whitle', clubName);
    expect(own.ownClub.map(p => p.playerId)).toContain(P(50));
    const other = await Roster.findCandidates('Mary Whitle', 'Somewhere Else');
    expect(other.otherClubs.map(p => p.playerId)).toContain(P(50));
  });

  it('keeps a player whose team resolves to nothing', async () => {
    await run(`INSERT INTO player (id, first_name, family_name, gender, club, team) VALUES (?, 'Ben', 'Holcomeunique', 'Male', 63, NULL)`, [P(60)]);
    const found = await Roster.findCandidates('Ben Holcomeunique', 'Shell');
    expect(found.unattached.map(p => p.playerId)).toContain(P(60));
  });
});

// A reorder writes ONE statement, however many players change. Sentry NODE-13 (Sep 2026)
// was the per-player version: 8–12 sequential round trips inside a held transaction. This
// is the shape that comes back when somebody adds a per-player concern inside the loop,
// so it is counted, not assumed. Ported from roster-rank-batching.test.js, which counted
// calls on a fake connection.
describe('a renumber is one UPDATE, however many players change', () => {
  const { Kysely, PostgresDialect } = require('kysely');
  function counting() {
    const sqls = [];
    const pool = { connect: () => db.pool().connect(), end: async () => {} };
    const q = new Kysely({ dialect: new PostgresDialect({ pool }), log: e => sqls.push(e.query.sql) });
    return { q, updates: () => sqls.filter(s => /^\s*update/i.test(s)) };
  }

  it('renumberGender: four changed players, nominated and reserve, one statement', async () => {
    await players(A, 'Male', { 1: 1, 2: 2, 3: 3, 4: 4, 5: 99, 6: 100 });
    const { q, updates } = counting();
    const updated = await Roster.renumberGender(q, A, 'Male', { nominated: ids([4, 3, 2, 1]), reserve: ids([6, 5]) });
    expect(updated).toHaveLength(6);
    expect(updates()).toHaveLength(1);
    expect(await ranks(A, 'Male')).toEqual({ 4: 1, 3: 2, 2: 3, 1: 4, 6: 99, 5: 100 });
  });

  it('renumberGender: nothing changed, nothing written', async () => {
    await players(A, 'Male', { 1: 1, 2: 2 });
    const { q, updates } = counting();
    expect(await Roster.renumberGender(q, A, 'Male', { nominated: ids([1, 2]) })).toEqual([]);
    expect(updates()).toHaveLength(0);
  });

  it('renumberSection: one statement, and the unchanged are skipped', async () => {
    await players(A, 'Male', { 1: 1, 2: 2, 3: 3 });
    const { q, updates } = counting();
    const updated = await Roster.renumberSection(q, A, 'Male', 'nominated', ids([1, 3, 2]));
    expect(back(updated)).toEqual([{ id: 3, rank: 2 }, { id: 2, rank: 3 }]);
    expect(updates()).toHaveLength(1);
  });
});

// Moved from __tests__/unit/withdrawn-team-filters.test.js, which read the SQL out of a
// mocked db_connect. A withdrawn team (HARD-10/11) must not be offered as somewhere to put
// a player, nor counted towards its club in the picker.
describe('withdrawn teams are not handed out', () => {
  it('getClubTeams leaves a withdrawn team out of the "Move to…" list', async () => {
    const [{ name }] = await run('SELECT name FROM club WHERE id = ?', [CLUB]);
    expect((await Roster.getClubTeams(name)).map(t => t.id)).toContain(A);
    await run('UPDATE team SET withdrawn = now() WHERE id = ?', [A]);
    expect((await Roster.getClubTeams(name)).map(t => t.id)).not.toContain(A);
  });

  it('getClubSummaries counts neither a withdrawn team nor its players', async () => {
    await players(A, 'Male', { 1: 1, 2: 2 });
    const count = async () => (await Roster.getClubSummaries()).find(c => c.id === CLUB);
    const before = await count();
    await run('UPDATE team SET withdrawn = now() WHERE id = ?', [A]);
    expect(await count()).toEqual({ ...before, teams: before.teams - 1, players: before.players - 2 });
  });
});
