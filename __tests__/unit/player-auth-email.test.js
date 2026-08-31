// Player.setAuthRole — the write that runs when a superadmin approves a signup.
//
// The bug: "authEmail" (login identity) and "playerEmail" (contact address) are
// separate columns on purpose, and approving a signup only ever wrote authEmail.
// A player added to a roster by their captain starts with no contact email and
// nothing else ever fills it in, so a newly signed-up player could log in, hold a
// real address, and still show blank on their own profile form and on their club's
// contact page — both of which read playerEmail. Reported for Chris Petty (#1959),
// newly made captain of Alderley Park B; 53 players were in that state.
//
// These assert the statement, since dev.env points at the production database and
// the write paths can't be exercised against it. The CASE guard's *behaviour* was
// checked separately with a read-only SELECT over the three real shapes in
// production — NULL, an encrypted empty string, and a genuine address — which fills
// the first two and leaves the third alone.

jest.mock('../../db_connect.js', () => {
  const state = { log: [] };
  return {
    __state: state,
    isObject: o => o === Object(o),
    otherConnect: async () => ({
      query: jest.fn(async (sql, params) => {
        state.log.push({ sql: sql.replace(/\s+/g, ' ').trim(), params });
        return [[]];
      })
    })
  };
});

const db = require('../../db_connect.js');
const Player = require('../../models/players');

const KEY = process.env.DB_PI_KEY || 'test-key';

beforeEach(() => {
  db.__state.log = [];
  process.env.DB_PI_KEY = KEY;
});

describe('setAuthRole', () => {
  it('seeds the contact email from the login email when approving a signup', async () => {
    await Player.setAuthRole(1959, {
      role: null, messerAdmin: false, authEmail: 'chrispetty191@gmail.com'
    });

    expect(db.__state.log).toHaveLength(1);
    const { sql, params } = db.__state.log[0];
    expect(sql).toContain('"authEmail" = pgp_sym_encrypt(?, ?)');
    expect(sql).toContain('"playerEmail" = CASE');
    // The guard: only a NULL or all-whitespace contact email is filled in.
    expect(sql).toContain(`NULLIF(TRIM(pgp_sym_decrypt("playerEmail", ?)::text), '')`);
    expect(sql).toContain('ELSE "playerEmail"');
    expect(params).toEqual([
      null, 0,
      'chrispetty191@gmail.com', KEY, // authEmail
      KEY,                            // the guard's decrypt
      'chrispetty191@gmail.com', KEY, // the seeded playerEmail
      1959
    ]);
  });

  it('never overwrites a contact email that is already set', async () => {
    await Player.setAuthRole(7, { role: 'captain', messerAdmin: false, authEmail: 'a@b.com' });
    // Expressed as a CASE rather than a second statement or a read-then-write, so
    // the check and the write are the same row lock.
    expect(db.__state.log[0].sql).toMatch(/"playerEmail" = CASE WHEN .+ ELSE "playerEmail" END/);
  });

  it('leaves both email columns alone when no login email is supplied', async () => {
    // The ordinary player-edit form posts role/messerAdmin and knows nothing about
    // authEmail. It must not clear either column, or seed one from the other.
    await Player.setAuthRole(7, { role: 'captain', messerAdmin: true });

    expect(db.__state.log).toHaveLength(1);
    const { sql, params } = db.__state.log[0];
    expect(sql).not.toContain('authEmail');
    expect(sql).not.toContain('playerEmail');
    expect(params).toEqual(['captain', 1, 7]);
  });
});
