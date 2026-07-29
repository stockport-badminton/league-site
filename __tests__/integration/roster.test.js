const request = require('supertest');

// The team-management pages and their write API.
//
// The point of most of these is authorization. Every roster write used to sit
// behind `secured` alone, and `secured` only proves that someone is logged in — so
// a captain at one club could rewrite another club's players. Two of the write
// routes had no middleware at all.
//
// `secured` is mocked to install whichever user a test asks for, so the same route
// can be exercised as a superadmin, as a club admin, and as a club admin reaching
// for someone else's club.

// Jest hoists jest.mock() above this declaration, so the name has to be
// mock-prefixed for the factory to be allowed to close over it.
let mockCurrentUser = null;

jest.mock('../../middleware/secured', () => (req, res, next) => {
  if (mockCurrentUser) req.user = mockCurrentUser;
  next();
});

jest.mock('../../models/roster');
jest.mock('../../models/club');
jest.mock('../../utils/ses');

jest.mock('../../db_connect', () => ({
  connect: jest.fn(),
  otherConnect: jest.fn(() => Promise.resolve({
    query: jest.fn(() => Promise.resolve([[], []]))
  })),
  withTransaction: jest.fn(fn => fn({ query: jest.fn(() => Promise.resolve([[]])) })),
  isObject: jest.fn(obj => obj === Object(obj)),
}));

const Roster = require('../../models/roster');
const Club = require('../../models/club');
const ses = require('../../utils/ses');
const app = require('../../app');

const SUPERADMIN = {
  id: 'auth0|super',
  displayName: 'Results Secretary',
  email: 'results@example.com',
  _json: {
    'https://my-app.example.com/role': 'superadmin',
    'https://my-app.example.com/club': 'All',
  },
};

function clubAdmin(club) {
  return {
    id: 'auth0|admin',
    displayName: 'Club Admin',
    email: 'admin@example.com',
    _json: {
      'https://my-app.example.com/role': 'admin',
      'https://my-app.example.com/club': club,
    },
  };
}

const ROSTER_ROWS = [
  { playerId: 1, name: 'Neil Cooper', gender: 'Male', rank: 1, junior: 0, teamCaptain: 1, teamId: 12, teamName: 'Shell A', divisionName: 'Premier', clubName: 'Shell', tel: '07700 900123', email: 'neil@example.com' },
  { playerId: 2, name: 'Sam Whittaker', gender: 'Male', rank: 2, junior: 0, teamId: 12, teamName: 'Shell A', divisionName: 'Premier', clubName: 'Shell', tel: null, email: null },
  { playerId: 3, name: 'Priya Ramanathan', gender: 'Female', rank: 1, junior: 0, teamId: 12, teamName: 'Shell A', divisionName: 'Premier', clubName: 'Shell', tel: null, email: 'priya@example.com' },
  { playerId: 4, name: 'Aisha Karim', gender: 'Female', rank: 99, junior: 1, teamId: 12, teamName: 'Shell A', divisionName: 'Premier', clubName: 'Shell', tel: null, email: null },
  { playerId: 5, name: 'Tom Beddow', gender: 'Male', rank: 100, junior: 0, teamId: 12, teamName: 'Shell A', divisionName: 'Premier', clubName: 'Shell', tel: null, email: null },
];

const TEAMS = [{ id: 12, name: 'Shell A', teamRank: 1, divisionName: 'Premier' }];

beforeEach(() => {
  jest.clearAllMocks();
  mockCurrentUser = SUPERADMIN;
  Roster.getClubRoster.mockResolvedValue(ROSTER_ROWS);
  Roster.getClubTeams.mockResolvedValue(TEAMS);
  Roster.isReserve.mockImplementation(r => r !== null && r !== undefined && Number(r) >= 99);
  Roster.NO_CLUB_ID = 63;
  Club.getAll.mockResolvedValue([{ name: 'Shell' }, { name: 'College Green' }]);
});

describe('GET /manage-players/club-:club — the captain roster', () => {
  it('renders the roster for the viewer own club', async () => {
    mockCurrentUser = clubAdmin('Shell');
    const res = await request(app).get('/manage-players/club-Shell');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Neil Cooper');
    expect(res.text).toContain('Shell A');
  });

  // The old page's whole complaint: no ranks anywhere, so the nominated order —
  // the thing that drives eligibility — existed only as vertical position.
  it('shows the nominated position and the reserve numbering', async () => {
    const res = await request(app).get('/manage-players/club-Shell');
    expect(res.text).toMatch(/class="rank">1</);
    expect(res.text).toMatch(/class="rank">R1</);
  });

  // Every reserve is stored at rank 99 today; sequential ranks must not read as
  // R99, R100.
  it('numbers reserves by position rather than by stored rank', async () => {
    const res = await request(app).get('/manage-players/club-Shell');
    expect(res.text).not.toContain('>R99<');
    expect(res.text).not.toContain('>R100<');
  });

  it('offers tap-to-call and mailto links for players who have them', async () => {
    const res = await request(app).get('/manage-players/club-Shell');
    expect(res.text).toContain('href="tel:07700900123"');
    expect(res.text).toContain('href="mailto:neil@example.com"');
  });

  it('counts the players with no contact details at all', async () => {
    const res = await request(app).get('/manage-players/club-Shell');
    // Sam, Aisha and Tom have neither a phone nor an email.
    expect(res.text).toMatch(/<span class="n">3<\/span><span class="l">No contact<\/span>/);
  });

  it('marks juniors and captains', async () => {
    const res = await request(app).get('/manage-players/club-Shell');
    expect(res.text).toContain('roster-flag junior');
    expect(res.text).toContain('roster-flag captain');
  });

  it('has no drag handles or row menus in the read-only view', async () => {
    const res = await request(app).get('/manage-players/club-Shell');
    expect(res.text).not.toContain('drag-handle');
    expect(res.text).not.toContain('row-menu-btn');
  });

  it('403s a club admin looking at another club', async () => {
    mockCurrentUser = clubAdmin('Shell');
    const res = await request(app).get('/manage-players/club-College%20Green');
    expect(res.status).toBe(403);
  });

  it('404s an unknown club rather than 500ing', async () => {
    Roster.getClubTeams.mockResolvedValue([]);
    const res = await request(app).get('/manage-players/club-Nowhere');
    expect(res.status).toBe(404);
  });
});

describe('GET /manage-players/club-:club/edit — the editor', () => {
  it('renders drag handles, row menus and the save bar', async () => {
    const res = await request(app).get('/manage-players/club-Shell/edit');
    expect(res.status).toBe(200);
    expect(res.text).toContain('drag-handle');
    expect(res.text).toContain('row-menu-btn');
    expect(res.text).toContain('roster-savebar');
    expect(res.text).toContain('roster-edit.js');
  });

  // The lists carry their identity as data attributes. The old page re-derived team
  // and section by walking up four parentElements and reading positional indices.
  it('tags every list with its team, gender and section', async () => {
    const res = await request(app).get('/manage-players/club-Shell/edit');
    expect(res.text).toContain('data-team="12" data-gender="Male" data-section="nominated"');
    expect(res.text).toContain('data-team="12" data-gender="Female" data-section="reserve"');
  });

  it('403s a club admin editing another club', async () => {
    mockCurrentUser = clubAdmin('Shell');
    const res = await request(app).get('/manage-players/club-College%20Green/edit');
    expect(res.status).toBe(403);
  });

  it('lets a club admin edit their own club', async () => {
    mockCurrentUser = clubAdmin('Shell');
    const res = await request(app).get('/manage-players/club-Shell/edit');
    expect(res.status).toBe(200);
  });
});

describe('GET /manage-players/club-:club/registration.docx', () => {
  it('streams a Word document rather than writing one to disk', async () => {
    const res = await request(app)
      .get('/manage-players/club-Shell/registration.docx')
      .responseType('blob');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('wordprocessingml.document');
    expect(res.headers['content-disposition']).toContain('Shell Registrations.docx');
    // A real zip container, not an empty body.
    expect(res.body.length).toBeGreaterThan(1000);
  });

  it('403s another club\'s document', async () => {
    mockCurrentUser = clubAdmin('Shell');
    const res = await request(app).get('/manage-players/club-College%20Green/registration.docx');
    expect(res.status).toBe(403);
  });
});

describe('POST /api/teams/:id/order', () => {
  beforeEach(() => {
    Roster.getTeamOwner.mockResolvedValue({ id: 12, name: 'Shell A', clubId: 40, clubName: 'Shell' });
    Roster.saveTeamOrder.mockResolvedValue([{ id: 2, rank: 1 }]);
  });

  it('saves an ordered id list', async () => {
    const res = await request(app)
      .post('/api/teams/12/order')
      .send({ sections: [{ gender: 'Male', section: 'nominated', playerIds: [2, 1] }] });
    expect(res.status).toBe(200);
    expect(Roster.saveTeamOrder).toHaveBeenCalledWith(12, [
      { gender: 'Male', section: 'nominated', playerIds: [2, 1] }
    ]);
  });

  // Authorization comes from the team's real owner, not from anything the request
  // claimed about itself.
  it('403s a club admin ordering another club\'s team, and writes nothing', async () => {
    mockCurrentUser = clubAdmin('College Green');
    const res = await request(app)
      .post('/api/teams/12/order')
      .send({ sections: [{ gender: 'Male', section: 'nominated', playerIds: [2, 1] }] });
    expect(res.status).toBe(403);
    expect(Roster.saveTeamOrder).not.toHaveBeenCalled();
  });

  it('404s an unknown team', async () => {
    Roster.getTeamOwner.mockResolvedValue(null);
    const res = await request(app)
      .post('/api/teams/999/order')
      .send({ sections: [] });
    expect(res.status).toBe(404);
  });

  it('rejects a non-numeric player id', async () => {
    const res = await request(app)
      .post('/api/teams/12/order')
      .send({ sections: [{ gender: 'Male', section: 'nominated', playerIds: ['1; DROP TABLE player'] }] });
    expect(res.status).toBe(400);
    expect(Roster.saveTeamOrder).not.toHaveBeenCalled();
  });

  it('rejects an unknown section name', async () => {
    const res = await request(app)
      .post('/api/teams/12/order')
      .send({ sections: [{ gender: 'Male', section: 'everyone', playerIds: [1] }] });
    expect(res.status).toBe(400);
  });

  it('rejects an unknown gender', async () => {
    const res = await request(app)
      .post('/api/teams/12/order')
      .send({ sections: [{ gender: 'Other', section: 'nominated', playerIds: [1] }] });
    expect(res.status).toBe(400);
  });

  it('rejects a missing sections array', async () => {
    const res = await request(app).post('/api/teams/12/order').send({});
    expect(res.status).toBe(400);
  });

  // The endpoint that replaced /player/batch-update takes no table or column names
  // at all, so passing them has no effect beyond failing validation.
  it('ignores any attempt to name a table or a column', async () => {
    const res = await request(app)
      .post('/api/teams/12/order')
      .send({ tablename: 'player', fields: ['id', 'role'], data: [[1, 'superadmin']] });
    expect(res.status).toBe(400);
    expect(Roster.saveTeamOrder).not.toHaveBeenCalled();
  });
});

describe('POST /player/batch-update — removed', () => {
  // The critical finding: this took `tablename` and `fields` from the body and
  // interpolated both into an UPDATE, behind `secured` only. Any logged-in user
  // could set their own player.role to superadmin. Nothing should ever route to
  // updateBulk from a request body again.
  it('no longer exists', async () => {
    const res = await request(app)
      .post('/player/batch-update')
      .send({ tablename: 'player', fields: ['id', 'role'], data: [[1, 'superadmin']] });
    expect(res.status).toBe(404);
  });
});

describe('POST /manage-players/create — removed', () => {
  // Had no middleware at all: anonymous player creation into any club, with the
  // club id taken from the request body.
  it('no longer exists', async () => {
    mockCurrentUser = null;
    const res = await request(app)
      .post('/manage-players/create')
      .send({ first_name: 'Anon', family_name: 'Intruder', team: 12, club: 40, gender: 'Male' });
    expect(res.status).toBe(404);
  });
});

describe('POST /api/players/:id/move', () => {
  beforeEach(() => {
    Roster.getPlayerOwner.mockResolvedValue({ id: 2, name: 'Sam Whittaker', gender: 'Male', rank: 2, teamId: 12, teamClubId: 40, clubName: 'Shell' });
    Roster.getTeamOwner.mockResolvedValue({ id: 23, name: 'Shell B', clubId: 40, clubName: 'Shell' });
    Roster.movePlayer.mockResolvedValue({ playerId: 2, name: 'Sam Whittaker', teamId: 23, rank: 99 });
  });

  it('moves a player between teams at the same club', async () => {
    const res = await request(app)
      .post('/api/players/2/move')
      .send({ teamId: 23, section: 'reserve' });
    expect(res.status).toBe(200);
    expect(Roster.movePlayer).toHaveBeenCalledWith(2, 23, 'reserve');
  });

  // Both ends are checked: otherwise a club admin could push one of their own
  // players into someone else's team.
  it('403s when the destination belongs to another club', async () => {
    mockCurrentUser = clubAdmin('Shell');
    Roster.getTeamOwner.mockResolvedValue({ id: 99, name: 'CG A', clubId: 61, clubName: 'College Green' });
    const res = await request(app)
      .post('/api/players/2/move')
      .send({ teamId: 99, section: 'reserve' });
    expect(res.status).toBe(403);
    expect(Roster.movePlayer).not.toHaveBeenCalled();
  });

  it('403s when the player belongs to another club', async () => {
    mockCurrentUser = clubAdmin('College Green');
    Roster.getTeamOwner.mockResolvedValue({ id: 23, name: 'CG B', clubId: 61, clubName: 'College Green' });
    const res = await request(app)
      .post('/api/players/2/move')
      .send({ teamId: 23, section: 'reserve' });
    expect(res.status).toBe(403);
    expect(Roster.movePlayer).not.toHaveBeenCalled();
  });

  it('rejects a missing section', async () => {
    const res = await request(app).post('/api/players/2/move').send({ teamId: 23 });
    expect(res.status).toBe(400);
  });

  it('rejects a missing teamId', async () => {
    const res = await request(app).post('/api/players/2/move').send({ section: 'reserve' });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/players/:id/release', () => {
  it('releases a player from the viewer own club', async () => {
    Roster.getPlayerOwner.mockResolvedValue({ id: 2, name: 'Sam Whittaker', clubName: 'Shell', teamId: 12 });
    Roster.releasePlayer.mockResolvedValue({ playerId: 2, name: 'Sam Whittaker', from: 'Shell A' });
    mockCurrentUser = clubAdmin('Shell');
    const res = await request(app).post('/api/players/2/release');
    expect(res.status).toBe(200);
    expect(Roster.releasePlayer).toHaveBeenCalledWith(2);
  });

  it('403s releasing another club\'s player', async () => {
    Roster.getPlayerOwner.mockResolvedValue({ id: 2, name: 'Someone Else', clubName: 'College Green', teamId: 99 });
    mockCurrentUser = clubAdmin('Shell');
    const res = await request(app).post('/api/players/2/release');
    expect(res.status).toBe(403);
    expect(Roster.releasePlayer).not.toHaveBeenCalled();
  });
});

describe('GET /api/roster/club-:club/candidates', () => {
  beforeEach(() => {
    Roster.findUnattached.mockResolvedValue([{ playerId: 9, name: 'Free Agent', gender: 'Male', clubName: 'No Club' }]);
    Roster.findAtOtherClubs.mockResolvedValue([{ playerId: 10, name: 'Someone Else', gender: 'Male', clubName: 'College Green', teamName: 'CG A' }]);
  });

  // Three outcomes as three labelled groups, instead of one Add button that chose
  // between them by reading an undocumented property off an <option>.
  it('separates unattached players from transfer candidates', async () => {
    const res = await request(app).get('/api/roster/club-Shell/candidates?term=some');
    expect(res.status).toBe(200);
    expect(res.body.unattached).toHaveLength(1);
    expect(res.body.otherClubs).toHaveLength(1);
  });

  it('does not search on a one-character term', async () => {
    const res = await request(app).get('/api/roster/club-Shell/candidates?term=s');
    expect(res.body.unattached).toEqual([]);
    expect(Roster.findUnattached).not.toHaveBeenCalled();
  });

  it('403s another club\'s search', async () => {
    mockCurrentUser = clubAdmin('Shell');
    const res = await request(app).get('/api/roster/club-College%20Green/candidates?term=some');
    expect(res.status).toBe(403);
  });
});

describe('POST /api/roster/club-:club/players', () => {
  beforeEach(() => {
    Roster.getTeamOwner.mockResolvedValue({ id: 12, name: 'Shell A', clubId: 40, clubName: 'Shell' });
    Roster.createPlayer.mockResolvedValue(4321);
    Roster.addToTeam.mockResolvedValue({ playerId: 4321, teamId: 12, rank: 99 });
  });

  it('creates a player and places them in the team', async () => {
    const res = await request(app)
      .post('/api/roster/club-Shell/players')
      .send({ firstName: 'New', familyName: 'Player', gender: 'Male', teamId: 12, section: 'reserve' });
    expect(res.status).toBe(200);
    expect(res.body.created.playerId).toBe(4321);
    // The club comes from the destination team, never from the request body.
    expect(Roster.createPlayer).toHaveBeenCalledWith(expect.objectContaining({ clubId: 40 }));
  });

  it('ignores a club id supplied in the body', async () => {
    const res = await request(app)
      .post('/api/roster/club-Shell/players')
      .send({ firstName: 'New', familyName: 'Player', gender: 'Male', teamId: 12, club: 61, clubId: 61 });
    expect(res.status).toBe(200);
    expect(Roster.createPlayer).toHaveBeenCalledWith(expect.objectContaining({ clubId: 40 }));
  });

  it('requires both names', async () => {
    const res = await request(app)
      .post('/api/roster/club-Shell/players')
      .send({ firstName: 'Onlyone', gender: 'Male', teamId: 12 });
    expect(res.status).toBe(400);
    expect(Roster.createPlayer).not.toHaveBeenCalled();
  });

  it('rejects an over-long name rather than letting Postgres 500', async () => {
    const res = await request(app)
      .post('/api/roster/club-Shell/players')
      .send({ firstName: 'x'.repeat(80), familyName: 'Player', gender: 'Male', teamId: 12 });
    expect(res.status).toBe(400);
  });

  it('403s creating into another club', async () => {
    mockCurrentUser = clubAdmin('College Green');
    const res = await request(app)
      .post('/api/roster/club-Shell/players')
      .send({ firstName: 'New', familyName: 'Player', gender: 'Male', teamId: 12 });
    expect(res.status).toBe(403);
    expect(Roster.createPlayer).not.toHaveBeenCalled();
  });
});

describe('POST /api/roster/club-:club/attach', () => {
  beforeEach(() => {
    Roster.getTeamOwner.mockResolvedValue({ id: 12, name: 'Shell A', clubId: 40, clubName: 'Shell' });
    Roster.addToTeam.mockResolvedValue({ playerId: 9, teamId: 12, rank: 99 });
  });

  it('adopts a player who belongs to no club', async () => {
    Roster.getPlayerOwner.mockResolvedValue({ id: 9, name: 'Free Agent', teamClubId: 63, clubName: 'No Club' });
    const res = await request(app)
      .post('/api/roster/club-Shell/attach')
      .send({ playerId: 9, teamId: 12 });
    expect(res.status).toBe(200);
    expect(Roster.addToTeam).toHaveBeenCalled();
  });

  // The old modal told the user an email had been sent and then, for a superadmin,
  // took the player anyway.
  it('refuses to quietly take a player who is at a real club', async () => {
    Roster.getPlayerOwner.mockResolvedValue({ id: 10, name: 'Someone Else', teamClubId: 61, clubName: 'College Green' });
    const res = await request(app)
      .post('/api/roster/club-Shell/attach')
      .send({ playerId: 10, teamId: 12 });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('transfer');
    expect(Roster.addToTeam).not.toHaveBeenCalled();
  });
});

describe('POST /api/roster/club-:club/transfer', () => {
  beforeEach(() => {
    Roster.getPlayerOwner.mockResolvedValue({ id: 10, name: 'Someone Else', gender: 'Male', rank: 1, teamId: 99, teamName: 'CG A', teamClubId: 61, clubName: 'College Green' });
    Roster.getTeamOwner.mockResolvedValue({ id: 12, name: 'Shell A', clubId: 40, clubName: 'Shell' });
    Roster.movePlayer.mockResolvedValue({ playerId: 10, teamId: 12, rank: 99 });
    ses.sendEmail.mockResolvedValue({});
  });

  // The finding this closes: the old UI said "an email has been sent to request a
  // transfer" and sent nothing at all.
  it('actually emails the results secretary for a club admin', async () => {
    mockCurrentUser = clubAdmin('Shell');
    const res = await request(app)
      .post('/api/roster/club-Shell/transfer')
      .send({ playerId: 10, teamId: 12 });
    expect(res.status).toBe(200);
    expect(res.body.applied).toBe(false);
    expect(ses.sendEmail).toHaveBeenCalledTimes(1);
    const params = ses.sendEmail.mock.calls[0][0];
    expect(params.Message.Subject.Data).toContain('Someone Else');
    expect(params.Message.Body.Html.Data).toContain('College Green');
  });

  it('reports failure honestly when the mail cannot be sent', async () => {
    mockCurrentUser = clubAdmin('Shell');
    ses.sendEmail.mockRejectedValue(new Error('SES is down'));
    const res = await request(app)
      .post('/api/roster/club-Shell/transfer')
      .send({ playerId: 10, teamId: 12 });
    expect(res.status).toBeGreaterThanOrEqual(500);
  });

  // A superadmin is the person who approves transfers, so emailing them about it
  // would be absurd.
  it('applies the transfer directly for a superadmin', async () => {
    const res = await request(app)
      .post('/api/roster/club-Shell/transfer')
      .send({ playerId: 10, teamId: 12 });
    expect(res.status).toBe(200);
    expect(res.body.applied).toBe(true);
    expect(Roster.movePlayer).toHaveBeenCalled();
    expect(ses.sendEmail).not.toHaveBeenCalled();
  });
});

describe('GET /manage-players — the club picker', () => {
  it('lists every club for a superadmin', async () => {
    Roster.getClubSummaries.mockResolvedValue([
      { id: 40, name: 'Shell', teams: 3, players: 36 },
      { id: 61, name: 'College Green', teams: 5, players: 50 },
    ]);
    const res = await request(app).get('/manage-players');
    expect(res.status).toBe(200);
    expect(res.text).toContain('College Green');
    expect(res.text).toContain('/manage-players/club-Shell/edit');
  });

  // Replaces the nav's hardcoded /manage-players/club-Aerospace.
  it('sends a club admin straight to their own club', async () => {
    mockCurrentUser = clubAdmin('Shell');
    const res = await request(app).get('/manage-players');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/manage-players/club-Shell');
  });
});
