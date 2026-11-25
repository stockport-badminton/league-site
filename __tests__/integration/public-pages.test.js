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
const cloudinaryGallery = require('../../utils/cloudinaryGallery');
const app = require('../../app');

beforeEach(() => {
  jest.clearAllMocks();
  cloudinaryGallery._reset();
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

  // The notifications offer moved to the fixtures & results pages (fixtures.test.js).
  it('does not carry the notifications offer', async () => {
    setupHomepageMocks();
    const res = await request(app).get('/');
    expect(res.text).not.toContain('notificationsBanner');
    expect(res.text).not.toContain('notificationsVideoPlayer');
  });

  it('calls all three Fixture model methods once each', async () => {
    setupHomepageMocks();
    await request(app).get('/');
    expect(Fixture.getOutstandingScorecards).toHaveBeenCalledTimes(1);
    expect(Fixture.getRecent).toHaveBeenCalledTimes(1);
    expect(Fixture.getupComing).toHaveBeenCalledTimes(1);
  });

  // The gallery listing comes from Cloudinary. It used to be fetched for the homepage
  // itself, and each instance's first homepage request in 10 minutes waited ~450 ms for
  // it (Nov 2026 logs). Now the modal fetches it from /homepage-gallery when it opens.
  it('makes no Cloudinary call and carries no gallery images', async () => {
    setupHomepageMocks();
    axios.get.mockImplementation(() => new Promise(() => {}));
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(axios.get).not.toHaveBeenCalled();
    expect(res.text).not.toMatch(/class="carousel-item/);
    expect(res.text).toContain('id="generatedTournamentGalleryModal"');
    expect(res.text).toMatch(/fetch\('\/homepage-gallery'\)/);
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

// GET /homepage-gallery — the homepage gallery modal's carousel items
describe('GET /homepage-gallery', () => {
  beforeEach(() => SiteSettings.get.mockResolvedValue('messer2026'));

  it('renders one carousel item per image, the first active, src set', async () => {
    axios.get.mockResolvedValue({ data: { resources: [
      { url: 'https://res.cloudinary.com/hvunsveuh/image/upload/v1/a.jpg', context: { custom: { caption: 'Final <b>' } } },
      { url: 'https://res.cloudinary.com/hvunsveuh/image/upload/v1/b.jpg' },
    ] } });
    const res = await request(app).get('/homepage-gallery');
    expect(res.status).toBe(200);
    expect(res.headers['x-robots-tag']).toBe('noindex');
    const items = res.text.match(/<div class="carousel-item[^"]*">/g) || [];
    expect(items).toEqual(['<div class="carousel-item active">', '<div class="carousel-item">']);
    expect(res.text).toContain('src="https://res.cloudinary.com/hvunsveuh/image/upload/f_auto,c_fill/w_auto:breakpoints_200_1920_30_10:300/v1/a.jpg"');
    expect(res.text).toContain('<h5>Final &lt;b&gt;</h5>');
    expect(res.text).not.toContain('<html');
  });

  it('uses the tag set in /admin, and asks Cloudinary once for two requests', async () => {
    SiteSettings.get.mockResolvedValue('presentations2026');
    axios.get.mockResolvedValue({ data: { resources: [] } });
    await request(app).get('/homepage-gallery');
    await request(app).get('/homepage-gallery');
    expect(axios.get).toHaveBeenCalledTimes(1);
    expect(axios.get.mock.calls[0][0]).toMatch(/\/tags\/presentations2026$/);
  });

  it('answers empty, in under 2 s, when Cloudinary never answers', async () => {
    axios.get.mockImplementation(() => new Promise(() => {}));
    const started = Date.now();
    const res = await request(app).get('/homepage-gallery');
    expect(res.status).toBe(200);
    expect(Date.now() - started).toBeLessThan(2000);
    expect(res.text).not.toMatch(/carousel-item/);
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
