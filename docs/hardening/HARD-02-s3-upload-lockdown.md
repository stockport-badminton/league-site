# HARD-02 — S3 upload lockdown

**Severity:** critical · **Wave:** A · **Blocked by:** nothing
**Owns:** `routes/index.js` (the `/sign-s3` handler only), new `utils/uploads.js`
**Sources:** SEC-1

## Why

`GET /sign-s3` (`routes/index.js:115`) takes `file-name` and `file-type` straight from
the query string and returns a presigned `PUT` URL with `ACL: 'public-read'`. There is
no `secured`, no token, no allowlist on the key or the content type.

The key is attacker-chosen, so **existing objects can be overwritten** — the venues map
(`utils/venues-map-generator.js`), the generated weekly videos
(`controllers/socialVideoController.js`), any club's scorecard photo. The content type is
attacker-chosen, so the bucket can be made to serve HTML or an executable. And it is an
unmetered write channel into storage you pay for.

Callers today: `views/index-scorecard.ejs` (×2), `views/messer-scorecard.ejs`,
`views/scorecard-upload.ejs`. All four upload a scorecard photo for a fixture.

## What to do

1. **Generate the key server-side.** A UUID under a fixed prefix — `scorecards/<uuid>.jpg`.
   Never accept a client-supplied path. Return the final URL alongside the signed one so
   the page knows where the file will land.
2. **Pin the content type** to an image allowlist (`image/jpeg`, `image/png`,
   `image/webp`, `image/heic`). Reject anything else with a 400.
3. **Drop `ACL: 'public-read'`.** Serve the object through a presigned GET, or via a
   dedicated read path, rather than making the whole bucket writable-and-public.
4. **Require a caller to be plausible.** These uploads accompany a scorecard, so the
   request should carry a valid fixture or draft id. A rate limit is not authorisation,
   but add `publicFormLimiter` as well.
5. Put the key generation and the allowlist in `utils/uploads.js` so the Messer path and
   the standard path cannot drift.

Keep the four calling views working. They pass `file-name` today; the server should now
ignore it (or use it only for the extension) rather than the request breaking.

## Acceptance criteria

- A request with `file-name=../../venues-map.png` cannot produce a URL that writes to
  that key.
- A request with `file-type=text/html` is refused.
- The returned URL cannot overwrite an existing object.
- Uploading a photo from `/scorecard-beta` still works end to end.

## Tests

New `__tests__/integration/sign-s3.test.js`:

- path traversal in `file-name` → key is still under the fixed prefix
- non-image `file-type` → 400
- valid request → 200, key matches `scorecards/<uuid>.<ext>`, no `public-read`

Mock the AWS SDK; do not hit S3 in tests.

## Out of scope

- `add_scorecard_photo` (the endpoint that records the URL afterwards) — **HARD-03**.
- The other unauthenticated endpoints — SEC-3, SEC-4, SEC-6 are small and can ride along
  in a follow-up, but do not mix them into this commit.
