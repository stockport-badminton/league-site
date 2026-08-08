// The player search behind /api/players/search — used by the signup-approval page
// to pick the player row an account gets linked to, and by the ELO comparison page.
//
// Two live faults are pinned here, both of which made the search quietly return
// fewer people than exist rather than fail in any visible way:
//
//   - Names are stored with stray whitespace: 378 of 1107 rows have a leading or
//     trailing space, almost always in front of family_name (" Petty"). Joining the
//     columns raw produced "Chris  Petty", so a LIKE for the "Chris Petty" a human
//     types matched nothing — while "Petty" alone still worked, which is what made
//     it look like the search was broken rather than the data.
//   - The joins to team, club and division were INNER. club and division are only
//     there for the optional filters and contribute nothing to the output, so a gap
//     in either dropped the player entirely. Team 52 "No Team" — where released
//     players are parked — carries division 0, which no division row has, so that
//     join alone hid 490 players. A returning member could not be found.
//
// dev.env carries the same DATABASE_URL as .env, so the only database reachable
// locally is production. The db layer is faked to capture the exact SQL and params.

jest.mock('../../db_connect.js', () => {
  const state = { log: [], rows: [] };
  return {
    __state: state,
    isObject: o => o === Object(o),
    otherConnect: async () => ({
      query: jest.fn(async (sql, params) => {
        state.log.push({ sql: sql.replace(/\s+/g, ' ').trim(), params });
        const rows = state.rows.length ? state.rows.shift() : [];
        rows.affectedRows = rows.length;
        return [rows];
      }),
    }),
  };
});

const db = require('../../db_connect.js');
const Player = require('../../models/players');

beforeEach(() => {
  db.__state.log = [];
  db.__state.rows = [];
});

const lastQuery = () => db.__state.log[db.__state.log.length - 1];

describe('searchPlayers', () => {
  describe('stray whitespace in the stored names', () => {
    it('collapses the whitespace in the name it matches against', async () => {
      await Player.searchPlayers('Chris Petty', {});

      // Whatever the exact expression, the columns must not be compared raw: a
      // plain concatenation of first_name and family_name is what produced the
      // double space.
      const { sql } = lastQuery();
      expect(sql).toMatch(/regexp_replace/i);
      expect(sql).toMatch(/TRIM/i);
      expect(sql).not.toMatch(/CONCAT\(player\.first_name, ' ', player\.family_name\)/);
    });

    it('collapses the whitespace in what the user typed', async () => {
      await Player.searchPlayers('  Chris   Petty  ', {});

      expect(lastQuery().params[0]).toBe('%Chris Petty%');
    });

    it('returns the name normalised, so the UI does not show the double space', async () => {
      const { sql } = (await Player.searchPlayers('x', {}), lastQuery());

      // The selected name expression is the normalised one, not the raw columns.
      expect(sql).toMatch(/regexp_replace\([^)]*\)[\s\S]*?AS name/i);
    });

    it('sorts on the trimmed surname, so " Petty" files under P', async () => {
      await Player.searchPlayers('a', {});

      const order = lastQuery().sql.match(/ORDER BY (.+?) LIMIT/i)[1];
      expect(order).toMatch(/TRIM/i);
    });
  });

  describe('players must not be dropped by joins that only exist for the filters', () => {
    it('reaches team, club and division with LEFT JOINs', async () => {
      await Player.searchPlayers('a', {});

      const { sql } = lastQuery();
      expect(sql).toMatch(/LEFT JOIN team/i);
      expect(sql).toMatch(/LEFT JOIN club/i);
      expect(sql).toMatch(/LEFT JOIN division/i);
      // No INNER join to any of them, however spelled.
      expect(sql).not.toMatch(/(?<!LEFT )\bJOIN (team|club|division)\b/i);
    });

    it('still returns a player whose team resolves to nothing', async () => {
      db.__state.rows = [[{ id: 1906, name: 'Ben Holcome', teamName: 'No Team' }]];

      const rows = await Player.searchPlayers('Ben Holcome', {});

      expect(rows).toHaveLength(1);
      expect(rows[0].id).toBe(1906);
    });
  });

  describe('the filters still filter', () => {
    it('adds a predicate per supplied filter, in parameter order', async () => {
      await Player.searchPlayers('smith', {
        division: 'Premier', club: 'Dome', team: 'Dome A', gender: 'Male',
      });

      // Placeholders are still `?` here: the ?→$N conversion happens inside
      // db_connect's wrapper, which is faked out in this file.
      const { sql, params } = lastQuery();
      expect(sql).toMatch(/division\.name = \?/);
      expect(sql).toMatch(/club\.name = \?/);
      expect(sql).toMatch(/team\.name = \?/);
      expect(sql).toMatch(/player\.gender = \?/);
      expect(params).toEqual(['%smith%', 'Premier', 'Dome', 'Dome A', 'Male']);
    });

    it('adds nothing when no filter is supplied', async () => {
      await Player.searchPlayers('smith', {});

      const { sql, params } = lastQuery();
      expect(params).toEqual(['%smith%']);
      expect(sql).not.toMatch(/division\.name =/);
      expect(sql).not.toMatch(/club\.name =/);
    });

    it('tolerates being called with no filters object at all', async () => {
      // toHaveLength, not toEqual([]): the wrapper hangs affectedRows off the array.
      await expect(Player.searchPlayers('smith')).resolves.toHaveLength(0);
      expect(lastQuery().params).toEqual(['%smith%']);
    });

    it('caps the result set', async () => {
      await Player.searchPlayers('a', {});

      expect(lastQuery().sql).toMatch(/LIMIT 20/i);
    });
  });
});
