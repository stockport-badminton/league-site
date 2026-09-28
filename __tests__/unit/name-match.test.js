// utils/nameMatch.js — what "is this person already registered?" means. Each case is a
// name that was hard to find with the old `ILIKE '%term%'`, or a stranger the looser
// rules tried along the way would have offered instead.
const { matchName, rankByName, normalise } = require('../../utils/nameMatch');

const kind = (q, name) => (matchName(q, name) || {}).kind || null;

describe('matchName', () => {
  it('finds a one-letter typo in the stored name (the case that started this)', () => {
    expect(kind('Mary Whitle', 'Marry Whitle')).toBe('close');
  });

  it('ignores word order', () => {
    expect(kind('Whitle Mary', 'Marry Whitle')).toBe('close');
  });

  it('still finds a literal fragment, as the old search did', () => {
    expect(kind('rry Whi', 'Marry Whitle')).toBe('contains');
    expect(kind('Whitle', 'Marry Whitle')).toBe('contains');
  });

  it('matches a prefix of each word, for someone still typing', () => {
    expect(kind('Mar Whit', 'Marry Whitle')).toBe('close');
  });

  it('knows common nicknames', () => {
    expect(kind('Andrew Bates', 'Andy Bates')).toBe('close');
    expect(kind('Mike Hayes', 'Michael Hayes')).toBe('close');
    expect(kind('Kathryn Melling', 'Kat Melling')).toBe('close');
  });

  it('ignores case, accents, apostrophes and hyphens', () => {
    expect(kind('zoe', 'Zoë Siu')).toBe('contains');
    expect(kind('OBrien', "Sean O'Brien")).toBe('contains');
    expect(kind('Prem Chandar Anandan', 'Prem Chandar-Anandan')).toBe('exact');
  });

  it('matches words split differently', () => {
    expect(kind('Dave McDonald', 'Dave Mc Donald')).toBe('close');
  });

  it('gives short words no slack', () => {
    // One edit is the whole of a three-letter word.
    expect(kind('Tom Long', 'Tim Long')).toBe(null);
    expect(kind('Sam Roe', 'Sam Ray')).toBe(null);
  });

  it('does not let the whole name\'s slack stand in for one word\'s', () => {
    // Two edits over "tomlong"/"tomtang" is small; two edits in a four-letter word is not.
    expect(kind('Tom Long', 'Tom Tang')).toBe(null);
  });

  it('requires every typed word to match a different stored word', () => {
    expect(kind('Bates Bates', 'Andy Bates')).toBe(null);
    expect(kind('Andy Bates Smith', 'Andy Bates')).toBe(null);
  });

  // Tuned against the live table: two edits from five letters paired these strangers.
  it.each([
    ['Ryan Fox', 'Brian Fox'],
    ['Rob Wilson', 'Rob Timson'],
    ['Alex Mason', 'Alex Watson'],
  ])('does not pair %s with %s', (a, b) => {
    expect(kind(a, b)).toBe(null);
  });

  it('matches nothing to an empty query', () => {
    expect(matchName('', 'Andy Bates')).toBe(null);
    expect(matchName('  ', 'Andy Bates')).toBe(null);
  });
});

describe('rankByName', () => {
  const rows = [
    { id: 1, name: 'Graham White' },
    { id: 2, name: 'Marry Whitle' },
    { id: 3, name: 'Sylvia Ellis-Jones' },
    { id: 4, name: 'John Cave' },
  ];

  it('puts literal matches above close ones', () => {
    expect(rankByName(rows, 'Whitle', r => r.name).map(r => r.id)).toEqual([2, 1]);
  });

  it('puts a match at the start of a word above one inside it', () => {
    expect(rankByName(rows, 'jo', r => r.name).map(r => r.id)).toEqual([3, 4]);
    expect(rankByName(rows, 'ohn', r => r.name).map(r => r.id)).toEqual([4]);
  });

  it('keeps the caller\'s order among equals and applies the limit after ranking', () => {
    const many = [{ id: 1, name: 'Ann Smyth' }, { id: 2, name: 'Bo Smith' }, { id: 3, name: 'Cy Smith' }];
    expect(rankByName(many, 'smith', r => r.name, 2).map(r => r.id)).toEqual([2, 3]);
  });

  it('labels each row with how it matched, without changing the row', () => {
    const [top] = rankByName(rows, 'Mary Whitle', r => r.name);
    expect(top).toEqual({ id: 2, name: 'Marry Whitle', match: 'close' });
    expect(rows[1]).not.toHaveProperty('match');
  });
});

describe('normalise', () => {
  it('collapses the stray whitespace a third of stored names carry', () => {
    expect(normalise('  Chris   Petty ')).toBe('chris petty');
  });
});
