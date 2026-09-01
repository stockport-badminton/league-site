# HARD-21 — The weekly social video has no readable URL

**Severity:** low, but **dated** — must land before the first weekly video of the season
**Wave:** C · **Blocked by:** nothing
**Owns:** `controllers/socialVideoController.js`, one new route in `routes/index.js`
**Source:** found auditing the bucket for HARD-02b, 1 Sep 2026

## Why

`GET /api/social/generate-weekly-video` builds the week's results video, uploads it to S3
and answers with a URL for Make.com, which downloads it and posts it to social media.

The URL it answers with is a **public bucket URL**:

```js
videos['16-9'] = `https://${process.env.S3_BUCKET_NAME}.s3.eu-west-1.amazonaws.com/${s3Keys['16-9']}`;
```

That URL returns **403**. `uploadVideoToS3` sets no `ACL`, so the objects were never
publicly readable:

```js
await s3.send(new PutObjectCommand({
  Bucket: process.env.S3_BUCKET_NAME,
  Key: s3Key,
  Body: fileContent,
  ContentType: 'video/mp4'
}));   // no ACL, and no bucket policy grants public read either
```

Verified 1 Sep 2026 by anonymous `HEAD` against both
`social-videos/weekly-video-16_9.mp4` and `…-1_1.mp4`.

**This is not a regression, and nothing is broken today.** It has never worked. The
feature was built over the summer, the season had not started, and no weekly video has
been generated in anger — so the first real run is when Make.com would have failed to
fetch. Confirmed with the owner: Make.com's only job is to download the file and upload
it to social, so a plain readable URL is all it needs.

It is explicitly **not** HARD-02b's doing. That package made *new scorecard photos*
private; it never touched `social-videos/`, and the runbook's claim that these objects are
public — and would be broken by Block Public Access — was simply out of date. Corrected in
that package's file.

## What to do

Add a read proxy and return its URL instead of the bucket URL. This is the **third**
instance of a pattern already in the codebase, so follow the existing ones rather than
inventing a fourth shape:

- `GET /static/generated/venues-map.png` in `app.js` (~line 174) — the simplest version.
- `GET /scorecard-photo/:id` in `routes/index.js` — the careful version, and the better
  model. Copy from this one.

Specifically:

1. A route — `GET /social-video/:aspect` with `aspect` constrained to `16-9` / `1-1`,
   resolving to the two known keys. **Never take a key from the request**; the aspect is
   an enum, not a path.
2. Stream it with `GetObjectCommand`, `Content-Type: video/mp4`. Attach an `'error'`
   listener to `obj.Body` before piping — a mid-transfer failure is otherwise an
   unhandled `'error'` on an EventEmitter, which takes the instance down. Same shape as
   gotcha 2c and as the scorecard-photo route, which does this and the venues-map route
   does not.
3. `mediaLimiter` from `middleware/rateLimit.js`, as `/scorecard-photo/:id` uses. These
   are 1–2MB objects and the route is necessarily unauthenticated.
4. **Build the returned URL with `absoluteUrl()` from `utils/canonical.js`**, never
   `req.get('host')`. This URL is handed to a third party: behind Firebase the Host header
   is the *Cloud Run* one, so `req.get('host')` would hand Make.com
   `league-site-akvq7tsxuq-nw.a.run.app`. That is gotcha 1b, and it is exactly the class
   of bug that put the wrong canonical on every page of the site.
5. Cache headers: `public`, short max-age. Unlike a scorecard photo there is nothing
   private here — it is about to be posted publicly — so `public` is correct and
   `Cache-Control: private` would be cargo-culting from the photo route.

## Acceptance criteria

- `GET /social-video/16-9` and `/social-video/1-1` return `200 video/mp4` for the objects
  currently in the bucket.
- The JSON from `/api/social/generate-weekly-video` contains those URLs on our own
  domain, and no `*.s3.*.amazonaws.com` URL.
- An unknown aspect is a 404, and no request-supplied string ever reaches `Key`.
- The objects stay private in S3 — this must not be "fixed" by adding
  `ACL: 'public-read'` back to the upload.
- Tests: a served video, the aspect enum rejecting junk, and an assertion that the
  returned URL is on the site's own origin.

## While you are in here — separate decision, do not silently fix

`GET /api/social/generate-weekly-video` carries **no authentication and no rate limiter**.
An anonymous caller can trigger an ffmpeg encode on Cloud Run, repeatedly. There is an S3
lock file and a 65-second dedupe window, which blunts it but is not an authorization
control. That is a compute-cost and availability question rather than a data one, and it
changes how Make.com calls the endpoint, so it wants its own decision — raise it rather
than folding it into this package.

## Out of scope

- Making the video objects public again. That is the thing this package exists to avoid.
- Block Public Access on the bucket (HARD-02b step 4).
- Anything about how Make.com authenticates *to* social platforms.
