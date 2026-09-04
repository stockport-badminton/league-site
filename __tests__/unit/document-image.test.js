// Pulling the photo out of a document scorecard.
//
// THE FIXTURES ARE GENERATED — `__tests__/fixtures/make-document-fixtures.js` builds them,
// and that file explains why at length. Briefly: the first version of this test used real
// scorecards from the bucket, until one was rendered and turned out to be a filled card
// carrying twelve players' names and both captains' signatures.
//
// Generated does not mean naive. An earlier extractor passed against hand-made files and
// managed 48% against the real corpus, because PDF dictionary keys are unordered and
// Acrobat writes `/Filter[/FlateDecode/DCTDecode]`. Both of those shapes now have a
// fixture built deliberately to carry them, named after the shape — which is stronger than
// a real card that happens to have one, since you cannot tell which by looking at it.
//
// `scorecard-pdf-flate.pdf` is the exception: a real file, kept because it is a BLANK
// league form with nothing personal on it.

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { extractEmbeddedImage, isRefusedArchive, sniff } = require('../../utils/documentImage');

const fixture = n => fs.readFileSync(path.join(__dirname, '..', 'fixtures', n));

describe('extractEmbeddedImage', () => {
  // A .docx scorecard is word/media/image1.* and an empty document. Bytes come out
  // untouched, so there is no re-encode and no quality loss.
  it.each([
    ['scorecard-docx-jpeg.docx', 'image/jpeg'],
    ['scorecard-docx-png.docx', 'image/png'],
  ])('extracts the pasted photo from %s', async (name, type) => {
    const got = extractEmbeddedImage(fixture(name), name);
    expect(got).not.toBeNull();
    expect(got.contentType).toBe(type);
    expect(got.source).toBe('docx');
    // It must be a real image, not just bytes that survived.
    const meta = await sharp(got.buffer).metadata();
    expect(meta.width).toBe(600);
    expect(meta.height).toBe(400);
  });

  it('extracts a jpeg straight out of a /DCTDecode pdf', async () => {
    const got = extractEmbeddedImage(fixture('scorecard-pdf-dct.pdf'), 'card.pdf');
    expect(got).not.toBeNull();
    expect(got.contentType).toBe('image/jpeg');
    expect(got.source).toBe('pdf');
    const meta = await sharp(got.buffer).metadata();
    expect(meta.width).toBe(600);
  });

  // Bug 1, and the bigger half of 48% -> 65%. A PDF dictionary is unordered, so `/Filter`
  // is allowed to come before `/Subtype /Image`. Scanning forwards from the /Subtype match
  // finds no filter and skips a perfectly good jpeg.
  it('finds the image when /Filter is written before /Subtype', async () => {
    const got = extractEmbeddedImage(fixture('scorecard-pdf-dct-keys-reordered.pdf'), 'card.pdf');
    expect(got).not.toBeNull();
    expect(got.contentType).toBe('image/jpeg');
    const meta = await sharp(got.buffer).metadata();
    expect(meta.width).toBe(600);
  });

  // Bug 3, and the last of the codec failures: `stream` followed by a BARE CR, plus the
  // filter as a one-element array. 21 real files, all of them one page, one image and
  // /DCTDecode — the precise case Phase 1 claims — extracting nothing because the regex
  // that finds a stream insisted on a \n.
  it('handles a bare CR after the stream keyword', async () => {
    const got = extractEmbeddedImage(fixture('scorecard-pdf-dct-bare-cr.pdf'), 'card.pdf');
    expect(got).not.toBeNull();
    expect(got.contentType).toBe('image/jpeg');
    const meta = await sharp(got.buffer).metadata();
    expect(meta.width).toBe(600);
  });

  // Bug 2. Acrobat zlibs the jpeg, so the stream bytes are not a jpeg and bailing on any
  // filter array was half right — one inflate and they are.
  it('inflates a /Filter[/FlateDecode /DCTDecode] chain', async () => {
    const got = extractEmbeddedImage(fixture('scorecard-pdf-flate-over-dct.pdf'), 'card.pdf');
    expect(got).not.toBeNull();
    expect(got.contentType).toBe('image/jpeg');
    const meta = await sharp(got.buffer).metadata();
    expect(meta.width).toBe(600);
  });

  // Phase 1 deliberately does not decode raw pixel data — that needs the inflate cap and
  // predictor handling. It must decline, not guess.
  it('declines a /FlateDecode pdf rather than guessing', () => {
    expect(extractEmbeddedImage(fixture('scorecard-pdf-flate.pdf'), 'card.pdf')).toBeNull();
  });

  it('trusts the bytes over the extension', () => {
    // The image inside is a png regardless of what anything is called.
    const got = extractEmbeddedImage(fixture('scorecard-docx-png.docx'), 'card.docx');
    expect(got.contentType).toBe('image/png');
  });

  it('never throws on rubbish', () => {
    for (const [buf, name] of [
      [Buffer.from('not a document'), 'card.pdf'],
      [Buffer.from('PK truncated'), 'card.docx'],
      [Buffer.alloc(0), 'card.pdf'],
      [Buffer.from('%PDF-1.4 no images here'), 'card.pdf'],
    ]) {
      expect(() => extractEmbeddedImage(buf, name)).not.toThrow();
      expect(extractEmbeddedImage(buf, name)).toBeNull();
    }
  });

  it('does not treat an old binary .doc as a zip', () => {
    // The OLE2 magic that starts a legacy .doc — not PK, and not handled.
    const ole2 = Buffer.from('d0cf11e0a1b11ae1', 'hex');
    expect(extractEmbeddedImage(ole2, 'card.doc')).toBeNull();
  });
});

describe('isRefusedArchive', () => {
  // Never a supported scorecard: the one zip in the bucket has no row pointing at it, so
  // nothing ever displayed it, and unpacking archives from an unauthenticated endpoint is
  // a different risk class.
  it.each([['card.zip'], ['card.ZIP'], ['card.rar'], ['card.tar'], ['card.gz']])
    ('refuses %s', n => expect(isRefusedArchive(n)).toBe(true));

  it.each([['card.pdf'], ['card.docx'], ['card.jpg'], ['card.heic']])
    ('allows %s', n => expect(isRefusedArchive(n)).toBe(false));
});

describe('sniff', () => {
  it.each([
    [[0xff, 0xd8, 0xff], 'image/jpeg'],
    [[0x89, 0x50, 0x4e, 0x47], 'image/png'],
    [[0x47, 0x49, 0x46, 0x38], 'image/gif'],
  ])('recognises %s', (bytes, type) => {
    expect(sniff(Buffer.from(bytes)).type).toBe(type);
  });

  it('returns null for something that is not an image', () => {
    expect(sniff(Buffer.from('%PDF-1.4'))).toBeNull();
  });
});
