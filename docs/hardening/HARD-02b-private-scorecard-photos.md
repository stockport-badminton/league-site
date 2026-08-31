# HARD-02b — Make scorecard photos private

**Severity:** low · **Wave:** C · **Blocked by:** nothing
**Owns:** `routes/index.js` (`/sign-s3`), a new read path, `scorecardstore."scoresheet-url"`
**Source:** the residual left by HARD-02

## Why

HARD-02 closed the two things that mattered about `/sign-s3`: the caller can no longer
choose the object key, so nothing in the bucket can be overwritten, and the content type
has to be an image, so the bucket cannot be made to serve HTML or an executable.

What is left is smaller. An anonymous caller can still upload a JPEG under a random name
in `scorecards/`, and the object is still `ACL: public-read`. That is a storage-cost
nuisance rather than a defacement route, and the endpoint carries `publicFormLimiter`.

`public-read` was kept deliberately, because scorecard photos are rendered straight from
the bucket by `<img src>` and by links already stored in
`scorecardstore."scoresheet-url"`. Removing it without a read path would blank every
historical scorecard photo on the site.

## What to do

1. A read route that streams the object — `app.js` already does exactly this for the
   venues map (`GET /static/generated/venues-map.png`), so follow that.
2. Store the key rather than the full S3 URL for new uploads, and render through the new
   route.
3. Backfill the existing `scoresheet-url` values, or keep the renderer tolerant of both
   shapes. Tolerant is probably cheaper and safer than a migration.
4. Only then drop `ACL: 'public-read'` from the signer.
5. Consider tying the signature to a fixture or draft id at the same time, so an upload
   has to belong to something.

## Acceptance criteria

- New photos are not publicly readable direct from the bucket.
- Every existing photo still displays.
- `npm run test:e2e` passes, including the scorecard specs.

## Out of scope

- Deleting the anonymous uploads already in the bucket.
- Object lifecycle rules on the bucket, which would be a sensible separate thing.
