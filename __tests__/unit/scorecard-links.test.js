// Draft confirmation links and scorecard photo URLs.
//
// Both halves of HARD-03 live in utils/scorecardLinks.js: the token that stops
// /populated-scorecard-beta/:id being walked by counting, and the check that stops
// an arbitrary URL reaching an outbound email from our own verified domain.

const {
  newDraftToken,
  tokenMatches,
  draftRequiresToken,
  confirmationPath,
  confirmationUrl,
  normalisePhotoUrl,
  isPhotoUrl,
} = require('../../utils/scorecardLinks');
const { escapeHtml } = require('../../utils/html');

const BUCKET = 'badmintontemp';

beforeEach(() => {
  process.env.S3_BUCKET_NAME = BUCKET;
  delete process.env.SITE_ORIGIN;
});

describe('newDraftToken', () => {
  it('is long enough not to be guessed', () => {
    expect(newDraftToken().length).toBeGreaterThanOrEqual(32);
  });

  it('is URL-safe, so it survives being pasted out of an email', () => {
    for (let i = 0; i < 50; i++) {
      expect(newDraftToken()).toMatch(/^[A-Za-z0-9_-]+$/);
    }
  });

  it('does not repeat', () => {
    const seen = new Set();
    for (let i = 0; i < 500; i++) seen.add(newDraftToken());
    expect(seen.size).toBe(500);
  });
});

describe('tokenMatches', () => {
  it('accepts the token it was given', () => {
    const t = newDraftToken();
    expect(tokenMatches(t, t)).toBe(true);
  });

  it('rejects a different token of the same length', () => {
    const t = newDraftToken();
    const other = newDraftToken();
    expect(tokenMatches(t, other)).toBe(false);
  });

  it('rejects a prefix of the real token', () => {
    const t = newDraftToken();
    expect(tokenMatches(t, t.slice(0, 8))).toBe(false);
  });

  it('rejects nothing at all', () => {
    const t = newDraftToken();
    expect(tokenMatches(t, '')).toBe(false);
    expect(tokenMatches(t, undefined)).toBe(false);
    expect(tokenMatches(t, null)).toBe(false);
    expect(tokenMatches(t, ['a', 'b'])).toBe(false);
  });
});

describe('draftRequiresToken', () => {
  // The grandfather clause. A draft filed before the column existed has no token and
  // its link is already in a captain's inbox; those must keep working.
  it('is false for a draft that has no token stored', () => {
    expect(draftRequiresToken(null)).toBe(false);
    expect(draftRequiresToken(undefined)).toBe(false);
    expect(draftRequiresToken('')).toBe(false);
    expect(draftRequiresToken('   ')).toBe(false);
  });

  it('is true as soon as a token is stored', () => {
    expect(draftRequiresToken(newDraftToken())).toBe(true);
  });
});

describe('confirmationUrl', () => {
  it('uses the public origin, not a request host', () => {
    expect(confirmationUrl(42, 'abc')).toBe(
      'https://stockport-badminton.co.uk/populated-scorecard-beta/42?t=abc');
  });

  it('follows SITE_ORIGIN so a staging deploy does not claim to be production', () => {
    process.env.SITE_ORIGIN = 'https://staging.example.com';
    expect(confirmationUrl(42, 'abc')).toBe(
      'https://staging.example.com/populated-scorecard-beta/42?t=abc');
  });

  it('percent-encodes the token rather than pasting it into the query raw', () => {
    expect(confirmationPath(7, 'a b&c')).toBe('/populated-scorecard-beta/7?t=a%20b%26c');
  });

  it('omits the query entirely for a draft with no token', () => {
    expect(confirmationPath(7, null)).toBe('/populated-scorecard-beta/7');
  });
});

describe('normalisePhotoUrl', () => {
  const good = [
    `https://${BUCKET}.s3.eu-west-1.amazonaws.com/scorecards/20262027/abc.jpg`,
    // The spelling 989 of the stored URLs actually use.
    `https://${BUCKET}.s3-eu-west-1.amazonaws.com/Mellor-A-Canute-A.jpeg`,
    `https://${BUCKET}.s3.amazonaws.com/whatever.png`,
    // Path style.
    `https://s3.eu-west-1.amazonaws.com/${BUCKET}/scorecards/20262027/abc.jpg`,
  ];

  good.forEach(url => {
    it(`accepts ${url}`, () => {
      expect(normalisePhotoUrl(url)).toBe(url);
      expect(isPhotoUrl(url)).toBe(true);
    });
  });

  it('drops a presigned query string, so a temporary signature is not stored as if permanent', () => {
    const signed = `https://${BUCKET}.s3.eu-west-1.amazonaws.com/scorecards/a.jpg?X-Amz-Signature=deadbeef`;
    expect(normalisePhotoUrl(signed))
      .toBe(`https://${BUCKET}.s3.eu-west-1.amazonaws.com/scorecards/a.jpg`);
  });

  const bad = {
    'another domain entirely': 'https://evil.example.com/scorecard.jpg',
    'a lookalike host that merely starts with the bucket':
      `https://${BUCKET}.s3.eu-west-1.amazonaws.com.evil.example.com/a.jpg`,
    'a different bucket': 'https://someone-elses-bucket.s3.eu-west-1.amazonaws.com/a.jpg',
    'path style naming a different bucket': `https://s3.eu-west-1.amazonaws.com/other/${BUCKET}.jpg`,
    'plain http': `http://${BUCKET}.s3.eu-west-1.amazonaws.com/a.jpg`,
    'a javascript: URL': 'javascript:alert(1)',
    'a data: URL': 'data:text/html,<script>alert(1)</script>',
    'credentials smuggling the real host into the userinfo':
      `https://${BUCKET}.s3.eu-west-1.amazonaws.com@evil.example.com/a.jpg`,
    'the bucket root with no key': `https://${BUCKET}.s3.eu-west-1.amazonaws.com/`,
    'not a URL at all': 'scorecard.jpg',
    'nothing': '',
    'an object': {},
    // The payload the package names: closing the href and writing the rest of the email.
    'HTML metacharacters':
      `https://${BUCKET}.s3.eu-west-1.amazonaws.com/a.jpg"><a href="https://evil.example.com">Confirm`,
  };

  Object.entries(bad).forEach(([label, value]) => {
    it(`rejects ${label}`, () => {
      expect(() => normalisePhotoUrl(value)).toThrow();
      expect(isPhotoUrl(value)).toBe(false);
    });
  });

  it('throws a 400-shaped error, not a 500', () => {
    let err;
    try { normalisePhotoUrl('https://evil.example.com/a.jpg'); } catch (e) { err = e; }
    expect(err.status).toBe(400);
  });

  it('fails closed when no bucket is configured', () => {
    delete process.env.S3_BUCKET_NAME;
    expect(() => normalisePhotoUrl(good[0])).toThrow();
  });
});

describe('escapeHtml', () => {
  it('neutralises everything that could end an attribute or open a tag', () => {
    expect(escapeHtml(`"><script>alert('x')&</script>`))
      .toBe('&quot;&gt;&lt;script&gt;alert(&#39;x&#39;)&amp;&lt;/script&gt;');
  });

  it('renders null and undefined as nothing rather than the words', () => {
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
  });
});
