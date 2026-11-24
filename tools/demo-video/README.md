# The walkthrough videos

Two recorders share `overlay.js` (captions, pointer, spotlight, title cards) and the seed:
"how to enter a result" (`record.js`, below) and "how to turn on notifications"
(`record-notifications.js`, at the end).

## How to enter a result

`static/beta/video/enter-result-{desktop,mobile}.{mp4,jpg}`, linked from `/email-scorecard`
("New to this? Watch how it works"). Desktop is 1920×1080; mobile is 1080×1920, for a phone held
upright. The page picks the cut by orientation, and each cut links to the other.

Re-record them whenever the wizard changes enough that the video lies.

## What is real and what is not

- **Real:** the page, the menus, the dropdowns, the score validation, the draft it files and the
  "Scorecard received" page, all running on the local server and database.
- **Fictional:** Larkhill A v Brookvale A and their players (`seed.sql`), and the scorecard
  photo (`make-card.js`, which writes `card-data.json` onto `Scorecard-print.pdf` in a
  handwriting font). No real player or captain's handwriting appears in the video.
- **Stubbed:** `/api/analyse-scorecard` answers with exactly what is written on the card, except
  game 7's "21", which comes back as "2". That misread is the validation scene. The S3 photo
  read is stubbed as well, and so is the "we couldn't email the results secretary" warning,
  which the local server's dead mail credentials would otherwise put on screen.

## Recording

```sh
tools/local-db.sh up
docker exec -i sdbl-local-db psql -U sdbl -d sdbl < tools/demo-video/seed.sql   # once per database
node tools/demo-video/make-card.js                                              # once; needs ImageMagick

# the e2e suite's server: DEV_MODE user, dead outbound credentials
DEV_MODE=true NODE_ENV=development GLOBAL_RATE_LIMIT=100000 node -r ./e2e/server-env.js app.js

node tools/demo-video/record.js desktop
node tools/demo-video/record.js mobile
```

Each take deletes the demo fixture's draft first, files a new one, and writes the published
MP4 and poster straight into `static/beta/video/`. Each take takes about 1½ minutes. Watch the
result before committing it.

## Traps

- **Ten takes an hour, then restart the server.** `POST /email-scorecard` is limited to ten
  an hour (`publicFormLimiter`). The 11th take records the "Steady on" page instead, and an
  early version of these videos shipped that way. `record.js` now fails if submit does not
  reach "Scorecard received". The counters are in memory, so a restart clears them.
- **Playwright's `recordVideo` is CSS-pixel resolution**, and so is Chrome's screencast,
  whatever `deviceScaleFactor` says. Only `--force-device-scale-factor` at launch, with
  `channel: 'chromium'` (new headless), gives sharp frames. `record.js` therefore captures the
  screencast itself and builds a constant-frame-rate video with ffmpeg.
- **The captions, pointer, spotlight and title cards are in the page** (`overlay.js`), so they
  are rendered at full resolution. This also means a selector the overlay highlights must
  still exist when the view changes.
- `make-card.js` uses macOS's Bradley Hand font, and the paper noise is random, so the card is
  never byte-identical between runs.

## How to turn on notifications

`static/beta/video/notifications-mobile.{mp4,jpg}`, phone cut only (1080×1920), opened by any
`[data-notifications-video]` link through `views/notifications-video.ejs`: the banner at the
top of the fixtures & results pages (`views/notifications-banner.ejs`) and `/notifications`. Same server and seed as above, then:

```sh
node tools/demo-video/record-notifications.js      # DEMO_BASE=http://127.0.0.1:3123 for another port
```

- **Real:** the homepage, the menu, `/notifications` with the fictional Larkhill club, and
  the page's own states ("Notifications are on", Save settings / Turn off).
- **Stubbed:** headless Chromium has no push service, so `PushManager.subscribe` returns a
  fake subscription and `/api/push/*` is answered in the browser (nothing is written). The
  "Allow notifications?" prompt and the arriving notifications are drawn by `overlay.js`
  (`prompt`, `notify`), since a headless browser draws no browser or phone UI. iPhone's
  "Add to Home Screen" step is a title card for the same reason.
- **The worker must install**, or the page shows "doesn't support notifications". It
  precaches `/static/generated/venues-map.png`, which the local server 404s (it is read
  from S3), and one failed precache aborts the install. The recorder serves a stand-in
  for it through a context route, which also catches the worker's requests.
- The PushManager stub is its own init script, first: sharing one with the styling lines
  once left the real `subscribe` in place, which fails with "permission denied".
- No rate limit to worry about: nothing is POSTed to the server.

Re-record when `/notifications` changes enough that the video lies, or when the reminder
times change (they are in a caption and in the example notifications).
