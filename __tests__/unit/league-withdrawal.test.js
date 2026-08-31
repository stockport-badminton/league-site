// Withdrawing a team (HARD-10).
//
// These assert the exact statements, because the write path cannot be exercised: dev.env
// carries the same DATABASE_URL as .env, so the only database available is production.
// The db layer is faked so the SQL and its parameters can be read back.
//
// What is being pinned down:
//   - a withdrawal must never delete a team row (2,132 fixtures already point at team
//     ids that no longer exist; deleting is how that happened — HARD-11)
//   - it must void only fixtures with no result, and repeat that guard in the UPDATE's
//     own WHERE clause, so a scorecard filed between the preview and the write cannot be
//     silently overwritten
//   - it must refuse to run twice
//   - reinstating must un-void only the fixtures this withdrawal voided, not the 114
//     voided during HARD-09 for unrelated reasons
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

describe('withdrawTeam', () => {
  const team = { id: 61, name: 'Parrswood C', division: 3, withdrawn: null };

  it('voids only the fixtures with no result, and never deletes anything', async () => {
    queue([team], [{ id: 7301 }, { id: 7344 }], [{ id: 61 }]);

    const result = await League.withdrawTeam(61, { reason: 'folded' });

    expect(result.voidedFixtures).toEqual([7301, 7344]);

    const voids = sqlMatching(/^UPDATE fixture/);
    expect(voids).toHaveLength(1);
    const sql = voids[0].sql;
    expect(sql).toMatch(/SET status = 'void'/);
    // The guard, repeated in the write itself rather than only in the preview.
    expect(sql).toMatch(/"homeScore" IS NULL AND f\."awayScore" IS NULL/);
    expect(sql).toMatch(/status IS NULL OR f\.status IN \('', 'outstanding'\)/);
    // Nothing is conceded and nothing is removed.
    expect(sql).not.toMatch(/conceded/);
    expect(sqlMatching(/^DELETE/)).toHaveLength(0);
  });

  it('clears the division, remembers it, and repeats the once-only guard in the WHERE', async () => {
    queue([team], [{ id: 7301 }], [{ id: 61 }]);

    await League.withdrawTeam(61, { reason: 'folded' });

    const writes = sqlMatching(/^UPDATE team/);
    expect(writes).toHaveLength(1);
    const sql = writes[0].sql;
    expect(sql).toMatch(/"withdrawnDivision" = division/);
    expect(sql).toMatch(/division = NULL/);
    expect(sql).toMatch(/withdrawn = now\(\)/);
    expect(sql).toMatch(/WHERE id = \? AND withdrawn IS NULL/);
    // The voided ids are stored so the reinstate can undo exactly those.
    expect(writes[0].params).toEqual(['folded', [7301], 61]);
  });

  it('refuses to run twice, and writes nothing the second time', async () => {
    queue([[{ ...team, withdrawn: '2026-08-31T00:00:00.000Z' }][0]]);
    queue([{ ...team, withdrawn: '2026-08-31T00:00:00.000Z' }]);

    await expect(League.withdrawTeam(61, {})).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining('already withdrawn on 2026-08-31')
    });

    expect(sqlMatching(/^UPDATE/)).toHaveLength(0);
    expect(log().some(e => e.sql === 'ROLLBACK')).toBe(true);
    expect(log().some(e => e.sql === 'COMMIT')).toBe(false);
  });

  it('rolls back if the team write finds no row to claim (concurrent withdrawal)', async () => {
    // The SELECT saw withdrawn = NULL, but the UPDATE's own guard matched nothing.
    queue([team], [{ id: 7301 }], []);

    await expect(League.withdrawTeam(61, {})).rejects.toMatchObject({ status: 409 });
    expect(log().some(e => e.sql === 'ROLLBACK')).toBe(true);
  });

  it('404s an unknown team without touching a fixture', async () => {
    queue([]);
    await expect(League.withdrawTeam(999, {})).rejects.toMatchObject({ status: 404 });
    expect(sqlMatching(/^UPDATE/)).toHaveLength(0);
  });

  it('stores a blank reason as NULL rather than an empty string', async () => {
    queue([team], [], [{ id: 61 }]);
    await League.withdrawTeam(61, { reason: '   ' });
    expect(sqlMatching(/^UPDATE team/)[0].params[0]).toBeNull();
  });
});

describe('reinstateTeam', () => {
  const withdrawnTeam = {
    id: 61, name: 'Parrswood C', withdrawn: '2026-08-31T00:00:00.000Z',
    division: null, withdrawnDivision: 3, withdrawnFixtures: [7301, 7344]
  };

  it('puts the team back in the division it left', async () => {
    queue([withdrawnTeam], [{ next: 9 }], [{ id: 7301 }, { id: 7344 }], [{ id: 61 }]);

    const result = await League.reinstateTeam(61);

    expect(result).toMatchObject({ teamId: 61, division: 3, restoredFixtures: [7301, 7344] });
    const sql = sqlMatching(/^UPDATE team/)[0].sql;
    expect(sql).toMatch(/division = "withdrawnDivision"/);
    expect(sql).toMatch(/withdrawn = NULL/);
    expect(sql).toMatch(/WHERE id = \? AND withdrawn IS NOT NULL/);
  });

  it('un-voids only the fixtures this withdrawal voided, and only if still unplayed', async () => {
    queue([withdrawnTeam], [{ next: 9 }], [{ id: 7301 }], [{ id: 61 }]);

    await League.reinstateTeam(61);

    const un = sqlMatching(/^UPDATE fixture/);
    expect(un).toHaveLength(1);
    // Restricted to the stored ids — a blanket "un-void this team's fixtures" would
    // resurrect the 114 voided during HARD-09 for other reasons.
    expect(un[0].sql).toMatch(/f\.id = ANY\(\?::int\[\]\)/);
    expect(un[0].params[0]).toEqual([7301, 7344]);
    expect(un[0].sql).toMatch(/f\.status = 'void'/);
    expect(un[0].sql).toMatch(/"homeScore" IS NULL AND f\."awayScore" IS NULL/);
  });

  it('touches no fixture when the withdrawal voided none', async () => {
    queue([{ ...withdrawnTeam, withdrawnFixtures: [] }], [{ next: 9 }], [{ id: 61 }]);
    await League.reinstateTeam(61);
    expect(sqlMatching(/^UPDATE fixture/)).toHaveLength(0);
  });

  it('refuses a team that is not withdrawn', async () => {
    queue([{ id: 61, name: 'Shell A', withdrawn: null, withdrawnDivision: null }]);
    await expect(League.reinstateTeam(61)).rejects.toMatchObject({ status: 409 });
    expect(sqlMatching(/^UPDATE/)).toHaveLength(0);
  });

  it('refuses when no division was recorded to return to', async () => {
    queue([{ ...withdrawnTeam, withdrawnDivision: null }]);
    await expect(League.reinstateTeam(61)).rejects.toMatchObject({ status: 409 });
    expect(sqlMatching(/^UPDATE/)).toHaveLength(0);
  });
});

describe('getWithdrawalImpact', () => {
  it('counts outstanding and recorded fixtures separately and writes nothing', async () => {
    queue(
      [{ id: 61, name: 'Parrswood C', division: 3, withdrawn: null, divisionName: 'Division 3' }],
      [{ outstanding: '11', recorded: '3' }],
      [{ players: '8' }]
    );

    const impact = await League.getWithdrawalImpact(61);

    expect(impact.outstandingFixtures).toBe(11);
    expect(impact.recordedFixtures).toBe(3);
    expect(impact.players).toBe(8);
    expect(sqlMatching(/^(UPDATE|DELETE|INSERT)/)).toHaveLength(0);
  });

  it('LEFT JOINs the fixtures so a team with none still previews', async () => {
    queue([{ id: 61, name: 'Parrswood C' }], [{ outstanding: '0', recorded: '0' }], [{ players: '0' }]);
    await League.getWithdrawalImpact(61);
    // gotcha 1c: an inner join to something optional loses the whole thing.
    expect(sqlMatching(/COUNT\(f\.id\)/)[0].sql).toMatch(/LEFT JOIN fixture f/);
  });

  it('returns null for an unknown team', async () => {
    queue([]);
    expect(await League.getWithdrawalImpact(999)).toBeNull();
  });
});

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
    expect(log()[0].sql).toMatch(/WHERE club\.name = \?/);
  });
});
