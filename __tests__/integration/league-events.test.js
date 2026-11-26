const request = require('supertest');

// The event dates (the Messer finals): kept at /admin/league-events by a Messer admin,
// shown on the fixtures list by fixtureController's withEvents. They were hard-coded rows
// pushed onto every result of Fixture.getFixtureDetails.
let mockClaims = null;
jest.mock('../../middleware/devMode', () => (req, res, next) => {
  if (mockClaims) req.user = { id: 'auth0|test', displayName: 'Test User', nickname: 'test', _json: mockClaims };
  next();
});
jest.mock('../../middleware/secured', () => (req, res, next) =>
  (req.user ? next() : res.redirect('/login')));

jest.mock('../../models/leagueEvent');
jest.mock('../../models/venue');
jest.mock('../../models/fixture');
jest.mock('../../models/division');
jest.mock('axios');

const LeagueEvent = require('../../models/leagueEvent');
const Venue = require('../../models/venue');
const Fixture = require('../../models/fixture');
const app = require('../../app');

// A messer admin is usually a captain too; the flag, not the role, is what admits them.
const MESSER_ADMIN = { 'https://my-app.example.com/role': 'captain', 'https://my-app.example.com/messeradmin': true };
const CAPTAIN = { 'https://my-app.example.com/role': 'captain' };

beforeEach(() => {
  jest.clearAllMocks();
  mockClaims = MESSER_ADMIN;
  Venue.getAll.mockResolvedValue([
    { id: 12, name: 'Ladybridge Park Residents Club', address: 'Edenbridge Road' },
    { id: 5, name: 'Woods Lane Sports Centre', address: 'Woods Ln' },
  ]);
  LeagueEvent.seasonOf.mockResolvedValue('20262027');
  LeagueEvent.create.mockResolvedValue(9);
  LeagueEvent.updateById.mockResolvedValue();
  LeagueEvent.deleteById.mockResolvedValue();
  LeagueEvent.getForSeason.mockResolvedValue([]);
});

describe('/admin/league-events', () => {
  const VALID = { date: '2027-04-13', title: 'Messer A Section Final', detail: '', venue: '12' };

  it('lists the dates for a messer admin, with the season each is shown in', async () => {
    LeagueEvent.getAll.mockResolvedValue([
      { id: 3, day: '2031-01-01', title: 'Stray', detail: null, venue: null, venueName: null, season: null },
      { id: 1, day: '2027-04-13', title: 'Messer A Section Final', detail: null, venue: 12,
        venueName: 'Ladybridge Park Residents Club', season: '20262027' },
    ]);
    const res = await request(app).get('/admin/league-events');
    expect(res.status).toBe(200);
    expect(res.text).toContain('<td>13/04/2027</td>');
    expect(res.text).toContain('<td>2026/27</td>');
    expect(res.text).toContain('None: not shown');
    expect(res.text).toContain('href="/admin/league-events/1"');
  });

  it('is forbidden to a member who is not a messer admin, and writes nothing', async () => {
    mockClaims = CAPTAIN;
    expect((await request(app).get('/admin/league-events')).status).toBe(403);
    expect((await request(app).post('/admin/league-events').type('form').send(VALID)).status).toBe(403);
    expect(LeagueEvent.create).not.toHaveBeenCalled();
  });

  it('sends a visitor who is not logged in to log in', async () => {
    mockClaims = null;
    const res = await request(app).get('/admin/league-events');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/login');
  });

  it('is in the nav for a messer admin', async () => {
    LeagueEvent.getAll.mockResolvedValue([]);
    const res = await request(app).get('/admin/league-events');
    expect(res.text).toContain('<a class="dropdown-item" href="/admin/league-events">Messer &amp; Event Dates</a>');
  });

  it('creates a date, nulling a blank detail', async () => {
    const res = await request(app).post('/admin/league-events').type('form').send(VALID);
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/admin/league-events');
    expect(LeagueEvent.create).toHaveBeenCalledWith({ date: '2027-04-13', title: 'Messer A Section Final', detail: null, venue: 12 });
  });

  it('re-renders with what was typed and the venue still selected, and writes nothing, when invalid', async () => {
    const res = await request(app).post('/admin/league-events').type('form')
      .send({ ...VALID, date: '2027-02-30', title: '', detail: 'x'.repeat(101) });
    expect(res.status).toBe(400);
    expect(LeagueEvent.create).not.toHaveBeenCalled();
    expect(res.text).toContain('Date is required.');
    expect(res.text).toContain('Title is required.');
    expect(res.text).toContain('Detail must be 100 characters or fewer.');
    expect(res.text).toContain('value="2027-02-30"');
    expect(res.text).toMatch(/<option value="12" selected>Ladybridge Park Residents Club<\/option>/);
  });

  it('refuses a date in no season, as it would be shown nowhere', async () => {
    LeagueEvent.seasonOf.mockResolvedValue(undefined);
    const res = await request(app).post('/admin/league-events').type('form').send({ ...VALID, date: '2031-01-01' });
    expect(res.status).toBe(400);
    expect(res.text).toContain('That date is not in any season');
    expect(LeagueEvent.seasonOf).toHaveBeenCalledWith('2031-01-01');
    expect(LeagueEvent.create).not.toHaveBeenCalled();
  });

  it('edits a date: the form shows the stored day, and a save writes the new one', async () => {
    LeagueEvent.getById.mockResolvedValue({ id: 1, day: '2027-04-13', title: 'Messer A Section Final', detail: null, venue: 12 });
    const form = await request(app).get('/admin/league-events/1');
    expect(form.status).toBe(200);
    expect(form.text).toContain('value="2027-04-13"');
    expect(form.text).toContain('action="/admin/league-events/1"');

    const res = await request(app).post('/admin/league-events/1').type('form').send({ ...VALID, date: '2027-04-14' });
    expect(res.status).toBe(302);
    expect(LeagueEvent.updateById).toHaveBeenCalledWith(1, { date: '2027-04-14', title: 'Messer A Section Final', detail: null, venue: 12 });
  });

  it('answers 404 for a date that does not exist', async () => {
    LeagueEvent.getById.mockResolvedValue(undefined);
    expect((await request(app).get('/admin/league-events/77')).status).toBe(404);
    expect((await request(app).post('/admin/league-events/77').type('form').send(VALID)).status).toBe(404);
    expect(LeagueEvent.updateById).not.toHaveBeenCalled();
  });

  it('deletes a date', async () => {
    const res = await request(app).post('/admin/league-events/3/delete');
    expect(res.status).toBe(302);
    expect(LeagueEvent.deleteById).toHaveBeenCalledWith(3);
  });
});

describe('the fixtures list', () => {
  // Stored the way production stores fixture dates: local midnight, read in UTC.
  const fixture = (id, date, homeTeam, extra = {}) => ({
    id, date: new Date(date), homeTeam, awayTeam: 'Canute A', homeClub: 'Bramhall', homeClubId: 1,
    awayClub: 'Canute', division: 7, divisionName: 'Premier', venueName: '1 Test St',
    venueLink: 'https://maps.example/1', status: 'outstanding', homeScore: null, awayScore: null, ...extra,
  });
  const FIXTURES = [
    fixture(101, '2027-04-12T23:00:00Z', 'Bramhall A'),
    fixture(102, '2027-04-27T23:00:00Z', 'Shell A'),
  ];
  const FINALS = { id: 3, day: '2027-05-05', title: 'Messer Finals', detail: '@ Ladybridge Park Residents Club',
    venueName: 'Ladybridge Park Residents Club', venueAddress: 'Edenbridge Road', gMapUrl: 'https://maps.example/12' };
  const A_FINAL = { id: 1, day: '2027-04-20', title: 'Messer A Section Final', detail: null,
    venueName: null, venueAddress: null, gMapUrl: null };

  beforeEach(() => {
    mockClaims = null;
    Fixture.getFixtureDetails.mockResolvedValue(FIXTURES.map(f => ({ ...f })));
    LeagueEvent.getForSeason.mockResolvedValue([FINALS, A_FINAL]);
  });

  // The row bodies in page order, tags stripped.
  const rows = html => [...html.matchAll(/<tr class="[^"]*">([\s\S]*?)<\/tr>/g)]
    .map(m => m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());

  it('shows the season\'s event dates among the fixtures, in date order, without a result', async () => {
    const res = await request(app).get('/results/season-20262027');
    expect(res.status).toBe(200);
    expect(LeagueEvent.getForSeason).toHaveBeenCalledWith('20262027');
    const body = rows(res.text);
    const at = s => body.findIndex(r => r.includes(s));
    expect(at('Bramhall A')).toBeLessThan(at('Messer A Section Final'));
    expect(at('Messer A Section Final')).toBeLessThan(at('Shell A'));
    expect(at('Shell A')).toBeLessThan(at('Messer Finals'));
    expect(body[at('Messer Finals')]).toBe('05/05/2027 Messer Finals @ Ladybridge Park Residents Club');
    expect(res.text).toContain('<tr class="table-danger league-event">');
    // Not offered as a club or team to filter by.
    expect(res.text).not.toMatch(/<option[^>]*>Messer/);
  });

  it('a superadmin gets no Rearrange, Concede or date-edit links on them', async () => {
    mockClaims = { 'https://my-app.example.com/role': 'superadmin', 'https://my-app.example.com/club': 'All' };
    LeagueEvent.getForSeason.mockResolvedValue([FINALS]);
    Fixture.getFixtureDetails.mockResolvedValue([]);
    const res = await request(app).get('/admin/results/season-20262027');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Messer Finals');
    expect(res.text).not.toContain('js-rearrange-link');
    expect(res.text).not.toContain('concede-link');
    expect(res.text).not.toContain('data-fixture-id');
  });

  it.each([
    ['a club', '/results/club-Bramhall'],
    ['a team', '/results/team-Bramhall A'],
    ['a status', '/results/status-complete'],
  ])('leaves them off %s\'s list', async (_, path) => {
    const res = await request(app).get(encodeURI(path));
    expect(res.status).toBe(200);
    expect(res.text).not.toMatch(/Messer Finals|Section Final/);
    expect(LeagueEvent.getForSeason).not.toHaveBeenCalled();
  });

  it('leaves them out of the JSON for a club, which remnants-badminton reads', async () => {
    const res = await request(app).get('/fixtures/club-Bramhall');
    expect(res.status).toBe(200);
    expect(res.body.map(r => r.id)).toEqual([101, 102]);
  });

  it('the season JSON carries them as rows with isEvent and no id', async () => {
    const res = await request(app).get('/fixtures/season-20262027');
    expect(res.body.map(r => r.id)).toEqual([101, null, 102, null]);
    expect(res.body[1]).toMatchObject({ isEvent: true, homeTeam: 'Messer A Section Final', date: '2027-04-20T00:00:00.000Z' });
  });

  // The hard-coded rows meant the list was never empty, and getNearestFixture read the
  // date of the last row of an empty list: a 500 once they had gone.
  it.each(['/results/club-Nowhere', '/fixtures/club-Nowhere'])('%s, with no fixtures, still answers', async path => {
    Fixture.getFixtureDetails.mockResolvedValue([]);
    const res = await request(app).get(path);
    expect(res.status).toBe(200);
  });

  it('keeps them out of the grid', async () => {
    const res = await request(app).get('/results-grid/season-20262027');
    expect(res.status).toBe(200);
    expect(res.text).not.toMatch(/Messer Finals|Section Final/);
  });

  it('a malformed season reads the current season\'s dates', async () => {
    await request(app).get('/results/season-2026x');
    expect(LeagueEvent.getForSeason).toHaveBeenCalledWith(require('../../models/season').current());
  });
});
