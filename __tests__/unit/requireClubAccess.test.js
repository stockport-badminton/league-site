const requireClubAccess = require('../../middleware/requireClubAccess');
const { assertClubAccess, requireSuperAdmin, isSuperAdmin, CLUB_CLAIM, ROLE_CLAIM } =
  requireClubAccess;

// The hole this closes: every roster write used to sit behind `secured` alone,
// which only proves someone is logged in. A captain at one club could rewrite any
// other club's players — or any table at all, via /player/batch-update.
function userWith(claims) {
  return { displayName: 'Test User', _json: claims || {} };
}

describe('requireClubAccess', () => {
  let req, res, next;

  beforeEach(() => {
    req = { params: {}, user: undefined };
    res = {};
    next = jest.fn();
  });

  describe('assertClubAccess', () => {
    it('lets a club admin through for their own club', () => {
      req.user = userWith({ [CLUB_CLAIM]: 'Shell' });
      expect(() => assertClubAccess(req, 'Shell')).not.toThrow();
    });

    it('blocks a club admin from another club', () => {
      req.user = userWith({ [CLUB_CLAIM]: 'Shell' });
      expect(() => assertClubAccess(req, 'College Green')).toThrow(/access to College Green/);
    });

    it('attaches a 403 status so the error handler does not render a 500', () => {
      req.user = userWith({ [CLUB_CLAIM]: 'Shell' });
      let caught;
      try { assertClubAccess(req, 'College Green'); } catch (err) { caught = err; }
      expect(caught.status).toBe(403);
    });

    // 'All' is the marker the Auth0 strategy sets for a superadmin, who has no one
    // club of their own.
    it('lets the All club claim through for any club', () => {
      req.user = userWith({ [CLUB_CLAIM]: 'All' });
      expect(() => assertClubAccess(req, 'Anything')).not.toThrow();
    });

    it('lets a superadmin through even with no club claim', () => {
      req.user = userWith({ [ROLE_CLAIM]: 'superadmin' });
      expect(() => assertClubAccess(req, 'College Green')).not.toThrow();
    });

    it('blocks a user with no claims at all', () => {
      req.user = userWith({});
      expect(() => assertClubAccess(req, 'Shell')).toThrow();
    });

    it('blocks an unauthenticated request', () => {
      expect(() => assertClubAccess(req, 'Shell')).toThrow();
    });

    // Guards against a club-less URL being read as "any club".
    it('blocks when the club is missing from the URL', () => {
      req.user = userWith({ [CLUB_CLAIM]: 'Shell' });
      expect(() => assertClubAccess(req, undefined)).toThrow();
    });

    it('is case- and whitespace-sensitive rather than fuzzy', () => {
      req.user = userWith({ [CLUB_CLAIM]: 'Shell' });
      expect(() => assertClubAccess(req, 'shell')).toThrow();
      expect(() => assertClubAccess(req, 'Shell ')).toThrow();
    });
  });

  describe('as route middleware', () => {
    it('calls next with no argument when allowed', () => {
      req.user = userWith({ [CLUB_CLAIM]: 'Shell' });
      req.params.club = 'Shell';
      requireClubAccess(req, res, next);
      expect(next).toHaveBeenCalledWith();
    });

    it('calls next with a 403 error when denied', () => {
      req.user = userWith({ [CLUB_CLAIM]: 'Shell' });
      req.params.club = 'College Green';
      requireClubAccess(req, res, next);
      expect(next).toHaveBeenCalledTimes(1);
      expect(next.mock.calls[0][0]).toBeInstanceOf(Error);
      expect(next.mock.calls[0][0].status).toBe(403);
    });
  });

  describe('requireSuperAdmin', () => {
    it('allows a superadmin', () => {
      req.user = userWith({ [ROLE_CLAIM]: 'superadmin' });
      requireSuperAdmin(req, res, next);
      expect(next).toHaveBeenCalledWith();
    });

    // A club admin managing their own roster is not enough for the site-wide
    // endpoints (creating players outside the roster flow, cross-club transfers).
    it('rejects a club admin', () => {
      req.user = userWith({ [ROLE_CLAIM]: 'admin', [CLUB_CLAIM]: 'Shell' });
      requireSuperAdmin(req, res, next);
      expect(next.mock.calls[0][0].status).toBe(403);
    });

    it('rejects an anonymous request', () => {
      requireSuperAdmin(req, res, next);
      expect(next.mock.calls[0][0].status).toBe(403);
    });
  });

  // Takes the request, not the user — it reads req.user._json, the same claims the
  // rest of the app reads.
  describe('isSuperAdmin', () => {
    it('is true only for the superadmin role', () => {
      expect(isSuperAdmin({ user: userWith({ [ROLE_CLAIM]: 'superadmin' }) })).toBe(true);
      expect(isSuperAdmin({ user: userWith({ [ROLE_CLAIM]: 'admin' }) })).toBe(false);
      expect(isSuperAdmin({ user: userWith({}) })).toBe(false);
      expect(isSuperAdmin({})).toBe(false);
    });
  });
});
