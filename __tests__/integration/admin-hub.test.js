// GET /admin — the hub every superadmin tool is linked from.
const request = require('supertest');

let mockCurrentUser = null;
jest.mock('../../middleware/secured', () => (req, res, next) => {
  if (mockCurrentUser) req.user = mockCurrentUser;
  next();
});
jest.mock('../../models/registrationRequest');
jest.mock('../../models/clubRegistration');

const Requests = require('../../models/registrationRequest');
const Registration = require('../../models/clubRegistration');
const { GROUPS } = require('../../utils/adminTools');
const app = require('../../app');

const SUPERADMIN = { id: 'a', displayName: 'Results Secretary', _json: { 'https://my-app.example.com/role': 'superadmin', 'https://my-app.example.com/club': 'All' } };
const CLUB_ADMIN = { id: 'b', displayName: 'Club Admin', _json: { 'https://my-app.example.com/role': 'admin', 'https://my-app.example.com/club': 'Dome' } };

beforeEach(() => {
  jest.clearAllMocks();
  mockCurrentUser = SUPERADMIN;
  Requests.countPending.mockResolvedValue(2);
  Registration.getStatus.mockResolvedValue([{ id: 1, received: true }, { id: 2, received: false }, { id: 3, received: false }]);
});

it('is superadmin-only', async () => {
  mockCurrentUser = CLUB_ADMIN;
  const res = await request(app).get('/admin');
  expect(res.status).toBe(403);
});

it('links every tool, with what needs attention', async () => {
  const res = await request(app).get('/admin');
  expect(res.status).toBe(200);
  GROUPS.forEach(g => g.tools.forEach(t => expect(res.text).toContain('href="' + t.href + '"')));
  expect(res.text).toContain('2 pending');
  expect(res.text).toContain('2 outstanding');
});

// The page's first job is to be a list of links.
it('still renders when a count fails', async () => {
  Registration.getStatus.mockRejectedValue(new Error('db down'));
  const res = await request(app).get('/admin');
  expect(res.status).toBe(200);
  expect(res.text).toContain('href="/admin/registrations"');
  expect(res.text).not.toContain('outstanding');
});
