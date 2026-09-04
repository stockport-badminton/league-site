#!/usr/bin/env node
/**
 * Generate the document-scorecard fixtures.
 *
 *   node __tests__/fixtures/make-document-fixtures.js
 *
 * WHY THESE ARE GENERATED RATHER THAN REAL
 *
 * The obvious fixtures are real scorecards from the bucket, and the first version of this
 * used them — until one was rendered and turned out to be a filled card carrying twelve
 * players' names and both captains' signatures. A git repository is forever and possibly
 * public, so that is not a thing to commit.
 *
 * Generating them is not a compromise here, it is better: each file exists to carry ONE
 * structural shape, named after it, and the shapes are exactly the ones that broke the
 * extractor when it was written. A real scorecard carries a shape incidentally and you
 * cannot tell which by looking.
 *
 * `scorecard-pdf-flate.pdf` is NOT generated — it is a real file, kept because it is a
 * BLANK league form with nothing personal on it, and it is the negative case (raw pixel
 * data, which Phase 1 declines).
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const sharp = require('sharp');

const OUT = __dirname;

// Something clearly a fixture, so nobody mistakes one for league data.
async function testImage(format) {
  const svg = Buffer.from(
    '<svg width="600" height="400" xmlns="http://www.w3.org/2000/svg">' +
    '<rect width="600" height="400" fill="#ffffff"/>' +
    '<rect x="20" y="20" width="560" height="360" fill="none" stroke="#002060" stroke-width="3"/>' +
    '<text x="300" y="190" font-family="sans-serif" font-size="34" fill="#002060" ' +
    'text-anchor="middle">TEST FIXTURE</text>' +
    '<text x="300" y="235" font-family="sans-serif" font-size="20" fill="#626b7d" ' +
    'text-anchor="middle">not a real scorecard</text></svg>');
  const img = sharp(svg);
  return format === 'png' ? img.png().toBuffer() : img.jpeg({ quality: 85 }).toBuffer();
}

// --- docx -------------------------------------------------------------------
// Built with the `docx` package, which is already a dependency, so these are real Word
// files with the image at word/media/ exactly as Word itself writes it.
async function writeDocx(name, format) {
  const docx = require('docx');
  const image = await testImage(format);
  const doc = new docx.Document({
    sections: [{
      children: [new docx.Paragraph({
        children: [new docx.ImageRun({
          data: image,
          transformation: { width: 600, height: 400 },
          type: format === 'png' ? 'png' : 'jpg',
        })],
      })],
    }],
  });
  const buf = await docx.Packer.toBuffer(doc);
  fs.writeFileSync(path.join(OUT, name), buf);
  return buf.length;
}

// --- pdf --------------------------------------------------------------------
//
// Hand-built, because the point of each is its dictionary, and no library will emit a
// deliberately awkward one. Minimal but valid: catalog, pages, one page, the image
// XObject, a content stream that draws it.
function buildPdf(imageBytes, { filter, reorderKeys, eol }) {
  const EOL = eol || '\n';
  const objects = [];
  const add = body => { objects.push(body); return objects.length; };

  const catalog = add('<< /Type /Catalog /Pages 2 0 R >>');
  const pages   = add('<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  const page    = add('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 400] ' +
                      '/Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>');

  // The dictionary under test. `reorderKeys` puts /Filter BEFORE /Subtype, which is legal
  // (PDF dictionary keys are unordered) and is what an extractor that scans only after
  // /Subtype silently misses.
  const dictParts = reorderKeys
    ? ['/Filter ' + filter, '/Type /XObject', '/Subtype /Image']
    : ['/Type /XObject', '/Subtype /Image', '/Filter ' + filter];
  const imageDict = '<< ' + dictParts.join(' ') +
    ' /Width 600 /Height 400 /ColorSpace /DeviceRGB /BitsPerComponent 8 ' +
    '/Length ' + imageBytes.length + ' >>';
  const image   = add({ dict: imageDict, stream: imageBytes });
  const content = Buffer.from('q 600 0 0 400 0 0 cm /Im0 Do Q');
  add({ dict: '<< /Length ' + content.length + ' >>', stream: content });

  const chunks = [Buffer.from('%PDF-1.4\n')];
  const offsets = [];
  let pos = chunks[0].length;
  objects.forEach((o, i) => {
    offsets.push(pos);
    const head = Buffer.from((i + 1) + ' 0 obj\n');
    let body;
    if (typeof o === 'string') {
      body = Buffer.concat([Buffer.from(o), Buffer.from('\nendobj\n')]);
    } else {
      body = Buffer.concat([
        Buffer.from(o.dict), Buffer.from(EOL + 'stream' + EOL), o.stream,
        Buffer.from(EOL + 'endstream' + EOL + 'endobj' + EOL),
      ]);
    }
    chunks.push(head, body);
    pos += head.length + body.length;
  });

  let xref = 'xref\n0 ' + (objects.length + 1) + '\n0000000000 65535 f \n';
  offsets.forEach(o => { xref += String(o).padStart(10, '0') + ' 00000 n \n'; });
  xref += 'trailer\n<< /Size ' + (objects.length + 1) + ' /Root 1 0 R >>\nstartxref\n' +
          pos + '\n%%EOF\n';
  chunks.push(Buffer.from(xref));
  return Buffer.concat(chunks);
}

(async () => {
  const sizes = {};
  sizes['scorecard-docx-jpeg.docx'] = await writeDocx('scorecard-docx-jpeg.docx', 'jpeg');
  sizes['scorecard-docx-png.docx']  = await writeDocx('scorecard-docx-png.docx', 'png');

  const jpeg = await testImage('jpeg');

  // The 80% case: the stream IS a jpeg.
  fs.writeFileSync(path.join(OUT, 'scorecard-pdf-dct.pdf'),
    buildPdf(jpeg, { filter: '/DCTDecode' }));

  // Same, with /Filter written before /Subtype. Legal, and the shape that held extraction
  // at 48% until the dictionary was parsed properly rather than scanned forwards.
  fs.writeFileSync(path.join(OUT, 'scorecard-pdf-dct-keys-reordered.pdf'),
    buildPdf(jpeg, { filter: '/DCTDecode', reorderKeys: true }));

  // The 21-file shape: a bare CR after `stream`, and the filter as a one-element array
  // with spaces inside the brackets. PDF-1.3 from an old scanner driver, which writes CR
  // for every line ending in the file. The spec says CRLF or LF; this says otherwise, and
  // there are 21 of it.
  fs.writeFileSync(path.join(OUT, 'scorecard-pdf-dct-bare-cr.pdf'),
    buildPdf(jpeg, { filter: '[ /DCTDecode ]', eol: '\r' }));

  // A jpeg with zlib on top, which Acrobat writes. Bailing on any filter array was right
  // that the raw bytes are not a jpeg, and wrong to give up: one inflate and they are.
  fs.writeFileSync(path.join(OUT, 'scorecard-pdf-flate-over-dct.pdf'),
    buildPdf(zlib.deflateSync(jpeg), { filter: '[/FlateDecode /DCTDecode]' }));

  for (const f of fs.readdirSync(OUT).filter(n => /\.(pdf|docx)$/.test(n)).sort()) {
    console.log('  ' + f.padEnd(40) + Math.round(fs.statSync(path.join(OUT, f)).size / 1024) + 'KB');
  }
})().catch(e => { console.error(e); process.exit(1); });
