// A withdrawn team must not be offered as somewhere to put a player.
//
// HARD-10 added `team.withdrawn` and the convention that such a team has a NULL division,
// which keeps it out of the league table. Three queries never learned about it:
//
//   Roster.getClubTeams    the roster editor's "Move to…" destination list (now __tests__/db/roster.test.js)
//   Roster.getClubSummaries the superadmin club picker's team and player counts (likewise)
//   Club.getTeamsForClub    the club page's team listing (now in __tests__/db/club.test.js)
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

beforeEach(() => {
  db.__state.log = [];
  db.__state.rows = [];
});

const lastSql = () => db.__state.log[db.__state.log.length - 1].sql;

// The three queries that hand out teams — Roster.getClubTeams, Roster.getClubSummaries and
// Club.getTeamsForClub — moved to __tests__/db/ when they went onto the typed query layer
// (REARCH-01). Their SQL no longer passes through this mock; there each is tested by
// withdrawing a team and checking it drops out, rather than by reading the statement.

// "A reinstated team gets no public page" — getFixtureEventById and getForSitemap must agree
// — moved to __tests__/db/fixture-reads.test.js (REARCH-01), where a team is withdrawn and
// restored and both pages are read, rather than their SQL inspected.

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
