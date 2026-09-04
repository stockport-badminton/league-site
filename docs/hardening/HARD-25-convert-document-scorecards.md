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
