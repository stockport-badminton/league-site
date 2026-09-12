// Who may publish a league result.
//
// `POST /scorecard-beta` is the publish step: it writes the fixture's score, inserts 18
// `game` rows, fires the result zap and sends the "website updated" email. It carried
// `publicFormLimiter` and nothing else, while `GET /scorecard-beta` was `secured` and the
// messer equivalent (`POST /messer-scorecard-beta`) was `secured` too. That asymmetry is
// the giveaway: no comment anywhere justified the open POST, unlike the endpoints in this
// codebase whose public reachability IS deliberate and documented (HARD-24).
//
// What it allowed was not rewriting history — HARD-01's `resolveFixtureForResult` already
// refuses `already-recorded`, `ambiguous`, `rearranged`, `conceded` and `not-found`, so a
// result can be neither overwritten nor invented. It was publishing a plausible but
// FABRICATED result for any currently outstanding fixture, from inputs that are all public
// (fixtures, dates, team names, nominated players). The nastier half is what follows: once
// a fake result is recorded the real captain's submission resolves to `already-recorded`
// and is refused with a 409, so this is a way to BLOCK a genuine result — and the captain
// reports that as "the website is broken", not as tampering.
//
// Before gating, the callers were checked, because that is the step SEC-3 skipped when it
// gated the invoice endpoints and silently killed a Make.com automation that fires once a
// year (HARD-23). Over the whole retained Cloud Logging window (17 May 2026 onward):
// 5 POSTs to `/scorecard-beta`, all 200, all one desktop browser; 5 POSTs to
// `/email-scorecard`, each preceding a publish the same day; and 5 complete fixtures in
// the database, each with exactly 18 games. One human, in a browser, 1:1 with the drafts.
// No automation, no non-browser user agent. Confirmed with the owner that it is him, as
// superadmin. Gating is therefore safe — but re-run that query rather than trusting this
// paragraph if the flow ever changes.
//
// Two ways through, because the superadmin session is not the only legitimate route to
// the confirmation page:
//
//   1. a superadmin session — who publishes today, and who published all 1,557 of the
//      drafts that predate the token column; or
//   2. a valid token FOR THE DRAFT BEING PUBLISHED, so the results secretary can still
//      publish from the emailed link on a device with no session.
//
// `secured` alone would have been the wrong gate in both directions: any logged-in league
// member could still publish any outstanding fixture, and a session-less secretary
// following the email link would be redirected to /login with the POST body lost — which
// is the kind of thing discovered at the worst possible moment, mid-validation.
//
// The token test is `mayPublishDraft`, NOT `mayOpenDraft`. See the comment on it in
// utils/scorecardLinks.js: reading a tokenless draft is grandfathered open and publishing
// one is not.

const { isSuperAdmin } = require('./requireClubAccess');
const { mayPublishDraft } = require('../utils/scorecardLinks');
const Fixture = require('../models/fixture');

function forbidden() {
  const err = new Error('Only the results secretary can publish a result');
  err.status = 403;
  return err;
}

async function requirePublishAuthority(req, res, next) {
  try {
    if (isSuperAdmin(req)) return next();

    // The confirmation page renders both of these as hidden fields; a caller who did not
    // come from there has neither. `draftId` alone proves nothing — it is a sequential
    // primary key — so both are required and the token is what is actually checked.
    const draftId = req.body && req.body.draftId;
    const providedToken = req.body && req.body.t;
    if (!draftId || !providedToken) return next(forbidden());

    const rows = await Fixture.getScorecardById(draftId);
    if (!rows || !rows.length) return next(forbidden());

    if (!mayPublishDraft(rows[0].confirmToken, providedToken)) return next(forbidden());

    return next();
  } catch (err) {
    // A lookup failure is ours, not the caller's: let the central handler report it
    // rather than turning an outage into a misleading 403.
    next(err);
  }
}

module.exports = requirePublishAuthority;
module.exports.requirePublishAuthority = requirePublishAuthority;
