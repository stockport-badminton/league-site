# HARD-03 — Photo endpoint and confirmation links

**Severity:** high · **Wave:** B · **Blocked by:** HARD-01 (same file)
**Owns:** `controllers/scorecardController.js` — `add_scorecard_photo` and
`fixture_populate_scorecard_errors` only
**Sources:** SEC-2, SEASON-5

Do not start until HARD-01 has landed. Both packages edit `scorecardController.js`.

## Why

**The photo endpoint injects into outbound email.** `POST /add-scorecard-photo/:id`
(`scorecardController.js:608`) is unauthenticated. It writes `req.body.imgURL` against
any fixture id, then interpolates that value **unescaped** into an HTML email sent from
`results@stockport-badminton.co.uk`:

```js
Data: `<p>a scorecard has been updated with a photo: <a href="${req.body.imgURL}">${req.body.imgURL}</a>…`
```

So any fixture's photo can be replaced with a link to anything, and a crafted value
rewrites the email itself — a phishing message from your own verified domain, delivered
to the results secretary who is expecting exactly that email.

**Confirmation links are enumerable and built from the wrong host.** The link is
`/populated-scorecard-beta/<id>` where the id is the draft's sequential primary key —
no token, no login, no check that the visitor is connected to either club. Ids run to
about 2,400, so every scorecard ever filed can be walked by counting, and an outsider
can confirm a result neither captain has agreed. The URL is also built from
`req.headers.host` (`scorecardController.js:413`), the pattern the rest of the site
retired: behind Firebase that is the Cloud Run hostname, so the email can carry a link
to the wrong domain.

## What to do

1. **Escape the URL for HTML** before it goes near the email body, and **validate it** —
   reject anything that is not an `https://` URL on our own bucket. `utils/` already has
   XML/HTML escaping helpers used by the image generator; reuse rather than re-invent.
2. **Gate the write.** The fixture id alone is not authorisation. Use the draft token
   introduced below, or require the submission to match an existing draft.
3. **Add a random token per draft.** A column on `scorecardstore`, included in the
   confirmation URL and checked on the way in. This does not change what a captain does —
   they still click the link in their email.
4. **Use `absoluteUrl()` / `canonicalFor(req)`** from `utils/canonical.js` for the link,
   including in email. CLAUDE.md is explicit about this.

## Acceptance criteria

- An `imgURL` containing `">` cannot alter the structure of the email.
- An `imgURL` pointing at a domain other than our bucket is rejected.
- `/populated-scorecard-beta/<id>` without a valid token does not render a scorecard.
- The emailed link points at the public domain regardless of the `Host` header.
- Filing and confirming a scorecard still works end to end (`npm run test:e2e`).

## Tests

- `imgURL` with HTML metacharacters → email body unchanged in structure
- `imgURL` off-bucket → 400
- confirmation URL without token → 403/404
- `Host: league-site-xxx.a.run.app` → emailed link still uses the public origin
  (`__tests__/unit/canonical.test.js` has the pattern)

## Out of scope

- `full_fixture_post` — HARD-01 owns it.
- The S3 signing endpoint — HARD-02.
