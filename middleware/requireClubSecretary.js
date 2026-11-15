// Route middleware for /club-officers/:clubId — the club's own secretaries manage its
// officers. Admits the superadmin, or a login that is a club secretary or match secretary
// (by the player flag) of the club in :clubId. Leaves the match on req.secretaryOf.
//
// Looked up on every request rather than read from a session claim: a flag given or taken
// on this page has to take effect at once, for the person it was taken from as well.
//
// A login whose identity provider says the address is unverified is not matched, so an
// account opened under a secretary's address cannot borrow their office.
const ClubOfficers = require('../models/clubOfficers')
const { isSuperAdmin } = require('./requireClubAccess')
const { userEmail } = require('../utils/sessionUser')

function forbidden() {
  const err = new Error("Only this club's club secretary or match secretary can manage its officers");
  err.status = 403;
  return err;
}

async function requireClubSecretary(req, res, next) {
  try {
    const clubId = Number(req.params.clubId);
    if (!Number.isInteger(clubId)) {
      const err = new Error('No such club');
      err.status = 404;
      throw err;
    }
    if (isSuperAdmin(req)) return next();
    const json = (req.user && req.user._json) || {};
    if (json.email_verified === false) throw forbidden();
    const clubs = await ClubOfficers.secretaryClubs(userEmail(req.user));
    const mine = clubs.find(c => c.clubId === clubId);
    if (!mine) throw forbidden();
    req.secretaryOf = mine;
    next();
  } catch (err) {
    next(err);
  }
}

module.exports = requireClubSecretary;
