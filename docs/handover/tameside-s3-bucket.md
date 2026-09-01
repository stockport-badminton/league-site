# Handover: the Tameside league shares Stockport's S3 bucket

**Written 1 Sep 2026, for whoever picks up the [tameside](https://github.com/stockport-badminton/tameside)
repo.** You do not need the league-site repo to act on this, but the change it forces is
in *your* repo, not that one.

## The situation

Both leagues write scorecard photos into **one bucket: `badmintontemp`** (eu-west-1),
owned by the Stockport league site. Nobody planned this; it was discovered while auditing
that bucket. The split today:

| What | Where | Count |
|---|---|---|
| Stockport scorecard photos | bucket **root** | ~1,117 |
| **Tameside scorecard photos** | bucket **root**, every key prefixed `tameside-` | **338** |
| Tameside Vision OCR cache | `scorecard-ocr-cache/` | 14 |
| Stockport inbound email (SES) | `inbound-email/` | 12 |
| Stockport weekly social videos | `social-videos/` | 3 |

All 338 Tameside objects are named `tameside-<season>-<home>-<away>.<ext>` or
`tameside-ocr-<timestamp>.<ext>`, so **`tameside-` is a reliable discriminator.** Last
written 24 Sep 2025.

**Every root object in the bucket is currently world-readable** — verified by anonymous
HEAD, 12/12 public in both leagues' samples. There is *no* bucket policy granting this;
it comes from per-object ACLs written at upload time. The only bucket-policy statement is
`AllowSESReceiptWrite`, letting SES write to `inbound-email/*`.

## What is about to change, and why it breaks you

The Stockport side is working through a hardening package (HARD-02b) whose end state is
**scorecard photos are no longer readable straight from the bucket**. Stockport is safe
because it has already built a read path: `GET /scorecard-photo/:id` streams the object
using server credentials and authorises the viewer against the draft row, so its photos
keep working when the objects go private.

**Tameside has no equivalent.** If the Stockport side runs its ACL sweep over the bucket
root — which is where your 338 photos live — every Tameside scorecard photo that is
rendered from a public URL goes 403. That is the whole reason this note exists.

Two facts make this urgent rather than theoretical:

1. The runbook's sweep was written assuming photos live under a `scorecards/` prefix.
   **That prefix does not exist** — everything is at the root. So whoever runs it will
   have to re-scope it to the root, and the root is shared with you.
2. Nothing in the bucket distinguishes the two leagues except that `tameside-` prefix.

## What you need to do

Pick one. In rough order of how well they age:

**A. Give Tameside its own read path (recommended).** Mirror what league-site did: a route
that takes your own row id, resolves the object key from your database, fetches from S3
with credentials, and streams it. The league-site implementation worth copying is
`utils/scorecardPhoto.js` (key derivation, allowed content types, denied prefixes) plus
the `GET /scorecard-photo/:id` handler in `routes/index.js`. Points to carry over:

- Key the route on **your row id, never on an object key from the request** — otherwise
  it is an open proxy for the whole bucket.
- **Deny the prefixes that are not yours** (`inbound-email/`, `social-videos/`,
  `scorecard-ocr-cache/`, and Stockport's root objects). league-site's `DENIED_PREFIXES`
  does exactly this.
- **Do not echo S3's stored `ContentType` back**: objects uploaded before the lockdown
  carry a caller-chosen type, and reflecting it lets the bucket serve HTML from your own
  origin, which is worse than from S3 because it is same-origin with your session cookie.
  Map the extension to a type you allow, and 404 anything else.
- Historical keys are messy: some spell a space as `+` (an old upload widget rewrote
  `%20`), and PDFs are common — 338 Tameside objects include a lot of `.pdf`. Serve
  documents as an attachment, not inline.

**B. Move Tameside's objects to their own bucket.** Cleanest long-term separation, and it
ends this whole class of problem. `aws s3 mv` with the `tameside-` prefix, then update
your stored URLs. It is a one-way door for any URL already sent to a captain, so treat it
like a migration.

**C. Do nothing, and have the Stockport sweep exclude `tameside-`.** Legitimate as a
holding position — it keeps your photos working today — but it leaves 338 objects
world-readable indefinitely and leaves the coupling in place for the next person to
rediscover.

## Tell the Stockport side which one you picked

Until you do, their Step 3 must exclude `tameside-*` from the root sweep. If you go with
**A** or **B**, say so and they can sweep the whole root.

## Verifying, before and after

Read-only, no credentials needed for the second one:

```bash
# what is actually in the bucket, and whose it is
aws s3 ls s3://badmintontemp/ --recursive | grep -c tameside-

# is a given object readable by a stranger right now?
curl -s -o /dev/null -w '%{http_code}\n' \
  "https://badmintontemp.s3.eu-west-1.amazonaws.com/tameside-20242025-Aerospace%20A-GHAP%20A.pdf"
# 200 today; 403 once it is made private
```

league-site has `tools/scorecard-photo-audit.js`, which reconciles every stored URL
against the bucket using the app's own key-derivation rather than a reimplementation.
It is worth copying the *approach* if you build option A: a hand-rolled parser in the
checker measures the checker, not the proxy.
