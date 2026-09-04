# HARD-20 — A wrong status from routes that have no authorization

*(Originally "a phantom 401"; a third sighting on 1 Sep 2026 was a 404, so the symptom is
broader than the title assumed. See below.)*

**Severity:** low (test-only — see below) · **Wave:** A · **Blocked by:** nothing
**Owns:** `__tests__/` setup, and whatever it turns out to be
**Sources:** HARD-07's agent (31 Aug 2026), and a `--detectOpenHandles` run (1 Sep 2026)

## Why

Two tests have been seen failing with **HTTP 401 where 200 or 500 was expected**, on two
different unauthenticated routes:

```
__tests__/integration/spam-gate.test.js
  the spam gate › looks identical to success        POST /contact-us   expected 200, got 401

__tests__/integration/friendly-500.test.js
  answers 500, not 200                              GET  /fixtures     expected 500, got 401
```

Neither route touches `checkJwt`. `POST /contact-us` carries `contactLimiter`,
`spamGate()`, `validateContactUs` and the handler; `GET /fixtures` carries nothing at all.

**A third sighting, 1 Sep 2026 — and it is not a 401**, which is the most useful thing
about it:

```
__tests__/integration/mail-relay.test.js
  400s without a fixture to identify                POST /fixture/reminder  expected 400, got 404
```

Captured verbatim from a full run. Same session also produced an unidentified single-test
failure on a **docs-only** working tree, i.e. with no code change in play at all.

Why it matters to this package: it widens the symptom from "a phantom 401" to **"a wrong
status on an unauthenticated route under a contended full run"**, and 404 is a status this
codebase produces in many places, so the `express-jwt` theory above cannot explain it.
HARD-14 already records a 403→404 on `roster.test.js`; with this one, **two of the three
non-401 sightings land on 404**. If there is a single mechanism, the search should start
from what all four have in common — a full run, a loaded machine, an unauthenticated
route, and a status that some *other* route on the same app would legitimately return —
rather than from `express-jwt`.

Behaviour matches the rest: does not reproduce alone (3/3 clean), does not reproduce with
the neighbouring suite (3/3 clean), and three consecutive full runs afterwards were
772/772. Per the note below, that is absence of evidence, not evidence of contention.

### Frequency, and the reason there is so little evidence

On 1 Sep 2026 a single session saw **three** failing full runs, two of them on a working
tree containing **only documentation changes** — so whatever this is, it is not sensitive
to the code under test. Only one of the three was captured. The other two are gone, for a
mundane and fixable reason:

> `npx jest 2>&1 | tail -4` shows the summary and **throws away the failing test's name and
> its expected/received**. By the time you notice the count is wrong, the detail is gone,
> and the next run passes.

**So the first change this package needs is not a diagnostic, it is a habit.** Redirect the
whole run to a file and read the summary from it:

```bash
npx jest > /tmp/jest.txt 2>&1; grep -E "^Tests:" /tmp/jest.txt
grep -E "^  ● .*›|Expected: |Received: " /tmp/jest.txt | grep -v Console
```

Three sightings over months, two of them lost to `| tail`, is the whole reason this is
still open. Capture first; the sightings are rare enough that losing one costs weeks.

**There is no 401 anywhere in this codebase.** Grepping `middleware/`, `controllers/`,
`routes/`, `models/`, `utils/` and `app.js` finds none. The only thing that can produce
one is `express-jwt`, whose `UnauthorizedError` carries `status: 401` and which the two
error handlers at the foot of `routes/index.js` will faithfully pass through. So something
is putting an express-jwt rejection in front of a request that never asked for one.

## What is already known

**It does not happen in production.** Cloud Run request logs for the last 30 days contain
**zero** 401s, while the same query returns plenty of 404s — so request logging is working
and this has never reached a visitor:

```bash
gcloud logging read \
 'resource.type="cloud_run_revision" AND resource.labels.service_name="league-site" AND httpRequest.status=401' \
 --project stockport-badminton-map --freshness=30d --limit=50 \
 --format="value(timestamp,httpRequest.requestMethod,httpRequest.requestUrl,httpRequest.status)"
```

That is what makes this low severity rather than an authorization bug, and it points the
investigation squarely at the test harness rather than at the routes.

**It is rare.** Not reproduced in 19 consecutive full-suite runs with a diagnostic in
place, nor in ~40 other full runs that day. Both sightings were on a *contended* machine,
which is also when the (separate, genuine) timeout flakiness appears — so it is easy to
mistake one for the other, and both of the day's real bugs were initially written off as
contention.

**It is not the HSTS leak.** That was a different intermittent failure in the same period,
caused by a test doing `jest.resetModules()` + `require('../../app')` and leaking a second
pg pool. Fixed on 1 Sep; the 401 predates it and is unrelated.

**But something is still leaking.** After that fix, a clean 727-test green run *still*
prints:

```
A worker process has failed to exit gracefully and has been force exited. This is
likely caused by tests leaking due to improper teardown.
```

So there is a second open handle, and it is the most promising lead here — a worker that
will not exit is holding something (a timer, a socket, a pool) across tests, which is
exactly the shape of a fault that leaks state between suites. `--detectOpenHandles`
printed nothing useful on its own; try it per-suite rather than across the whole run,
and start with the suites that construct an app: `security-headers`, `healthz`,
`friendly-500`, `spam-gate`. Note `jwksRsa.expressJwtSecret` is built at module scope in
`routes/index.js` with `rateLimit: true`, so it creates timers for every suite that
requires the router — including all the ones that never make a JWT request.

## What to do

1. **Reinstate a diagnostic and loop.** The body and headers will name the source; a status
   alone will not. Restore this to the failing assertion, run the full suite in a loop
   until it fires, then remove it:

   ```js
   const rejected = await post({ [HONEYPOT_FIELD]: 'x' });
   if (rejected.status !== 200) {
     console.error('DIAG status=' + rejected.status +
       ' body=' + JSON.stringify(String(rejected.text).slice(0, 400)) +
       ' headers=' + JSON.stringify(rejected.headers));
   }
   ```

   Loop with load on the machine, since both sightings were under contention.
2. **Suspect module-registry cross-talk first.** Several suites mock `middleware/secured`,
   `models/auth.js` and `db_connect` differently, and Jest gives each *file* a fresh
   registry but each *worker* a shared process. A `WWW-Authenticate` header on the response
   would confirm express-jwt as the source immediately.
3. **Check whether `jwksRsa.expressJwtSecret` is the shared thing.** It is constructed once
   at module scope in `routes/index.js` with `cache: true, rateLimit: true,
   jwksRequestsPerMinute: 5` — a module-level cache and rate limiter with timers, created
   even for suites that never call a JWT route. Jest's "worker failed to exit gracefully"
   warning appears on runs of this suite, and active timers are one of the causes it names.
4. If it turns out to be purely an artefact of how the tests share a process, **say so and
   close it** — with the reasoning written down, so the next person who sees a 401 does not
   start from scratch.

## Acceptance criteria

- The source of the 401 is named, with the captured body or header that proves it.
- Either a fix, or a written explanation of why it cannot happen outside the test harness.
- If it is fixed, the two tests above stop being intermittent — demonstrated by a loop of
  full runs on a loaded machine, not a single green run.

## Out of scope

- The timeout flakiness under concurrent Jest processes. That is understood: the default 5s
  `testTimeout` was too tight for a supertest case that boots the whole app, it is now 15s,
  and it is recorded on HARD-14.
- `roster.test.js`'s 403→404, also on HARD-14. Possibly the same root cause as this, since
  both are wrong *statuses* rather than timeouts — worth checking together, but do not
  assume it.

## The lesson worth keeping

Both real bugs found on 1 Sep were first dismissed as contention on the grounds that they
"did not reproduce in N runs". That is not evidence of contention; it is absence of
evidence. Both were only diagnosed by looping until failure **and capturing the output**.
A wrong status is never contention — contention produces timeouts.


---

# SOLVED, 4 Sep 2026 — the responses are not ours

**The phantom statuses come from other processes on the developer's machine, answering on
ephemeral ports that `supertest` collided with.** Nothing in this application produces
them, which is exactly why grepping the codebase for a 401 found nothing and why
production has never logged one.

## How it was caught

A docs-only run failed `event-page-and-sitemap.test.js › hyphenates division names`, and
this time the output was captured rather than discarded by `| tail`:

```
Expected substring: "<loc>https://stockport-badminton.co.uk/tables/Division-1</loc>"
Received string:    "WebSockets request was expected"
```

That string does not exist in this repository or in `node_modules`. Scanning every
listening socket for it found the source, and then a sweep of every HTTP-speaking listener
inside macOS's ephemeral range (`net.inet.ip.portrange` = **49152–65535**) produced the
whole set:

| port | process | answers |
|---|---|---|
| 49436 | VS Code helper (`Code H`) | **400** `WebSockets request was expected` |
| **49447** | VS Code helper | **401** |
| 51373 | VS Code helper | **404** |
| 52383 | VS Code helper | **404** |
| 54987 | VS Code helper | **404** |
| 55773 | Postman | **404** |

**Those are exactly the three phantom statuses this package and HARD-14 recorded** — 401,
404 and 400 — and nothing else in the range speaks HTTP at all.

**Port 49447, the source of the 401, is the Claude Code extension's own local proxy.**
Confirmed by pointing supertest at it deliberately:

```json
{"type":"error","error":{"type":"authentication_error",
 "message":"Invalid authentication"},"request_id":null}
```

That is Anthropic's API error shape, returned to an unauthenticated caller. So the
authorization bug this package spent days hunting was the assistant investigating it,
answering on a port `supertest` had asked the kernel to pick. Worth stating plainly rather
than as "a VS Code helper": the set of listeners depends entirely on what a given
developer happens to be running, so the *specific* ports here will not reproduce
elsewhere — the mechanism will.

| sighting | expected | got | source |
|---|---|---|---|
| `spam-gate › looks identical to success` | 200 | 401 | port 49447 |
| `friendly-500 › answers 500` | 500 | 401 | port 49447 |
| `roster › 403s a club admin ordering another club's team` | 403 | 404 | a 404 port |
| `mail-relay › 400s without a fixture to identify` | 400 | 404 | a 404 port |
| `event-page-and-sitemap › hyphenates division names` | body | 400 + alien body | port 49436 |

## Why it fits every symptom

- **No 401 in the codebase.** Correct — it was never ours.
- **Zero 401s in 30 days of production logs**, while 404s log fine. Correct — this is a
  local artifact of the developer's machine and cannot occur on Cloud Run.
- **A wrong *status*, never a timeout.** A different server answered, and answered fast.
- **Failures on a docs-only working tree**, twice. Nothing to do with the code under test.
- **A different arbitrary test each run.** Whichever request happens to collide.
- **Worse with concurrency, and "does not reproduce alone".** `request(app)` stands up a
  fresh server per call, so a full run binds an ephemeral port on the order of a thousand
  times. Six conflicting ports in a 16,384-wide range puts a collision somewhere in a full
  run at roughly 30% — which is about the observed rate — while a single suite binds a few
  dozen times and essentially never hits one.

## What to do

The kernel-level detail of how a bind lands on a port another process holds on `*` is not
worth chasing; the source of the responses is established well past doubt by the exact
match of all three statuses. Two useful responses, in order of value:

1. **Make an alien response say so.** The cost here was never the flake, it was that a
   collision looks like an authorization bug — this package spent days on the theory that
   `express-jwt` was somehow reachable. A check in the test harness that recognises a
   response the app did not produce (no `x-powered-by`/our headers, or the literal
   `WebSockets request was expected`) and fails with *"this response did not come from the
   app — an ephemeral port collided with another local listener"* converts a multi-day
   mystery into a one-line diagnosis. Cheap, and it survives the next tool that opens a
   socket.
2. **Stop colliding.** Either raise the machine's ephemeral floor above the listeners, or
   have the suite bind an explicit port outside the range instead of asking for `0`. The
   first is machine config and does not travel with the repo; the second does.

**HARD-14's outstanding wrong-status failures are probably the same thing** — but
**this was overstated when first written, and the guard has since disproved the strong
form of it.**

The original claim was that HARD-14's 403→404 on `roster.test.js` "is not" a real
authorization bug and needed no separate investigation. On 4 Sep, with the guard in place,
a full run produced:

```
GET /manage-players/club-Shell/edit  expected 200, received 404
```

**The guard did not fire**, which means the response carried our CSP headers — so it came
from *our own app*, not from a colliding listener. A genuine intermittent 404 on a
`secured` + `requireClubAccess` route is exactly what HARD-14 suspected, in the same test
file, and this diagnosis does not account for it.

So the honest position is: the collision mechanism is established and explains the *401*
sightings and the captured 400; it does **not** explain every wrong status, and HARD-14's
404 on the roster routes remains open. The guard is what separates them from here on — a
wrong status **with** our headers is ours, a wrong status **without** them is not.

A third signature seen the same day and *not* attributed: `POST /fixture/reminder` failing
with `socket hang up`. There is no HTTP response for the guard to inspect, so it says
nothing. A colliding listener resetting the connection instead of answering would look
like this, but that is a guess and is recorded as one.

## The reasoning error worth keeping

This package's own note said *"'did not reproduce in N runs' is not evidence of
contention, it is absence of evidence"* — and it was right, but the same trap then caught
the investigation twice over. Two of three sightings were lost to `npx jest | tail`, which
prints the summary and discards the failing test's name and its expected/received. **The
diagnosis took one captured body.** Three sightings over months, two thrown away by a
pipe: capture first, theorise second.
