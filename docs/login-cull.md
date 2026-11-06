# The monthly login cull

Logins nobody uses are attack surface and noise. On 5 Nov 2026, 81 Auth0 accounts unused
for two or more years were deleted by hand from the shared tenant. This keeps it from piling
up again. Tameside's site runs the same cull over its own accounts (its `docs/login-cull.md`).

1. **Monthly, `POST /admin/login-cull/run`** (Cloud Scheduler, `X-Audit-Token`) emails every
   Stockport login that has not been used for a year, and sends the results mailbox a
   summary. It deletes nothing.
2. **The person keeps the login** by logging in to either league's site (last-login is
   shared across the tenant), or with the link in the email. `GET /keep-login/:token` only
   shows a button, because mail scanners prefetch links; the POST keeps it for a year.
3. **A month after the email**, with no sign of life, the login is listed on
   `/admin/login-cull` (Admin → Site → Login Cull). A superadmin presses Delete. That deletes
   the account from Auth0 and clears it as any player's `authEmail`. The player's contact
   address (`playerEmail`), role and results are untouched. "keep" next to a row keeps it for
   a year without emailing anyone.

Nothing is deleted automatically, by decision (5 Nov 2026, as on Tameside): a club admin
could otherwise disappear mid-season with nobody having looked. The delete only touches
accounts that were on the page **and** are still due when it runs, so a login used in the
meantime is left alone.

## Whose accounts

The tenant is shared with Tameside's site, so each site culls its own, and the split leaves
none in both and none in neither (`utils/authCull.js`):

| Site | Culls |
|---|---|
| Tameside | accounts linked to a Tameside player (its `player_auth_account`), plus unlinked accounts with `app_metadata.league = 'tameside'` |
| Stockport | accounts linked to a Stockport player, plus unlinked accounts not tagged `tameside`, **minus anything in Tameside's `player_auth_account`** |

- **"Linked to a Stockport player" is by address**: a player whose `authEmail` or
  `playerEmail` is the account's email, the same match the login callback makes. Stockport
  has no account-id link table.
- **Tameside's links are read live**, through the read-only `TAMESIDE_DATABASE_URL`
  connection the team-strength import uses (`tamesideLinkedAccounts` in
  `utils/externalLeagues.js`). **Without it the cull refuses**: no warnings, no deletions, and
  the page says why. It cannot tell a Tameside player from an unlinked Stockport one otherwise.
- `league` records where someone signed up, not whose they are: 15 accounts tagged
  `stockport` are linked to Tameside players, and Google signups before 5 Nov 2026 carry no
  tag (a pre-user-registration Action does not run for social logins; a post-login one tags
  them at signup since). So Tameside's link wins, and the tag only decides for the unlinked.
- An account Tameside has linked is Tameside's even if it also matches a Stockport player.
  Its owner gets Tameside's email, which says that logging in to either site keeps it.

Never-approved accounts (no `betaAccess`) and accounts with no email address are listed
straight away without an email: the first could never log in, the second cannot be written
to.

Measured on 5 Nov 2026 (read-only dry run): 137 accounts in the tenant, 86 linked by
Tameside; the first run would warn 6 and list 14 never-approved signups.

## Setup

1. Apply the migration **before deploying**. Without the table the page and the run fail;
   nothing else does.

```bash
node run-migration.js 034_auth_account_notice.sql --prod
```

2. No new secret: the run uses `AUDIT_CRON_TOKEN`, like the team-strength jobs, and needs
   `TAMESIDE_DATABASE_URL`, which production already has.

3. Create the scheduler job, 10:00 Europe/London on the 1st of each month:

```bash
gcloud scheduler jobs create http sbl-monthly-login-cull \
  --location=europe-west2 \
  --schedule="0 10 1 * *" \
  --time-zone="Europe/London" \
  --uri="https://stockport-badminton.co.uk/admin/login-cull/run" \
  --http-method=POST \
  --headers="X-Audit-Token=<AUDIT_CRON_TOKEN>"
```

4. Check it with `gcloud scheduler jobs run sbl-monthly-login-cull --location=europe-west2`.
   The response body says how many were warned, failed, deferred, waiting and due.

## Details

- **At most 40 emails a run, a second apart**, inside the 60s Firebase gives a request and
  gentle on Gmail (the emails skill, 27 Aug 2026). The rest go next month (`deferred`).
- **A warning is recorded only after SES accepts it.** Otherwise someone never told would be
  listed for deletion a month later.
- **The keep token is stored hashed**, one per email. A new email replaces it, and using it
  spends it.
- **A quiet month sends the results mailbox nothing.**
- **Under `DEV_MODE` it refuses.** A local server's mock superadmin would otherwise reach the
  real tenant through `dev.env`'s Auth0 credentials.
- The Stockport Auth0 application has `read:users` and `delete:users` (checked 5 Nov 2026).
  `Auth.deleteUser` waits and retries on a 429, and treats a 404 as already gone.
- Logs: `[login-cull]` in Cloud Logging.
