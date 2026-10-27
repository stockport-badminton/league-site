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

jest.mock('../../models/juniorClub');
jest.mock('../../models/venue');

const JuniorClub = require('../../models/juniorClub');
const Venue = require('../../models/venue');
const app = require('../../app');

const MACC = {
  id: 1, name: 'Macc Smashers Junior Badminton', venue_note: null,
  session_times: 'Fridays 5.30pm - 8.30pm', fees: null, has_email: true,
  website: null, notes: null, venueName: 'Macclesfield Leisure Centre',
  venueAddress: 'Priory Lane, Macclesfield, Cheshire, SK10 4AF', gMapUrl: 'https://maps.example/27',
};
const MG = {
  id: 2, name: 'MG Badders', venue_note: 'Club Cheadle Hulme', session_times: null, fees: null,
  has_email: false, website: 'https://mgbadders.com', notes: null,
  venueName: 'Woods Lane Sports Centre', venueAddress: 'Cheadle Hulme High School, Woods Ln', gMapUrl: null,
};

beforeEach(() => {
  jest.clearAllMocks();
  Venue.getAll.mockResolvedValue([
    { id: 27, name: 'Macclesfield Leisure Centre', address: 'Priory Lane' },
    { id: 5, name: 'Woods Lane Sports Centre', address: 'Cheadle Hulme High School' },
  ]);
  JuniorClub.create.mockResolvedValue(9);
  JuniorClub.updateById.mockResolvedValue();
  JuniorClub.deleteById.mockResolvedValue();
});

describe('GET /info/junior-clubs', () => {
  it('shows each club with only the details it published', async () => {
    JuniorClub.getActive.mockResolvedValue([MACC, MG]);
    const res = await request(app).get('/info/junior-clubs');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Macc Smashers Junior Badminton');
    expect(res.text).toContain('<a href="/contact-us?junior=1">Send the club a message</a>');
    expect(res.text).toContain('Fridays 5.30pm - 8.30pm');
    expect(res.text).toContain('<a href="https://maps.example/27" target="_blank" rel="noopener">Macclesfield Leisure Centre</a>');
    expect(res.text).toContain('<a href="https://mgbadders.com" target="_blank" rel="noopener">Club website</a>');
    expect(res.text).toContain('Club Cheadle Hulme');
    // MG Badders takes enquiries through its website alone.
    expect(res.text).not.toContain('/contact-us?junior=2');
    // No club's address is ever on the page.
    expect(res.text).not.toContain('mailto:');
  });

  it('escapes what an admin typed', async () => {
    JuniorClub.getActive.mockResolvedValue([{ ...MG, notes: '<script>alert(1)</script>' }]);
    const res = await request(app).get('/info/junior-clubs');
    expect(res.text).not.toContain('<script>alert(1)</script>');
    expect(res.text).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('says so when there are no clubs', async () => {
    JuniorClub.getActive.mockResolvedValue([]);
    const res = await request(app).get('/info/junior-clubs');
    expect(res.status).toBe(200);
    expect(res.text).toContain('No junior clubs are listed at the moment');
  });

  it('is linked from the nav', async () => {
    JuniorClub.getActive.mockResolvedValue([]);
    const res = await request(app).get('/info/junior-clubs');
    expect(res.text).toContain('<a class="nav-link" href="/info/junior-clubs">Juniors</a>');
  });
});

describe('/admin/junior-clubs', () => {
  const VALID = {
    name: 'College Green Juniors', venue: '14', session_times: 'Mondays 6.30pm - 7.30pm',
    fees: '£50 per term', website: 'www.collegegreenbadminton.com/', active: 'on',
  };

  it('lists every club, hidden ones included', async () => {
    JuniorClub.getAll.mockResolvedValue([{ ...MG, active: false, venueName: 'Woods Lane Sports Centre' }]);
    const res = await request(app).get('/admin/junior-clubs');
    expect(res.status).toBe(200);
    expect(res.text).toContain('MG Badders');
    expect(res.text).toContain('Hidden');
  });

  it('creates a club, adding https:// to a bare website and nulling blanks', async () => {
    const res = await request(app).post('/admin/junior-clubs').type('form').send({ ...VALID, contact_email: '  ' });
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/admin/junior-clubs');
    expect(JuniorClub.create).toHaveBeenCalledWith({
      name: 'College Green Juniors', venue: 14, venue_note: null, session_times: 'Mondays 6.30pm - 7.30pm',
      fees: '£50 per term', contact_email: null, website: 'https://www.collegegreenbadminton.com/',
      notes: null, active: true,
    });
  });

  it('an unticked box hides the club', async () => {
    const { active, ...rest } = VALID;
    await request(app).post('/admin/junior-clubs').type('form').send(rest);
    expect(JuniorClub.create.mock.calls[0][0].active).toBe(false);
  });

  it('re-renders with what was typed, and writes nothing, when the form is invalid', async () => {
    const res = await request(app).post('/admin/junior-clubs').type('form')
      .send({ ...VALID, name: '', contact_email: 'not-an-email', website: 'javascript:alert(1)' });
    expect(res.status).toBe(400);
    expect(JuniorClub.create).not.toHaveBeenCalled();
    expect(res.text).toContain('Name is required.');
    expect(res.text).toContain('Enquiries email does not look like an email address.');
    expect(res.text).toContain('Website must be a web address');
    expect(res.text).toContain('value="£50 per term"');
    expect(res.text).toContain('value="not-an-email"');
    expect(res.text).toMatch(/<option value="14"|<option value="27"/);
  });

  it('keeps the chosen venue selected after a failed save', async () => {
    const res = await request(app).post('/admin/junior-clubs').type('form').send({ ...VALID, venue: '27', name: '' });
    expect(res.text).toMatch(/<option value="27" selected>/);
  });

  it('edits a club', async () => {
    JuniorClub.getById.mockResolvedValue({ id: 2, name: 'MG Badders', active: true });
    const form = await request(app).get('/admin/junior-clubs/2');
    expect(form.status).toBe(200);
    expect(form.text).toContain('value="MG Badders"');

    const res = await request(app).post('/admin/junior-clubs/2').type('form').send(VALID);
    expect(res.status).toBe(302);
    expect(JuniorClub.updateById).toHaveBeenCalledWith(2, expect.objectContaining({ name: 'College Green Juniors' }));
  });

  it('404s an unknown club rather than writing', async () => {
    JuniorClub.getById.mockResolvedValue(undefined);
    expect((await request(app).get('/admin/junior-clubs/99')).status).toBe(404);
    expect((await request(app).post('/admin/junior-clubs/99').type('form').send(VALID)).status).toBe(404);
    expect(JuniorClub.updateById).not.toHaveBeenCalled();
  });

  it('deletes a club', async () => {
    const res = await request(app).post('/admin/junior-clubs/2/delete');
    expect(res.status).toBe(302);
    expect(JuniorClub.deleteById).toHaveBeenCalledWith(2);
  });
});
