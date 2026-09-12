# HARD-31 — decide, knowingly, whether to rotate `DB_PI_KEY`

**Severity:** low · **Wave:** C · **Blocked by:** nothing (HARD-27 landed)
**Owns:** nothing in code — this is a decision, and then possibly a migration
**Sources:** split out of HARD-27 on 12 Sep 2026, which put rotation out of scope

## Why this is a package and not a task

`models/players.js:getEmails` pasted `DB_PI_KEY` into its SQL as a string literal, and
`console.log(sql)` sat on the line above it. That line ran on **every distribution-list
send**, so the key that encrypts every player's email address and phone number was written
into Cloud Logging each time. The log line was removed on 7 Sep 2026 and the interpolation
on 12 Sep (HARD-27), but **neither of those retrieves what was already written**.

So the question is not "is the key exposed now" — it isn't — but "was it exposed for long
enough, to a wide enough audience, to be worth re-keying". That is a judgement, and the
reason it needs writing down is that **deferring it by default is itself a decision**, taken
without anyone noticing they took it.

## What to find out first

Cheap, and it changes the answer:

- **How far back do the logs go, and how many sends are in them?** Cloud Run request logs
  retain about four months. `getEmails` runs only on a list send, so the count is small and
  countable. Remember the `timestamp>=` constraint — `gcloud logging read` applies
  `--freshness=1d` without one, and an empty result then reads exactly like "never happened"
  (see CLAUDE.md).
- **Who can read those logs?** If it is the two people with project access, that is a very
  different exposure from a log sink shipping elsewhere.
- **Is the key in any other sink?** Sentry breadcrumbs, an error message captured with the
  statement attached, a slow-query log on the Supabase side.

## What rotating actually costs

Every `pgp_sym_encrypt`'d value has to be decrypted under the old key and re-encrypted
under the new one, in one pass, with the application either down or writing through both.
The columns are `player."playerEmail"`, `player."playerTel"` and `player."authEmail"` —
about 1,100 rows, so the data volume is nothing; the risk is entirely in doing it without
losing or double-encrypting a value. It belongs in a reviewed script under `scripts/` with
a dry run, like `scripts/backfill-contact-emails.js`, and wants a verified round trip on
the local database first (`tools/local-db.sh`), which now exists and did not when the
exposure happened.

## Acceptance criteria

- A decision is recorded here — rotate, or do not rotate — **with the reasoning**, not
  merely an outcome.
- If the decision is not to rotate, that is a valid close. Say what would change it.
- If it is to rotate: the script, a dry run, a local round trip, then the run, then
  `node tools/dbq.js --check missing-contact` before and after to prove no address was lost.

## Out of scope

- Anything about how the key is *used*. HARD-27 closed that: it is bound everywhere, and
  `__tests__/unit/no-secrets-in-sql.test.js` fails if it is ever pasted in again.
