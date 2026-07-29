// Rank arithmetic for the roster writes.
//
// These matter more than usual: dev.env carries the same DATABASE_URL as .env, so
// the only database available locally is production and the write paths cannot be
// exercised against it. The db layer is faked here so the exact statements and
// parameters can be asserted.
//
// The bugs being pinned down, all of which were live:
//   - moving a player between teams renumbered only the destination, leaving the
//     source ranked 1, 2, 4, 6 (10+ teams in production are still like this)
//   - every reserve was written rank = 99, so reserve order was draggable but
//     unsaveable
//   - a partial failure could apply half a move

jest.mock('../../db_connect.js', () => {
  const state = { rows: [], log: [], failOn: null };
  function makeConn() {
    return {
      query: jest.fn(async (sql, params) => {
        const flat = sql.replace(/\s+/g, ' ').trim();
        state.log.push({ sql: flat, params: params });
        if (state.failOn && state.log.length === state.failOn) {
          throw new Error('simulated database failure');
        }
        // Only reads draw from the queued fixtures. Letting an UPDATE consume one
        // made the queue position depend on how many rows happened to be written,
        // so a test's later fixtures silently shifted onto the wrong query.
        const isRead = /^(SELECT|INSERT)/i.test(flat);
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
const Roster = require('../../models/roster');

function queue(...resultSets) {
  db.__state.rows = resultSets;
}

function updates() {
  return db.__state.log
    .filter(e => e.sql.startsWith('UPDATE player SET rank'))
    .map(e => ({ rank: e.params[0], id: e.params[1] }));
}

beforeEach(() => {
  db.__state.rows = [];
  db.__state.log = [];
  db.__state.failOn = null;
});

describe('isReserve', () => {
  it('treats 99 and above as a reserve', () => {
    expect(Roster.isReserve(99)).toBe(true);
    expect(Roster.isReserve(100)).toBe(true);
    expect(Roster.isReserve(101)).toBe(true);
  });

  it('treats a nominated rank as not a reserve', () => {
    expect(Roster.isReserve(1)).toBe(false);
    expect(Roster.isReserve(98)).toBe(false);
  });

  // 24 players in production have a NULL rank. Treating them as nominated means
  // the next save gives them a real number instead of stranding them.
  it('treats a missing rank as nominated', () => {
    expect(Roster.isReserve(null)).toBe(false);
    expect(Roster.isReserve(undefined)).toBe(false);
  });

  it('accepts a numeric string, as the DB driver may return', () => {
    expect(Roster.isReserve('99')).toBe(true);
    expect(Roster.isReserve('2')).toBe(false);
  });
});

describe('saveTeamOrder', () => {
  it('numbers a nominated section from 1 in the order given', async () => {
    queue([{ id: 7, rank: 1 }, { id: 8, rank: 2 }, { id: 9, rank: 3 }]);
    await Roster.saveTeamOrder(12, [
      { gender: 'Male', section: 'nominated', playerIds: [9, 7, 8] }
    ]);
    expect(updates()).toEqual([
      { rank: 1, id: 9 },
      { rank: 2, id: 7 },
      { rank: 3, id: 8 }
    ]);
  });

  // The headline reserve fix: sequential from 99 rather than all-99.
  it('numbers a reserve section sequentially from 99', async () => {
    queue([{ id: 21, rank: 99 }, { id: 22, rank: 99 }, { id: 23, rank: 99 }]);
    await Roster.saveTeamOrder(12, [
      { gender: 'Female', section: 'reserve', playerIds: [23, 21, 22] }
    ]);
    // 23 is skipped because it already holds 99 — the no-op check, not a bug.
    expect(updates()).toEqual([
      { rank: 100, id: 21 },
      { rank: 101, id: 22 }
    ]);
  });

  it('skips the write for a row already holding the right rank', async () => {
    queue([{ id: 7, rank: 1 }, { id: 8, rank: 2 }]);
    await Roster.saveTeamOrder(12, [
      { gender: 'Male', section: 'nominated', playerIds: [7, 8] }
    ]);
    expect(updates()).toEqual([]);
  });

  // Repairs the gaps the old client-side renumbering left behind.
  it('closes gaps in an existing sequence', async () => {
    queue([{ id: 7, rank: 1 }, { id: 8, rank: 2 }, { id: 9, rank: 4 }, { id: 10, rank: 6 }]);
    await Roster.saveTeamOrder(12, [
      { gender: 'Male', section: 'nominated', playerIds: [7, 8, 9, 10] }
    ]);
    expect(updates()).toEqual([{ rank: 3, id: 9 }, { rank: 4, id: 10 }]);
  });

  // A stale page could otherwise pull a player into a team just by naming them in
  // an order payload.
  it('ignores ids that do not belong to the team and gender', async () => {
    queue([{ id: 7, rank: 1 }, { id: 8, rank: 2 }]);
    await Roster.saveTeamOrder(12, [
      { gender: 'Male', section: 'nominated', playerIds: [999, 8, 7] }
    ]);
    expect(updates()).toEqual([{ rank: 1, id: 8 }, { rank: 2, id: 7 }]);
  });

  // A player omitted from a stale payload keeps a valid rank at the bottom rather
  // than being left out of the sequence entirely.
  it('appends section members the payload left out', async () => {
    queue([{ id: 7, rank: 1 }, { id: 8, rank: 2 }, { id: 9, rank: 3 }]);
    await Roster.saveTeamOrder(12, [
      { gender: 'Male', section: 'nominated', playerIds: [9] }
    ]);
    expect(updates()).toEqual([{ rank: 1, id: 9 }, { rank: 2, id: 7 }, { rank: 3, id: 8 }]);
  });

  it('only touches the section it was asked about', async () => {
    // Both genders' rows come back from the query; only the nominated men are in
    // the requested section.
    queue([{ id: 7, rank: 1 }, { id: 8, rank: 99 }, { id: 9, rank: 100 }]);
    await Roster.saveTeamOrder(12, [
      { gender: 'Male', section: 'nominated', playerIds: [7] }
    ]);
    expect(updates()).toEqual([]);
  });

  it('writes all four sections inside one transaction', async () => {
    queue(
      [{ id: 1, rank: 2 }],
      [{ id: 2, rank: 3 }],
      [{ id: 3, rank: 100 }],
      [{ id: 4, rank: 105 }]
    );
    await Roster.saveTeamOrder(12, [
      { gender: 'Male', section: 'nominated', playerIds: [1] },
      { gender: 'Female', section: 'nominated', playerIds: [2] },
      { gender: 'Male', section: 'reserve', playerIds: [3] },
      { gender: 'Female', section: 'reserve', playerIds: [4] }
    ]);
    const shape = db.__state.log.map(e => e.sql);
    expect(shape[0]).toBe('BEGIN');
    expect(shape[shape.length - 1]).toBe('COMMIT');
    expect(updates()).toEqual([
      { rank: 1, id: 1 }, { rank: 1, id: 2 }, { rank: 99, id: 3 }, { rank: 99, id: 4 }
    ]);
  });

  it('rolls back rather than half-applying', async () => {
    queue([{ id: 7, rank: 5 }, { id: 8, rank: 6 }]);
    db.__state.failOn = 3; // the SELECT is 1, the first UPDATE is 2
    await expect(Roster.saveTeamOrder(12, [
      { gender: 'Male', section: 'nominated', playerIds: [7, 8] }
    ])).rejects.toThrow('simulated database failure');
    expect(db.__state.log.map(e => e.sql)).toContain('ROLLBACK');
  });

  it('reads rows in rank order so leftovers keep their relative positions', async () => {
    queue([{ id: 7, rank: 1 }]);
    await Roster.saveTeamOrder(12, [
      { gender: 'Male', section: 'nominated', playerIds: [7] }
    ]);
    const select = db.__state.log.find(e => e.sql.startsWith('SELECT id, rank'));
    expect(select.sql).toContain('ORDER BY rank NULLS LAST, id');
  });
});

describe('movePlayer', () => {
  it('appends to the destination and closes the gap in the source', async () => {
    queue(
      // getPlayerOwner
      [{ id: 5, name: 'Dave Halliwell', gender: 'Male', rank: 2, teamId: 12, teamName: 'CG A', teamClubId: 61, clubName: 'College Green' }],
      [{ max: 3 }],           // current max nominated rank in the destination
      [{ club: 61 }],         // destination team's club
      [{ id: 7, rank: 1 }, { id: 9, rank: 3 }],  // source, read back after the move
      [{ id: 1, rank: 1 }, { id: 2, rank: 2 }, { id: 3, rank: 3 }, { id: 5, rank: 4 }] // destination
    );
    const result = await Roster.movePlayer(5, 23, 'nominated');
    expect(result).toMatchObject({ playerId: 5, teamId: 23, rank: 4 });

    const move = db.__state.log.find(e => e.sql.startsWith('UPDATE player SET team'));
    expect(move.params).toEqual([23, 61, 4, 5]);

    // Source compaction: the player who was rank 3 becomes rank 2.
    expect(updates()).toEqual([{ rank: 2, id: 9 }]);
  });

  it('appends to a reserve destination from 99, not from 1', async () => {
    queue(
      [{ id: 5, name: 'Ken Tsang', gender: 'Male', rank: 1, teamId: 12, teamClubId: 61, clubName: 'College Green' }],
      [{ max: 0 }],   // no reserves yet in the destination
      [{ club: 61 }],
      [],             // source, read back after the move
      []              // destination
    );
    const result = await Roster.movePlayer(5, 23, 'reserve');
    expect(result.rank).toBe(99);
  });

  it('continues an existing reserve sequence', async () => {
    queue(
      [{ id: 5, name: 'Ken Tsang', gender: 'Male', rank: 1, teamId: 12, teamClubId: 61, clubName: 'College Green' }],
      [{ max: 100 }],
      [{ club: 61 }],
      [], []
    );
    const result = await Roster.movePlayer(5, 23, 'reserve');
    expect(result.rank).toBe(101);
  });

  it('renumbers both ends when only the section changes', async () => {
    queue(
      [{ id: 5, name: 'Tom Beddow', gender: 'Male', rank: 99, teamId: 12, teamClubId: 61, clubName: 'College Green' }],
      [{ max: 2 }],
      [{ club: 61 }],
      [{ id: 6, rank: 100 }],   // source reserves, read back after the move
      [{ id: 1, rank: 1 }, { id: 2, rank: 2 }, { id: 5, rank: 3 }]  // destination nominated
    );
    await Roster.movePlayer(5, 12, 'nominated');
    // The reserve left behind moves from 100 down to 99.
    expect(updates()).toEqual([{ rank: 99, id: 6 }]);
  });

  it('404s for an unknown player instead of writing anything', async () => {
    queue([]);
    await expect(Roster.movePlayer(999, 23, 'nominated')).rejects.toMatchObject({ status: 404 });
    expect(updates()).toEqual([]);
  });

  it('404s for an unknown destination team', async () => {
    queue(
      [{ id: 5, name: 'X', gender: 'Male', rank: 1, teamId: 12, teamClubId: 61, clubName: 'CG' }],
      [{ max: 1 }],
      []   // no such team
    );
    await expect(Roster.movePlayer(5, 9999, 'nominated')).rejects.toMatchObject({ status: 404 });
    expect(db.__state.log.map(e => e.sql)).toContain('ROLLBACK');
  });
});

describe('releasePlayer', () => {
  it('parks the player on the no-club sentinel and compacts the old team', async () => {
    queue(
      [{ id: 5, name: 'Chris Ogden', gender: 'Male', rank: 2, teamId: 12, teamName: 'CG A', teamClubId: 61, clubName: 'College Green' }],
      [{ id: 7, rank: 1 }, { id: 9, rank: 3 }]   // old team, read back after the release
    );
    const result = await Roster.releasePlayer(5);
    expect(result).toMatchObject({ playerId: 5, name: 'Chris Ogden', from: 'CG A' });

    const release = db.__state.log.find(e => e.sql.startsWith('UPDATE player SET club'));
    // club 63 = 'No Club', team 52 = 'No Team' (both verified against the schema).
    expect(release.params).toEqual([Roster.NO_CLUB_ID, Roster.NO_TEAM_ID, 99, 5]);
    expect(Roster.NO_CLUB_ID).toBe(63);
    expect(Roster.NO_TEAM_ID).toBe(52);

    expect(updates()).toEqual([{ rank: 2, id: 9 }]);
  });

  it('404s for an unknown player', async () => {
    queue([]);
    await expect(Roster.releasePlayer(999)).rejects.toMatchObject({ status: 404 });
  });
});

describe('addToTeam', () => {
  it('adds as the next reserve', async () => {
    queue([{ gender: 'Female' }], [{ club: 61 }], [{ max: 99 }]);
    const result = await Roster.addToTeam(77, 23, 'reserve');
    expect(result).toEqual({ playerId: 77, teamId: 23, rank: 100 });
  });

  it('adds as the next nominated player', async () => {
    queue([{ gender: 'Male' }], [{ club: 61 }], [{ max: 2 }]);
    const result = await Roster.addToTeam(77, 23, 'nominated');
    expect(result.rank).toBe(3);
  });

  it('404s for an unknown player', async () => {
    queue([]);
    await expect(Roster.addToTeam(999, 23, 'reserve')).rejects.toMatchObject({ status: 404 });
  });
});

describe('createPlayer', () => {
  // models/players.js:create has no RETURNING clause, so its result.insertId is
  // always undefined — which is why the old add-player modal set the new row's id
  // to undefined and then posted parseInt(undefined).
  it('returns the new id', async () => {
    queue([{ id: 4321 }]);
    const id = await Roster.createPlayer({
      firstName: 'New', familyName: 'Player', gender: 'Male', clubId: 61, teamId: 23
    });
    expect(id).toBe(4321);
    expect(db.__state.log[0].sql).toContain('RETURNING id');
  });

  it('throws rather than returning undefined if no id comes back', async () => {
    queue([]);
    await expect(Roster.createPlayer({
      firstName: 'New', familyName: 'Player', gender: 'Male', clubId: 61, teamId: 23
    })).rejects.toThrow(/no id/);
  });
});
