// models/fixture.js's public-page reads against a real Postgres (REARCH-01).
//
// The event-page/sitemap agreement was checked by reading SQL out of a mocked db_connect
// (withdrawn-team-filters.test.js), with a note that it had been "verified behaviourally
// against the local Postgres — withdrawing a live team removed both, restoring it put both
// back". This is that verification, kept. Passed against the string queries first, then
// unchanged against the typed ones.
const db = require('../../db_connect');
const Fixture = require('../../models/fixture');

const run = (text, params) => db.otherConnect().then(c => c.query(text, params)).then(([r]) => [...r]);

describe('a withdrawn team gets no public event page, and the sitemap agrees', () => {
  // HARD-11 reinstated 19 deleted teams as withdrawn rows so historical fixtures resolve.
  // Those rows are for referential integrity, not public pages (owner's call, 14 Sep 2026),
  // and a sitemap entry whose page does not render is a soft 404.
  it('drops the fixture from both while either team is withdrawn, and restores both', async () => {
    const [f] = await run(`SELECT f.id, f."homeTeam", f."awayTeam" FROM fixture f
      WHERE f.date > now() - interval '6 months' ORDER BY f.id DESC LIMIT 1`);
    const inSitemap = async () => (await Fixture.getForSitemap(18)).some(r => r.id === f.id);

    expect(await Fixture.getFixtureEventById(f.id)).toHaveLength(1);
    expect(await inSitemap()).toBe(true);

    for (const team of [f.homeTeam, f.awayTeam]) {
      await run('UPDATE team SET withdrawn = now() WHERE id = ?', [team]);
      expect(await Fixture.getFixtureEventById(f.id)).toHaveLength(0);
      expect(await inSitemap()).toBe(false);
      await run('UPDATE team SET withdrawn = NULL WHERE id = ?', [team]);
    }
    expect(await Fixture.getFixtureEventById(f.id)).toHaveLength(1);
    expect(await inSitemap()).toBe(true);
  });

  // An inner join to an optional officer once returned an empty page for every home
  // fixture of a team with no captain flagged (48 fixtures, gotcha 1c).
  it('still renders a fixture whose home team has no captain or match secretary', async () => {
    const [f] = await run(`SELECT id, "homeTeam" FROM fixture ORDER BY id DESC LIMIT 1`);
    await run('UPDATE player SET "teamCaptain" = 0 WHERE team = ?', [f.homeTeam]);
    await run('UPDATE player SET "matchSecrertary" = 0 WHERE club = (SELECT club FROM team WHERE id = ?)', [f.homeTeam]);
    const [row] = await Fixture.getFixtureEventById(f.id);
    expect(row).toMatchObject({ id: f.id, teamCaptain: null, teamCaptainId: null, matchSecretary: null });
  });

  it("carries the home team's venue directions as venueDirections", async () => {
    const [f] = await run(`SELECT f.id, t.venue FROM fixture f JOIN team t ON t.id = f."homeTeam"
      WHERE t.venue IS NOT NULL ORDER BY f.id DESC LIMIT 1`);
    await run('UPDATE venue SET directions = ? WHERE id = ?', ['Use the South site entrance.', f.venue]);
    const [row] = await Fixture.getFixtureEventById(f.id);
    expect(row.venueDirections).toBe('Use the South site entrance.');
  });
});

// What an event page says about the two teams going into a match (utils/fixturePreview.js).
// Built in a season of its own, well clear of the real fixtures.
describe('getMatchContext', () => {
  const A = 95001, B = 95002, C = 95003;
  const day = d => `2031-${d}`;

  beforeEach(async () => {
    await run(`INSERT INTO season (id, name, "startDate", "endDate", label) VALUES
      (95001, '20302031', '2030-08-01', '2031-01-01', 'test'), (95002, '20312032', '2031-08-01', '2032-06-30', 'test')`);
    const [club] = await run('SELECT id, venue FROM club WHERE venue IS NOT NULL AND id <> 63 ORDER BY id LIMIT 1');
    const [div] = await run('SELECT id FROM division WHERE league = 1 ORDER BY rank LIMIT 1');
    await run(`INSERT INTO team (id, name, club, venue, rank, division, "divRank", penalties) VALUES
      (${A}, 'Context A', ?, ?, 1, ?, 1, 0), (${B}, 'Context B', ?, ?, 2, ?, 2, 0), (${C}, 'Context C', ?, ?, 3, ?, 3, 0)`,
    [club.id, club.venue, div.id, club.id, club.venue, div.id, club.id, club.venue, div.id]);
    const f = (id, date, home, away, status, hs, as) => run(`INSERT INTO fixture (id, date, "homeTeam", "awayTeam", status, "homeScore", "awayScore")
      VALUES (?, ?, ?, ?, ?, ?, ?)`, [id, date, home, away, status, hs, as]);
    await f(950001, '2030-10-01', B, A, 'complete', 12, 6) // last season: a meeting, not form
    await f(950002, day('09-10'), A, C, 'complete', 11, 7)
    await f(950003, day('09-17'), C, B, 'complete', 4, 14)
    await f(950004, day('09-24'), A, C, 'void', null, null) // never counted
    await f(950005, day('09-24'), B, C, 'rearranged', 10, 8) // a scored row superseded: not a result
    await f(950006, day('10-01'), A, B, 'outstanding', null, null) // the match itself
    await f(950007, day('10-08'), A, C, 'complete', 18, 0) // after it: not form going in
    await run(`INSERT INTO game (fixture, "gameType", "homeScore", "awayScore") VALUES
      (950006, 'FirstMens', 21, 15), (950006, 'FirstLadies', 18, 21), (950006, 'FirstMixed', NULL, NULL)`);
  });

  it('gives the season, both teams’ results before the match, the meetings, and this fixture’s games', async () => {
    const ctx = await Fixture.getMatchContext({ id: 950006, date: new Date(2031, 9, 1), homeTeamId: A, awayTeamId: B });
    expect(ctx.season).toBe('20312032');
    expect(ctx.form.map(r => r.id)).toEqual([950003, 950002]);
    expect(ctx.form[0]).toMatchObject({ homeTeam: C, awayTeam: B, homeScore: 4, awayScore: 14, homeName: 'Context C', awayName: 'Context B' });
    expect(ctx.meetings.map(r => r.id)).toEqual([950001]);
    expect(ctx.meetings[0]).toMatchObject({ homeTeam: B, awayTeam: A, homeName: 'Context B', awayName: 'Context A' });
    expect(ctx.games).toEqual([
      { gameType: 'FirstMens', homeScore: 21, awayScore: 15 },
      { gameType: 'FirstLadies', homeScore: 18, awayScore: 21 },
    ]);
  });

  it('has no season and no form for a date no season holds, and still finds the meetings', async () => {
    const ctx = await Fixture.getMatchContext({ id: 950006, date: new Date(2031, 6, 15), homeTeamId: A, awayTeamId: B });
    expect(ctx.season).toBeNull();
    expect(ctx.form).toEqual([]);
    expect(ctx.meetings.map(r => r.id)).toEqual([950001]);
  });
});

describe('getFixtureSummaryById', () => {
  // The clubs decide who may open the scorecard (fixtureController.getScorecard).
  it('names both teams\' clubs', async () => {
    const [f] = await run(`SELECT f.id, hc.name AS "homeClub", ac.name AS "awayClub" FROM fixture f
      JOIN team h ON h.id = f."homeTeam" JOIN club hc ON hc.id = h.club
      JOIN team a ON a.id = f."awayTeam" JOIN club ac ON ac.id = a.club
      ORDER BY f.id DESC LIMIT 1`);
    const [row] = await Fixture.getFixtureSummaryById(f.id);
    expect(row).toMatchObject({ id: f.id, homeClub: f.homeClub, awayClub: f.awayClub });
  });
});
