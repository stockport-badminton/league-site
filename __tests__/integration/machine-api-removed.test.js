const request = require('supertest');

// HARD-49: 37 routes sat behind `checkJwt`, which verified a token's signature and nothing
// else — no audience, no issuer — so any token the Auth0 tenant signed would pass. Behind
// it were create/patch/delete for players, teams, clubs, divisions, fixtures, games,
// venues and leagues; `PATCH /team/:id` turned request-body KEYS into SQL; and every
// `*/batch-create` took the table name itself from the body.
//
// Nothing used them: 0 requests in the 30 days of log retention, GETs included, no caller
// in this repo or the Remnants site, no scheduler job. They were the original token-guarded
// API from before the superadmin UI. So they were removed rather than repaired, and this
// asserts they stay removed. `setupAfterEnv.js` stamps every response, so a 404 here is
// ours, not some other process on the port.

jest.mock('../../models/fixture');
jest.mock('../../models/season');
jest.mock('../../models/auth.js');

const Fixture = require('../../models/fixture');
const app = require('../../app');

const REMOVED = [
  ['post', '/player/batch-create'], ['delete', '/player/5'],
  ['post', '/team/create'], ['post', '/team/batch-create'], ['delete', '/team/5'], ['patch', '/team/5'],
  ['post', '/league/create'], ['delete', '/league/5'], ['patch', '/league/5'], ['get', '/leagues'],
  ['post', '/club/create'], ['post', '/club/batch-create'], ['delete', '/club/5'], ['patch', '/club/5'],
  ['post', '/division/create'], ['post', '/division/batch-create'], ['delete', '/division/5'],
  ['patch', '/division/5'], ['get', '/division/5'], ['get', '/divisions'],
  ['post', '/fixture/create'], ['post', '/fixture/batch-create'], ['patch', '/fixture/rearrange'],
  ['delete', '/fixture/5'], ['patch', '/fixture/5'], ['get', '/fixture/5'],
  ['post', '/game/create'], ['post', '/game/batch-create'], ['delete', '/game/5'], ['patch', '/game/5'],
  ['get', '/game/5'], ['get', '/games'],
  ['post', '/venue/create'], ['post', '/venue/batch-create'], ['delete', '/venue/5'], ['patch', '/venue/5'],
  ['get', '/venue/5'],
];

describe('the token-guarded machine API is gone (HARD-49)', () => {
  it('lists all 37', () => {
    expect(REMOVED).toHaveLength(37);
  });

  // With a token, too: what used to answer 401 without one must not answer at all now.
  it.each(REMOVED)('%s %s is not found', async (method, path) => {
    const res = await request(app)[method](path)
      .set('Authorization', 'Bearer eyJhbGciOiJSUzI1NiJ9.e30.c2ln')
      .send({ tablename: 'player', fields: ['id'], data: [] });

    expect(res.status).not.toBe(401);
    expect([404, 405]).toContain(res.status);
  });

  // The control. /fixtures/* is a different, public route and the Remnants club site reads
  // /fixtures/club-Remnants as JSON several times a day. It must survive this.
  it('leaves the public /fixtures/* JSON in place', async () => {
    Fixture.getFixtureDetails.mockResolvedValue([{ id: 1, homeTeam: 'Remnants A', awayTeam: 'Shell A', date: '2026-10-01T00:00:00.000Z', division: 7, status: 'outstanding' }]);

    const res = await request(app).get('/fixtures/club-Remnants').set('Accept', 'application/json');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/json/);
    expect(res.body[0].homeTeam).toBe('Remnants A');
  });
});
