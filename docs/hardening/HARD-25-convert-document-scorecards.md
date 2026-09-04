# HARD-25 — Convert document scorecards to images on the way in

**Severity:** low (an improvement, not a defect) · **Wave:** B · **Blocked by:** nothing
**Owns:** `utils/uploads.js` (`/sign-s3`), or a new server-side receive path
**Source:** the captain who could not file a `.docx` on 4 Sep 2026 (Sentry NODE-Z,
JAVASCRIPT-1VE, NODE-10) and the question that followed

## The finding, which is the whole point

**Every document scorecard is an image inside a wrapper.** Not a document that happens to
contain a picture — a picture with a wrapper around it. Measured on six real files pulled
from the bucket, chosen as the smallest, median and largest of each type:

| | pages | embedded images | fonts | words of text |
|---|---|---|---|---|
| `.docx` × 3 | — | **exactly 1** | — | **0** |
| `.pdf` × 3 | **1** | **exactly 1** | **0** | — |

A `.docx` scorecard is `word/media/image1.{jpeg,png}` and an empty `document.xml`.
Somebody pasted a photo into Word. A `.pdf` scorecard is a single page whose only content
is one image XObject, with no fonts at all — a scanner or a phone's "save as PDF".

**So converting them is extraction, not rendering.** That is what makes this cheap, and it
is the opposite of what you would assume from the file extensions.

## The corpus

127 `.pdf` (avg 610KB) and 14 `.docx` (avg 461KB) — 141 files, ~7% of the 1,479
scorecards on record. Sizes run from 29KB to **20.7MB**. One of the samples turned out to
be a *blank* Tameside league form, so not all 141 are filled cards; that is worth knowing
before anyone counts a backfill as 141 recoverable scorecards.

## Measured: 82% of them need nothing but a byte copy

The codec matters more than the extension does, so it was measured across an even spread
of 30 of the 127 PDFs rather than guessed from three:

| image codec | share of PDFs | what extraction needs |
|---|---|---|
| **`/DCTDecode`** | **80%** | **nothing** — the stream *is* a JPEG, write the bytes out |
| `/CCITTFaxDecode` | 13% | a fax decoder. `sharp` does not do CCITT |
| `/FlateDecode` | 3% | `zlib.inflateSync`, then wrap raw pixels with `sharp` |
| other | 3% | unknown until one is opened |

Shape, same sample: **0 multi-page**, 1 of 30 with more than one image, 5 of 30 carrying
`/DecodeParms`, largest 20.3MB.

A `.docx` is always verbatim — the image comes straight out of the zip. So:

```
  14 docx            verbatim
 ~102 of 127 pdfs    verbatim   (the 80% that are DCTDecode)
 ----
 ~82% of all document scorecards: byte extraction, nothing else
```

**An earlier draft of this brief had the phasing backwards**, because the first three PDFs
opened happened to be 2 Flate / 1 DCT. The corpus is the other way round, and the
consequence is large: the easy 80% is also the common case, and **verbatim extraction
cannot decompression-bomb**, because nothing is inflated.

| method | dependencies |
|---|---|
| docx → zip read, image verbatim | Node `zlib` — built in |
| pdf `/DCTDecode` → stream bytes verbatim | none |
| pdf `/FlateDecode` → inflate, wrap raw | `sharp` — already a dependency |
| pdf `/CCITTFaxDecode` → decode fax | **nothing available**; see Phase 3 |

**Ghostscript is not needed for any of this**, which is worth recording because ImageMagick
IS already in the image (`Dockerfile`: `apk add fontconfig ttf-liberation ffmpeg
imagemagick`) so `convert card.pdf out.jpg` looks like the obvious answer. It delegates PDF
rasterising to `gs`, which Alpine's `imagemagick` does not pull in. Extraction avoids that
and is more faithful anyway: verbatim bytes rather than a re-render.

## Where it runs — the actual design question

`/sign-s3` hands out a presigned PUT and never sees the bytes. That design is deliberate:
the app must not proxy large uploads. So conversion cannot live there.

**But the app already receives these bytes somewhere else.**
`POST /api/analyse-scorecard` takes the file through `multer.memoryStorage()` for OCR. So
the document path already exists — it is just refused at the door.

The cheap design is therefore to make that endpoint do both jobs, since it is already
holding the file:

1. Widen its filter to accept `pdf` and `docx` (today: `image/*` only).
2. Extract the embedded image.
3. Run OCR on the extracted image — which is the point of the endpoint anyway.
4. **PUT the extracted image to S3 from the server**, which already has credentials, and
   return its key.
5. The client uses that key as the scorecard photo. **No presigned PUT for documents.**

One round trip, no double transfer, no new endpoint, and the presigned-PUT design stays
exactly as it is for ordinary photos. A document upload becomes a *shorter* path than a
photo upload, not a longer one.

## Cost, against the "pennies a month" constraint

Measured, not assumed:

- **Volume: 260–325 fixtures a season** (20262027: 260). About 35 uploads a month in
  season, of which ~7% are documents — so **roughly 20 document uploads a season**.
- **Vision**: `documentTextDetection`, and `cornerDetection.js` calls it **twice** per
  scorecard (once to measure skew, once on the enhanced image). 35 × 2 = **70 units a
  month against a 1,000/month free tier**. Fourteen times headroom, and that is with
  *every* scorecard OCR'd, not just documents.
- **Cloud Run**: 2Gi / 1 CPU. A verbatim extraction is a zip read or a buffer slice; the
  3% Flate case peaks at ~36MB of raw pixels, which fits comfortably. Perhaps a
  CPU-second per document, twenty times a season — **about a minute of CPU a year**.
- **S3**: one extra PUT per document, and the image is *smaller* than the document it came
  from. Storage delta is negative if the original is not kept.

So the honest answer is that this is free — not "cheap", free, because it sits inside
existing free tiers and the volume is two orders of magnitude below where any of them
start charging.

**The one thing that is not free is a retry loop.** There is no Vision cache on this side
(the `scorecard-ocr-cache/` objects in the bucket are all Tameside's). A captain who
re-analyses the same card five times spends ten units. Fine at 14× headroom, but the cache
is cheap insurance and Tameside already has one to copy.

## Phasing

**Phase 1 — verbatim only. ~82% coverage, no new dependencies, no resource risk.**
docx (zip read) and `/DCTDecode` PDFs (stream bytes). Nothing is inflated or re-encoded,
so there is no bomb surface and no pixel arithmetic to get wrong. Everything else falls
back to today's behaviour: store the document, skip OCR, and say so.

**Phase 2 — `/FlateDecode`, 3%.** Needs the raw wrap, the `/DecodeParms` predictor
handling and the inflate cap. Worth doing only once Phase 1 has run a season, and it is
the phase that introduces the bomb guard.

**Phase 3 — `/CCITTFaxDecode`, 13%.** The office-scanner case, and the only one with no
tool to hand. Options are a CCITT decoder dependency, or extracting the stream into a TIFF
container that ImageMagick can already read. Genuinely optional: 13% of 7% is about three
scorecards a season, and "stored as a PDF, no OCR" is a perfectly good outcome for them.

## What to do

1. Confirm the direction: accept documents and convert, rather than telling captains to
   stop sending them.
2. Build Phase 1 behind the existing OCR endpoint, with the guard rails below.
3. Leave Phases 2 and 3 unbuilt until Phase 1 has a season behind it.

## Edge cases a production version must handle

The proof above used a regex over the PDF bytes. That is fine for a proof and **not fine
for a general implementation** — these six files happened to be simple. A real one needs:

- **`/DecodeParms` with a PNG predictor.** Absent in all three samples, common in the
  wild, and the raw bytes are wrong until it is undone.
- **Indirect `/ColorSpace` references.** Sample 2 carried `/ColorSpace 9 0 R`, an object
  reference the regex could not resolve — it was RGB, but only arithmetic on the inflated
  length said so.
- **CMYK, greyscale, and 1-bit CCITT** — the last is exactly what an office scanner
  produces for a black-and-white form.
- **More than one image, or more than one page.** Every sample was 1×1, and nothing
  guarantees it.
- **A 20.7MB input** decoding to ~36MB of raw pixels in memory. That is fine once; it is
  not fine several times concurrently, and `/sign-s3` is unauthenticated.

Which means: use a real PDF parser rather than byte scanning, and treat a failed
extraction as "store the original and move on", never as a failed upload. The file the
captain sent is the record; a conversion is a convenience.

### The guard rails, in the order they must run

There is very little control over what a captain uploads, so the limits are the control,
and each must run **before** the work it protects against:

1. **Size, at the door.** `multer` already caps at 10MB and now reports it properly. The
   largest historical document is 20.3MB, so 10MB refuses a real if unusual card — worth
   deciding whether to raise it to ~15MB rather than discovering it in September.
2. **Shape, before decoding.** More than one page, or more than one image: refuse to
   convert and fall back. Every sampled card was single-page, so anything else is not the
   shape this is for.
3. **Declared pixel count, before allocating.** `Width × Height × components` from the
   XObject dict, capped — a 30KB PDF can legitimately declare a 20,000×20,000 image and
   inflating it first is how a small upload becomes an OOM. **Phase 1 does not need this
   at all**, since verbatim extraction allocates only what is already on disk. It is the
   admission fee for Phase 2.
4. **A wall clock.** OCR already talks to Vision over the network; conversion should not
   turn a refusal into a hang.

## Acceptance criteria

- A `.docx` or `.pdf` scorecard, uploaded by a captain, is stored as an image and previews
  in the browser.
- A file the extractor cannot handle is stored as-is, and the captain is not told off.
- The OCR reader accepts a converted document scorecard.
- Tests run against real files of each shape: docx-with-jpeg, docx-with-png,
  pdf-DCTDecode, pdf-FlateDecode, and one it is expected to refuse.

## Out of scope

- Reading *text* out of a document scorecard. There is none — 0 words and 0 fonts across
  every sample. Anything that looks like text on these is pixels.
- The `.msg` file in the bucket (one, 3.8MB, an Outlook message). A separate curiosity.


---

# Phase 1, built 4 Sep 2026

**Delivered coverage: 104 of the 141 document scorecards on record — 74%.** All 14 .docx
and 90 of the 127 PDFs. Every one produces an image `sharp` can decode.

That is measured by running the extractor over **the whole corpus**, not a sample, and the
brief's 82% prediction was never checkable any other way. Two intermediate figures were
reported during the work — 65%, then 59% — and both were wrong in an instructive direction:
65% came from extrapolating a 40-file sample, and 59% was the first honest full-corpus run.
Every later gain came from a bug the full corpus exposed and the sample had hidden.

Four bugs, all of them invisible to a synthetic fixture and three of them invisible to a
sample:

1. **PDF dictionary keys are unordered.** The first version searched the 600 bytes *after*
   `/Subtype /Image` for the filter, and four of twenty files put `/Filter` first. Fixed by
   walking the `<<`...`>>` dictionary that introduces each stream and testing the whole of
   it. No change on its own — because of bug 2.
2. **An off-by-one in that dictionary walk.** `depth` started at 0 having already consumed
   the closing `>>`, so the matching `<<` took it to -1, the loop never broke, and *every*
   walk ran to its 20,000-byte guard and returned nothing. Together with bug 1: **48% of
   the sample → 65%**, and 59% measured properly.
3. **`stream` followed by a bare CR.** 21 files — one page, one image, `/DCTDecode`, the
   exact case Phase 1 exists for — matched nothing, because the regex looking for a stream
   was `/stream\r?\n/` and these write CR for every line ending in the file. PDF-1.3 out
   of some old scanner driver; the spec says CRLF or LF. **59% → 74%**, the single largest
   gain in the package, and it was a two-character fix sitting behind a wrong denominator.
4. **A zip directory entry counted as a second image.** `fromDocx` required exactly one
   `word/media/` entry, and a writer that emits an entry for the directory itself (legal,
   common, and not what Word does) made that two, so a perfectly good single-photo document
   returned null. Found by the *generated* fixture within a minute of it existing — the
   bucket's real files happen not to have directory entries, so no real fixture could have
   caught it.

What still fails, all 37 of it:

| | | |
|---|---|---|
| `/CCITTFaxDecode` | 15 | office-scanner bitonal; no decoder to hand — Phase 3 |
| multi-image page | 12 | one scan sliced into 30–89 strips; which is the card? |
| multi-page | 5 | 2 or 4 pages; picking one is a guess, so it declines |
| no image XObject | 3 | a genuinely typed document, not a photo of a card |
| `/FlateDecode` | 2 | raw pixels; needs the inflate cap — Phase 2 |

Note what is **not** on that list: a codec Phase 1 claims to handle. The census-vs-delivered
gap the earlier write-up attributed to "where a real PDF parser would earn its dependency"
was mostly bug 3. What remains is genuinely structural — the multi-image and multi-page
cases need a parser that can tell which XObject the page actually draws, not more codecs.

Also handled, and not in the original plan: **`/Filter[/FlateDecode/DCTDecode]`** - a jpeg
with zlib on top, which Acrobat writes. The first version bailed on any filter array, which
was right that the raw bytes are not a jpeg and wrong to give up: one inflate and they are.
`zlib`'s `maxOutputLength` is the bomb guard, and it is why this stays a Phase 1 case - the
output is bounded by a jpeg, unlike raw pixel data which can declare any dimensions.

## Decisions taken

**The cap is 25MB, up from 10.** Only 5 of 1,494 objects exceed 10MB and **three are
genuine scorecards a captain filed** - a 20.3MB pdf, a 13.5MB png and an 11.9MB jpeg - so
the old cap had been refusing real cards for two seasons. 25MB clears the largest and still
refuses the 25.2MB zip, the only object above it.

Size is explicitly **not** the safety mechanism: a 20MB jpeg is an ordinary phone photo
while a 20MB pdf can declare a 20,000x20,000 image, and no byte count separates them. The
shape checks do that.

**Zips are refused by name**, before anything reads a byte. Never a supported scorecard -
the one in the bucket has no row pointing at it, so nothing ever displayed it.

**The OCR enhance step now encodes to jpeg.** `sharp`'s `.toBuffer()` keeps the input
format and greyscale png barely compresses: a real 13.5MB png scorecard reached Vision at
**11.8MB**, and as jpeg the same image is **2.6MB - 4.6x smaller**. Since it has already
been greyscaled, normalised and sharpened *for OCR*, jpeg artefacts are irrelevant to text
detection. Without this the 25MB cap would be safe for jpeg inputs and quietly unsafe for
png, which would arrive near Vision's ~20MB ceiling. Verified separately that an 11.8MB
image *does* go through Vision (164 words detected), so the ceiling is above our largest
real card either way - but there is no reason to send 4.6x more than necessary.

**The enhance step now falls back instead of throwing.** A genuine 11.9MB scorecard in the
bucket (`Parrswood C-Dome B.jpeg`) makes `sharp` throw `VipsJpeg: Invalid SOS parameters
for sequential JPEG` - malformed, not large - and with no catch that was a 500 on the one
endpoint whose job is to be helpful. Vision is more tolerant than libvips, so the original
bytes are handed over instead. **That card could not be OCR'd at any size limit before
this.**

## What Phase 1 does not do

The other 26% return null and are refused with a message naming what still works, rather
than crashing. `utils/documentImage.js` handles docx and jpeg-bearing pdfs only; CCITT
(15 files) and raw `/FlateDecode` pixel data (2 files) are Phase 3 and Phase 2. Both stay
optional — but note that the multi-image page case is now **12 files, larger than either**,
and it is not a codec problem, so if a phase 2 gets built its first job is working out
which XObject the page draws.

(Superseded — the storage half is built, below.)

## Tests

`__tests__/unit/document-image.test.js` (23 cases). The fixtures are **generated**, by
`__tests__/fixtures/make-document-fixtures.js`, and the reason is worth recording because
the first version of this test did the opposite.

It used real scorecards from the bucket, on the argument — correct as far as it went — that
no hand-made file would have had unordered dictionary keys or a Flate-over-DCT chain. Then
one was rendered before committing, and it was a filled card carrying **twelve players'
names and both captains' signatures**. A git repository is forever and possibly public, so
that is not a thing to commit, whatever it buys in coverage.

Generating them turned out to be strictly better, not a compromise. Each file exists to
carry exactly one structural shape and is named after it, so the test says which shape it
is defending; a real card carries a shape incidentally and you cannot tell which by looking
at it. And the generated docx found bug 4 within a minute, which no real fixture could
have, because the bucket's files don't have the entry that triggers it.

| fixture | shape |
|---|---|
| `scorecard-docx-jpeg.docx` / `-png.docx` | pasted photo in `word/media/`, plus a directory entry |
| `scorecard-pdf-dct.pdf` | the 80% case: the stream is a jpeg |
| `scorecard-pdf-dct-keys-reordered.pdf` | `/Filter` before `/Subtype` (bug 1) |
| `scorecard-pdf-dct-bare-cr.pdf` | bare CR after `stream`, `[ /DCTDecode ]` (bug 3) |
| `scorecard-pdf-flate-over-dct.pdf` | Acrobat's zlib-over-jpeg |
| `scorecard-pdf-flate.pdf` | **real**, and the one safe one: a *blank* league form. The negative case — raw pixels, declined |

Coverage against the real corpus is not something a fixture can assert, so it was measured
out-of-band by running the extractor over all 141 objects. Re-measure the same way before
claiming a Phase 2 number; a sample will mislead you, as it did three times here.

`__tests__/integration/scorecard-analysis-upload.test.js` covers the endpoint: docx and pdf
accepted, unconvertible pdf explained, zip refused by name, a 12MB file accepted where the
old cap refused it, and 26MB still refused.


---

# The storage half, 4 Sep 2026

A decodable document now becomes **an ordinary jpeg in the bucket**, and the captain
uploads once.

```
captain picks card.pdf
  -> POST /api/analyse-scorecard      (the auto-fill input)
     -> extractEmbeddedImage          the photo inside it
     -> uploads.storeImage            PUT the IMAGE, server-side, private
     -> OCR + prefill
  <- { ...form fields, photoUrl, photoStored }
     -> the page drops photoUrl into every #scoresheet-url
```

**Why the image and not the document.** Storing the pdf would preserve the exact thing you
wanted rid of: a file the browser will not open inline. What lands is a jpeg, so the photo
proxy serves it, the confirmation page shows it, and next season's OCR can read it again.

**Why server-side rather than a presigned PUT.** `/sign-s3` accepts jpeg, png, webp and
heic only (`utils/uploads.js`), and that is a security boundary, not an oversight — it was
opened up to caller-chosen types once and that was the HARD-02 hole. So documents get no
presigned PUT at all; the bytes that reach the bucket are ones we produced, through the
same `buildUploadKey` allowlist, so the extension comes from the sniffed content type and
an extracted gif is refused here exactly as it would be there. No ACL is set: HARD-02b made
this bucket private and a public-read object would be a silent hole in it.

**Two things had to change that the brief did not anticipate:**

1. **`accept="image/*"` on the auto-fill input.** The file dialog would not offer a captain
   their own scanner's PDF, so the entire server-side conversion was unreachable from the
   UI. No server test can see this — `accept` is what the *browser* filters the picker
   with, and supertest posts whatever it is told to — so it is covered in
   `e2e/scorecard.spec.js` instead.
2. **`objectUrl` is now shared.** `/sign-s3` built the URL as a literal and `storeImage`
   needed the identical shape, because `normalisePhotoUrl` has to accept both. Three places
   agreeing on a string by hand is how they drift, so there is one definition and a test
   asserts the stored URL round-trips through the photo proxy's own rule.

**Ordering: store first, OCR second.** If Vision throws, the captain still has their photo.
And a store failure does not fail the request — they keep the prefill and the response says
`photoStored: false`, which the page turns into "the form is filled in but the photo did not
save", because the prefill working otherwise makes it look like everything did.

## It wrote to the production bucket, and that is now closed properly

The first run of the suite covering this **put two real objects in `badmintontemp`**. The
cause is worth recording because it is not specific to S3:

> `app.js` and `instrument.js` both call `require('dotenv').config()` at import time, and
> every integration test requires `app.js`. So the real `.env` — production
> `DATABASE_URL`, `S3_BUCKET_NAME` and live AWS credentials — is loaded into every test
> process. The database has been safe only because the models are all mocked.

Nothing server-side had ever written to S3 before (image uploads are a presigned PUT from
the browser), so no suite had any reason to mock the SDK, and the new code path went
straight through to production. `__tests__/setup.js` now plants dummy AWS credentials and
closes the shared-credentials file and the metadata service, so an **unmocked** AWS call
fails to sign instead of succeeding — the Jest counterpart to `e2e/helpers/read-only.js`,
enforced once rather than trusted to each test. `S3_BUCKET_NAME` is deliberately left
alone; several tests compare URLs built from it against `normalisePhotoUrl`.

## Tests

Five cases in `__tests__/integration/scorecard-analysis-upload.test.js`, with the SDK
mocked so the PUT is observable as well as harmless: the extracted jpeg is what gets stored
(not the pdf, and smaller than it), the key is server-generated under the season prefix with
a `.jpg` extension, **no ACL**, the returned URL round-trips through `normalisePhotoUrl`, a
store failure still returns the OCR with `photoStored: false`, and an image upload stores
nothing and is told nothing. Plus the browser test for `accept`.
