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

---

# The runbook — how to actually make the photos private

**The code is done and deployed-safe as it stands.** Everything below is the half that
touches AWS, and none of it is in this repo. Nothing here is required for the site to
keep working: the read path does not care whether the objects are public or private, so
you can stop after any step and the site is fine.

Do the steps in order. Each one says how to reverse it.

**Before you start.** Know your bucket name (`S3_BUCKET_NAME` in Cloud Run) and check
what is in it, because scorecard photos are not the only thing:

```bash
aws s3 ls s3://$BUCKET/ --recursive | head -50
```

You should see `scorecards/…` (photos), `venues-map.png`, and `social-videos/…`. The
last two are *generated assets the site serves publicly* — `venues-map.png` is proxied by
`app.js` and the videos are handed to Make.com. **Do not make those private.** Every step
below is scoped to the `scorecards/` prefix for that reason.

> **Correction, 1 Sep 2026 — read this before running any sweep.** The paragraph above is
> wrong in two ways that matter, both found by listing the bucket rather than assuming it.
>
> **There is no `scorecards/` prefix.** The bucket's only prefixes are
> `scorecard-ocr-cache/` (14), `inbound-email/` (12) and `social-videos/` (3). All 1,455
> photos sit at the **root**. Every `--recursive` command below scoped to `scorecards/`
> matches nothing, so a sweep written from this runbook would appear to succeed and change
> nothing. Re-scope to the root — and then read the next paragraph, because the root is
> not only ours.
>
> **338 of the root objects belong to the Tameside league**, which shares this bucket.
> They are all named `tameside-…`, so they can be excluded, and they are all public today.
> Stockport's photos survive going private because `GET /scorecard-photo/:id` proxies
> them; **Tameside has no such read path**, so sweeping the whole root blanks 338 of their
> scorecards. See [`docs/handover/tameside-s3-bucket.md`](../handover/tameside-s3-bucket.md).
> Until the Tameside side has its own reader or its own bucket, **step 3 must exclude
> `tameside-*`.**
>
> `venues-map.png` and `social-videos/*` need no protecting — they are already private
> (see the step 4 correction below).

### Step 0 — confirm the read path works in production, while the objects are still public

This is the whole reason the work was split. Deploy the code, then open a confirmation
link from a recent results email and check the photo appears on the page. Also try a
photo from an archived season:

```bash
# a draft id and token for something old, and one for something recent
node tools/dbq.js "SELECT id, date, \"confirmToken\" IS NOT NULL AS tokened, \"scoresheet-url\"
                   FROM scorecardstore
                   WHERE COALESCE(NULLIF(TRIM(\"scoresheet-url\"), ''), '') <> ''
                   ORDER BY date LIMIT 3"
node tools/dbq.js "SELECT id, date, \"confirmToken\" IS NOT NULL AS tokened, \"scoresheet-url\"
                   FROM scorecardstore
                   WHERE COALESCE(NULLIF(TRIM(\"scoresheet-url\"), ''), '') <> ''
                   ORDER BY date DESC LIMIT 3"
```

Then `curl -I https://stockport-badminton.co.uk/scorecard-photo/<id>` (add `?t=<token>`
for a tokened draft) and expect `200` with an `image/*` content type. **If any of these
404, stop and find out why before going near the bucket** — that is exactly the failure
this ordering exists to catch, and at this point it costs nothing.

A `404` here means one of: the object is genuinely gone from the bucket; the stored URL
is not parseable as one of our own objects; or the key is corrupted. The third is known
to exist — the upload page used to rewrite `%20` as `+` when reconstructing the URL, so
some historical keys in the column do not match the object that was actually written.
Those photos are already unreachable today and were before this work; note them and move
on, do not treat them as a regression.

**Reverse:** nothing to reverse. Redeploy the previous revision.

**Step 0 was run on 1 Sep 2026 and passed.** `tools/scorecard-photo-audit.js` reconciles
every row in `scorecardstore."scoresheet-url"` against a `ListObjectsV2` of the bucket,
using the route's *own* `photoKeyFromStored` and content-type gate rather than a
reimplementation — a hand-rolled parser here would measure the script instead of the
proxy, which is the same class of mistake that put 490 `+`-for-space URLs in the column.
Re-run it after step 3 and diff the counts; that is the check that proves nothing broke.

| Verdict | Rows | |
|---|---|---|
| Servable | **1,456** | 98.4% of 1,479 |
| Object missing | 21 | already 404 today |
| Unservable type | 2 | already 404 today |
| **Refused by the guard** | **0** | every stored URL shape parses |

**The zero is what licenses step 3.** The risk was that making objects private would blank
photos whose keys the reader could not resolve; measured, that set is empty. Both host
spellings and all 490 `+` URLs resolve. Every failure is a genuinely absent object — one
was confirmed by hand with `head-object` and in the S3 console.

The 21 dead rows are not age-related rot: 17 are the contiguous block **ids 878–900, all
dated Feb 2020**, while 1,282 servable rows sit inside the same id range. Something
happened to those objects specifically. The remaining four are 2160, 2252, 2253, 2259.
The 2 unservable ones are keys that never had a real extension
(`College Green C-Disley B.22`).

**406 objects in the bucket are referenced by no row at all** — the anonymous-upload
residual HARD-02 left behind, and the true size of the lifecycle-rule question this
package defers.

### Correction: the premise of step 4 is out of date

The step-4 warning below says Block Public Access would break the venues map and the
weekly videos. **Checked on 1 Sep 2026: both are already `403` to an anonymous request**,
and `GET /static/generated/venues-map.png` still answers `200` because the app fetches it
with credentials. So that warning no longer describes the bucket.

**The weekly video handoff has never worked.** `uploadVideoToS3` in
`controllers/socialVideoController.js` sets no ACL, so the two `.mp4`s were never public,
while the controller hands Make.com a plain public bucket URL
(`https://<bucket>.s3.eu-west-1.amazonaws.com/social-videos/weekly-video-16_9.mp4`) that
403s. It has not been noticed because the feature was built over the summer and the season
had not started. This is **not** a regression from HARD-02b — nothing here made it
private, it never was. Fixing it belongs with the social-video work, not this package; the
options are a credentialed proxy route (matching `venues-map.png` and
`/scorecard-photo/:id`), a presigned URL with an expiry, or giving Make.com its own
read-only IAM credentials.

Also checked: **the bucket policy grants no public read at all.** Its one statement is
`AllowSESReceiptWrite` (SES → `inbound-email/*`). Everything public is public by
per-object ACL, so **step 2 requires no action** — and step 3's ACL sweep is genuinely the
only lever, with nothing overriding it.

### Non-image objects, and which are public

Of 1,484 objects, 41 are neither image nor document. 29 are already private and
legitimate: `inbound-email/` (12, the SES→S3 inbound store),
`scorecard-ocr-cache/*.vision.json` (14 — note these are **Tameside** league OCR cache
written into the Stockport bucket, worth knowing when reasoning about who writes here),
and `social-videos/` (the two weekly videos plus the `.generating` lock).

**Five are publicly readable and are captain uploads that were never photos** — all named
exactly like a scorecard, so they came in through the upload form:

```
David Lloyd A-Featherforce A.xlsx                    18K   2026-05-23   PUBLIC
Alderley Park C-Manor A.msg                          3.7M  2024-11-14   PUBLIC
Macclesfield B-Parrswood C.zip                      25.2M  2022-11-09   PUBLIC
College Green C-Disley B.22                          1.5M  2022-01-20   PUBLIC
Alderley Park C-College Green D.12102022_APBC_…      3.2M  2022-10-16   PUBLIC
```

Step 3 makes all five private along with everything else. The `.xlsx` is recent and may
hold member data; the `.zip` alone is 25MB of the storage residual.

Seven `.jfif` objects look non-image to a naive extension filter but are ordinary
photos — `TYPE_BY_EXTENSION` includes `jfif` and all seven are referenced and servable.

### Step 1 — stop new uploads being public

Already done in code: `/sign-s3` no longer signs `ACL: 'public-read'`. It takes effect on
the next deploy and applies only to objects written after it.

**Reverse:** `git revert` the commit "Stop signing scorecard uploads as public-read".
It is deliberately a separate commit from the read path so this is a one-command
reversal that does not take the read path with it.

### Step 2 — check whether a bucket policy is granting public read anyway

An ACL is not the only way an object is public. If a bucket policy grants
`s3:GetObject` to `*`, step 1 changed nothing observable.

```bash
aws s3api get-bucket-policy --bucket $BUCKET --query Policy --output text | jq .
```

If there is a statement with `"Principal": "*"` and `"Action": "s3:GetObject"` covering
`arn:aws:s3:::$BUCKET/scorecards/*` (or the whole bucket, `/*`), it has to be narrowed.
**Save the current policy first** — this is the step it is most annoying to undo from
memory:

```bash
aws s3api get-bucket-policy --bucket $BUCKET --query Policy --output text > /tmp/bucket-policy-before.json
```

Then edit it so any public-read statement's `Resource` covers only what must stay public
(`arn:aws:s3:::$BUCKET/venues-map.png` and `arn:aws:s3:::$BUCKET/social-videos/*`) and no
longer `scorecards/*`, and put it back with
`aws s3api put-bucket-policy --bucket $BUCKET --policy file:///tmp/after.json`.

**Reverse:** `aws s3api put-bucket-policy --bucket $BUCKET --policy file:///tmp/bucket-policy-before.json`.
Effective within seconds.

### Step 3 — make the existing photos private

Only after step 0 passed. This is the step that would blank the photos if the read path
were wrong, and it is the one worth doing in two halves.

First one object, and check the site still shows it:

```bash
# pick a photo you have already loaded successfully through /scorecard-photo/:id
aws s3api put-object-acl --bucket $BUCKET --key "scorecards/…/one-photo.jpg" --acl private
curl -sI "https://$BUCKET.s3.eu-west-1.amazonaws.com/scorecards/…/one-photo.jpg" | head -1   # expect 403
curl -sI "https://stockport-badminton.co.uk/scorecard-photo/<that draft id>" | head -1        # expect 200
```

If both of those are right, do the rest of the prefix:

```bash
aws s3 ls s3://$BUCKET/scorecards/ --recursive --output text \
  | awk '{ $1=""; $2=""; $3=""; sub(/^ +/, ""); print }' \
  | while IFS= read -r key; do
      aws s3api put-object-acl --bucket "$BUCKET" --key "$key" --acl private
    done
```

Note the historical photos that predate the `scorecards/` prefix and sit at the bucket
root (`20182019-Shell A-Mellor A.jpg` and similar). They need the same treatment, and
they are the ones where getting the read path right matters most — check a handful
through `/scorecard-photo/:id` individually before changing them.

**Reverse:** the same loop with `--acl public-read`. Note this is only *practically*
reversible — if you cannot enumerate exactly which objects you changed, you will make
things public that were private. Keep the output of the `aws s3 ls` above.

### Step 4 (optional) — Block Public Access on the bucket

The belt-and-braces version, and the only one that is genuinely hard to get wrong. **Do
not do this** unless the venues map and the weekly videos have been moved out of this
bucket or in front of a proxy first, because it blocks them too.

**Reverse:** `aws s3api delete-public-access-block --bucket $BUCKET`, then re-apply the
policy from step 2.

### What is deliberately not in this runbook

- **Migrating `scorecardstore."scoresheet-url"`.** The reader accepts a bare key as well
  as every URL shape in the data, so storing keys for new uploads is a one-line change
  whenever someone wants it. Rewriting ~1,500 rows of historical URLs is a one-way door
  with no upside — it is the owner's call, not this package's.
- **Backfilling `confirmToken`.** Same reason as HARD-03: minting tokens for existing
  rows is what would invalidate the links this all rests on.
- **Deleting the anonymous uploads already in the bucket**, and lifecycle rules on the
  `scorecards/` prefix. Both still out of scope, and lifecycle is the right answer to the
  storage-cost residual rather than more code.

## Who can see a photo, once this is done

| Who | How |
|---|---|
| Anyone holding a confirmation link for that draft | the `?t=` token, checked by `mayOpenDraft` |
| Anyone who can guess a draft id, **for a draft filed before migration 011** | the grandfather clause — same exposure the confirmation page already has, and it shrinks as old drafts are processed |
| Anyone at all, direct from the bucket | no longer — that was the finding |

The middle row is the honest caveat: photos on tokenless drafts are still reachable by
counting ids, exactly as the *scorecard* is. It is the same authorization as the data the
photo is a picture of, which is the point — but it is not "private" in the strong sense
until the grandfather clause in `utils/scorecardLinks.js` goes, and that clause carries
its own note saying what removes it.
