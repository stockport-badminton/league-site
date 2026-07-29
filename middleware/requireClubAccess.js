// Authorization for anything scoped to one club's players.
//
// The club claim on req.user is a club *name* for an admin/captain, and the
// literal string 'All' for a superadmin (see the Auth0Strategy verify callback in
// app.js). `secured` only proves someone is logged in — it says nothing about
// which club's roster they may touch, which is how /player/batch-update ended up
// lettng any captain rewrite any table. Every roster write goes through here.
//
// The same check lived inline in playerController.manage_player_list_clubs_teams
// and documentsController.assertClubAccess; both now call this.

const CLUB_CLAIM = 'https://my-app.example.com/club';
const ROLE_CLAIM = 'https://my-app.example.com/role';

function claim(req, name) {
  return req.user && req.user._json ? req.user._json[name] : undefined;
}

function isSuperAdmin(req) {
  return claim(req, ROLE_CLAIM) === 'superadmin';
}

function forbidden(club) {
  const err = new Error(
    club
      ? `You don't have access to ${club}'s players`
      : "You don't have access to this club's players"
  );
  err.status = 403;
  return err;
}

// Throws unless the viewer is a superadmin or their own club matches `club`.
// Use inside a controller when the club has to be looked up first (e.g. an
// endpoint keyed by player or team id).
function assertClubAccess(req, club) {
  if (isSuperAdmin(req)) return;
  const userClub = claim(req, CLUB_CLAIM);
  // 'All' is the superadmin marker, but check it independently of the role claim
  // so a user with one and not the other still resolves the same way.
  if (userClub === 'All') return;
  if (!userClub || !club || userClub !== club) throw forbidden(club);
}

// Route middleware for paths carrying a :club name parameter.
function requireClubAccess(req, res, next) {
  try {
    assertClubAccess(req, req.params.club);
    next();
  } catch (err) {
    next(err);
  }
}

// Route middleware for the superadmin-only endpoints (cross-club transfers,
// site-wide player edits). A club admin managing their own roster is not enough.
function requireSuperAdmin(req, res, next) {
  if (isSuperAdmin(req)) return next();
  const err = new Error('Only the results secretary can do that');
  err.status = 403;
  next(err);
}

module.exports = requireClubAccess;
module.exports.requireClubAccess = requireClubAccess;
module.exports.requireSuperAdmin = requireSuperAdmin;
module.exports.assertClubAccess = assertClubAccess;
module.exports.isSuperAdmin = isSuperAdmin;
module.exports.CLUB_CLAIM = CLUB_CLAIM;
module.exports.ROLE_CLAIM = ROLE_CLAIM;
