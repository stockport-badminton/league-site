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

## Acceptance criteria

Either:

- A CCITT scorecard PDF is stored as a readable image, checked by eye, with whichever
  approach was chosen and its cost written down; or
- A note here saying it was considered and declined, with the reason and the date.

## Out of scope

- `/FlateDecode` — HARD-29.
- Installing Ghostscript. HARD-25 established the whole approach works without it.
