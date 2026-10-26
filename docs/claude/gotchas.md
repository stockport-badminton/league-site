# Gotchas & lessons learned

Moved out of `CLAUDE.md`, word for word, so that file holds only the rules most tasks need.


1. **PostgreSQL column quoting**: Unquoted camelCase columns become lowercase. Always quote column names in SQL.
   This bites `AS` aliases too, not just column references: `AS teamCaptain` becomes
   `teamcaptain`, so `row.teamCaptain` is `undefined`. That silently blanked the
   captain and match secretary on every `/event/` page for as long as it existed, and
   `AS Man1` blanked every player column on `/fixture-players` and on the scorecard
   confirmation screen until Sep 2026. It renders as an empty cell, never an error.
   **But quote the alias and its references together.** `getMatchPlayerOrderDetails`
   aliases `homeTeam.club AS clubId` and the wrapper joins `club ON club.id = clubId`;
   quoting only the alias turns a blank column into `column "clubid" does not exist`.
   Where nothing in JavaScript reads a column, leaving it folded is the correct answer.
   **The rule, enforced by `__tests__/unit/sql-alias-quoting.test.js`: an alias is either
   quoted-and-camelCase, or written lowercase. Never camelCase-unquoted.** That third form
   is the only dangerous one, and it is dangerous because it LIES — the SQL says
   `AS clubSecEmail` and the row arrives as `clubsecemail`, so the mistake is invisible at
   the place you would look for it. 177 existing aliases were rewritten to lowercase to
   start the guard clean, which was provably inert (Postgres was already folding them):
   verified by snapshotting the output keys of 35 model functions against the real
   database before and after — 421 keys, none changed.
   **That guard cannot find a broken CONSUMER.** It compares SQL against itself and never
   sees what JavaScript reads, so it stops new instances and finds none of the existing
   ones. Neither will `npm test`: these failures are silent, most of these queries have no
   test, and a mock spelling the key camelCase passes against the bug. The only reliable
   method is to run the query and diff its real keys against what its consumers read —
   which is HARD-19, and belongs with `dbq --check` because it needs the database.
   `__tests__/unit/fixture-players-aliases.test.js` does that for one query pair.
   **`node tools/key-contract.js` is that check.** It runs every read-only model function,
   reads `Object.keys()` off a real row, and reports any camelCase property read in
   `views/` or `controllers/` whose lowercase form is a real output key while the camelCase
   form is not — the exact signature of a folded alias with a camelCase reader. It reports
   **suspects, not bugs**: it matches names, not producers, so confirm each by hand. Of the
   first nine it found, three were SCREAMING_CASE OCR constants and four were fed by a
   different function that quotes correctly; the two real ones were `/club-api` consumers
   and `homeClubName`. `--coverage` lists the functions it could not make return a row,
   which is the honest limit of any run.
   **And the folded name is sometimes the right thing to read.** `POST /contact-us` did
   `rows[0].clubSecEmail.indexOf(',')` against `Club.getContactDetailsById`, whose alias is
   `AS clubSecEmail` unquoted — so it was `undefined.indexOf`, the catch turned it into
   "Sorry something went wrong sending your email.", and the enquiry was lost. One member
   tried four times in five minutes on 7 Sep (Sentry NODE-12) and the league got nothing.
   The fix reads `clubsecemail`, because `controllers/clubController.js` and
   `views/club-contact.ejs` already read every column of that query in lowercase and work:
   quoting the alias would have fixed one caller and broken the club contact page.
1a. **`req.user.email` does not exist.** `req.user` is the raw passport-auth0 `Profile`,
   cached whole in the session by `passport.serializeUser`. It carries `displayName`, `id`,
   `emails: [{ value }]` and `_json` — and **no `email`**. The login strategy in `app.js`
   reads `profile.emails[0].value`, so the shape was never in doubt; the spelling just looks
   obvious. It fails in the worst available way: `undefined` is falsy, so every call site
   had a `||` fallback beside it and quietly took the other branch. Nothing threw, nothing
   logged, the feature simply did not exist — `rosterController` had been putting the
   requester in a transfer email's `replyTo` so the club could reply to them, and had
   always sent the league address alone; every `blocked_entry` row said `admin` rather than
   who added it. **Use `userEmail(req.user)` from `utils/sessionUser.js`**, which also has
   `userDisplayName` and `userLabel`. `__tests__/unit/session-user.test.js` fails if
   `.user.email` reappears in `controllers/`, `models/`, `utils/`, `routes/` or
   `middleware/` — it strips comments and strings first and self-tests that the stripper
   still works, because a desynchronised scanner under-reports and so fails in the
   direction that looks fine. It also builds a real `Profile` from the dependency and
   asserts `.email` is undefined, so the premise is checked against passport-auth0 rather
   than against this paragraph.
1b. **Never build a URL from `req.get('host')`.** Firebase Hosting rewrites `**` to
   Cloud Run and the Host header that arrives is the *Cloud Run* one — the requested
   host is passed separately, in `x-fh-requested-host`. Every canonical and `og:url`
   on the site pointed at `league-site-akvq7tsxuq-nw.a.run.app`, which serves the
   whole site publicly, so Google was told the authoritative copy of every page was
   on another hostname. Use `canonicalFor(req)` / `absoluteUrl(path)` from
   `utils/canonical.js` — including for links in emails. `SITE_ORIGIN` overrides the
   default for a staging deploy.
1bb. **`/healthz` never reaches the container, and a new endpoint gets curled in
   production.** Google's frontend intercepts that exact literal path in front of Cloud
   Run and answers its own `Error 404 (Not Found)!!1` page — no response headers of ours,
   so the request demonstrably never arrives. The health endpoint is therefore served at
   **`/health`** (both are registered; monitor `/health`). What makes this worth
   remembering is not the path: it passed Jest, it passed against a real local server,
   and it 404'd in production, because the thing that breaks it only exists once there is
   a Google frontend in front of the app. `/healthz/` and `/HEALTHZ` both answer 200,
   which is how it was pinned down — compare a path you know has no route (it should
   return *our* 404 page, with our headers) against the one you are debugging.
1bc. **Firebase Hosting gives up after 60 seconds, and the work carries on without it.**
   Cloud Run's own request timeout is 300s, but every request to
   `stockport-badminton.co.uk` is rewritten to it *through Firebase Hosting*, which cuts
   the connection at 60. The two halves then disagree: **Firebase returns an error to the
   caller while Cloud Run finishes the job and logs its own `200`.** So a slow request
   looks like a failure and is a success — the exact inverse of `secured`'s 302 that
   Make.com recorded as a successful invoice run, and the same lesson from the other
   direction: **the caller's view of an outcome and the outcome are different things.**
   Measured 21 Sep 2026 on the first weekly video post. Cloud Scheduler logged
   `ERROR / INTERNAL` 59.5s after dispatch; Cloud Run logged `200` with
   `latency: 91.195s`; the app logged *"weekly video posted to Stockport page,
   Instagram"*. The video was published. The job went red. `attemptDeadline: 300s` on the
   scheduler never came into it, because the limit is in front of Cloud Run rather than in
   the caller.
   **A retry would have double-posted.** Nothing had been published twice only because
   `retryCount` is unset on these jobs, which was inherited by copying the tables job
   rather than chosen. Anything that publishes and can exceed 60s must not carry retries.
   The video handler is slow because `waitForContainer` waits on Meta transcoding, which
   is not ours to speed up — so `sbl-weekly-video-post` calls **Cloud Run directly**
   (`league-site-akvq7tsxuq-nw.a.run.app`), bypassing Firebase. That does not change what
   Meta fetches: the handler builds the video URL from `SITE_ORIGIN` through
   `absoluteUrl()`, so it is the public domain whichever host invoked the job.
   **The weekly tables and fixtures posts went the same way, and call Cloud Run directly
   too** (24 Oct 2026). Both were measured at 39s when this was written; the Facebook
   story frames (11 Oct) and a slow Meta day took tables to 37 → 38 → 59 → **90s** on four
   consecutive Saturdays, and on the fourth the scheduler logged `ERROR / INTERNAL` over a
   post that went out. Audit (7.9s) and registrations (4.8s) still go through Firebase.
   **A job that publishes to Meta belongs on the Cloud Run URL from the start** — its
   duration is Meta's, and every target added makes it longer without anything warning.
1c. **An INNER JOIN to something optional loses the whole page.**
   `__tests__/unit/optional-join-guard.test.js` now fails on the specific shape that has
   caused this three times: an inner join to `player` on a ROLE (`teamCaptain`,
   `clubSecretary`, `matchSecrertary`, `treasurer`, `otherComms`, `club."clubSec"`,
   `team.captain`). A role is optional by nature — six teams have no captain flagged — so
   joining one as an *attribute* of another row is always the mistake. The one permitted
   form is a statement that hardcodes the role as a literal in its own SELECT
   (`'club Sec' AS role`): then the join defines what the row IS, and INNER is right. It
   deliberately ignores the 27 inner joins to `venue`/`club`/`division`, which need
   judgement per query rather than a rule.
   Found by it: `getAnnualInvoices` inner-joined the club secretary, so **a club with
   nobody flagged would have been dropped from the invoice run entirely** — no error, no
   empty row, just absent. Latent only because all 18 clubs have one today. Fixing it
   surfaced that `No Club` (63) was being excluded *by the same accident*, so that is now
   excluded on purpose. `getFixtureEventById`
   joined the home team's captain, six teams have none flagged, and the 48 affected
   fixtures rendered as `HTTP 200` with a two-byte body. Two lessons: join optional
   things with `LEFT JOIN` (or a scalar subquery, which also makes the pick
   deterministic when there are duplicates), and never `res.send(err)` — an Error
   serialises to `{}` and goes out with the default **status 200**, so a crawler
   banks it as a real page. Use `next(err)`, or an explicit `res.status(404)`.
2. **Query placeholders**: Use `?`, not `$1`. The wrapper converts automatically.
2b. **There is no `insertId`.** The wrapper mimics mysql2's `[rows]` shape but cannot
   invent MySQL's `insertId`: Postgres reports nothing about an inserted row unless the
   statement says `RETURNING id`. Without it an INSERT resolves to an *empty rows
   array*, so `result.insertId` is `undefined` — silently, since nothing throws. Any
   INSERT whose id is needed must end `RETURNING id`, and the caller reads
   `result[0].id`. This bit three separate flows (submitted scorecards redirected to
   `/populated-scorecard-beta/undefined` and emailed that dead link for months; the
   add-player modal posted `NaN` as the new id). **When mocking such a model in a
   test, mock `[{ id: 42 }]`, never `{ insertId: 42 }`** — the invented shape is
   exactly what let the scorecard bug live behind a green test.
2d. **The query tuple has ONE element, and `affectedRows` hangs off the rows array.**
   mysql2 returns `[rows, info]`; `pgQuery` returns `[rows]` and does
   `rows.affectedRows = result.rowCount` before returning. So the natural
   `const [, info] = await conn.query(...)` is **always `undefined`**, and
   `(info && info.rowCount) || 0` is always `0` — silently, because `undefined` is falsy
   and every caller has a fallback beside it. Read `const [rows] = …; rows.affectedRows`.
   Measured: `SELECT id FROM team WHERE id IN (4,18)` returns a tuple of length 1 with
   `rows.affectedRows === 2`.
   Same family as 2b, and it bit the same way. `scripts/null-stale-officer-pointers.js`
   cleared all four pointers it was asked to and reported **"committed — 0 of 4 cleared"**,
   with a warning that rows had been skipped to avoid clobbering them. The writes were
   right and the report was the exact opposite of the truth; it was caught only because the
   run finished by re-querying and printing `remaining: 0`, which cannot both be true.
   **A write script should end by re-reading the thing it changed**, precisely so a wrong
   count cannot pass as a result.
2c. **The `pg` Pool must keep its `'error'` listener.** `pg` emits `'error'` on the
   Pool when the backend hangs up on an **idle** client, and an EventEmitter `'error'`
   with no listener is an uncaught exception — so a connection Supabase reaped while
   nobody was using it killed the whole Cloud Run instance, in-flight requests
   included (Sentry NODE-X, 6 Aug). Nothing catches this for you: the pool works
   perfectly in dev, in tests, and under any load that keeps its connections busy, so
   the gap is invisible until it isn't. Only idle clients come through the handler —
   an error on an in-flight query rejects that query's promise and surfaces through
   the caller's `try`/`catch` and the central 500 handler. Swallowing is correct (pg
   has already discarded the client); it's captured to Sentry so the event stays
   visible as *handled*. If it starts arriving often, the real fix is the transaction
   pooler on 6543 — which is what `PG_POOL_MAX` exists for.
3. **Form repopulation on errors**: Must pass both submitted data AND team/player dropdowns with selected flags, or form appears empty to user.
4. **Session cookie name**: Must be `__session` for Cloud Run (Firebase requirement).
5. **DEV_MODE is safe**: Only works outside production; injects mock user for local testing without Auth0.
6. **Model exports are async**: Always await model calls — they return promises.
7. **Test setup**: `__tests__/setup.js` runs before any test, sets env vars (don't rely on .env in tests).

