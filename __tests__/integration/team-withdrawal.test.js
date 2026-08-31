// The withdraw-a-team admin flow (HARD-10).
//
// The gap: /admin/teams could create, edit, promote and relegate but not withdraw, so a
// folded team stayed in its division as a row of zeros in the public league table and
// stayed on the annual invoice. Parrswood C was withdrawn by hand in August 2026 by
// moving its players to the No Club / No Team sentinels.
//
// These render for real (no res.render mock) — the confirmation page is the only place
// the person doing this is told what happens to the outstanding fixtures, so asserting
// on the view name would prove nothing. Same lesson as the blank populated-messer page.

const request = require('supertest');

// Mutable so the same file can exercise the superadmin and the club-captain cases.
// `var` rather than `let`: jest.mock factories are hoisted above the declarations.
var mockUser;

jest.mock('../../middleware/secured', () => (req, res, next) => {
  req.user = mockUser;
  next();
});

jest.mock('../../models/teams');
jest.mock('../../models/club');
jest.mock('../../models/division');
jest.mock('../../models/venue');
jest.mock('../../models/league');
jest.mock('../../models/roster');

jest.mock('../../db_connect', () => ({
  connect: jest.fn(),
  otherConnect: jest.fn(() => Promise.resolve({
    query: jest.fn(() => Promise.resolve([[], []]))
  })),
  isObject: jest.fn(obj => obj === Object(obj)),
}));

const Team = require('../../models/teams');
const Division = require('../../models/division');
const Club = require('../../models/club');
const League = require('../../models/league');
const Roster = require('../../models/roster');
const app = require('../../app');

const SUPERADMIN = {
  id: 'auth0|test',
  _json: {
    'https://my-app.example.com/role': 'superadmin',
    'https://my-app.example.com/club': 'All',
  },
};

const CLUB_CAPTAIN = {
  id: 'auth0|captain',
  _json: {
    'https://my-app.example.com/role': 'captain',
    'https://my-app.example.com/club': 'Parrswood',
  },
};

const IMPACT = {
  team: {
    id: 61, name: 'Parrswood C', division: 3, withdrawn: null,
    withdrawnDivision: null, withdrawnReason: null,
    divisionName: 'Division 3', clubName: 'Parrswood', clubId: 41,
  },
  season: '20262027',
  outstandingFixtures: 11,
  recordedFixtures: 3,
  players: 8,
};

beforeEach(() => {
  jest.clearAllMocks();
  mockUser = SUPERADMIN;
  League.getAllLeagueTables.mockResolvedValue([]);
  League.getWithdrawnTeams.mockResolvedValue([]);
  League.getWithdrawalImpact.mockResolvedValue(IMPACT);
  League.getTeamPlayerIds.mockResolvedValue([201, 202, 203]);
  League.withdrawTeam.mockResolvedValue({
    teamId: 61, name: 'Parrswood C', division: 3,
    voidedFixtures: [7301, 7344], season: '20262027',
  });
  League.reinstateTeam.mockResolvedValue({
    teamId: 61, name: 'Parrswood C', division: 3, restoredFixtures: [7301, 7344],
  });
  Roster.releasePlayer.mockImplementation(id =>
    Promise.resolve({ playerId: id, name: 'Player ' + id, from: 'Parrswood C' }));
  Team.getAll.mockResolvedValue([]);
  Team.getById.mockResolvedValue([{ id: 61, name: 'Parrswood C', division: 3, rank: 3 }]);
  Team.updateById.mockResolvedValue({ affectedRows: 1 });
  Team.getNextDivRank.mockResolvedValue(9);
});

describe('GET /admin/teams/:id/withdraw — the confirmation page', () => {
  it('spells out what happens to the outstanding fixtures before anything is written', async () => {
    const res = await request(app).get('/admin/teams/61/withdraw');

    expect(res.status).toBe(200);
    expect(res.text).toContain('Withdraw Parrswood C');
    // The counts, so the person doing it can see the size of what they are about to do.
    expect(res.text).toMatch(/Fixtures still to play this season[\s\S]*?11/);
    expect(res.text).toMatch(/Results already recorded this season[\s\S]*?3/);
    // The answer, named: void, not conceded and not deleted.
    expect(res.text).toMatch(/marked\s*<code>void<\/code>/);
    expect(res.text).toMatch(/not conceded and not\s*\n?\s*deleted/);
    // And the effect on everyone else's position.
    expect(res.text).toMatch(/can<\/em>\s*change where other teams finish/);
    // Nothing was written by rendering the page.
    expect(League.withdrawTeam).not.toHaveBeenCalled();
  });

  it('says the team row is kept rather than deleted', async () => {
    const res = await request(app).get('/admin/teams/61/withdraw');
    expect(res.text).toMatch(/not<\/em> deleted/);
    expect(res.text).toContain('2,132');
  });

  it('flags releasing the players as the part that cannot be undone', async () => {
    const res = await request(app).get('/admin/teams/61/withdraw');
    expect(res.text).toContain('No Club / No Team');
    expect(res.text).toMatch(/cannot be undone/);
    // Off by default.
    expect(res.text).toMatch(/name="releasePlayers"[^>]*>/);
    expect(res.text).not.toMatch(/name="releasePlayers"[^>]*checked/);
  });

  it('404s an unknown team', async () => {
    League.getWithdrawalImpact.mockResolvedValue(null);
    const res = await request(app).get('/admin/teams/9999/withdraw');
    expect(res.status).toBe(404);
  });

  it('tells you it has already been withdrawn instead of offering the button again', async () => {
    League.getWithdrawalImpact.mockResolvedValue({
      ...IMPACT,
      team: { ...IMPACT.team, division: null, withdrawn: '2026-08-31T00:00:00.000Z',
        withdrawnDivision: 3, withdrawnReason: 'folded' },
    });
    const res = await request(app).get('/admin/teams/61/withdraw');
    expect(res.status).toBe(200);
    expect(res.text).toContain('is already withdrawn');
    expect(res.text).not.toMatch(/<button[^>]*>Withdraw Parrswood C<\/button>/);
  });
});

describe('POST /admin/teams/:id/withdraw', () => {
  it('will not act without the confirmation box', async () => {
    const res = await request(app).post('/admin/teams/61/withdraw').type('form').send({});
    expect(res.status).toBe(400);
    expect(res.text).toMatch(/Tick the confirmation box/);
    expect(League.withdrawTeam).not.toHaveBeenCalled();
  });

  it('withdraws, and reports what it voided', async () => {
    const res = await request(app).post('/admin/teams/61/withdraw').type('form')
      .send({ confirm: 'yes', reason: 'folded mid-season' });

    expect(res.status).toBe(200);
    expect(League.withdrawTeam).toHaveBeenCalledWith('61', { reason: 'folded mid-season' });
    expect(res.text).toContain('Parrswood C withdrawn');
    expect(res.text).toMatch(/2<\/strong>\s*outstanding fixture/);
    expect(res.text).toContain('7301, 7344');
    expect(res.text).toMatch(/Recorded results left untouched/);
  });

  it('leaves the players alone unless asked', async () => {
    await request(app).post('/admin/teams/61/withdraw').type('form').send({ confirm: 'yes' });
    expect(Roster.releasePlayer).not.toHaveBeenCalled();
  });

  it('releases the players through Roster.releasePlayer when asked, not by hand', async () => {
    const res = await request(app).post('/admin/teams/61/withdraw').type('form')
      .send({ confirm: 'yes', releasePlayers: 'yes' });

    expect(res.status).toBe(200);
    // Roster owns the rank renumbering of the list they leave; renumbering anywhere
    // else is what left teams ranked 1, 2, 4, 6.
    expect(Roster.releasePlayer.mock.calls.map(c => c[0])).toEqual([201, 202, 203]);
    expect(res.text).toMatch(/3<\/strong>\s*players released/);
  });

  it('surfaces a second attempt as a conflict rather than withdrawing again', async () => {
    const err = new Error('Parrswood C was already withdrawn on 2026-08-31.');
    err.status = 409;
    League.withdrawTeam.mockRejectedValue(err);

    const res = await request(app).post('/admin/teams/61/withdraw').type('form')
      .send({ confirm: 'yes' });

    expect(res.status).toBe(409);
  });

  it('404s an unknown team without calling the write', async () => {
    League.getWithdrawalImpact.mockResolvedValue(null);
    const res = await request(app).post('/admin/teams/9999/withdraw').type('form')
      .send({ confirm: 'yes' });
    expect(res.status).toBe(404);
    expect(League.withdrawTeam).not.toHaveBeenCalled();
  });
});

describe('authorization — withdrawal is superadmin only', () => {
  beforeEach(() => { mockUser = CLUB_CAPTAIN; });

  it('403s a club captain opening the confirmation page', async () => {
    const res = await request(app).get('/admin/teams/61/withdraw');
    expect(res.status).toBe(403);
    expect(League.getWithdrawalImpact).not.toHaveBeenCalled();
  });

  it('403s a club captain posting the withdrawal', async () => {
    const res = await request(app).post('/admin/teams/61/withdraw').type('form')
      .send({ confirm: 'yes' });
    expect(res.status).toBe(403);
    expect(League.withdrawTeam).not.toHaveBeenCalled();
  });

  it('403s a club captain reinstating', async () => {
    const res = await request(app).post('/admin/teams/61/reinstate').type('form').send({});
    expect(res.status).toBe(403);
    expect(League.reinstateTeam).not.toHaveBeenCalled();
  });

  it('403s a logged-in user with no role claim at all', async () => {
    mockUser = { id: 'auth0|nobody', _json: {} };
    const res = await request(app).post('/admin/teams/61/withdraw').type('form')
      .send({ confirm: 'yes' });
    expect(res.status).toBe(403);
    expect(League.withdrawTeam).not.toHaveBeenCalled();
  });
});

describe('POST /admin/teams/:id/reinstate', () => {
  it('reinstates and returns to the team list', async () => {
    const res = await request(app).post('/admin/teams/61/reinstate').type('form').send({});
    expect(res.status).toBe(302);
    expect(League.reinstateTeam).toHaveBeenCalledWith('61');
  });

  it('reports a conflict when the team is not withdrawn', async () => {
    const err = new Error('Shell A is not withdrawn.');
    err.status = 409;
    League.reinstateTeam.mockRejectedValue(err);
    const res = await request(app).post('/admin/teams/61/reinstate').type('form').send({});
    expect(res.status).toBe(409);
  });
});

describe('/admin/teams — the withdrawn section', () => {
  it('lists withdrawn teams separately from genuinely unassigned ones, with Reinstate', async () => {
    Division.getAll.mockResolvedValue([{ id: 3, name: 'Division 3', rank: 3, league: 1 }]);
    Club.getAll.mockResolvedValue([{ id: 41, name: 'Parrswood' }]);
    Team.getAll.mockResolvedValue([
      { id: 61, name: 'Parrswood C', club: 41, division: null },
      { id: 62, name: 'Broken D', club: 41, division: 999 },
      { id: 63, name: 'Shell A', club: 41, division: 3 },
    ]);
    League.getWithdrawnTeams.mockResolvedValue([{
      id: 61, name: 'Parrswood C', clubName: 'Parrswood',
      withdrawn: '2026-08-31T00:00:00.000Z', withdrawnReason: 'folded',
      withdrawnDivision: 3, withdrawnDivisionName: 'Division 3',
      withdrawnFixtures: [7301, 7344],
    }]);

    const res = await request(app).get('/admin/teams');

    expect(res.status).toBe(200);
    expect(res.text).toContain('Withdrawn');
    expect(res.text).toContain('/admin/teams/61/reinstate');
    // A withdrawn team has a NULL division, so without the split it would appear in
    // "Unassigned (no matching division)" next to real data faults.
    const unassignedBlock = res.text.split('Unassigned (no matching division)')[1] || '';
    expect(unassignedBlock).toContain('Broken D');
    expect(unassignedBlock).not.toContain('Parrswood C');
    // And every live team gets the action that was missing — including one stranded
    // on a division that no longer exists, which is a prime candidate for it.
    expect(res.text).toContain('/admin/teams/63/withdraw');
    expect(unassignedBlock).toContain('/admin/teams/62/withdraw');
  });
});

describe('editing a withdrawn team', () => {
  it('is refused, because the form would post a division and half-reinstate it', async () => {
    Team.getById.mockResolvedValue([{
      id: 61, name: 'Parrswood C', division: null, rank: 3,
      withdrawn: '2026-08-31T00:00:00.000Z', withdrawnDivision: 3,
    }]);

    const res = await request(app).post('/admin/teams/61').type('form').send({
      name: 'Parrswood C', club: '41', division: '3', venue: '3',
      matchDay: 'Wednesday', rank: '3',
    });

    expect(res.status).toBe(409);
    expect(res.text).toMatch(/Reinstate it from/);
    expect(Team.updateById).not.toHaveBeenCalled();
  });
});
