# HARD-14 — A flaky authorization test

**Severity:** medium · **Wave:** A · **Blocked by:** nothing
**Owns:** `__tests__/integration/roster.test.js` (and whatever the root cause turns out to be)
**Source:** observed 31 August 2026 while adding the invoice auth tests

## Why

`POST /api/teams/:id/order › 403s a club admin ordering another club's team, and writes
nothing` intermittently fails under the full parallel suite, asserting 403 and receiving
**404**. Roughly one full run in five.

Characterised so far:

- `npx jest __tests__/integration/roster.test.js` — **47/47, ten runs in a row.** Stable
  in isolation.
- `npx jest --runInBand` — full suite passes.
- `npx jest` (default parallelism) — fails intermittently, and *not always in the same
  file*: one run failed in `admin-teams.test.js` instead.
- Every run prints "A worker process has failed to exit gracefully", which predates this
  and may or may not be related.

A 404 from that endpoint means `Roster.getTeamOwner` resolved falsy, so the handler
returned "no such team" before ever reaching `assertClubAccess`:

```js
const owner = await Roster.getTeamOwner(teamId)
if (!owner) return next(Object.assign(new Error('No such team'), { status: 404 }))
assertClubAccess(req, owner.clubName)
```

The mock is set in a `describe`-level `beforeEach` (`roster.test.js:196`) while
`jest.clearAllMocks()` runs in the file-level one (`roster.test.js:74`). Jest runs outer
hooks first, so that ordering should be deterministic — which is why this needs actual
investigation rather than a guess.

**This matters more than an ordinary flake.** The test that misbehaves is an
*authorization* test. When it fails it reports 404 instead of 403, which means on those
runs it never actually proved that a club admin is refused another club's team. A green
suite that sometimes skips its own security assertion is worse than a red one, and it
trains everybody to re-run rather than look.

## What to do

1. Reproduce reliably first — `--maxWorkers=N` bisection, and `--detectOpenHandles` for
   the worker-teardown warning.
2. Find the actual mechanism. Do not "fix" it by adding `mockResolvedValue` in more
   places until it stops; that hides it rather than removing it.
3. If it turns out to be leakage between suites, the fix belongs in
   `__tests__/setupAfterEnv.js` alongside `resetRateLimits()`, not in one file.
4. Once fixed, run `npx jest` twenty times and confirm twenty clean runs.

## Acceptance criteria

- Twenty consecutive full parallel runs, all green.
- The root cause written down in the test file or `CLAUDE.md` — the next person needs to
  know what it was.
- The worker-teardown warning either resolved or explained.

## Out of scope

- Making the assertion weaker to stop it failing.
- The 397 other tests, unless the root cause is shared.


---

## Update, 4 Sep 2026 — the 403→404 is still open, and now separable

HARD-20 turned out to be a real mechanism: other processes on the developer's machine
listen on ephemeral ports, `supertest` binds one per request, and on a collision *they*
answer — with a 400, 401 or 404 that looks exactly like a bug in our own code. That
explains the phantom 401s.

**It does not explain this package's 403→404**, and the initial claim in HARD-20 that it
did was too strong. A guard now in `__tests__/setupAfterEnv.js` fails with an explicit
"this response did not come from the application" whenever a response lacks the CSP header
that helmet puts on every one of ours. On 4 Sep a full run produced

```
GET /manage-players/club-Shell/edit   expected 200, received 404
```

and **the guard stayed silent** — so that 404 was ours. Same test file, same shape as the
403→404 recorded above.

So this package's residual stands, and is now cheap to triage rather than expensive:

| failure | meaning |
|---|---|
| timeout | contention. Re-run the suite alone. |
| wrong status, guard fires | a colliding local listener. Not our bug. |
| **wrong status, guard silent** | **ours. Investigate.** |
| `socket hang up` | unattributed. No response to inspect; possibly a collision, possibly not. |

The third row is what this package is about, and it is the one that was previously
indistinguishable from the second.


---

## Update, 7 Sep 2026 — "one run in five" is an undercount, and it is not one test

A full day's work on unrelated packages produced intermittent failures in **five distinct
suites**, every one of which passed on its own immediately afterwards:

| suite | how it failed |
|---|---|
| `scorecard-photo.test.js` | `socket hang up` |
| `team-withdrawal.test.js` | expected 200, got **404** |
| `roster.test.js` | the original 403→404 |
| `sign-s3.test.js` | (full run only) |
| `contact-us-club.test.js` | 8 failures, then 8 passes alone |

That matters for two reasons.

**The brief's "roughly one full run in five" is optimistic.** Across roughly a dozen full
runs today, four had at least one failure. The rate is closer to one in three.

**It is not an authorization-test problem.** `team-withdrawal` returning 404 where 200 was
expected is the same shape as `roster`'s 403→404 — a lookup resolving falsy — but in a
different suite with different mocks. `socket hang up` is a different shape again. The
package is still named after the first instance found, and that name is now misleading.

Also worth recording: this cost real time. Twice I read a failing full run as a regression
from the change I had just made, went looking for a cause in my own diff, and found the
suite green on a clean run. **A suite that cries wolf is not free** — it taught me to
re-run rather than look, which is precisely what the brief warns about, and is exactly the
wrong reflex to have when a failure IS real.

### Sharpened next step

The single most informative fact is unchanged and still unexplained: `--runInBand` passes.
Whatever this is, it is **between workers, not within a file** — so per-file mock hygiene
is the wrong place to look, and step 3 of the plan (fix it in `setupAfterEnv.js`) is
probably where it lands.

Two candidates worth eliminating first, given what the failures have in common:

- **Shared module state across workers via the module registry.** Several suites mock
  `middleware/secured` and the models; a worker reusing a module instance from a previous
  file would explain a lookup returning falsy in a suite that never set it up.
- **Contention on the real resources the suite still touches.** `app.js` calls
  `dotenv.config()` at import (HARD-26), so all 31 app-requiring suites hold production
  credentials and a session store pointed at production Postgres. `socket hang up`
  is the shape of a network resource under contention, not of a mock problem.

The second one links this package to HARD-26, and both should be settled before HARD-08
puts the suite in CI — where a one-in-three flake is everybody's problem rather than
something two people know to shrug at.


---

## Resolved, 7 Sep 2026 — it was one bug, it was never ours, and it was fixable

**Root cause: supertest asked for the wrong kind of port.**

`request(app)` calls `app.listen(0)` with no host. That binds the IPv6 **wildcard** `::`,
while supertest addresses its own requests to `127.0.0.1`. Two things then go wrong
together:

1. the kernel's port-0 allocator for `::` **will hand out a port already held on
   `127.0.0.1` specifically** — to the bind they are different addresses, so it is not a
   conflict; and
2. an incoming connection to `127.0.0.1` is delivered to the **more specific** of the two
   bindings — theirs, not ours.

Demonstrated directly, against a VS Code helper holding 49436:

```
bind wildcard *:49436  -> SUCCEEDED (:::49436)
GET 127.0.0.1:49436    -> 400 "WebSockets request was expected"    (not ours)
bind 127.0.0.1:49436   -> REFUSED EADDRINUSE
```

and with port 0, which is what supertest actually does — planting a loopback decoy just
ahead of the allocator's cursor, where the next binds will look:

```
IPv6 wildcard ::  (before the fix)   -> handed out the held port? YES
IPv4 loopback 127.0.0.1 (the fix)    -> handed out the held port? NO (skipped it)
```

So this was never a coincidence to be tolerated. **The fix is to bind `127.0.0.1`**, which
is the address supertest was connecting to all along: that allocator will not hand out a
port already taken on that address, and a foreign listener on the wildcard is covered too,
because our bind is then the one refused.

### Measured, not asserted

Twenty full runs before the fix: **5 failed — 25%**, one in four, in five *different*
suites. Twenty after: **20 green**. At the measured 25% rate, twenty clean runs in a row
has a probability of 0.75^20, about **0.3%**. Every one was a port collision:

| run | suite | port | guard |
|---|---|---|---|
| 5 | `rate-limits` | 49436 | fired |
| 9 | `healthz` | — | **silent** |
| 11 | `club-contact` | 57556 | fired |
| 17 | `security-headers` | 49447 | fired — and it answered **200 `ok`** |
| 18 | `roster` | — | **silent** |

Run 17 is the one to remember: a foreign process answered **200**. A test asserting only a
status code would have **passed for the wrong reason**.

Then the suite was instrumented so each server stamped its own responses, which counts
collisions directly instead of waiting for one to land somewhere that fails. Over four
runs the correlation was exact — **collision ⇔ failing run**, no collisions in the runs
that passed. That is the whole bug; there is no residual.

### Three things this package believed that were wrong

**1. "The guard was silent, so that 404 was ours."** It was not. Three of the seven
colliding listeners are **Express** servers, and Express's own `finalhandler` 404 sends:

```
HTTP/1.1 404 Not Found
X-Powered-By: Express
Content-Security-Policy: default-src 'none'
X-Content-Type-Options: nosniff
```

The guard inferred "ours" from the **absence** of those headers, so it could not fire on
them. `curl` against one of those ports returns, verbatim, the failure the 4 Sep update
recorded as ours and told the next reader to investigate:

```
Cannot GET /manage-players/club-Shell/edit
```

The rule now lives in `__tests__/helpers/foreign-response.js` and compares a **per-server
id we issue ourselves** — something a process that does not know it exists cannot produce.
The old heuristic remains only for `request('http://host:port')`, which stands up no
server of ours and is used by nothing but the guard's own self-test.

**2. "`--runInBand` passes, so it is between workers, not within a file."** It does not
pass. Three instrumented `--runInBand` runs: one collided (port 54987, a 404, guard
silent) and failed. It performs the *same* ~616 binds, so it was never going to be safer —
the original claim rested on too few runs. This is the premise that sent the investigation
towards module-registry leakage and mock hygiene, and it was the expensive one.

**3. "Several suites mock `middleware/secured` and the models; a worker reusing a module
instance would explain a lookup returning falsy."** Jest workers are separate *processes*
and each test file gets a fresh module registry, so plain module state cannot leak between
files at all. The other candidate — keep-alive sockets pooled on `http.globalAgent`,
whose `keepAlive` really is `true` on Node 22 — is also dead: superagent sets
`agent: false` on every request, so the global agent is never consulted. Verified at
runtime: the server sees `Connection: close` and `http.globalAgent` holds zero sockets.

### Why it looked like a dozen different bugs

The victim is whichever suite happens to bind the contested port, and the symptom is
whatever the squatter answers — 400, 401, 404, `200 ok`, or `ECONNRESET`, which is the
`socket hang up` recorded against `scorecard-photo`. Across this package's history that is
**twelve distinct suites**. There was one bug.

It also explains the shape of the onset — and the onset was not 31 Aug. The suite roughly
doubled that day (391 → 720 tests, 26 → 45 files) as the backlog landed, but what drives
this is **binds**, not tests, and those grew about 1.4x (roughly 377 → 511 per run), which
is enough to take an occasional oddity to a quarter of runs. The bug itself is older:
commit `1c48aef` (30 Jul, at about half the size) records in its own message

> the one-off flake seen while landing this: `fixtures.test.js` failed a status assertion
> on one run and then passed on four consecutive full runs. I could not reproduce it and
> have not explained it

which is this, a month earlier and rarer. The rate is a function of how many requests the
suite makes, so it grows as the suite grows — and it was never going to announce itself
with a clean before-and-after.

### The worker-teardown warning

Explained as far as it can honestly be explained, and it is **not what it was assumed to
be**. It printed in **8 of the 20** baseline runs — not "every run" as the brief says —
and in **12 of the 20** runs after the fix, with every one of those 20 green. So it is
independent of the collisions, does not track them, and was never part of this bug. It is
also not a reliable distress signal: it fires on runs where nothing whatsoever is wrong.

What it is *not*:

- **not the app's timers.** Both `setInterval`s (`app.js:500`, connect-pg-simple's prune
  timer) call `.unref()`, so neither can hold a worker open.
- **not a production Postgres pool.** `db.connect()` is inside `if (require.main ===
  module)` (`app.js:453`), so the app's own pool is **never constructed** under Jest. The
  session store at `app.js:361` does build one, but express-session never calls the store
  — no suite sends a session cookie — so it never connects.
- **not a leaked handle any one suite can be blamed for.** `--detectOpenHandles` on an
  app-requiring suite reports none.

What is left is Jest force-exiting a worker that missed its 500 ms graceful-exit window.
Which handle it was still holding is **not established**, and cannot be with the obvious
tool: `--detectOpenHandles` silently implies `--runInBand`, so it cannot observe the
parallel case that produces the warning. A suite making ~616 sockets a run has obvious
candidates, but that is a guess and is written down as one.

It belongs with **HARD-26** either way, which owns what `require('app.js')` drags into the
test process.
