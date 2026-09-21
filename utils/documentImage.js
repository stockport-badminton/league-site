// Pull the photo out of a document scorecard.
//
// WHY THIS IS EXTRACTION AND NOT RENDERING
//
// Every document scorecard on record is a picture with a wrapper around it, not a document
// that happens to contain one. Measured over six real files (smallest, median and largest
// of each type): a `.docx` is `word/media/image1.*` and a document.xml with **zero words**;
// a `.pdf` is one page whose only content is one image XObject, with **zero fonts**.
// Somebody pasted a photo into Word, or a scanner said "save as PDF".
//
// So the job is to copy bytes out, not to rasterise a page — which is why it needs no
// Ghostscript, no pdf.js and no new dependency. ImageMagick IS already in the image, and
// `convert card.pdf out.jpg` looks like the obvious answer, but it delegates PDF
// rasterising to Ghostscript, which Alpine's imagemagick package does not pull in.
//
// WHAT THIS DELIBERATELY DOES NOT DO
//
// Measured over ALL 141 document scorecards on record, not a sample — an earlier sample of
// 30 put /DCTDecode at 80% and the achievable rate at ~82%, and neither survived contact
// with the full set. What actually fails, of the 127 PDFs:
//
//   /CCITTFaxDecode        15   office-scanner bitonal — NOT handled, no decoder to hand
//   multi-image page       12   30-89 image strips, one scan sliced up: which one is it?
//   multi-page              5   2 or 4 pages; picking one is a guess, so it declines
//   no image XObject        3   a real typed document, not a photo of a card
//   /FlateDecode            2   raw pixels — NOT handled, needs the inflate cap first
//
// That is 37 of 127. Phase 1 is the verbatim cases only: all 14 .docx and the other 90
// PDFs — **104 of 141, 74%** of the corpus. It allocates nothing beyond what is already
// in memory, so it cannot be made to decompression-bomb. The rest return null and the caller stores the document as it
// arrived — "kept as a PDF, no OCR" is a perfectly good outcome.
//
// Note what is NOT on that list: a codec Phase 1 claims to handle. It was there until the
// bare-CR fix below, at 21 files.
//
// A failed extraction refuses the upload, and it has to: `/sign-s3` accepts jpeg, png,
// webp and heic only (utils/uploads.js), so there is no path that stores a pdf or a docx.
// The ones in the bucket predate that check. So "we could not read it, send a photo" is
// the whole of the fallback — there is nothing to attach it to.

const zlib = require('zlib');
const sharp = require('sharp');
const { zipEntries } = require('./zip');

// A jpeg inside a pdf, inflated, should not exceed this. The upload cap is 25MB, so a
// stream that expands past 30MB is not a scorecard photo.
const MAX_INFLATED_BYTES = 30 * 1024 * 1024;

// Refused outright rather than attempted. A zip was never a supported scorecard — the one
// in the bucket has no row pointing at it, so nothing ever displayed it — and unpacking
// arbitrary archives from an unauthenticated endpoint is a different risk class entirely.
const REFUSED_EXTENSIONS = ['zip', 'rar', '7z', 'gz', 'tar'];

const IMAGE_MAGIC = [
  { bytes: [0xff, 0xd8, 0xff], type: 'image/jpeg', ext: 'jpg' },
  { bytes: [0x89, 0x50, 0x4e, 0x47], type: 'image/png', ext: 'png' },
  { bytes: [0x47, 0x49, 0x46, 0x38], type: 'image/gif', ext: 'gif' },
];

// Trust the bytes, not the name: a .docx can hold image1.png named .jpeg and Word does not
// care. Every consumer downstream does.
function sniff(buffer) {
  for (const m of IMAGE_MAGIC) {
    if (m.bytes.every((b, i) => buffer[i] === b)) return m;
  }
  // RIFF....WEBP
  if (buffer.slice(0, 4).toString('latin1') === 'RIFF' &&
      buffer.slice(8, 12).toString('latin1') === 'WEBP') {
    return { type: 'image/webp', ext: 'webp' };
  }
  return null;
}

const extensionOf = name => String(name || '').split('.').pop().toLowerCase();

function isRefusedArchive(name) {
  return REFUSED_EXTENSIONS.includes(extensionOf(name));
}

// --- docx -------------------------------------------------------------------
// The image comes out verbatim. No re-encode, so no quality loss.
function fromDocx(buffer) {
  // A zip may carry an entry for the directory itself (`word/media/`, zero bytes). Word
  // does not write them but plenty of writers do, and counting one as a second image is
  // what made `media.length !== 1` reject a perfectly good single-photo document.
  const media = zipEntries(buffer)
    .filter(e => /^word\/media\/./i.test(e.name) && !e.name.endsWith('/'));
  if (media.length !== 1) return null;   // not the one-pasted-photo shape
  const data = media[0].read();
  const kind = sniff(data);
  if (!kind) return null;
  return { buffer: data, contentType: kind.type, extension: kind.ext, source: 'docx' };
}

// --- pdf --------------------------------------------------------------------
//
// Only the /DCTDecode case, where the stream between `stream` and `endstream` IS a
// complete JPEG file and can be written out untouched.
//
// This reads the bytes rather than parsing the document, which is enough for the shape
// these files have — one page, one image, no fonts — and is deliberately conservative:
// anything that does not match exactly returns null instead of guessing. A general PDF
// parser is what Phase 2 needs; guessing is what it must not do.
// For each `stream` keyword, the dictionary that introduces it — the text between the
// `<<` that opens it and the `>>` that closes it. Walked BACKWARDS with a depth count,
// because a dict can nest (`/DecodeParms << ... >>`) and the outer one is what describes
// the stream.
//
// This exists because PDF dictionary keys are UNORDERED. An earlier version searched only
// the 600 bytes after `/Subtype /Image` and silently missed every file that happens to put
// `/Filter /DCTDecode` first — four of twenty in the real corpus, which dropped extraction
// from ~70% to 48% for no reason but key order.
function streamDictionaries(s) {
  const out = [];
  // `stream` is followed by CRLF or LF *per the spec*, and by a bare CR in 21 of the 127
  // real files — PDF-1.3 output from some old scanner driver, which writes CR for every
  // line ending in the whole file. `/stream\r?\n/` never matched them, so a one-page
  // one-image /DCTDecode scorecard, the exact case this exists for, extracted nothing.
  // The alternation is ordered so CRLF is consumed whole and `m[0].length` stays right.
  const re = /stream(?:\r\n|\n|\r)/g;
  let m;
  while ((m = re.exec(s)) !== null) {
    // The `>>` closing the dict sits just before `stream`, modulo whitespace.
    let i = m.index - 1;
    while (i > 0 && /\s/.test(s[i])) i--;
    if (s[i - 1] !== '>' || s[i] !== '>') continue;
    // depth starts at 1: the closing `>>` we just matched is already consumed, so the
    // `<<` that balances it is the one to stop on. Starting at 0 made every walk run past
    // its own opening brace to the 20000-byte guard and return nothing.
    let depth = 1;
    let j = i - 1;
    for (; j > 0; j--) {
      if (s[j - 1] === '>' && s[j] === '>') { depth++; j--; continue; }
      if (s[j - 1] === '<' && s[j] === '<') {
        depth--;
        if (depth === 0) break;
        j--;
        continue;
      }
      // A dictionary is not megabytes long; if we have walked that far, the file is not
      // the shape this handles.
      if (i - j > 20000) { j = 0; break; }
    }
    if (j <= 0) continue;
    out.push({ dict: s.slice(j - 1, i + 1), streamStart: m.index + m[0].length });
  }
  return out;
}

// ── /CCITTFaxDecode: the office-scanner case (HARD-30) ──────────────────────
//
// 15 of 127 PDFs in the corpus, "about three scorecards a season" — and each one is a
// captain who cannot file a result. The specimen that prompted this was tried twice, ten
// seconds apart, then abandoned; the result was filed by hand and chased by email for a
// week.
//
// **No new dependency, and still no Ghostscript.** CCITT Group 3/4 is a TIFF compression
// scheme, so the bytes do not need decoding here at all: they are copied out of the PDF
// stream UNTOUCHED, given a minimal TIFF header, and handed to `sharp` — which reaches
// `libtiff`, which decodes CCITT. That is the whole trick, and it is why HARD-25's rule
// that this works without rasterising a page survives intact.
//
// Everything below is a header field that has to be right, so each says where it comes
// from. `/DecodeParms` is where a PDF puts them; `/Width` and `/Height` on the image
// dictionary are the fallback, and `Columns` defaults to 1728 per the PDF spec because
// that is fax paper.
const TIFF_RATIONAL_BYTES = 16;

function ccittTiff(dict, ccitt) {
  const num = re => { const m = dict.match(re); return m ? Number(m[1]) : null; };
  const width = num(/\/Columns\s+(\d+)/) ?? num(/\/Width\s+(\d+)/) ?? 1728;
  const height = num(/\/Rows\s+(\d+)/) ?? num(/\/Height\s+(\d+)/);
  const k = num(/\/K\s+(-?\d+)/) ?? 0;
  if (!height || !width) return null;

  // K < 0 is Group 4, K = 0 is Group 3 one-dimensional. K > 0 is Group 3 TWO-dimensional,
  // which needs T4Options bit 0 set and has never appeared in the corpus — decline rather
  // than emit a header that is probably wrong, because a silently mis-decoded scorecard is
  // worse than one we admit we cannot read.
  if (k > 0) return null;
  const compression = k < 0 ? 4 : 3;

  // BlackIs1 false (the default) means 0 is black — TIFF photometric 0, WhiteIsZero.
  const photometric = /\/BlackIs1\s+true/.test(dict) ? 1 : 0;

  const entries = [
    [256, 3, width], [257, 3, height], [258, 3, 1], [259, 3, compression],
    [262, 3, photometric], [273, 4, 0], [277, 3, 1], [278, 4, height],
    [279, 4, ccitt.length], [282, 5, 0], [283, 5, 0], [296, 3, 2],
  ];
  const ifdOffset = 8;
  const ratOffset = ifdOffset + 2 + entries.length * 12 + 4;
  const dataOffset = ratOffset + TIFF_RATIONAL_BYTES;

  const head = Buffer.alloc(dataOffset);
  head.write('II', 0, 'latin1');
  head.writeUInt16LE(42, 2);
  head.writeUInt32LE(ifdOffset, 4);
  head.writeUInt16LE(entries.length, ifdOffset);
  entries.forEach(([tag, type, value], i) => {
    const o = ifdOffset + 2 + i * 12;
    head.writeUInt16LE(tag, o);
    head.writeUInt16LE(type, o + 2);
    head.writeUInt32LE(1, o + 4);
    // 273 StripOffsets points at the copied bytes; 282/283 are RATIONALs and so are
    // stored out of line, which is what the sixteen bytes after the IFD are for.
    const v = tag === 273 ? dataOffset
            : tag === 282 ? ratOffset
            : tag === 283 ? ratOffset + 8
            : value;
    if (type === 3) head.writeUInt16LE(v, o + 8); else head.writeUInt32LE(v, o + 8);
  });
  head.writeUInt32LE(200, ratOffset); head.writeUInt32LE(1, ratOffset + 4);
  head.writeUInt32LE(200, ratOffset + 8); head.writeUInt32LE(1, ratOffset + 12);

  // One strip, RowsPerStrip = Height. True of every specimen seen; a multi-strip image
  // would need the offsets and byte counts as arrays, and would decode wrong rather than
  // fail, so it is worth knowing this is the assumption.
  return Buffer.concat([head, ccitt]);
}

// Only the /DCTDecode case, where the bytes between `stream` and `endstream` ARE a
// complete JPEG file and can be written out untouched.
//
// Byte-level rather than a real parser, which is enough for the shape these files have —
// one page, one image, no fonts — and deliberately conservative: anything that does not
// match exactly returns null instead of guessing. A general parser is what Phase 2 needs;
// guessing is what it must not do.
async function fromPdf(buffer) {
  const s = buffer.toString('latin1');

  // Not our shape: more than one image. Bail rather than pick — a scan sliced into 30-89
  // strips is 12 of the 127, and choosing one of them is a guess.
  if ((s.match(/\/Subtype\s*\/Image/g) || []).length !== 1) return null;

  // Multi-page WAS also refused outright ("2 or 4 pages; picking one is a guess"), and
  // that reasoning does not survive the check above: with exactly one image there is
  // nothing to pick. The real specimen behind HARD-30 is two pages and one image — a
  // duplex scanner giving you the blank back of the sheet — so refusing it cost a captain
  // their result for a week.
  //
  // The case the old rule was really protecting against is a TYPED document with a logo:
  // one image, several pages, and the image is not the scorecard. That has a signature of
  // its own — fonts. Every document scorecard on record has zero, because it is a
  // photograph with a wrapper. So multi-page is allowed only when there is no text.
  const pages = (s.match(/\/Type\s*\/Page[^s]/g) || []).length;
  const fonts = (s.match(/\/Type\s*\/Font/g) || []).length;
  if (pages > 1 && fonts > 0) return null;

  for (const { dict, streamStart } of streamDictionaries(s)) {
    if (!/\/Subtype\s*\/Image/.test(dict)) continue;

    // Two shapes carry a jpeg. Both end with DCTDecode, because that IS the jpeg.
    //
    //   /Filter/DCTDecode                    the stream is the jpeg
    //   /Filter[/FlateDecode/DCTDecode]      the jpeg, then zlib on top of it
    //
    // The second is common — Acrobat writes it — and an earlier version of this bailed on
    // any filter array, which is why extraction sat at 48% when the codec census said 80%.
    // Bailing was right that the raw bytes are not a jpeg; giving up was not.
    const filter = /\/Filter\s*(\/\w+|\[[^\]]*\])/.exec(dict);
    if (!filter) return null;
    const chain = (filter[1].match(/\/\w+/g) || []);
    const isPlainDct = chain.length === 1 && chain[0] === '/DCTDecode';
    const isFlateOverDct = chain.length === 2 &&
      chain[0] === '/FlateDecode' && chain[1] === '/DCTDecode';
    const isCcitt = chain.length === 1 && chain[0] === '/CCITTFaxDecode';
    if (!isPlainDct && !isFlateOverDct && !isCcitt) return null;

    const end = s.indexOf('endstream', streamStart);
    if (end < 0) return null;
    let data = buffer.slice(streamStart, end);

    // CCITT: rewrap, do not decode here. See ccittTiff above.
    if (isCcitt) {
      const tiff = ccittTiff(dict, data);
      if (!tiff) return null;
      try {
        const jpeg = await sharp(tiff).jpeg({ quality: 90 }).toBuffer();
        return { buffer: jpeg, contentType: 'image/jpeg', extension: 'jpg' };
      } catch (err) {
        // A header we got wrong, or a stream libtiff will not take. Decline rather than
        // store something unreadable — the caller keeps the PDF and says so.
        return null;
      }
    }

    if (isFlateOverDct) {
      try {
        // maxOutputLength IS the bomb guard, and it is why this stays a Phase 1 case: the
        // output is a jpeg, so it is bounded by something sane, unlike raw pixel data
        // which can declare any dimensions it likes.
        data = zlib.inflateSync(data, { maxOutputLength: MAX_INFLATED_BYTES });
      } catch (err) {
        return null;   // truncated, or larger than we are willing to hold
      }
    }

    const kind = sniff(data);
    // It should be a jpeg by now. If it does not sniff as one, something about this file is
    // not what it claims, so leave it alone.
    if (!kind || kind.type !== 'image/jpeg') return null;
    return { buffer: data, contentType: kind.type, extension: kind.ext, source: 'pdf' };
  }
  return null;
}

/**
 * The embedded image, or null when this file is not one of the shapes handled above.
 * Never throws: a malformed document is a null, because the caller's job is to store the
 * original and carry on.
 */
async function extractEmbeddedImage(buffer, filename) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) return null;
  const ext = extensionOf(filename);
  try {
    if (ext === 'docx' || buffer.slice(0, 2).toString('latin1') === 'PK') {
      // A .doc (old binary Word) is not a zip and is not handled.
      if (ext === 'doc') return null;
      return fromDocx(buffer);
    }
    if (ext === 'pdf' || buffer.slice(0, 5).toString('latin1') === '%PDF-') {
      // `await`, not a bare return: an un-awaited promise escapes this try/catch, so a
      // rejection from the CCITT path would propagate to the caller instead of becoming
      // the `null` that every other failure here returns.
      return await fromPdf(buffer);
    }
  } catch (err) {
    return null;
  }
  return null;
}

module.exports = { extractEmbeddedImage, isRefusedArchive, sniff, REFUSED_EXTENSIONS };
