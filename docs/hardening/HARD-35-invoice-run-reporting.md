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

## Outcome (17 Oct 2026)

Took the first option: a row per run, read by the weekly digest.

- **`invoice_run`** (migration 023): one row per call to `runInvoiceSend`, refusals
  included, with `outcomes` as `[{club, sent, detail}]`. `detail` is the same line the
  caller is shown, pushed through one `report()` so the two cannot disagree. The record
  goes through `afterCommit`: by then the invoices are sent, and a 500 would invite a
  second run. If it fails the response says so, because an unrecorded run is one the
  digest will later call missing.
- **`invoice-run` check** (`tools/audit/checks.js`, severity high, a `run()` check). The
  decision is `findingsFor` in `models/invoiceRun.js`, which has no database. It reports
  "(all clubs) NOT sent" once the window after 1 Sep has closed with no club ever sent,
  and one row per club whose latest outcome is not "sent". A later single-club re-send
  clears that club. Not in `TRACKED`, so a row is always shown as new.
- **2026/27 is exempt by name** (`UNRECORDED_SEASONS`): its invoices went out by hand on
  1 Sep, before the table existed, so the absence of a row says nothing.

Two things found on the way:

- **The check read the season from `seasonModel.current()` first, and that cache is only
  filled by the app's startup.** `dbq --check` never fills it, so the date-based fallback
  named the exempt 2026/27 and the check printed nothing locally where the app would have
  printed a row. It reads the season table now, like every other check.
- **The invoice send CCs the treasurer's real Hotmail and BCCs real addresses, all
  hard-coded.** The local seed's fake `playerEmail` covers only the To, so a local run
  with working credentials would mail the real treasurer. Recorded in CLAUDE.md. Running
  the endpoint locally was not done for that reason: `record()` and `findings()` were
  rehearsed against local Postgres directly instead (before any run, after a partial run,
  after re-sending the failed club), then the rows deleted.

**Acceptance criteria**

- *A run that does not happen is visible within a week:* the weekly digest reports it from
  the first run after the window closes (1 Sep + 3 days).
- *Per-club outcomes somewhere durable:* `invoice_run.outcomes`.
- *A test that fails if the signal is silent:* `__tests__/unit/invoice-run-findings.test.js`
  (3 fail with the missing-run branch removed); `__tests__/integration/invoices.test.js`
  pins the recording (4 fail without the controller change).
