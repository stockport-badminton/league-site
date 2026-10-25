// Withdrawing and reinstating a team (HARD-10) against a real Postgres (REARCH-01).
//
// Ported from __tests__/unit/league-withdrawal.test.js, which faked db_connect and read
// the statements back, because when it was written there was no database to run them
// against. Every rule is kept and asserted on what the database holds afterwards. Passed
// against the string queries first, then run unchanged against the typed ones.
//
//   - a withdrawal never deletes a team row (deleting is how 2,132 fixtures came to
//     point at teams that no longer exist — HARD-11)
//   - it voids only fixtures with no result
//   - it refuses to run twice, including when a concurrent withdrawal wins the race
//   - reinstating un-voids only the fixtures this withdrawal voided, and only if still
//     unplayed — not the 114 voided during HARD-09 for unrelated reasons
const db = require('../../db_connect');
const League = require('../../models/league');
const Season = require('../../models/season');

const run = (text, params) => db.otherConnect().then(c => c.query(text, params)).then(([r]) => [...r]);

const T = 1001, OPP = 1002;
let DIVISION, F;

beforeEach(async () => {
  // The current season must have a window round today, whatever today is.
  await run(`INSERT INTO season (id, name, "startDate", "endDate", label)
    SELECT 1001, ?, now() - interval '30 days', now() + interval '300 days', 'test'
    WHERE NOT EXISTS (SELECT 1 FROM season WHERE name = ?)`, [Season.current(), Season.current()]);
  const [club] = await run('SELECT id, venue FROM club WHERE venue IS NOT NULL AND id <> 63 ORDER BY id LIMIT 1');
  const [{ id }] = await run('SELECT id FROM division ORDER BY id LIMIT 1');
  DIVISION = id;
  await run(`INSERT INTO team (id, name, club, venue, rank, division, "divRank") VALUES
    (${T}, 'Withdrawing A', ${club.id}, ${club.venue}, 1, ${DIVISION}, 1),
    (${OPP}, 'Opponent A', ${club.id}, ${club.venue}, 1, ${DIVISION}, 2)`);

  // One fixture in each state the rules tell apart, all inside this season.
  const fixture = (n, status, home = null, away = null, days = 7) => run(
    `INSERT INTO fixture (id, "homeTeam", "awayTeam", date, status, "homeScore", "awayScore")
     VALUES (?, ?, ?, date_trunc('day', now()) + make_interval(days => ?), ?, ?, ?)`,
    [n, T, OPP, days, status, home, away]);
  F = { outstanding: 1001, blank: 1002, complete: 1003, rearranged: 1004, oldVoid: 1005 };
  await fixture(F.outstanding, 'outstanding');
  await fixture(F.blank, 'outstanding', null, null, 14);   // '' is refused by fixture_status_check now
  await fixture(F.complete, 'complete', 10, 8, -7);
  await fixture(F.rearranged, 'rearranged');
  await fixture(F.oldVoid, 'void');
  await run(`INSERT INTO player (id, first_name, family_name, gender, club, team, rank) VALUES
    (10001, 'Test', 'One', 'Male', ${club.id}, ${T}, 1), (10002, 'Test', 'Two', 'Female', ${club.id}, ${T}, 1)`);
});

const statuses = async () => Object.fromEntries((await run(
  `SELECT id, status FROM fixture WHERE id BETWEEN 1001 AND 1005 ORDER BY id`)).map(r => [r.id, r.status]));
const team = async () => (await run(`SELECT division, "divRank", withdrawn IS NOT NULL AS withdrawn,
  "withdrawnDivision", "withdrawnReason", "withdrawnFixtures" FROM team WHERE id = ?`, [T]))[0];

describe('getWithdrawalImpact', () => {
  it('counts outstanding and recorded fixtures separately, and the players, and writes nothing', async () => {
    const impact = await League.getWithdrawalImpact(T);
    expect(impact).toMatchObject({ outstandingFixtures: 2, recordedFixtures: 3, players: 2, season: Season.current() });
    expect(impact.team).toMatchObject({ id: T, name: 'Withdrawing A', division: DIVISION, withdrawn: null });
    expect((await team()).withdrawn).toBe(false);
  });

  // gotcha 1c: an inner join to something optional loses the whole preview.
  it('still previews a team with no fixtures at all', async () => {
    expect(await League.getWithdrawalImpact(OPP + 0)).toMatchObject({ outstandingFixtures: 2 });
    await run('DELETE FROM fixture WHERE id BETWEEN 1001 AND 1005');
    expect(await League.getWithdrawalImpact(T)).toMatchObject({ outstandingFixtures: 0, recordedFixtures: 0, players: 2 });
  });

  it('returns null for an unknown team', async () => {
    expect(await League.getWithdrawalImpact(999999)).toBeNull();
  });
});

describe('withdrawTeam', () => {
  it('voids only the fixtures with no result, clears and remembers the division, deletes nothing', async () => {
    const before = await run('SELECT (SELECT count(*) FROM team)::int AS t, (SELECT count(*) FROM fixture)::int AS f');
    const result = await League.withdrawTeam(T, { reason: 'folded' });

    expect(result).toMatchObject({ teamId: T, name: 'Withdrawing A', division: DIVISION, season: Season.current() });
    expect([...result.voidedFixtures].sort()).toEqual([F.outstanding, F.blank]);
    expect(await statuses()).toEqual({ [F.outstanding]: 'void', [F.blank]: 'void', [F.complete]: 'complete',
      [F.rearranged]: 'rearranged', [F.oldVoid]: 'void' });
    const t = await team();
    expect(t).toMatchObject({ division: null, withdrawn: true, withdrawnDivision: DIVISION, withdrawnReason: 'folded' });
    expect([...t.withdrawnFixtures].sort()).toEqual([F.outstanding, F.blank]);
    expect(await run('SELECT (SELECT count(*) FROM team)::int AS t, (SELECT count(*) FROM fixture)::int AS f')).toEqual(before);
    expect((await League.getWithdrawnTeams()).map(w => w.id)).toContain(T);
  });

  it('refuses to run twice, naming the date, and writes nothing the second time', async () => {
    await League.withdrawTeam(T, { reason: 'folded' });
    await run(`UPDATE fixture SET status = 'outstanding' WHERE id = ?`, [F.rearranged]);
    await expect(League.withdrawTeam(T, {})).rejects.toMatchObject({
      status: 409, message: expect.stringMatching(/already withdrawn on \d{4}-\d\d-\d\d/) });
    expect((await statuses())[F.rearranged]).toBe('outstanding');
  });

  // The SELECT saw withdrawn = NULL, but by the UPDATE someone else had claimed the row.
  // A trigger that skips the team write stands in for that someone.
  it('rolls back the voiding if the team write finds no row to claim', async () => {
    await run(`CREATE FUNCTION pg_temp.skip() RETURNS trigger AS $$ BEGIN RETURN NULL; END $$ LANGUAGE plpgsql`);
    await run(`CREATE TRIGGER skip_team BEFORE UPDATE ON team FOR EACH ROW WHEN (NEW.id = ${T}) EXECUTE FUNCTION pg_temp.skip()`);
    await expect(League.withdrawTeam(T, {})).rejects.toMatchObject({ status: 409 });
    expect((await statuses())[F.outstanding]).toBe('outstanding');
  });

  it('404s an unknown team without touching a fixture', async () => {
    await expect(League.withdrawTeam(999999, {})).rejects.toMatchObject({ status: 404 });
    expect((await statuses())[F.outstanding]).toBe('outstanding');
  });

  it('stores a blank reason as NULL rather than an empty string', async () => {
    await League.withdrawTeam(T, { reason: '   ' });
    expect((await team()).withdrawnReason).toBeNull();
  });
});

describe('reinstateTeam', () => {
  it('puts the team back in its division, at the bottom, and un-voids what it voided', async () => {
    await League.withdrawTeam(T, { reason: 'folded' });
    const [{ max }] = await run('SELECT max("divRank") AS max FROM team WHERE division = ?', [DIVISION]);
    const result = await League.reinstateTeam(T);

    expect(result).toMatchObject({ teamId: T, division: DIVISION });
    expect([...result.restoredFixtures].sort()).toEqual([F.outstanding, F.blank]);
    expect(await team()).toEqual({ division: DIVISION, divRank: max + 1, withdrawn: false,
      withdrawnDivision: null, withdrawnReason: null, withdrawnFixtures: null });
    // Restored as 'outstanding', whatever they held before; the old void stays void.
    expect(await statuses()).toEqual({ [F.outstanding]: 'outstanding', [F.blank]: 'outstanding',
      [F.complete]: 'complete', [F.rearranged]: 'rearranged', [F.oldVoid]: 'void' });
  });

  it('leaves a voided fixture alone if it has since been given a result', async () => {
    await League.withdrawTeam(T, {});
    await run(`UPDATE fixture SET "homeScore" = 9, "awayScore" = 9 WHERE id = ?`, [F.blank]);
    const result = await League.reinstateTeam(T);
    expect(result.restoredFixtures).toEqual([F.outstanding]);
    expect((await statuses())[F.blank]).toBe('void');
  });

  it('touches no fixture when the withdrawal voided none', async () => {
    await run(`UPDATE fixture SET status = 'complete' WHERE id IN (?, ?)`, [F.outstanding, F.blank]);
    await League.withdrawTeam(T, {});
    expect((await League.reinstateTeam(T)).restoredFixtures).toEqual([]);
  });

  it('refuses a team that is not withdrawn', async () => {
    await expect(League.reinstateTeam(T)).rejects.toMatchObject({ status: 409 });
    expect((await team()).division).toBe(DIVISION);
  });

  it('refuses when no division was recorded to return to', async () => {
    await League.withdrawTeam(T, {});
    await run('UPDATE team SET "withdrawnDivision" = NULL WHERE id = ?', [T]);
    await expect(League.reinstateTeam(T)).rejects.toMatchObject({ status: 409 });
    expect((await team()).withdrawn).toBe(true);
  });

  it('404s an unknown team', async () => {
    await expect(League.reinstateTeam(999999)).rejects.toMatchObject({ status: 404 });
  });
});

describe('getTeamPlayerIds', () => {
  it('lists the players still on a team, in rank order', async () => {
    expect(await League.getTeamPlayerIds(T)).toEqual([10001, 10002]);
    expect(await League.getTeamPlayerIds(999999)).toEqual([]);
  });
});

// Moved from __tests__/unit/league-withdrawal.test.js, which read the statement out of a
// mocked db_connect. They could not run against a database until migration 026 put
// season."clubFee" into the schema: before it, the query failed everywhere but production.
describe('getAnnualInvoices', () => {
  const teamsFor = async (clubId, name) => {
    const rows = await League.getAnnualInvoices(name);
    const mine = rows.filter(r => r.clubId === clubId);
    return mine.length ? Number(mine[0].teamsCount) : 0;
  };
  let club;
  beforeEach(async () => { [club] = await run('SELECT c.id, c.name FROM club c JOIN team t ON t.club = c.id WHERE t.id = ?', [T]); });

  it('does not count a withdrawn team as entered', async () => {
    const before = await teamsFor(club.id);
    await League.withdrawTeam(T, {});
    expect(await teamsFor(club.id)).toBe(before - 1);
  });

  it('filters to the club it is asked about, and charges the season\'s fee', async () => {
    const rows = await League.getAnnualInvoices(club.name);
    expect(rows.length).toBeGreaterThan(0);
    expect(new Set(rows.map(r => r.clubName))).toEqual(new Set([club.name]));
    expect(rows.every(r => Number(r.clubFee) > 0)).toBe(true);
  });

  // No Club holds No Team, so it looks like a club with two teams. It was kept off the
  // invoice only by accident until the officer join was made LEFT.
  it('never invoices the No Club sentinel', async () => {
    expect((await League.getAnnualInvoices()).some(r => r.clubId === 63)).toBe(false);
  });

  // An INNER join to the secretary dropped a club with none flagged from the run entirely.
  it('still invoices a club with no secretary flagged, with a NULL secretary', async () => {
    await run('UPDATE player SET "clubSecretary" = 0 WHERE club = ?', [club.id]);
    const rows = await League.getAnnualInvoices(club.name);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every(r => r.secretary === null && r.playerEmail === null)).toBe(true);
  });
});
