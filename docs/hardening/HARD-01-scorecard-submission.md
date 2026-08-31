# HARD-01 — Scorecard submission integrity

**Severity:** critical · **Wave:** A · **Blocked by:** nothing
**Owns:** `controllers/scorecardController.js` (`full_fixture_post` only), `models/fixture.js`
**Sources:** SEASON-1, SEASON-2, SEASON-3, SEASON-6

This is the highest-priority item in the whole backlog. It is the only finding that has
demonstrably already destroyed league data.

## Why

`full_fixture_post` runs six steps inside one `try`, with **no transaction**:

1. find the outstanding fixture
2. `Fixture.updateById(...)` — **writes the result, commits immediately**
3. `Game.createBatch(...)` — the 18 game rows
4. ELO recalculation
5. fetch match stats, generate the result image
6. `await ses.sendEmail(...)` — the notification
7. render the confirmation page

Anything that throws after step 2 leaves the result written with nothing behind it.
Note step 6 in particular: **a momentary SES outage fails the captain's submission
after the result has already landed.**

Proven in production — three fixtures from last season are `complete` with a score and
zero rows in `game`:

```
#6117  2026-04-01  College Green B  7–11  Syddal Park B
#6576  2026-03-24  Aerospace A     14–4   Parrswood B
#6037  2026-03-22  Syddal Park A   10–8   Macclesfield A
```

Check it yourself: `node tools/dbq.js --check orphan-results`

The consequence is invisible. The league table is right; player stats, pair stats and
ELO silently omit those matches, and the scorecard view for them is blank. Nobody
reported it for a whole season.

Two related defects live in the same forty lines and are cheapest to fix together:

**The resubmit message.** Once a fixture is `complete` it is no longer `outstanding`, so
`getOutstandingFixtureId` throws `new Error('no matching fixtures')` — a bare error with
no status, which reaches the 500 page and is printed verbatim. So the captain whose
submission half-failed and the captain whose submission was fine see the same
meaningless screen, and both conclude nothing saved.

**The fixture lookup.** `models/fixture.js:568` selects by home team and away team with
**no date condition and no `ORDER BY`**, and the controller takes `result[0]`. Row order
is whatever the planner returns. Not live today (nothing in 2026/27 is doubled) but 15
pairings in the table already carry two outstanding rows, and one rearrangement that
leaves the original open makes it bite. `node tools/dbq.js --check ambiguous-pairings`

## What to do

1. **Wrap steps 2 and 3 in one transaction.** `db.withTransaction` already exists and is
   used by `models/roster.js` — follow that pattern. `otherConnect()` takes a connection
   per query so it cannot hold a transaction; the model functions need to accept a
   connection, as `Roster.renumberSection` does.
2. **Move everything non-essential after the commit and outside the try.** ELO, the
   image, the email and the stats fetch must not be able to cost a result. A failure in
   any of them should be captured to Sentry and logged, and the captain should still see
   a success page — with a note if the notification could not be sent.
3. **Handle the already-complete case explicitly.** Look the fixture up regardless of
   status. If it is already `complete`, render the recorded result and say so:
   *"This match is already recorded as 11–7. If that's wrong, contact the results
   secretary."* If it was `rearranged`, say so and give the new date. Never let this
   path reach the 500 page.
4. **Make the fixture lookup deterministic.** Add the match date to the query and an
   `ORDER BY date`. If more than one row still matches, do not guess — ask the captain
   which date they are reporting.
5. **Validate the score total.** A league fixture is 18 games, so the two scores must
   total 18 (Messer is 15). Reject with a plain explanation. Conceded matches
   legitimately break this rule and need their own path — check how `status='conceded'`
   is set before enforcing.

## Acceptance criteria

- A failure injected into `Game.createBatch` leaves the fixture **unchanged** — no
  score, still `outstanding`.
- A failure injected into `ses.sendEmail` leaves the result **fully saved** and still
  renders a success page.
- Submitting the same fixture twice renders a page naming the recorded score. No 500,
  no raw error string.
- A fixture lookup with two candidate rows either picks by date or refuses; it never
  silently picks one.
- A submission totalling anything but 18 is refused with a message a captain can act on.
- `node tools/dbq.js --check orphan-results` returns no *new* rows. (The three existing
  ones are data, and belong to HARD-09.)

## Tests

`__tests__/integration/scorecard.test.js` already covers this controller at 89%. Add:

- game-insert failure → fixture untouched (mock `Game.createBatch` to reject)
- email failure → result saved, success page rendered
- resubmit of a complete fixture → 200 with the recorded score, not 500
- two outstanding candidates → deterministic or refused
- totals not 18 → rejected

Follow the discipline in the README: confirm each new test fails before your change.
Mock model results as `[{ id: 42 }]`, never `{ insertId: 42 }` — see CLAUDE.md.

## Out of scope

- `add_scorecard_photo` and the confirmation link — same file, but **HARD-03**. Do not
  touch them; that package is sequenced after this one to avoid a conflict.
- Repairing the three existing broken results — **HARD-09**.
- The Messer submission path, unless the fix is shared. Say so if you change it.
