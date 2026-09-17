// Reading the signed-in user, in one place, because the obvious spelling is wrong.
//
// `req.user` is the raw `Profile` object from passport-auth0, cached whole in the session
// by `passport.serializeUser` in app.js. **That object has no `email` property.** Its
// constructor (node_modules/passport-auth0/lib/Profile.js) sets `displayName`, `id`,
// `name`, `emails` and `_json`, and nothing else — an address arrives as
// `emails: [{ value }]`, which is exactly how the login strategy itself reads it:
//
//     var email = profile.emails && profile.emails[0] && profile.emails[0].value;
//
// So `req.user.email` is `undefined` on every request, and had been wherever it was
// written. It fails in the worst available way: `undefined` is falsy, so every call site
// had a `||` fallback or an `if` beside it and quietly took the other branch. Nothing
// threw, nothing logged, and the feature simply did not exist.
//
// Found 17 Sep 2026 while adding the submitter's address to the draft-received email —
// the new code was written with the same spelling and would have shipped doing nothing.
// Two live call sites had it already:
//
//   - `rosterController` put the requester in a transfer email's `replyTo` so the club
//     could reply to the person asking. It has always sent the league address only.
//   - `spamAdminController` recorded who added a blocklist entry. Every row says 'admin'.
//
// `__tests__/unit/session-user.test.js` fails if `.user.email` reappears anywhere.

function userEmail(user) {
  if (!user) return '';
  const fromProfile = Array.isArray(user.emails) && user.emails[0] && user.emails[0].value;
  // `_json` is the raw Auth0 userinfo and carries `email` when that scope is granted.
  // Second, not first: `emails` is what the strategy authenticates on, so preferring it
  // keeps this agreeing with the row `Player.getAuthRoleByEmail` was looked up by.
  const fromClaims = user._json && user._json.email;
  return String(fromProfile || fromClaims || '').trim();
}

function userDisplayName(user) {
  return String((user && user.displayName) || '').trim();
}

// Name and address together, for the places that want to say who did something:
// "Jane Captain (jane@example.com)", or just the address, or ''.
function userLabel(user) {
  const email = userEmail(user);
  const name = userDisplayName(user);
  if (!email) return name;
  return name ? `${name} (${email})` : email;
}

module.exports = { userEmail, userDisplayName, userLabel };
