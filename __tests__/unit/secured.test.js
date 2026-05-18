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
    res = { redirect: jest.fn() };
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
});
