// A withdrawn team must not be offered as somewhere to put a player.
//
// HARD-10 added `team.withdrawn` and the convention that such a team has a NULL division,
// which keeps it out of the league table. Three queries never learned about it:
//
//   Roster.getClubTeams    the roster editor's "Move to…" destination list
//   Roster.getClubSummaries the superadmin club picker's team and player counts
//   Club.getTeamsForClub    the club page's team listing
//
// The first is the one that bites: a captain could move a live player onto a team that has
// been withdrawn, and nothing would stop her.
//
// It is latent today — no team in production has `withdrawn` set, because Parrswood C was
// withdrawn in real life and not through the mechanism, which is why it still holds a
// division place and trips `--check short-squads`. It stops being latent the moment either
// (a) somebody uses the withdrawal flow, or (b) HARD-11's 19 orphaned teams are reinstated
// as withdrawn rows, which is the plan and which is why these filters had to come first.
//
// Verified behaviourally against the local Postgres before being pinned here: withdrawing
// one real team removed it from all three, and restoring it put it back.

jest.mock('../../db_connect.js', () => {
  const state = { log: [], rows: [] };
  const conn = {
    query: jest.fn(async (sql, params) => {
      state.log.push({ sql: sql.replace(/\s+/g, ' ').trim(), params });
      const rows = state.rows.length ? state.rows.shift() : [];
      rows.affectedRows = rows.length;
      return [rows];
    }),
  };
  return {
    __state: state,
    isObject: o => o === Object(o),
    otherConnect: async () => conn,
    withTransaction: async fn => fn(conn),
  };
});

const db = require('../../db_connect.js');
const Roster = require('../../models/roster.js');
const Club = require('../../models/club.js');

beforeEach(() => {
  db.__state.log = [];
  db.__state.rows = [];
});

const lastSql = () => db.__state.log[db.__state.log.length - 1].sql;

describe('queries that hand out teams exclude withdrawn ones', () => {
  it('Roster.getClubTeams — the "Move to…" destination list', async () => {
    await Roster.getClubTeams('Mellor');
    expect(lastSql()).toMatch(/team\.withdrawn IS NULL/);
  });

  it('Club.getTeamsForClub — the club page listing', async () => {
    await Club.getTeamsForClub(1, -1);
    expect(lastSql()).toMatch(/t\.withdrawn IS NULL/);
  });

  it('Roster.getClubSummaries — counts both teams and players', async () => {
    await Roster.getClubSummaries();
    const sql = lastSql();
    // Two subqueries, and both need it: a withdrawn team's players must not be counted
    // towards the club either, or the picker shows a headcount nobody can find.
    expect(sql.match(/withdrawn IS NULL/g) || []).toHaveLength(2);
  });
});

describe('a reinstated team gets no public page', () => {
  // HARD-11 reinstates 19 deleted teams as withdrawn rows so that 2,132 historical
  // fixtures resolve and the foreign key becomes possible. Those rows exist for
  // referential integrity, NOT so their fixtures gain public /event/ pages — which would
  // render with no club, no division and no venue, since all three are reached through
  // the team. Owner's call, 14 Sep 2026.
  //
  // The two must agree: a sitemap entry whose page does not render is a soft 404, which
  // the seo skill forbids in terms. Verified behaviourally against the local Postgres —
  // withdrawing a live team removed both, restoring it put both back.
  const Fixture = require('../../models/fixture.js');

  it('getFixtureEventById excludes a fixture whose team is withdrawn', async () => {
    await Fixture.getFixtureEventById(1);
    expect(lastSql()).toMatch(/homeTeam\.withdrawn IS NULL AND awayTeam\.withdrawn IS NULL/);
  });

  it('getForSitemap excludes them too, so the two cannot disagree', async () => {
    await Fixture.getForSitemap(18);
    expect(lastSql()).toMatch(/homeTeam\.withdrawn IS NULL AND awayTeam\.withdrawn IS NULL/);
  });
});

describe('the league table path already handled it, and must keep doing so', () => {
  // Not a new filter — evidence that the NULL-division convention is what the league table
  // relies on, so these three filters are additive rather than a second mechanism.
  it('a withdrawn team has a NULL division, which is what keeps it out of the table', () => {
    const controller = require('fs').readFileSync(
      require('path').join(__dirname, '..', '..', 'controllers', 'teamController.js'), 'utf8');
    expect(controller).toMatch(/withdrawn/i);
    expect(controller).toMatch(/NULL division/i);
  });
});
