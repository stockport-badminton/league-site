// utils/registrationEmail.js — reading a forwarded registration email.
//
// Written by people, not forms, and forwarded, so the writer is inside the body. The
// reading is allowed to be imperfect (every line is shown, editable, beside the email on
// /admin/player-requests), but it must not miss the obvious list, which is the
// copying-and-pasting it replaces.
const { parseRegistrationEmail, genderIn, asName } = require('../../utils/registrationEmail');

const TEAMS = ['Dome A', 'Dome B', 'Shell A', 'Mellor A', 'Parrs Wood A'];
const read = (text, headerFrom) => parseRegistrationEmail({ text, headerFrom: headerFrom || 'Neil <neil@example.com>', teamNames: TEAMS });
const names = r => r.candidates.map(c => c.first + ' ' + c.family);

const GMAIL_FORWARD = [
  '---------- Forwarded message ---------',
  'From: Jane Secretary <jane@example.com>',
  'Date: Sun, 27 Sept 2026 at 19:02',
  'Subject: New players',
  'To: Neil <neil@example.com>',
  '',
  'Hi Neil,',
  '',
  'Could you please register the following for Dome B:',
  '',
  'Mary Whitle (F)',
  'John Smith - M',
  'Priya van der Berg, Female',
  '',
  'Thanks,',
  'Jane Secretary',
].join('\n');

describe('a forwarded list', () => {
  const r = read(GMAIL_FORWARD);

  it('finds who wrote it inside the forward, not the forwarder', () => {
    expect(r.originalFrom).toBe('Jane Secretary <jane@example.com>');
  });

  it('reads every name in the list, and nothing from the greeting or sign-off', () => {
    expect(names(r)).toEqual(['Mary Whitle', 'John Smith', 'Priya van der Berg']);
  });

  it('reads the gender each line gives, however it is written', () => {
    expect(r.candidates.map(c => c.gender)).toEqual(['Female', 'Male', 'Female']);
  });

  it('applies the one team the email names to the whole list', () => {
    expect(r.candidates.map(c => c.team)).toEqual(['Dome B', 'Dome B', 'Dome B']);
  });

  it('keeps the line each name came from, to show beside it', () => {
    expect(r.candidates[0].raw).toBe('Mary Whitle (F)');
  });
});

describe('other shapes', () => {
  it('reads a numbered, tab-separated table', () => {
    const r = read('Please add these to Parrs Wood A\n1. Tom Long\tMale\n2. Aimee Tsang\tFemale\n3) Chris O\'Brien\tM\n\nKind regards\nBob');
    expect(names(r)).toEqual(['Tom Long', 'Aimee Tsang', "Chris O'Brien"]);
    expect(r.candidates.map(c => c.gender)).toEqual(['Male', 'Female', 'Male']);
  });

  it('reads a player writing about themselves, in a sentence', () => {
    const r = read("Hi, I'd like to join the league. My name is Sarah Connor and I play for Shell A. Thanks! Sarah");
    expect(names(r)).toEqual(['Sarah Connor']);
    expect(r.candidates[0].team).toBe('Shell A');
  });

  // Excluding the sender's own name looked like the way to drop a sign-off, and would
  // have dropped exactly the player who writes in to register themselves.
  it('keeps the sender\'s own name when they are the one registering', () => {
    const r = read('Name: Ali Khan\nTeam: Mellor A\nGender: Male\n', '"Ali Khan" <ali@example.com>');
    expect(names(r)).toEqual(['Ali Khan']);
    expect(r.candidates[0]).toMatchObject({ gender: 'Male', team: 'Mellor A' });
  });

  it('attaches "Gender:" lines to the name above them', () => {
    const r = read('Name: Ali Khan\nGender: Male\n\nName: Sam Roe\nGender: Female\n');
    expect(r.candidates.map(c => [c.first, c.gender])).toEqual([['Ali', 'Male'], ['Sam', 'Female']]);
  });

  it('stops at a quoted earlier message', () => {
    const r = read('Jo Bloggs F\n\nOn Tue, 1 Sep 2026, Someone <a@b.com> wrote:\n> Old Person\n');
    expect(names(r)).toEqual(['Jo Bloggs']);
  });

  it('stops at a signature', () => {
    const r = read('Jo Bloggs F\n-- \nBob Jones\nParrs Wood Badminton Club');
    expect(names(r)).toEqual(['Jo Bloggs']);
  });

  it('reads nothing from an email that names nobody', () => {
    expect(read('Hi Neil,\n\nAre we still on for Tuesday?\n\nCheers\nBob').candidates).toEqual([]);
  });

  it('lists each person once', () => {
    expect(names(read('Mary Whitle F\nMary Whitle F\n'))).toEqual(['Mary Whitle']);
  });

  it('leaves the team for the page to ask when the email names two', () => {
    const r = read('Mary Whitle F Dome A\nJo Bloggs F\nAlso for Shell A later\n');
    expect(r.candidates.map(c => c.team)).toEqual(['Dome A', null]);
    expect(r.teams).toEqual(['Dome A', 'Shell A']);
  });
});

it('writes a capitalised surname as a name is written', () => {
  expect(asName('Mary WHITLE')).toEqual({ first: 'Mary', family: 'Whitle' });
  expect(asName("SEAN O'BRIEN-SMITH")).toEqual({ first: 'Sean', family: "O'Brien-Smith" });
});

describe('genderIn', () => {
  it.each([
    ['Mary Whitle (F)', 'Female'],
    ['John Smith - M', 'Male'],
    ['Priya, ladies', 'Female'],
    ['Tom Fox', null],        // the F in Fox is not a gender
    ['Sam Mills', null],
    ["men's and ladies' teams", null],
  ])('%s -> %s', (line, want) => {
    expect(genderIn(line)).toBe(want);
  });
});

describe('asName', () => {
  it.each([
    ['Mary Whitle', true],
    ['Priya van der Berg', true],
    ["Chris O'Brien", true],
    ['Hi Neil', false],
    ['Kind Regards', false],
    ['New Players', false],
    ['Dome B', false],        // a team, not a surname
    ['KIND REGARDS', false],
    ['Mary Whitle F', true],
    ['Tom Long Male', true],
    ['mary whitle', false],
    ['Mary', false],
  ])('%s -> %s', (s, ok) => {
    expect(!!asName(s)).toBe(ok);
  });
});
