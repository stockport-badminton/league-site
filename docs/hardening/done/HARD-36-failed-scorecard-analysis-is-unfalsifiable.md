# HARD-36 — a failed scorecard analysis destroys its own evidence

**Severity:** low, but it makes every other scorecard-reader bug more expensive
**Wave:** C · **Blocked by:** nothing (best done alongside HARD-22, same bucket)
**Owns:** `controllers/scorecardAnalysisController.js` (`analyse_scorecard`), one S3
lifecycle rule, and a retention line in CLAUDE.md
**Source:** 16 Sep 2026 — a captain's first two photos failed analysis and the third worked,
and the failure could not be diagnosed afterwards because the failing images no longer
existed.

## Why

`POST /api/analyse-scorecard` reads `req.file.buffer`, OCRs it, and **discards it**. A
document upload is stored before the OCR runs, deliberately, so the captain keeps their
photo if Vision throws. An **image** upload is not stored at all unless the analysis
succeeds — the page does its own upload afterwards.

So when analysis fails, the only artefacts are the log line and the request size.

That is exactly what happened on 16 Sep. Three attempts, 45 seconds apart:

```
07:40:36  422  3,778,686 bytes   Missing corner anchors: DATE
07:41:21  422  3,811,219 bytes   Missing corner anchors: DATE
07:42:05  200  3,740,264 bytes   ✓
```

Three different photos — the sizes differ — so the captain retook the shot and the third
one worked. **Diagnosing why the first two failed meant working from the one image that
had, by definition, succeeded.** An hour of Vision calls established that `DATE` was by far
the tightest anchor on the card (0.033 of headroom against 0.30, where every other anchor
had 0.125–0.170), which was worth finding and led to HARD-36's sibling fix — but it did
**not** establish what was different about the failures, and could not have.

Two candidate causes remained, wanting opposite responses, and no way to choose between
them:

- the threshold was marginally wrong (ours to fix), or
- Vision never read the word on those two shots — glare, or the crease visibly running
  through the card (the captain's retry is the fix).

`a44d16b` made the *message* distinguish those two going forward. This package is the other
half: **without the image, even a perfect message cannot be checked.** A log line saying
"outside[yMax=0.45]" is only believable if someone can look at the photo it describes.

This generalises. The scorecard reader is the one part of this codebase that fails on
*input we do not control* — a phone camera, a creased card, a kitchen table. Every future
report of it will be "it didn't work this morning", and every one will cost the same hour
unless the input is recoverable.

## What to do

1. **Store the image when analysis fails**, under its own prefix — `scorecards/failed-analysis/`
   — using the existing upload path. It is already private (HARD-02b) and the key builder
   already exists (`buildUploadKey` / `utils/uploads.js`).
2. **One S3 lifecycle rule on that prefix: expire after 14 days.** This is the part that
   makes it acceptable to store at all, and it must land in the same change, not after.
3. **Log the stored key next to the failure**, so the log line and the object find each
   other. Without that the bucket is a pile of anonymous jpegs.
4. **A failed store must not fail the request.** Same rule as the document path: the
   captain's problem is that the auto-fill did not work, and "we also could not save your
   photo" helps nobody. Wrap it the way `convertDocument` already does.

### Retention is the whole question, and versioning is not the answer

A scorecard photograph carries **twelve players' names and both captains' signatures**.
HARD-02b made these objects private for exactly that reason, and cleared 1,479 of them out
of the development database.

S3 **versioning was considered and is the wrong tool.** It protects an object that exists
from being overwritten or deleted; here no object is ever created. It also pushes the wrong
way on the only thing that makes this uncomfortable — versioning *retains more, for longer*,
keeping every version indefinitely unless a noncurrent-version expiry rule is added as well.

**Lifecycle expiration** is the mechanism that fits: retention becomes a property of the
bucket rather than of anyone remembering to tidy up. Fourteen days is long enough that a
Monday-morning report about Saturday's card is still diagnosable, and short enough that the
league is not accumulating a corpus of signatures it has no use for.

Volume is small. Analysis failures are rare — the 16 Sep pair are the only ones in the
retained log window — so this is a handful of objects a season, each deleted on a timer.

## Acceptance criteria

- A failed image analysis leaves an object under `scorecards/failed-analysis/`, and the
  422 log line names its key.
- A lifecycle rule on that prefix expires objects after 14 days, and is verified by reading
  the bucket configuration back rather than by having set it.
- A failure to store does not change the response the captain gets.
- The object is not public, checked the same way HARD-02b checked: an anonymous GET of its
  URL is refused.
- CLAUDE.md records what is stored, for how long, and why — next to the existing note about
  scorecard photos carrying personal data.

## Out of scope

- **Changing the anchor detection.** The DATE band was widened and the diagnostics improved
  in `a44d16b`; whether that was the right fix is a question this package exists to make
  answerable, not to answer.
- **Storing successful analyses' inputs.** The page already stores the photo it ends up
  attaching. Only the discarded failures are missing.
- **Document uploads.** Already stored, before the OCR, on purpose.
- **A retention policy for the main `scorecards/` prefix.** Those photos are the league's
  record of a result and are a different decision. Raise it separately if it needs raising.

## A note for whoever picks this up

The sibling finding is worth reading first: `controllers/cornerDetection.js`, the comment
above `findAnchors` and the one above the `DATE` anchor. Between them they record what was
measured on 16 Sep, and — more usefully — what was *not*, and why the difference mattered.

---

## Landed 16 Sep 2026 — and the first real failure went straight through the gap

The code landed in `f8e5bf0` / `7445ab7`, the lifecycle rule is on the bucket
(`expire-failed-scorecard-analysis`, `scorecards/failed-analysis/`, 14 days, verified
17 Sep). Then on 17 Sep a captain's Aerospace card failed and **nothing was kept**.

```
13:41:21  400  41,713 bytes  POST /api/convert-scorecard-document
```

No log line, no Sentry event, no object anywhere — on the endpoint this package had just
been written to make diagnosable. Two independent reasons, and both are worth keeping.

### It only covered the catch block, and a refusal is not an exception

`storeFailedImage` was called from `analyse_scorecard`'s `catch`. The **4xx refusals return
from inside the `try`** and never reach it. Three separate branches in
`convert_scorecard_document` return 400, and one more in `analyse_scorecard`, and none of
them logged so much as which check had fired. A status code in the request log was the
entire record.

**Covering a catch block is not the same as covering the failures.** The path that throws
is the one you think of; the path that politely declines is the one that actually runs.

### The document exemption was right for a reason that did not hold

`storeFailedImage` skipped documents deliberately: `convertDocument` stores the extracted
image under the ordinary prefix *before* the OCR, so a second copy here would keep the same
photo twice under two different retentions. True — **when extraction succeeds.**

When no image can be pulled out, nothing was stored under the ordinary prefix, and the
wrapper was discarded with the request. So the exemption was widest exactly where the
evidence was scarcest: *we could not get an image out of your file* is the failure that most
needs the file, and it was the one guaranteed to keep nothing.

Fixed by `refuseUpload`, which keeps the upload **as it arrived** — the pdf or docx, not an
image extracted from it, because on this path there is no image. `FAILED_UPLOAD_TYPES` is a
separate list from `ALLOWED_TYPES` on purpose: the latter guards `/sign-s3`, where the
content type is attacker-chosen and decides what the bucket will later serve, so adding
`application/pdf` to it would be a security change. Nothing kept here is attacker-chosen in
that sense — the bytes are already on the server, behind `secured`, private, deleted in 14
days — and restricting it to formats the reader understands would keep only the cases that
need no diagnosis.

### Still true, and now asserted

- A failed store never changes what the captain sees.
- A document that converts fine is **not** also kept as scrap — that would put a photo the
  league means to keep under a 14-day expiry.
- Every refusal now says which check fired and where the file went.

---

## The live case arrived, 20 Sep 2026 — and this is what it was for

Left open deliberately until a real failure came through, because a retention feature that
has never retained anything is a claim rather than a fact.

```
12:06:16  Scorecard upload refused: no image could be extracted (application/pdf)
          [file: scorecards/failed-analysis/20262027/41764fbc-…-aerospace-v-shell-c.pdf]
12:06:26  (the same file again, ten seconds later)
```

Same captain and same match as the 17 Sep failure that prompted the document-path fix —
Aerospace v Shell C. They tried twice with a byte-identical file and gave up; the result
was eventually filed by hand and chased by email over the following week.

**Diagnosed in one command from the kept file**, which is the whole point:

```
pdf version : %PDF-1.7      pages: 2      /Image: 1
/CCITTFaxDecode : 1         /DCTDecode: 0   /FlateDecode: 0   /Font: 0
```

A two-page office-scanner fax-compressed scan — **exactly [HARD-30](../HARD-30-ccitt-scorecards.md)**,
which estimated "about three scorecards a season" and had no specimen. It has one now, and
the TIFF-rewrap route has been spiked against it.

Compare with the 17 Sep failure four days earlier: a status code, a request size, and
nothing else. Diagnosing that one meant reasoning from a file size. That is the difference
this package bought, and it is worth restating that **the evidence and the message are two
halves of one thing** — a log line naming the check that refused an upload is only
believable if somebody can look at the file it describes.

**Closed 21 Sep 2026**: verified on a real failure rather than a synthetic one.
