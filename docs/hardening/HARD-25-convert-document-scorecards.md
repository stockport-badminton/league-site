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

## What it would take — no new dependencies

Proven against the real files, end to end:

| input | method | dependencies |
|---|---|---|
| `.docx` | read the zip, take `word/media/image1.*` **verbatim** | Node `zlib` — built in |
| `.pdf`, `/DCTDecode` | the stream **is** a JPEG; write the bytes out | none |
| `.pdf`, `/FlateDecode` | `zlib.inflateSync`, then wrap the raw pixels | `sharp` — already a dependency |

All three docx samples yielded a valid JPEG/PNG with the bytes untouched, so no
re-encoding and no quality loss. The DCTDecode PDF yielded a valid JPEG verbatim. The
FlateDecode one inflated to exactly 3.00 bytes/px of clean RGB and
`sharp(raw, {raw: {width, height, channels: 3}}).jpeg()` produced a legible 64KB
scorecard — checked by looking at it.

**Ghostscript is not needed, and that matters.** ImageMagick is already in the image
(`Dockerfile`: `apk add fontconfig ttf-liberation ffmpeg imagemagick`), so
`convert card.pdf out.jpg` looks like the obvious answer — but ImageMagick delegates PDF
rasterisation to Ghostscript, which Alpine's `imagemagick` package does not pull in. That
route means adding `ghostscript` to the image. Extraction avoids it entirely, and for a
corpus of single-image, zero-font pages it is also the more faithful result: verbatim
bytes rather than a re-render.

## Why this changes the decision, not just the plumbing

The immediate reaction to the 4 Sep incident was to **stop captains using document
formats**. That is a reasonable call — Word and PDF are genuinely annoying to open, they
do not preview natively in a browser, and the OCR reader cannot use them.

But it asks volunteers to change a habit, and habits held by 7% of an archive do not
change on request. If the conversion is a zip read and an inflate, the site can simply
**accept what a captain sends and store an image**, and nobody has to be told anything.
Two further consequences, both free once the image exists:

- **The photo would preview in a browser** — the actual complaint about these files.
- **The OCR reader could read them.** Today a `.docx` is refused outright; converted on
  receipt it becomes an ordinary photo and the auto-prefill works. That turns the format
  from an obstacle into a non-event.

## What to do

1. **Decide where it runs.** `/sign-s3` hands out a presigned PUT and never sees the
   bytes, so conversion cannot live there — it needs either a real upload endpoint that
   receives the file, or a post-upload step triggered after the PUT. That is the main
   design question and it is not small: the presigned-PUT design exists so the app never
   proxies large uploads.
2. **Then the extraction**, which is the easy half, and the guard rails below.
3. **Consider backfilling the 141**, once the code exists and has run on live traffic for
   a while. Not first: a backfill that mangles a scorecard nobody can re-upload is worse
   than a `.docx` that at least downloads.

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
