const { buildUploadKey, sanitiseHint, seasonSegment, PREFIX } = require('../../utils/uploads');

// Key and content-type rules for /sign-s3.
//
// The endpoint took both the object key and the content type from the query string and
// returned a presigned PUT with public-read. Any anonymous caller could overwrite any
// object in the bucket by naming it — the venues map and the generated weekly videos
// live there too — or have the bucket serve HTML from our own storage by choosing the
// type. Neither is reachable now, and these are the tests that say so.

describe('buildUploadKey', () => {
  it('puts every upload under the scorecards prefix', () => {
    const { key } = buildUploadKey('image/jpeg', 'anything at all');
    expect(key.startsWith(`${PREFIX}/`)).toBe(true);
  });

  // The attack that mattered: ask for an existing key and overwrite it.
  it('cannot be aimed at an existing object', () => {
    const targets = [
      'static/generated/venues-map.png',
      'social/weekly-video-16_9.mp4',
      '../../static/generated/venues-map.png',
      '/etc/passwd'
    ];
    for (const target of targets) {
      const { key } = buildUploadKey('image/png', target);
      // The only thing that matters is that the key is not the one asked for. The
      // target's words may well survive inside the sanitised hint —
      // "scorecards/20262027/<uuid>-static-generated-venues-map.png" is a harmless
      // filename, not the venues map — so assert on the key, not on its substrings.
      expect(key).not.toBe(target);
      expect(key.startsWith(`${PREFIX}/`)).toBe(true);
      expect(key).not.toContain('..');
      // Exactly scorecards/<season>/<name> — no extra path segments smuggled in.
      expect(key.split('/')).toHaveLength(3);
    }
  });

  it('never lets the client choose the whole name', () => {
    const a = buildUploadKey('image/jpeg', 'same-name').key;
    const b = buildUploadKey('image/jpeg', 'same-name').key;
    // Two requests for the identical name produce different keys, so one upload can
    // never clobber another — accidentally or otherwise.
    expect(a).not.toBe(b);
  });

  // The extension comes from the content type, not the filename, so a .jpg claiming to
  // be text/html is refused rather than quietly renamed.
  it('takes the extension from the content type', () => {
    expect(buildUploadKey('image/png', 'card.jpg').key).toMatch(/\.png$/);
    expect(buildUploadKey('image/jpeg', 'card.png').key).toMatch(/\.jpg$/);
    expect(buildUploadKey('image/webp', 'card').key).toMatch(/\.webp$/);
  });

  it('refuses anything that is not an image we recognise', () => {
    const bad = ['text/html', 'application/javascript', 'application/x-sh',
                 'image/svg+xml', '', undefined, 'IMAGE/HTML'];
    for (const type of bad) {
      expect(() => buildUploadKey(type, 'card')).toThrow(/not accepted/i);
    }
  });

  it('gives the refusal a 400 rather than letting it read as a server fault', () => {
    try {
      buildUploadKey('text/html', 'card');
      throw new Error('should have thrown');
    } catch (err) {
      expect(err.status).toBe(400);
    }
  });

  it('accepts the types a phone camera actually produces', () => {
    for (const type of ['image/jpeg', 'image/jpg', 'image/png', 'image/webp',
                        'image/heic', 'image/heif', 'IMAGE/JPEG', ' image/png ']) {
      expect(() => buildUploadKey(type, 'card')).not.toThrow();
    }
  });

  it('files by season so the bucket stays browsable', () => {
    // August is the rollover the rest of the site uses.
    expect(buildUploadKey('image/jpeg', 'x', new Date('2026-09-15')).key)
      .toContain('/20262027/');
    expect(buildUploadKey('image/jpeg', 'x', new Date('2027-03-15')).key)
      .toContain('/20262027/');
  });
});

describe('sanitiseHint', () => {
  // The hint is the only part of the key a caller still influences, so it gets reduced
  // to letters, digits and single dashes — no dots (no second extension), no slashes
  // (no traversal), and capped so it cannot push the key past S3's limit.
  it('keeps a readable trace of the match', () => {
    expect(sanitiseHint('20262027-Shell A-Mellor A.jpg')).toBe('20262027-shell-a-mellor-a');
  });

  it('strips anything structural', () => {
    expect(sanitiseHint('../../etc/passwd')).not.toContain('..');
    expect(sanitiseHint('../../etc/passwd')).not.toContain('/');
    expect(sanitiseHint('a.b.c.html')).not.toContain('.');
    expect(sanitiseHint('%2e%2e%2fetc')).not.toContain('/');
  });

  it('caps the length', () => {
    expect(sanitiseHint('x'.repeat(500)).length).toBeLessThanOrEqual(60);
  });

  it('copes with junk', () => {
    expect(sanitiseHint(undefined)).toBe('');
    expect(sanitiseHint(null)).toBe('');
    expect(sanitiseHint(12345)).toBe('');
    expect(sanitiseHint('!!!')).toBe('');
  });
});

describe('seasonSegment', () => {
  it('rolls over in August', () => {
    expect(seasonSegment(new Date('2026-07-31'))).toBe('20252026');
    expect(seasonSegment(new Date('2026-08-01'))).toBe('20262027');
  });
});
