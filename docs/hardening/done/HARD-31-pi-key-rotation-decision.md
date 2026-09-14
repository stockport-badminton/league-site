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
  retain **30 days** — measured 14 Sep 2026, and the "four months" this used to say was
  wrong (that is the 400-day `_Required` audit bucket, not the `_Default` one application
  logs go to). `getEmails` runs only on a list send, so the count is small and
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

---

# Decision, 14 Sep 2026 — **ROTATED**

Taken by the league secretary after the three questions above were answered, and recorded
here with the reasoning rather than just the outcome, because the whole point of this
package was that deferring by default is itself a decision nobody notices taking.

## What the exposure actually was

| Question | Answer |
|---|---|
| How many times was the key written to logs? | **3 entries** — 27 Aug (×2), 1 Sep |
| Who can read them? | **One human**: `stockport.badders.results@gmail.com` (Owner). Everything else with log access is a service account |
| Exported anywhere? | **No.** Only the two default sinks, both writing to in-project buckets |
| When would the evidence age out? | `_Default` retains **30 days**, so 26 Sep and 1 Oct 2026 |

Finding the retention was worth the detour: the brief said four months, CLAUDE.md said four
months, and both were wrong. That figure came from reading the oldest log entry for the
service — which is a Cloud **Audit** log in the 400-day `_Required` bucket, recording
deploys, not requests. Application logs go to `_Default` at 30 days. Corrected in both
places, because it makes "never delete on log silence alone" *more* important, not less.

## Why rotate anyway

The case for leaving it was real — three lines, one reader, no external sink, and the
evidence self-destructing within three weeks. It was rejected for two reasons:

- **"One human account" describes today's access list, not its history.** It says nothing
  about whether that account has ever been reached from somewhere it should not have been.
  The key protects every player's email and phone number, and the league does not get to
  find out later that it was wrong.
- **The cost turned out to be small and, once measured, bounded.** 366 values, one
  transaction, plaintext never leaving Postgres, a two-minute cutover at an hour with no
  active users and no matches on. The reason to defer would have been risk, and the
  rehearsal removed most of it.

## What was done

`scripts/hard31-rotate-pi-key.js` (gitignored) — dry by default, `--apply` to write,
`--production` to leave the local database. Both keys bound, never interpolated, and
neither read from argv, because argv is visible in `ps`.

Live table re-encrypted in one transaction: **167 `playerEmail`, 116 `playerTel`, 83
`authEmail`**. The five season archives' ten columns were **cleared**, not re-encrypted —
832 values. Checked first that this destroyed nothing unique: **every archived contact also
exists in the live table**, zero that do not.

`--check missing-contact` **0 rows before, 0 rows after**. Counts unchanged. `--check all`
afterwards showed no new finding attributable to the rotation.

Cutover: `gcloud run services update --update-env-vars` (never `--set-env-vars`, which
replaces the whole environment); all 28 variables verified present afterwards. Revision
`league-site-00232-vts`. Verified by the secretary loading club contact pages, which is the
only check that proves the *deployed app* decrypts — both contact routes are `secured`, so
they cannot be curled anonymously.

## The rehearsal earned its keep, and this is the part worth keeping

The local round trip found **two bugs in the script's own verification**, neither visible by
reading it:

**`pgp_sym_decrypt` with a wrong key RAISES `Wrong key or corrupt data`. It does not return
NULL.** So:

1. The "the old key no longer decrypts" check sat *inside* the transaction expecting a count
   of zero. It threw instead, and the entire rotation rolled back — after all three columns
   had already re-encrypted successfully. It now runs after the commit, where a throw is the
   success case.
2. The "pre-existing mixed-key mess" guard compared a stored count against a decryptable
   count. That comparison can never be unequal: the statement either returns the full count
   or throws. It now catches and stops.

Had this been run straight at production, the first would have rolled back harmlessly and
looked like an unexplained failure at the last step — with the operator holding a new key
that the database had never been given. **A rotation script that cannot be rehearsed is a
rotation script that gets run blind**, which is why the archive-table lookup skips tables
that do not exist locally rather than dying on them.

## What would reverse this decision

Nothing — it is done. The equivalent question next time is the same three: how many entries,
who can read them, and is anything exporting. Answer those before arguing about cost.
