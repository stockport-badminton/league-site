# The "how to enter a result" videos

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
