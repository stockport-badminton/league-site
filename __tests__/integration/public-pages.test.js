const request = require('supertest');

jest.mock('../../models/fixture');
jest.mock('../../models/venue');
jest.mock('../../models/club');
jest.mock('../../models/division');
jest.mock('../../models/auth.js');
jest.mock('../../models/homepageContent');
jest.mock('../../models/siteSettings');
jest.mock('axios');

const Fixture = require('../../models/fixture');
const Venue = require('../../models/venue');
const Club = require('../../models/club');
const HomepageContent = require('../../models/homepageContent');
const SiteSettings = require('../../models/siteSettings');
const axios = require('axios');
const app = require('../../app');

beforeEach(() => {
  jest.clearAllMocks();
});

// GET / — homepage
describe('GET /', () => {
  const setupHomepageMocks = () => {
    Fixture.getOutstandingScorecards.mockResolvedValue([]);
    Fixture.getRecent.mockResolvedValue([]);
    Fixture.getupComing.mockResolvedValue([]);
    HomepageContent.getActive.mockResolvedValue([]);
    SiteSettings.get.mockResolvedValue('messer2026');
    axios.get.mockResolvedValue({ data: { resources: [] } });
  };

  it('returns 200', async () => {
    setupHomepageMocks();
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
  });

  it('calls all three Fixture model methods once each', async () => {
    setupHomepageMocks();
    await request(app).get('/');
    expect(Fixture.getOutstandingScorecards).toHaveBeenCalledTimes(1);
    expect(Fixture.getRecent).toHaveBeenCalledTimes(1);
    expect(Fixture.getupComing).toHaveBeenCalledTimes(1);
  });

  it('returns 500 when a Fixture call rejects', async () => {
    Fixture.getOutstandingScorecards.mockRejectedValue(new Error('DB error'));
    Fixture.getRecent.mockResolvedValue([]);
    Fixture.getupComing.mockResolvedValue([]);
    HomepageContent.getActive.mockResolvedValue([]);
    SiteSettings.get.mockResolvedValue('messer2026');
    axios.get.mockResolvedValue({ data: { resources: [] } });
    const res = await request(app).get('/');
    expect(res.status).toBe(500);
  });
});

// GET /venues — venue list
describe('GET /venues', () => {
  it('returns 200', async () => {
    Venue.getAll.mockResolvedValue([{ id: 1, name: 'Mellor Sports Club', address: 'Mellor Road SK6 5PP' }]);
    const res = await request(app).get('/venues');
    expect(res.status).toBe(200);
  });

  it('calls Venue.getAll once', async () => {
    Venue.getAll.mockResolvedValue([]);
    await request(app).get('/venues');
    expect(Venue.getAll).toHaveBeenCalledTimes(1);
  });

  it('returns 500 when Venue.getAll rejects', async () => {
    Venue.getAll.mockRejectedValue(new Error('DB error'));
    const res = await request(app).get('/venues');
    expect(res.status).toBe(500);
  });
});

// GET /info/clubs — public club list (renders club-v2)
describe('GET /info/clubs', () => {
  const mockClubRow = {
    clubId: 1, name: 'Mellor', teamName: 'Mellor A', matchDay: 'Monday',
    clubvenue: 'Mellor Sports Club', clubgmap: '', clubaddress: 'Mellor Road',
    matchNightText: 'Mondays', clubNightText: 'Mondays', clubWebsite: '',
    matchVenue: 1, teammatchvenue: 'Mellor Sports Club', teamgmap: '', teamaddress: 'Mellor Road',
  };

  it('returns 200', async () => {
    Club.clubDetail.mockResolvedValue([mockClubRow]);
    Venue.getVenueClubs.mockResolvedValue([]);
    const res = await request(app).get('/info/clubs');
    expect(res.status).toBe(200);
  });

  it('calls Club.clubDetail and Venue.getVenueClubs once each', async () => {
    Club.clubDetail.mockResolvedValue([mockClubRow]);
    Venue.getVenueClubs.mockResolvedValue([]);
    await request(app).get('/info/clubs');
    expect(Club.clubDetail).toHaveBeenCalledTimes(1);
    expect(Venue.getVenueClubs).toHaveBeenCalledTimes(1);
  });

  it('returns 500 when Club.clubDetail rejects', async () => {
    Club.clubDetail.mockRejectedValue(new Error('DB error'));
    Venue.getVenueClubs.mockResolvedValue([]);
    const res = await request(app).get('/info/clubs');
    expect(res.status).toBe(500);
  });
});

// 404 handling
describe('404 handler', () => {
  it('returns 404 for an unknown route', async () => {
    const res = await request(app).get('/this-route-does-not-exist');
    expect(res.status).toBe(404);
  });
});
