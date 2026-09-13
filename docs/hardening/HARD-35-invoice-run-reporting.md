# HARD-35 — a scheduled send that did not happen should say so

**Severity:** medium · **Wave:** C · **Blocked by:** nothing (HARD-23's code landed)
**Owns:** `utils/auditDigest.js` / `controllers/auditController.js`, or a small completion
mail from `contactusController.send_invoices`
**Source:** step 5 of HARD-23's *What to do*, which its acceptance criteria did not cover —
recorded rather than quietly dropped, the same way HARD-28's gap 6 became HARD-34.

## Why

HARD-23 fixed the annual invoice run's authentication and made its refusals honest. What
it did **not** fix is the thing that made the 2026 failure cost a year: nobody was told.

Three properties combined, and HARD-23 only removed two of them:

1. Make.com's HTTP module treats a `302` as success — **fixed**, the gate answers 403.
2. The endpoint answered `200` to a refusal — **fixed**, refusals are 409 with a reason.
3. **Nothing watches whether the run happened at all.** Not fixed.

The third is the one that decides how long a failure lasts. A run that now fails correctly
still fails into silence: Make.com records a red step in a scenario history nobody reads,
and the next signal is a treasurer asking where the invoices are — which in 2026 was
"someone went looking", not an alert.

This generalises past invoices. The same is true of the daily registration reminder and
the weekly audit digest itself: each is a scheduled job whose *non-execution* is invisible.
The audit digest is the natural place to answer it, because it already runs weekly and
already exists to say "here is what the system noticed".

## What to do

Either:

- **Report the last invoice run into the weekly digest** — "annual invoices: sent to 18
  clubs on 1 Sep" or, more usefully, "annual invoices: NOT sent, and the date has passed".
  This needs somewhere to record the run; a row per run is enough, and there is no such
  table today. That is most of the work.
- **Or mail the treasurer on completion**, listing per-club outcomes. Cheaper, and it puts
  the report in front of the person who would notice its absence — but it only fires when
  the run *does* happen, so it does not cover the case that actually bit.

The first covers the real failure and the second does not, which is the argument for
preferring it despite the extra table.

Note that the digest suppresses detail via a `TRACKED` baseline in `utils/auditDigest.js`
(HARD-07) — a new line must escalate rather than be collapsed into "3 known issues
tracked", or it will be added and then never seen.

## Acceptance criteria

- A scheduled run that does not happen produces a visible signal within a week, without
  anybody going looking.
- A run that happens reports per-club outcomes somewhere durable, not only in the HTTP
  response to a caller that discards it.
- A test that fails if the signal is silent when the run did not occur.

## Out of scope

- SES bounce-watching for invoice delivery — already out of scope in HARD-23, and it
  applies equally to every outbound mail, so it wants its own package.
- The invoice content and the fee calculation.
