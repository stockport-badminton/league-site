// The missed-three notice: the mailer.send arguments, which the preview and the send
// both use, so neither can say something the other does not.
const path = require('path');
const ejs = require('ejs');
const { buildMissedThreeNotice } = require('../../utils/missedThreeEmail');
const mailer = require('../../utils/mailer');

const row = (over = {}) => ({
  club: 43, first_name: 'Olivia', family_name: 'Frankland', gender: 'Female',
  team_name: 'Alderley Park A', next_team_name: 'Alderley Park B', ...over,
});
const OFFICERS = [
  { clubId: 43, clubName: 'Alderley Park', name: 'Club Sec', email: 'clubsec@example.com' },
  { clubId: 43, clubName: 'Alderley Park', name: 'Match Sec', email: ' matchsec@example.com' },
  { clubId: 43, clubName: 'Alderley Park', name: 'Both Roles', email: 'clubsec@example.com' },
];

it('writes the subject as "full name, team"', () => {
  expect(buildMissedThreeNotice(row(), OFFICERS, 'Neil Cooper').subject)
    .toBe('Olivia Frankland, Alderley Park A');
});

it('writes the text with the team below, the pronouns and rule 19b', () => {
  expect(buildMissedThreeNotice(row(), OFFICERS, 'Neil Cooper').text).toBe([
    'Hi,',
    '',
    'Noticed that Olivia has missed 3 consecutive games for the Alderley Park A team now.',
    '',
    'In order to remain a nominated player she should play the next match, or a member of ' +
      'the Alderley Park B team needs to be nominated in her place to remain in line with rule 19b.',
    '',
    'Thanks',
    '',
    'Neil',
  ].join('\n'));
});

it('uses he/his for a male player', () => {
  const { text, data } = buildMissedThreeNotice(row({ first_name: 'Dave', gender: 'Male' }), OFFICERS, 'Neil');
  expect(text).toContain('nominated player he should play');
  expect(text).toContain('nominated in his place');
  expect(data).toMatchObject({ pronoun: 'he', possessive: 'his' });
});

// 378 player names carry stray spaces (project-player-name-whitespace).
it('tidies stray whitespace in names', () => {
  const { subject } = buildMissedThreeNotice(row({ first_name: 'Neil ', family_name: ' Hutchinson' }), OFFICERS, 'Neil');
  expect(subject).toBe('Neil Hutchinson, Alderley Park A');
});

it('leaves the name off the sign-off when the session only has an email', () => {
  const { text, data } = buildMissedThreeNotice(row(), OFFICERS, 'someone@example.com');
  expect(text.endsWith('Thanks')).toBe(true);
  expect(data.senderName).toBe('');
});

it('writes to every officer once, files a copy and takes replies in the results mailbox', () => {
  const n = buildMissedThreeNotice(row(), OFFICERS, 'Neil');
  expect(n.to).toEqual(['clubsec@example.com', 'matchsec@example.com']);
  expect(n.bcc).toEqual([mailer.RESULTS_MAILBOX]);
  expect(n.replyTo).toBe(mailer.RESULTS_MAILBOX);
  expect(n.whyReceiving).toContain('secretary for Alderley Park');
});

// The compiled template, rendered with the notice's own data: what a club reads.
it('renders the same words in the HTML', async () => {
  const n = buildMissedThreeNotice(row(), OFFICERS, 'Neil Cooper');
  const html = await ejs.renderFile(path.join(__dirname, '..', '..', 'views', 'emails', 'missed-three.ejs'),
    Object.assign({ logoUrl: 'https://example.com/logo.png', whyReceiving: n.whyReceiving }, n.data));
  const words = html.replace(/<!--[\s\S]*?-->/g, '').replace(/<style[\s\S]*?<\/style>/g, '')
    .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  expect(words).toContain('Noticed that Olivia has missed 3 consecutive games for the Alderley Park A team now.');
  expect(words).toContain('a member of the Alderley Park B team needs to be nominated in her place to remain in line with rule 19b.');
  expect(words).toMatch(/Thanks Neil /);
});
