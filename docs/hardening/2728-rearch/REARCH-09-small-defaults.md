# REARCH-09 — small defaults: the session user, logging, the tokenless-draft clause

**Size:** S each · **Window:** per part, below
**Blocked by:** nothing. Part A conflicts with REARCH-06 on `app.js` (sequence them).
**Owns:** A — `passport.serializeUser`/`deserializeUser` and the login enrichment in
`app.js`, `utils/sessionUser.js`; B — logging in `controllers/`, `models/`, `utils/`,
`middleware/`, `routes/`; C — `draftRequiresToken` in `utils/scorecardLinks.js`.
**Source:** the 24 Oct 2026 "build it from scratch" review.

Three independent changes, grouped because each is small. Take them as separate PRs.

---

## Part A — `req.user` is our own typed object

**Window:** off-season preferred (it touches every logged-in request); in-season possible
with the compatibility shim below.

### Why

`req.user` is the raw passport-auth0 `Profile`, cached whole in the session
(`serializeUser(user => user)`). At login, `app.js` looks the user up with
`Player.getAuthRoleByEmail` and **writes our own roles into Auth0's claim namespace** on
that profile — `_json['https://my-app.example.com/role']`, `/club`, `/messeradmin`. Then 31
places read them back out by that URL-shaped key, and 19 of those repeat the superadmin
comparison (REARCH-04).

So the database is *already* the source of roles; what is left is the shape. That shape
produced gotcha 1a: `req.user.email` does not exist on a `Profile`, every caller had a `||`
fallback, and the feature it served silently never worked. `utils/sessionUser.js`
(`userEmail`, `userDisplayName`, `userLabel`) is the half-step already taken.

### What to do

- At login, build `{ id, email, name, role, clubId, clubName, messerAdmin, playerId }` and
  serialise **that**. `utils/sessionUser.js` becomes the type definition (JSDoc
  `@typedef`, checked under REARCH-01's `checkJs`).
- **Existing sessions hold the old shape** (the session store is Postgres, they survive a
  deploy). `deserializeUser` upgrades an old-shaped session in place, so nobody is logged
  out. Remove the shim after the session lifetime has passed.
- Replace the 31 `_json[...]` reads; the session-user test already fails on
  `.user.email` — extend it to fail on `_json[` outside `sessionUser.js`.
- `DEV_MODE`'s mock user (`middleware/devMode.js`) produces the new shape.

### One thing to decide, not fix silently

Roles are read **once, at login**. A superadmin demoted in the database stays superadmin
until their session ends. That is today's behaviour and this package keeps it — but a
from-scratch design would re-read the role on each request (one indexed query) or on a
short cache. Ask whether it matters; it is a one-line change once the shape is ours.

---

## Part B — structured logs with a request id

**Window:** in-season OK.

There are 305 `console.log/error/warn` calls in application code. Cloud Run sends them to
Cloud Logging as text, with no severity and nothing tying a line to the request that
produced it — which is why the HARD-47 timing work had to invent its own
`[timing] <stage>: <label>` prefix to be searchable.

- `pino` with a Cloud Logging formatter (`severity` from the level, `message` field), and a
  request id taken from `X-Cloud-Trace-Context` so log lines group under the request in
  the console.
- Replace `console.*` a directory at a time. A test fails on new `console.` calls in
  application code.
- The existing `[timing]` lines become fields, not text; update `log-trawler` queries and
  the HARD-47 brief's measurement instructions in the same change.
- **Cost check:** Cloud Logging bills ingestion above a free allowance per project. JSON
  lines are somewhat larger than the text they replace; measure a day's volume before and
  after in the Logs Router usage page. Drop debug-level output in production if needed to
  stay level.

---

## Part C — end the tokenless-draft clause

**Done 26 Oct 2026**, ahead of its window. The date stood in for "the newest tokenless
draft is old and published", and that was already true: the newest was for a match on
6 May 2026 (last season), and the 30 days of request logs from 26 Sep held four
`/populated-scorecard-beta/` requests without `?t=`, all Google Read-Aloud fetching
*tokened* drafts (correctly refused). `mayOpenDraft` now takes `{ superAdmin }`, passed
`isSuperAdmin(req)` by the page, the photo read and the photo upload.

**Window (as written):** at the start of 2027/28 — it is defined by a date.

`draftRequiresToken` treats a draft with no `confirmToken` as openable by anyone with its
id, because links filed before migration 011 were already in captains' inboxes (HARD-03).
Measured 24 Oct 2026: **1,557 of 1,597 drafts have no token**; 232 of them are from the
last twelve months, all filed before the token existed.

By the start of 2027/28 the newest tokenless draft will be a year old, its fixture long
published. The clause's own comment says what removes it; this is that moment:

- Tokenless drafts open for a **superadmin only**; anyone else gets
  `scorecard-link-invalid.ejs`, which already exists for wrong tokens.
- `mayPublishDraft` is unchanged (it already refuses tokenless drafts).
- Check the request logs (30-day window, with a `timestamp>=` filter, per CLAUDE.md) for
  `/populated-scorecard-beta/` hits without `?t=` first. Log silence alone is not enough to
  decide on — but here the decision is a date, and the logs are only a check for a
  surprise.

---

## Out of scope

- Changing Auth0 or its Rules/Actions (hosting configuration).
- The bucket's privacy — done (HARD-02b), and HARD-22 holds the remaining lock.
- Re-reading roles per request (a question for Part A, above).
