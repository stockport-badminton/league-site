const request = require('supertest');

// GET /club/:id — the club contact page.
//
// Reported 1 Sep 2026: College Green listed every one of its captains four times.
//
// The cause was a cartesian product in Club.getContactDetailsById. It joined the club's
// match secretary and club secretary as ordinary rows alongside each team's captain, so a
// club with two people flagged for each role produced 2 x 2 rows per team. College Green
// has exactly that, and its five teams came back as twenty rows. Five clubs were
// affected; four more teams have two captains flagged, which multiplied it again.
//
// Two further faults in the same query, found while fixing it:
//
//   - The captain was an INNER JOIN, so a team with nobody flagged as captain vanished
//     from its club's page altogether. Two teams were in that state, College Green E
//     among them — the club was reported as having four teams when it has five. That is
//     gotcha 1c, again.
//   - `AS "clubSecEmail"` was quoted while every other alias was not, so it came back
//     camelCase while the view read `clubsecemail`. The club secretary's email address
//     rendered blank on every club page, silently. That is gotcha 1, again.
//
// The SQL is the real fix. Jest cannot execute it, so what is tested here is the layer
// that can be: the controller collapses the rows to one per team, and the view reads the
// alias the model actually returns.

jest.mock('../../models/club');
jest.mock('../../models/venue');
jest.mock('../../models/fixture');
jest.mock('../../models/division');
jest.mock('../../models/season');
jest.mock('../../models/roster');
jest.mock('../../models/auth.js');
jest.mock('axios');

jest.mock('../../middleware/secured', () => (req, res, next) => next());

const Club = require('../../models/club');
const app = require('../../app');

// The shape the model really returns: lowercase keys, because the aliases are unquoted
// and Postgres folds them. Getting this wrong is how the blank-email bug survived.
function row(teamName, captain, extra = {}) {
  return Object.assign({
    clubname: 'College Green',
    teamname: teamName,
    venueId: 1,
    venuename: 'College Green Sports Centre',
    address: 'Wilmslow Road, M20 5PG',
    matchvenueid: 1,
    matchvenuename: 'College Green Sports Centre',
    matchvenueaddress: 'Wilmslow Road, M20 5PG',
    matchnight: 'Tuesday 8pm',
    matchsecretary: 'Simon Owen',
    matchsectel: '07700 900001',
    matchsecemail: 'simon@example.com',
    clubsecretary: 'Paula Kite',
    clubsectel: '07700 900002',
    clubsecemail: 'paula@example.com',
    teamcaptain: captain,
    teamcaptaintel: '07700 900003',
    teamcaptainemail: (captain || 'x').toLowerCase().replace(/\s+/g, '.') + '@example.com',
  }, extra);
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('GET /club/:id', () => {
  it('lists each team once when the model returns duplicate rows', async () => {
    // Exactly the shape the bug produced: two teams, each repeated four times for the
    // two-by-two combination of secretaries.
    const rows = [];
    for (const team of ['College Green A', 'College Green B']) {
      for (let i = 0; i < 4; i++) rows.push(row(team, team === 'College Green A' ? 'Judith Peatman' : 'Chi-Sum Hau'));
    }
    Club.getContactDetailsById.mockResolvedValue(rows);

    const res = await request(app).get('/club/61');
    expect(res.status).toBe(200);

    const captainCount = (res.text.match(/Judith Peatman/g) || []).length;
    expect(captainCount).toBe(1);
    expect((res.text.match(/Chi-Sum Hau/g) || []).length).toBe(1);
  });

  it('still lists every distinct team', async () => {
    const rows = ['College Green A', 'College Green B', 'College Green C']
      .flatMap(t => [row(t, 'Cap ' + t.slice(-1)), row(t, 'Cap ' + t.slice(-1))]);
    Club.getContactDetailsById.mockResolvedValue(rows);

    const res = await request(app).get('/club/61');
    expect(res.text).toContain('College Green A');
    expect(res.text).toContain('College Green B');
    expect(res.text).toContain('College Green C');
  });

  // A team with no captain must still appear. Under the old INNER JOIN it did not exist
  // as far as this page was concerned.
  it('lists a team whose captain is missing', async () => {
    Club.getContactDetailsById.mockResolvedValue([
      row('College Green D', 'Jill Naylor'),
      row('College Green E', null, { teamcaptain: null, teamcaptainemail: null, teamcaptaintel: null }),
    ]);

    const res = await request(app).get('/club/61');
    expect(res.text).toContain('College Green E');
  });

  // Note what this does and does not prove. The model is mocked, so this asserts the
  // *view* reads `clubsecemail` — it cannot catch the alias mismatch in the SQL, which is
  // where the bug actually was. That half was verified against the real database: before
  // the fix the query returned a `clubSecEmail` key and the page rendered nothing; after
  // it, `paulakite@yahoo.co.uk`. Kept because it pins the view side of the contract.
  it('shows the club secretary email, which used to render blank', async () => {
    Club.getContactDetailsById.mockResolvedValue([row('College Green A', 'Judith Peatman')]);
    const res = await request(app).get('/club/61');
    expect(res.text).toContain('paula@example.com');
  });

  // The officers' phone numbers and email addresses are pgp_sym_encrypt'd in the
  // database. The handler used to log every decrypted row to stdout on every request,
  // which put them in Cloud Logging in plain text for anyone with log access.
  it('does not log decrypted contact details', async () => {
    const spy = jest.spyOn(console, 'log').mockImplementation(() => {});
    Club.getContactDetailsById.mockResolvedValue([row('College Green A', 'Judith Peatman')]);

    await request(app).get('/club/61');

    // Serialised with util.inspect, not String(): the handler logged the whole row
    // *object*, and String({...}) is '[object Object]', so a naive join would have found
    // nothing and this test would have passed against the very code it exists to catch.
    // It did, on the first run.
    const util = require('util');
    const logged = spy.mock.calls
      .map(c => c.map(a => (typeof a === 'string' ? a : util.inspect(a))).join(' '))
      .join('\n');
    expect(logged).not.toContain('07700 900002');
    expect(logged).not.toContain('paula@example.com');
    spy.mockRestore();
  });
});
