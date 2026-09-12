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

## What rotating actually costs — measured 12 Sep 2026, not estimated

Less than the first draft of this said, and the shape is different.

**Do it in the database, not in a script.** The obvious plan is extract, decrypt, rotate,
rewrite — and its first step pulls the league's entire contact list into plaintext on
somebody's laptop, which is the exact thing the column encryption exists to prevent. One
statement per column does the whole job without the plaintext ever leaving Postgres, and
is atomic inside a transaction:

```sql
UPDATE player
   SET "playerEmail" = pgp_sym_encrypt(pgp_sym_decrypt("playerEmail", :old), :new)
 WHERE "playerEmail" IS NOT NULL;
```

NULLs pass straight through (`pgp_sym_decrypt(NULL, k)` is NULL), so the `WHERE` is for
cost, not correctness. Bind both keys — do not interpolate them, for the reason HARD-27
exists.

**It is 13 columns, not 3.** The live table has `playerEmail`, `playerTel` and `authEmail`;
the five season archives (`player20212022` … `player20252026`) each carry `playerEmail` and
`playerTel` as well. **Nothing decrypts from an archive** — every `pgp_sym_decrypt` in the
codebase reads the live `player` table — so those ten columns are a decision of their own:
re-encrypt them, or clear them. They are historical copies of contact details that no code
reads and no one has asked for; clearing them is a smaller database and a smaller problem.

**The volume is nothing.** 1,138 players, of which 166 have a `playerEmail`, 115 a
`playerTel`, 83 an `authEmail` — 364 values in the live table. Every one of them decrypts
cleanly under the current key today (checked, all three columns), so there is no
pre-existing mixed-key mess waiting to be discovered halfway through. Nine are blank
ciphertext — `pgp_sym_encrypt('')` rather than NULL, the case CLAUDE.md warns about — and
they re-encrypt as blanks without special handling.

**The hard part is the cutover, and it is the only hard part.** `DB_PI_KEY` is a Cloud Run
environment variable, so between the transaction committing and the new revision serving,
the running app holds the OLD key against NEW ciphertext: every contact read fails, and any
write landing in that window writes old-key ciphertext into a now-new-key table, which is
the one outcome that is genuinely messy to unpick. A `gcloud run services update` took
about two minutes when `SENDGRID_API_KEY` was removed on 12 Sep. Options, in order of
effort: accept a two-minute window at an hour when nobody is editing a profile; or teach
the decrypt sites to fall back to a second key for the duration, which is a code change
across roughly ten call sites and needs its own removal afterwards.

Whichever is chosen, **keep the old key** until the re-encrypt has been verified — it is
the only thing that can read a row the transaction missed.

## Acceptance criteria

- A decision is recorded here — rotate, or do not rotate — **with the reasoning**, not
  merely an outcome.
- If the decision is not to rotate, that is a valid close. Say what would change it.
- If it is to rotate: the script, a dry run, a local round trip, then the run, then
  `node tools/dbq.js --check missing-contact` before and after to prove no address was lost.

## Out of scope

- Anything about how the key is *used*. HARD-27 closed that: it is bound everywhere, and
  `__tests__/unit/no-secrets-in-sql.test.js` fails if it is ever pasted in again.
