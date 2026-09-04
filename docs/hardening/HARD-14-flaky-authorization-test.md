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
