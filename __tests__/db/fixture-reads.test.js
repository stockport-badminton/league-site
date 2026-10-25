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
});
