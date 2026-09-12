# HARD-29 — `/FlateDecode` scorecards: the last 3% that `sharp` can already read

**Severity:** low · **Wave:** B · **Blocked by:** nothing
**Owns:** `utils/documentImage.js`
**Source:** split out of HARD-25 on 12 Sep 2026, which built Phase 1 and deliberately
deferred this. Spun into its own package so that "worth doing once Phase 1 has run a
season" survives the twelve months until that is true.

## Why this is separate, and why it is small

HARD-25 established, by measuring the whole archive rather than a sample, that **every
document scorecard is an image inside a wrapper** — so converting one is *extraction*, not
rendering. Phase 1 shipped the verbatim cases and covers **104 of 141 files, 74%**: all 14
`.docx` (zip read) and 90 of 127 PDFs (`/DCTDecode`, where the stream already *is* a JPEG).

This is the `/FlateDecode` slice: **3% of PDFs**, so roughly **one scorecard a season**.
The image is real pixels, deflated. `zlib` and `sharp` are both already dependencies, so
there is nothing to install — but unlike Phase 1 there is arithmetic to get right, and a
resource risk that verbatim extraction simply does not have.

## What it needs that Phase 1 did not

1. **The raw wrap.** After inflating you have pixel bytes, not an image file. `sharp` needs
   to be told `{ raw: { width, height, channels } }`, which means reading `/Width`,
   `/Height`, `/BitsPerComponent` and `/ColorSpace` out of the image dictionary and getting
   the channel count right. HARD-25 measured a clean sample at **3.00 bytes/px**, i.e. RGB;
   do not assume it.
2. **`/DecodeParms` predictors.** PNG predictors are common in PDF Flate streams and change
   how the inflated bytes map to pixels. Ignoring them produces an image that decodes
   without error and looks like static — which is worse than failing.
3. **The inflate cap.** This is the phase that introduces the bomb surface: a small upload
   can inflate to something enormous. Cap the output size and abort past it. HARD-25's
   guard rails say inflating first is how a small upload becomes an OOM, and calls the cap
   "the admission fee for Phase 2".

## What to do

- Extend `utils/documentImage.js`. The extractor already walks the PDF dictionary and
  already handles unordered keys and bare-CR `stream` markers — both were bugs found the
  hard way in Phase 1, so do not rewrite that walk.
- Fall back to today's behaviour on anything it cannot do: store the document, skip OCR,
  and tell the captain plainly. That path exists and works.

## Acceptance criteria

- A `/FlateDecode` scorecard PDF is stored as a readable image, checked **by eye** — a
  predictor mistake produces a valid image file full of noise, so an automated check that
  only asserts "an image came out" would pass.
- An inflate that exceeds the cap is refused without the process dying.
- Coverage measured over the **whole** corpus and reported as a fraction of it, not of a
  sample. HARD-25 reported 65% and 59% before the true 74%, and both wrong figures came
  from measuring the wrong denominator.
- A test per shape, against real files.

## Out of scope

- `/CCITTFaxDecode` — HARD-30.
- Any backfill. Forward-facing only, as with Phase 1.
