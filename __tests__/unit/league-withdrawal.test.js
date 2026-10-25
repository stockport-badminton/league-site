// Withdrawn teams in the league table and the annual invoice (HARD-10).
//
// The withdrawal itself — withdrawTeam, reinstateTeam, getWithdrawalImpact — is tested
// against a real Postgres in __tests__/db/league-withdrawal.test.js, since those went onto
// the typed query layer (REARCH-01). This file kept the statement-reading approach only
// for the functions still on the string wrapper: the three season-switched table reads
// (REARCH-02) and getAnnualInvoices. Its old note that "the only database available is
// production" stopped being true with HARD-13.
//
// What is being pinned down here:
//   - the live league table and the annual invoice must exclude a withdrawn team, and
//     the archived team<season> snapshots — which have no `withdrawn` column — must not
//     have the filter applied at all

jest.mock('../../db_connect.js', () => {
  const state = { rows: [], log: [] };
  function makeConn() {
    return {
      query: jest.fn(async (sql, params) => {
        const flat = sql.replace(/\s+/g, ' ').trim();
        state.log.push({ sql: flat, params: params });
        // Only reads and RETURNING writes draw from the queue; a plain write consuming
        // one would make queue position depend on how many rows happened to be written.
        const isRead = /^(SELECT|WITH)/i.test(flat) || /RETURNING/i.test(flat);
        const rows = isRead && state.rows.length ? state.rows.shift() : [];
        rows.affectedRows = rows.length;
        return [rows];
      })
    };
  }
  return {
    __state: state,
    isObject: o => o === Object(o),
    otherConnect: async () => makeConn(),
    withTransaction: async fn => {
      state.log.push({ sql: 'BEGIN', params: [] });
      try {
        const out = await fn(makeConn());
        state.log.push({ sql: 'COMMIT', params: [] });
        return out;
      } catch (err) {
        state.log.push({ sql: 'ROLLBACK', params: [] });
        throw err;
      }
    }
  };
});

const db = require('../../db_connect.js');
const League = require('../../models/league');

function queue(...resultSets) {
  db.__state.rows = resultSets;
}

function log() {
  return db.__state.log;
}

function sqlMatching(re) {
  return log().filter(e => re.test(e.sql));
}

beforeEach(() => {
  db.__state.rows = [];
  db.__state.log = [];
});

// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// The visible symptom: a withdrawn team must be out of the live league table and off
// the invoice, and must still be in the archived tables for the seasons it played.

describe('withdrawn teams and the league table', () => {
  it('excludes them from the live division table', async () => {
    queue([]);
    await League.getLeagueTable('Division-3');
    expect(log()[0].sql).toMatch(/JOIN team ON team\.id = b\.teamid AND team\.withdrawn IS NULL/);
  });

  it('excludes them from the live all-tables view', async () => {
    queue([]);
    await League.getAllLeagueTables();
    expect(log()[0].sql).toMatch(/JOIN team ON team\.id = b\.teamid AND team\.withdrawn IS NULL/);
  });

  it('excludes them from the run-in view', async () => {
    queue([]);
    await League.getAllLeagueTablesWithTopBottomDetails();
    expect(log()[0].sql).toMatch(/JOIN team t ON t\.id = s\.teamId AND t\.withdrawn IS NULL/);
  });

  it('does NOT apply the filter to an archived season snapshot', async () => {
    // team20242025 has no `withdrawn` column, and a team that folds this season must
    // still appear in the tables for the seasons it actually played.
    queue([]);
    await League.getAllLeagueTables('20242025');
    expect(log()[0].sql).not.toMatch(/withdrawn/);

    db.__state.log = [];
    queue([]);
    await League.getLeagueTable('Division-3', '20242025');
    expect(log()[0].sql).not.toMatch(/withdrawn/);

    db.__state.log = [];
    queue([]);
    await League.getAllLeagueTablesWithTopBottomDetails('20242025');
    expect(log()[0].sql).not.toMatch(/withdrawn/);
  });
});

describe('withdrawn teams and the annual invoice', () => {
  it('are not counted as entered teams', async () => {
    queue([]);
    await League.getAnnualInvoices();
    expect(log()[0].sql).toMatch(/team ON team\.club = club\.id AND team\.withdrawn IS NULL/);
  });

  it('still filters by club when one is named', async () => {
    queue([]);
    await League.getAnnualInvoices('Parrswood');
    expect(log()[0].sql).toMatch(/team ON team\.club = club\.id AND team\.withdrawn IS NULL/);
    // Was `WHERE club.name = ?`. The WHERE now also excludes the `No Club` sentinel, so
    // this asserts the club filter is APPLIED rather than that it is the only condition.
    expect(log()[0].sql).toMatch(/club\.name = \?/);
    expect(log()[0].sql).toMatch(/WHERE/);
  });

  // The sentinel club (63, `No Club`) holds `No Team` and so looks like a club with two
  // teams. It was excluded only because it has no flagged secretary and the officer join
  // was INNER; making that join LEFT surfaced it, so it is now excluded on purpose.
  it('never invoices the No Club sentinel', async () => {
    queue([]);
    await League.getAnnualInvoices();
    expect(log()[0].sql).toMatch(/club\.id <> 63/);
  });

  // An officer is optional in the data. Joining one with INNER dropped the whole club
  // from the invoice run — silently, with no error and no empty row.
  it('joins the club secretary with LEFT, so a club without one is still invoiced', async () => {
    queue([]);
    await League.getAnnualInvoices();
    expect(log()[0].sql).toMatch(/LEFT JOIN[\s\S]*player ON \(player\.club = club\.id/);
  });
});
