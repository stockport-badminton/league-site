// Turning a stored social handle into a profile URL.
//
// Both consumers — the visible links on /clubs/:slug and the schema.org `sameAs` in the
// JSON-LD — used to require the stored value to start `https://`, and drop anything else.
// Defensive, and completely vacuous: all seven clubs that have a handle store a BARE one
// ("ghapbadminton", "ManorBadminton", the Facebook page id "61576463475674"), so the
// section rendered for nobody and `sameAs` never carried a profile. Confirmed against
// production before it was changed: /clubs/ghap and /clubs/manor contained no occurrence
// of their own handles.
//
// sameAs is the half that matters: it is how a search engine ties a club page to that
// club's Facebook and Instagram, on pages that exist to answer "badminton club near me".

const { socialUrl, socialLinksFor } = require('../../utils/socialLinks');

describe('socialUrl', () => {
  // The shapes actually in the database today.
  it.each([
    ['instagram', 'ghapbadminton',              'https://www.instagram.com/ghapbadminton'],
    ['instagram', 'manorbadmintonclubwilmslow', 'https://www.instagram.com/manorbadmintonclubwilmslow'],
    ['facebook',  'CollegeGreenBadmintonClub',  'https://www.facebook.com/CollegeGreenBadmintonClub'],
    // A Facebook page id rather than a name. Both work on that path.
    ['facebook',  '61576463475674',             'https://www.facebook.com/61576463475674'],
    ['twitter',   'stockportbadders',           'https://x.com/stockportbadders'],
  ])('builds a %s url from the bare handle %s', (platform, stored, expected) => {
    expect(socialUrl(platform, stored)).toBe(expected);
  });

  // The likeliest thing an admin types into a free-text box.
  it('tolerates a leading @', () => {
    expect(socialUrl('instagram', '@ghapbadminton')).toBe('https://www.instagram.com/ghapbadminton');
  });

  it('passes a stored URL through untouched, rather than rewriting a working link', () => {
    const url = 'https://www.facebook.com/ShellBadminton';
    expect(socialUrl('facebook', url)).toBe(url);
  });

  it('adds a scheme to a bare www. address', () => {
    expect(socialUrl('facebook', 'www.facebook.com/ShellBadminton'))
      .toBe('https://www.facebook.com/ShellBadminton');
  });

  // The important refusal. Guessing at prose would produce a confident link to a page
  // that does not exist, which is worse than the empty section this replaced.
  it.each([
    ['ask us on instagram'],
    ['see the club website'],
    ['n/a'],
    ['handle with spaces'],
  ])('declines to invent a url from %j', (prose) => {
    expect(socialUrl('instagram', prose)).toBeNull();
  });

  it.each([[''], ['   '], [null], [undefined]])('returns null for %j', (empty) => {
    expect(socialUrl('instagram', empty)).toBeNull();
  });

  it('returns null for a platform it does not know', () => {
    expect(socialUrl('myspace', 'someclub')).toBeNull();
  });
});

describe('socialLinksFor', () => {
  it('returns only the platforms a club actually has, in a fixed order', () => {
    const links = socialLinksFor({ facebook: 'ghapbadminton', instagram: 'ghapbadminton', twitter: null });
    expect(links.map(l => l.platform)).toEqual(['facebook', 'instagram']);
    expect(links.map(l => l.url)).toEqual([
      'https://www.facebook.com/ghapbadminton',
      'https://www.instagram.com/ghapbadminton',
    ]);
  });

  it('is empty for a club with nothing stored, so the section can be hidden', () => {
    expect(socialLinksFor({ facebook: null, instagram: '', twitter: undefined })).toEqual([]);
    expect(socialLinksFor(null)).toEqual([]);
  });

  it('carries a label for each link', () => {
    expect(socialLinksFor({ instagram: 'x' })[0].label).toBe('Instagram');
  });
});
