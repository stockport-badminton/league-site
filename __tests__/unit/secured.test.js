const secured = require('../../middleware/secured');

describe('secured middleware', () => {
  let req, res, next;

  beforeEach(() => {
    req = {
      isAuthenticated: jest.fn(),
      query: {},
      originalUrl: '/scorecard-beta',
      session: {}
    };
    res = {
      redirect: jest.fn(),
      set: jest.fn(),
      status: jest.fn(function () { return this; }),
      json: jest.fn()
    };
    next = jest.fn();
  });

  it('calls next() when authenticated', () => {
    req.isAuthenticated.mockReturnValue(true);
    secured(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.redirect).not.toHaveBeenCalled();
  });

  it('redirects to /login when not authenticated', () => {
    req.isAuthenticated.mockReturnValue(false);
    secured(req, res, next);
    expect(res.redirect).toHaveBeenCalledWith(expect.stringContaining('/login'));
    expect(next).not.toHaveBeenCalled();
  });

  it('stores originalUrl in session.returnTo when not authenticated', () => {
    req.isAuthenticated.mockReturnValue(false);
    secured(req, res, next);
    expect(req.session.returnTo).toBe('/scorecard-beta');
  });

  it('prefers req.query.state over originalUrl for returnTo', () => {
    req.isAuthenticated.mockReturnValue(false);
    req.query.state = '/some-deep-page';
    secured(req, res, next);
    expect(req.session.returnTo).toBe('/some-deep-page');
  });

  // fetch() followed the redirect to Auth0, cross-origin, and failed with a network
  // error, so the roster editor could never say the session had expired.
  it('answers an /api/ call with a JSON 401, not a redirect', () => {
    req.isAuthenticated.mockReturnValue(false);
    req.originalUrl = '/api/teams/12/order';
    secured(req, res, next);
    expect(res.redirect).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ ok: false, error: expect.stringMatching(/expired/) }));
    expect(req.session.returnTo).toBeUndefined();
    expect(next).not.toHaveBeenCalled();
  });

  it('still redirects a page whose path merely contains api', () => {
    req.isAuthenticated.mockReturnValue(false);
    req.originalUrl = '/club-api/4';
    secured(req, res, next);
    expect(res.redirect).toHaveBeenCalled();
  });
});
