# HARD-30 — `/CCITTFaxDecode` scorecards: the office-scanner case

**Severity:** low · **Wave:** B · **Blocked by:** nothing
**Owns:** `utils/documentImage.js`, possibly `package.json`
**Source:** split out of HARD-25 on 12 Sep 2026. HARD-25 called it "genuinely optional"
and it is — this package exists so the decision is recorded rather than forgotten.

## The honest framing

**13% of PDFs, which is 13% of 7% of the archive: about three scorecards a season.**

It is the only case in HARD-25's analysis with **no tool to hand**. `sharp` does not decode
CCITT, and the one thing in the image that could — ImageMagick — delegates PDF work to
Ghostscript, which is not installed. HARD-25 made a point of *not* needing Ghostscript, and
that is worth keeping.

## The two ways in

1. **A CCITT decoder dependency.** Straightforward, and the cost is a new dependency on the
   production image for three scorecards a season. Weigh it honestly.
2. **Rewrap the stream as a TIFF.** CCITT Group 3/4 is a TIFF compression scheme, so the
   bytes can be given a TIFF header and handed to something that already reads TIFF. No new
   dependency, more code, and the header fields have to be right.

## What "done" could legitimately mean

**Deciding not to build it is a valid outcome**, and better than leaving the question open
for another year. For these three cards a season the current behaviour — store the PDF,
skip OCR, tell the captain plainly — is already a reasonable answer, and HARD-25 says so.

If that is the decision, record it here and move this to `done/`. What is not acceptable is
the state this package was created to escape: an optional phase buried in a finished
package, where nobody sees it again.

## A real specimen, and the rewrap spiked — 21 Sep 2026

The first CCITT card to come through since HARD-36 started keeping failed uploads:

```
scorecards/failed-analysis/20262027/41764fbc-…-aerospace-v-shell-c.pdf
%PDF-1.7  2 pages  /Image 1  /CCITTFaxDecode  K=-1 (G4)  2316x3292  BlackIs1 false
37,800 bytes of CCITT stream in a 39,109-byte file
```

Aerospace A v Shell C, 15 Sep. The captain tried twice ten seconds apart with a
byte-identical file, gave up, and the result was filed by hand and chased by email over
the following week. **That is the real cost of declining this**, and it is worth weighing
against "three scorecards a season": each one is a captain who cannot file a result.

**Option 2 — rewrap as TIFF — was spiked against that file and works.** CCITT G3/G4 is a
TIFF compression scheme, `sharp` reaches `libtiff`, and `libtiff` decodes it. The CCITT
bytes are copied out of the PDF stream **untouched** and given a minimal little-endian TIFF
header; `sharp` then read it at 2316x3292 and produced a legible JPEG of the scorecard,
checked by eye. About 50 lines, **no new dependency, and no Ghostscript** — which is what
HARD-25 was careful to preserve.

The header fields this package worried about turned out to be a dozen IFD entries and
correct first attempt. What remains before it is production code:

- **G3 as well as G4.** The spike maps `K < 0` to compression 4 and otherwise 3, which is
  right in principle and untested — every specimen so far is G4.
- **Multi-strip images.** The spike assumes one strip (`RowsPerStrip = Height`), true here
  and not guaranteed.
- `BlackIs1` drives `PhotometricInterpretation`; false means 0 = white, which this file is.
- Tests. **Do NOT commit this PDF as the fixture**, however tempting while it sits under a
  14-day expiry. It is a filled card carrying twelve players' names and both captains'
  signatures, and this repository is public — which is the exact mistake
  `__tests__/fixtures/make-document-fixtures.js` records having already been made and
  reversed once. Generate a CCITT fixture there instead, the way the DCT and docx ones are
  generated: the file needs to carry one structural shape (`/CCITTFaxDecode`, K=-1, single
  strip), and a real card carries that shape incidentally while also carrying six people's
  handwriting.
  The structural facts above are the specimen's whole contribution, and they are written
  down here precisely so the file itself does not have to be kept.

## Built, 21 Sep 2026 — option 2, the TIFF rewrap

`utils/documentImage.js` handles `/CCITTFaxDecode`. **No new dependency and no
Ghostscript**, which is the rule HARD-25 established and this had to keep: the CCITT bytes
are copied out of the PDF stream untouched, given a minimal TIFF header, and handed to
`sharp` — which reaches `libtiff`, which decodes CCITT. The header this package worried
about is a dozen IFD entries and was right first attempt.

Verified both ways: the generated fixture round-trips through the real code path, and the
real specimen extracts at 2316x3292 into a legible scorecard.

**A second blocker had to go with it, and it was the more interesting one.** `fromPdf`
refused any multi-page PDF outright — *"2 or 4 pages; picking one is a guess"* — and the
specimen is two pages, so CCITT support alone would not have read it. That reasoning does
not survive the check above it: the image count must already be exactly 1 to get that far,
so there is nothing to pick. What the rule was really protecting against is a **typed
document with a logo** — one image, several pages, and the image is not the scorecard —
and that has a signature of its own. Every document scorecard on record has **zero fonts**,
being a photograph with a wrapper. So multi-page is allowed only when there is no text.

That rule alone was costing results: the specimen's captain tried twice, gave up, filed by
hand, and the result was chased by email for a week.

**`extractEmbeddedImage` is now async.** Decoding a compressed format needs a decoder, and
sharp has no synchronous API. One caller (`convertDocument`, already async) and the tests.
Note the `await` on `fromPdf` inside its `try` — an un-awaited promise escapes the block,
so a rejection would propagate instead of becoming the `null` every other failure returns.

**Declined, deliberately: K > 0.** Group 3 two-dimensional needs `T4Options` bit 0 set and
has never appeared in the corpus. It returns null rather than emitting a header that is
probably wrong, because a silently mis-decoded scorecard is worse than one we admit we
cannot read. `K < 0` (G4) and `K = 0` (G3 1D) are handled; every specimen so far is G4.
Single-strip is assumed — true of every specimen, and a multi-strip image would decode
wrong rather than fail, which is worth knowing.

## Acceptance criteria — met

- A CCITT scorecard PDF is stored as a readable image, **checked by eye**, with the
  approach and its cost written down: option 2, ~60 lines, no new dependency.

## Out of scope

- `/FlateDecode` — HARD-29.
- Installing Ghostscript. HARD-25 established the whole approach works without it.
