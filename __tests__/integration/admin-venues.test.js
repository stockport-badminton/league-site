// /admin/venues: list, add and edit venues, including the "Getting there" notes
// (venue.directions, migration 037). No delete, on purpose — see venueController.js.
const request = require('supertest');

// Auth bypass — the admin routes gate on the superadmin role claim.
jest.mock('../../middleware/secured', () => (req, res, next) => {
  req.user = {
    id: 'auth0|test',
    _json: {
      'https://my-app.example.com/role': 'superadmin',
      'https://my-app.example.com/club': 'All',
    },
  };
  next();
});

jest.mock('../../models/venue');
// Saving regenerates the static clubs map from Google; not in a test.
jest.mock('../../utils/venues-map-generator', () => ({ generateVenuesMap: jest.fn().mockResolvedValue() }));

const Venue = require('../../models/venue');
const { generateVenuesMap } = require('../../utils/venues-map-generator');
const app = require('../../app');

const EVERYBODY = {
  id: 26, name: 'Everybody Sport and Recreation',
  address: 'Everybody Sport and Recreation Fitness Centre, Alderley Park, Macclesfield, SK10 4TG',
  gMapUrl: 'https://maps.app.goo.gl/jxYfweGPAcS1fEaH8', Lat: 53.27, Lng: -2.23, placeId: null,
  directions: 'Use the South site entrance.\nOverflow car park in front of the Royal London building.',
};
const VALID = {
  name: EVERYBODY.name, address: EVERYBODY.address, gMapUrl: EVERYBODY.gMapUrl,
  directions: EVERYBODY.directions, Lat: '53.27', Lng: '-2.23',
};

beforeEach(() => {
  jest.clearAllMocks();
  Venue.getById.mockImplementation(async id => (id === 26 ? EVERYBODY : undefined));
  Venue.create.mockResolvedValue(30);
  Venue.updateById.mockResolvedValue();
});

describe('/admin/venues', () => {
  it('lists every venue, says which are in use and which have directions', async () => {
    Venue.getAllWithUse.mockResolvedValue([
      { ...EVERYBODY, clubs: '1', teams: '3' },
      { id: 13, name: 'Macclesfield Academy', address: 'Park Lane', directions: null, clubs: '0', teams: '0' },
    ]);
    const res = await request(app).get('/admin/venues');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Everybody Sport and Recreation');
    expect(res.text).toContain('1 club, 3 teams');
    expect(res.text).toContain('Not in use');
    expect(res.text).toContain('href="/admin/venues/26"');
    expect(res.text).not.toMatch(/delete/i);
  });

  it('shows the stored row, directions included, on the edit form', async () => {
    const res = await request(app).get('/admin/venues/26');
    expect(res.status).toBe(200);
    expect(res.text).toContain('value="Everybody Sport and Recreation"');
    expect(res.text).toMatch(/<textarea[^>]*name="directions"[^>]*>Use the South site entrance\.\nOverflow car park/);
  });

  it('404s an unknown venue', async () => {
    expect((await request(app).get('/admin/venues/999')).status).toBe(404);
  });

  it('saves an edit, as numbers and nulls, and rebuilds the clubs map', async () => {
    const res = await request(app).post('/admin/venues/26').type('form').send({ ...VALID, directions: '  ' });
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/admin/venues');
    expect(Venue.updateById).toHaveBeenCalledWith(26, {
      name: EVERYBODY.name, address: EVERYBODY.address, gMapUrl: EVERYBODY.gMapUrl,
      directions: null, Lat: 53.27, Lng: -2.23,
    });
    expect(generateVenuesMap).toHaveBeenCalled();
  });

  it('creates a venue, coordinates optional', async () => {
    const res = await request(app).post('/admin/venues').type('form')
      .send({ ...VALID, name: 'New Hall', Lat: '', Lng: '' });
    expect(res.status).toBe(302);
    expect(Venue.create).toHaveBeenCalledWith(expect.objectContaining({ name: 'New Hall', Lat: null, Lng: null }));
  });

  it('re-renders with what was typed, and writes nothing, when the form is invalid', async () => {
    const res = await request(app).post('/admin/venues/26').type('form').send({
      ...VALID, name: '', gMapUrl: 'javascript:alert(1)', Lat: 'north-ish', Lng: '', directions: 'x'.repeat(1001),
    });
    expect(res.status).toBe(400);
    expect(Venue.updateById).not.toHaveBeenCalled();
    expect(generateVenuesMap).not.toHaveBeenCalled();
    expect(res.text).toContain('Name is required.');
    expect(res.text).toContain('Map link must be a web address');
    expect(res.text).toContain('Getting there must be 1000 characters or fewer.');
    expect(res.text).toContain('Give both latitude and longitude, or neither.');
    expect(res.text).toContain('value="north-ish"');
    expect(res.text).toContain('value="' + EVERYBODY.address + '"');
  });

  it('refuses a latitude that is not a number', async () => {
    const res = await request(app).post('/admin/venues').type('form').send({ ...VALID, Lat: 'abc' });
    expect(res.status).toBe(400);
    expect(res.text).toContain('Latitude must be a number between -90 and 90.');
    expect(Venue.create).not.toHaveBeenCalled();
  });
});
