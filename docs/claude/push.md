# Push notifications

Results and match reminders, pushed to phones and computers that opted in at
`/notifications`. Ported in Nov 2026 from the Hyde club site (`~/hydewebsite`, `lib/push/`,
`routes/push.js`), which ported it from remnants-badminton. Those two scrape other leagues'
sites; here the data is ours, so two of their mechanisms are gone (see below).

## What gets sent

| Kind | When | Who | Built by |
|---|---|---|---|
| Result | when a result is published (`POST /scorecard-beta`) | followers of either team | `resultNotification` |
| "Tomorrow" reminder | 18:00 UK, the evening before | followers of either team | `reminderNotification` |
| "Tonight" reminder | 17:00 UK, on the day | followers of either team | `reminderNotification` |

League fixtures only. **Messer is excluded** because Messer matches have no fixture dates. A
reminder covers fixtures with `status = 'outstanding'` on that UK date, so rearranged, void
and conceded fixtures send nothing. The body is the home team's `starttime`, its venue and the
division, leaving out whatever is null. The tap opens the event page (`eventPath`).

## Pieces

- `migrations/039_push.sql`: `push_subscription` (one row per browser, id = sha256 of the
  endpoint, `teams INTEGER[]` of at least one, `types TEXT[]` with empty = both) and
  `push_send` (the ledger).
- `models/push.js`: the SQL. `subscribersFor` matches with `teams && $1::int[]`.
- `utils/push/`: `utils/push/subscription.js` (validation, ported), `utils/push/send.js`
  (fan-out with `web-push`; 404/410 deletes the row), `utils/push/notifications.js` (the
  wording, the UK date), `utils/push/index.js` (`notifyResult`, `runReminders`, `sendTest`).
- `controllers/pushController.js` + `routes/push.js`: `/notifications`,
  `/api/push/subscribe` (POST, DELETE), `/api/push/subscription` (POST lookup),
  `/admin/push/reminders` (cron), `/admin/push` + `/admin/push/test` (superadmin).
- `views/notifications.ejs` + `static/beta/js/push-panel.js`: the opt-in page. The page
  reads what this browser is subscribed to from the server, not from localStorage.
- `views/sw.ejs`: the `push` and `notificationclick` handlers. `rootfiles/badge-96.png` is
  the monochrome status-bar badge.

## Rules

- **Every send is claimed in `push_send` before it is made** (`INSERT … ON CONFLICT DO
  NOTHING`). Keys are `result-<fixtureId>`, `reminders-<UK date>-<tonight|tomorrow>` and
  `test-<ms>`. A republished or corrected result notifies nobody a second time, and a
  scheduler retry or overlapping run sends no duplicate reminders. To send one again,
  delete its row in a reviewed script. Hyde needed an "announced ids" list and a back-fill
  cap instead, because it learns of results by diffing a scrape.
- **No `VAPID_PRIVATE_KEY` means nothing is sent.** That is the kill switch, and it is what
  every test and local run has. `notifyResult` checks it *before* claiming, so a result
  published while the key is missing is not marked sent.
- **Results are sent inside the publish request**, through `afterCommit`, and the
  confirmation page says what happened (`pushNote`). Not queued: there is nothing to wait
  for, a fan-out takes about a second, and Cloud Run throttles CPU after the response, so
  fire-and-forget is unreliable.
- **Topics are team ids.** A fixture has both, so a club derby needs no special case (Hyde
  had to add the other side's key). The picker offers teams in a division and not
  withdrawn (`followableTeams`); a subscription to a team that is later withdrawn stays and
  receives nothing.
- **Subscription API abuse**: endpoints must be on a known push service (so we can't be
  made to POST anywhere), teams are checked against `followableTeams`, a cross-site
  `Sec-Fetch-Site` or foreign `Origin` is refused, and `pushLimiter` allows 60 per
  15 minutes (a whole club subscribing from one sports-hall IP). No `spamGate`: there is no
  free text.
- **Replacing the VAPID key pair orphans every subscription.** Each browser subscribed with
  the old public key, and the push services will refuse sends signed with the new one.

## Production setup

1. `npx web-push generate-vapid-keys`; set `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY` on
   Cloud Run, plus `PUSH_CRON_TOKEN`.
2. `node run-migration.js 039_push.sql --prod`.
3. Two Cloud Scheduler jobs, `Europe/London`, POST to the **Cloud Run URL** (gotcha 1bc),
   header `X-Push-Token`, no retries:
   - `sbl-push-tonight`, `0 17 * * *`, `/admin/push/reminders?when=tonight`
   - `sbl-push-tomorrow`, `0 18 * * *`, `/admin/push/reminders?when=tomorrow`

## Testing

- `__tests__/unit/push.test.js` (validation, wording, fan-out, at-most-once),
  `__tests__/integration/push.test.js` (routes), `__tests__/db/push.test.js` (SQL), and the
  publish-path tests in `__tests__/integration/scorecard.test.js`.
- By hand: `/admin/push` → "To this browser" after turning notifications on at
  `/notifications`. As superadmin, `POST /admin/push/reminders?when=tomorrow&date=YYYY-MM-DD&dry=1`
  lists what a run would send and sends nothing. The scheduler's token cannot use `date` or `dry`.
- Push needs a secure context: production, or `localhost` in dev with the VAPID keys in
  `dev.env`. **On iPhone and iPad it works only from the Home Screen app (iOS 16.4+)**; the
  page says so.
