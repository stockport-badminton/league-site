# HARD-20 — A 401 from routes that have no authorization

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
