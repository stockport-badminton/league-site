const request = require('supertest');

// The superadmin's "approve a new signup" page.
//
// The bug this guards against was invisible to every server-side assertion that
// only asked "did the form render": the page laid itself out in a bare
// `.modal-dialog`, and Bootstrap 4 sets `pointer-events: none` on that class —
// `.modal-content`, nested inside it, is what puts them back. Used as a plain page
// wrapper with no `.modal-content`, the whole form rendered perfectly and could not
// be typed into, clicked or submitted.

let mockCurrentUser = null;

jest.mock('../../middleware/secured', () => (req, res, next) => {
  if (mockCurrentUser) req.user = mockCurrentUser;
  next();
});

jest.mock('../../models/players');
jest.mock('../../utils/ses');
jest.mock('axios');

jest.mock('../../db_connect', () => ({
  connect: jest.fn(),
  otherConnect: jest.fn(() => Promise.resolve({
    query: jest.fn(() => Promise.resolve([[], []])),
  })),
  withTransaction: jest.fn(fn => fn({ query: jest.fn(() => Promise.resolve([[]])) })),
  isObject: jest.fn(obj => obj === Object(obj)),
}));

const Player = require('../../models/players');
const auth = require('../../models/auth');
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

const NEW_SIGNUP = { email: 'newuser@example.com', name: 'New User' };

beforeEach(() => {
  jest.clearAllMocks();
  mockCurrentUser = SUPERADMIN;
  // Auth0's Management API is the only source for the signup's details; the GET is
  // otherwise a pure read.
  jest.spyOn(auth, 'getUserByAuthId').mockResolvedValue(NEW_SIGNUP);
  Player.getAuthRoleByEmail.mockResolvedValue(null);
});

afterEach(() => {
  jest.restoreAllMocks();
});

// Everything between `.modal-dialog` and the end of the document, so the assertions
// below are about the subtree the form actually lives in.
function dialogHtml(html) {
  const start = html.indexOf('class="modal-dialog"');
  expect(start).toBeGreaterThan(-1);
  return html.slice(start);
}

describe('GET /approve-user/:userId', () => {
  it('renders the form for a superadmin', async () => {
    const res = await request(app).get('/approve-user/auth0%7Cabc123');

    expect(res.status).toBe(200);
    expect(res.text).toContain('Approve New Signup');
    expect(res.text).toContain('newuser@example.com');
    expect(res.text).toContain('id="playerSearch"');
    expect(res.text).toContain('id="submitBtn"');
  });

  // The regression itself. `.modal-dialog` without a `.modal-content` inside it is
  // an inert form: Bootstrap 4.6's `.modal-dialog { pointer-events: none }` applies
  // to the whole subtree, and only `.modal-content { pointer-events: auto }` undoes
  // it. Every other view in views/ that uses `.modal-dialog` pairs the two.
  it('keeps the form inside a .modal-content, or none of it is clickable', () => {
    return request(app).get('/approve-user/auth0%7Cabc123').then(res => {
      const dialog = dialogHtml(res.text);
      expect(dialog).toContain('class="modal-content"');
      // The wrapper has to come before the fields, not merely exist somewhere.
      expect(dialog.indexOf('class="modal-content"'))
        .toBeLessThan(dialog.indexOf('id="playerSearch"'));
    });
  });

  it('warns when the email is already linked to a player', async () => {
    Player.getAuthRoleByEmail.mockResolvedValue({
      first_name: 'Neil', family_name: 'Cooper', role: 'admin',
      messerAdmin: false, clubName: 'Shell',
    });

    const res = await request(app).get('/approve-user/auth0%7Cabc123');

    expect(res.status).toBe(200);
    expect(res.text).toContain('already linked to');
    expect(res.text).toContain('Neil');
  });

  // The GET is a display-only step, so it must not touch Auth0 or send anything —
  // an email client prefetching the link would otherwise fire the approval.
  it('writes nothing on GET', async () => {
    const axios = require('axios');
    const ses = require('../../utils/ses');

    await request(app).get('/approve-user/auth0%7Cabc123');

    expect(axios.patch).not.toHaveBeenCalled();
    expect(ses.sendEmail).not.toHaveBeenCalled();
  });

  it('refuses a non-superadmin', async () => {
    mockCurrentUser = {
      id: 'auth0|admin',
      _json: {
        'https://my-app.example.com/role': 'admin',
        'https://my-app.example.com/club': 'Shell',
      },
    };

    const res = await request(app).get('/approve-user/auth0%7Cabc123');

    expect(res.status).toBe(403);
  });
});
