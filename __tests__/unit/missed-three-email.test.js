// The notice /missed-three's button opens in the results secretary's mail client.
const { buildMissedThreeEmail } = require('../../utils/missedThreeEmail');

const row = (over = {}) => ({
  first_name: 'Olivia', family_name: 'Frankland', gender: 'Female',
  team_name: 'Alderley Park A', next_team_name: 'Alderley Park B', ...over,
});

it('writes the subject as "full name, team"', () => {
  expect(buildMissedThreeEmail(row(), ['a@example.com'], 'Neil Cooper').subject)
    .toBe('Olivia Frankland, Alderley Park A');
});

it('writes the body with the team below and the rule number', () => {
  const { body } = buildMissedThreeEmail(row(), ['a@example.com'], 'Neil Cooper');
  expect(body).toBe([
    'Hi,',
    '',
    'Noticed that Olivia has missed 3 consecutive games for the Alderley Park A team now.',
    '',
    'In order to remain a nominated player she should play the next match, or a member of ' +
      `the Alderley Park B team needs to be nominated in her place to remain in line with rule 19b.`,
    '',
    'Thanks',
    '',
    'Neil',
  ].join('\n'));
});

it('uses he/his for a male player', () => {
  const { body } = buildMissedThreeEmail(row({ first_name: 'Dave', gender: 'Male' }), ['a@example.com'], 'Neil');
  expect(body).toContain('nominated player he should play');
  expect(body).toContain('nominated in his place');
});

// 378 player names carry stray spaces (project-player-name-whitespace).
it('tidies stray whitespace in names', () => {
  const { subject } = buildMissedThreeEmail(row({ first_name: 'Neil ', family_name: ' Hutchinson' }), ['a@example.com'], 'Neil');
  expect(subject).toBe('Neil Hutchinson, Alderley Park A');
});

it('leaves the name off the sign-off when the session only has an email', () => {
  const { body } = buildMissedThreeEmail(row(), ['a@example.com'], 'someone@example.com');
  expect(body.endsWith('Thanks')).toBe(true);
});

it('addresses every officer once and encodes the link for a mail client', () => {
  const { to, href } = buildMissedThreeEmail(row(), ['a@example.com', ' b@example.com', 'a@example.com'], 'Neil');
  expect(to).toEqual(['a@example.com', 'b@example.com']);
  expect(href.startsWith('mailto:a%40example.com,b%40example.com?subject=Olivia%20Frankland%2C%20Alderley%20Park%20A&body=')).toBe(true);
  // A '+' for a space shows up literally in a mailto body; line breaks are CRLF.
  expect(href).not.toContain('+');
  expect(decodeURIComponent(href.split('&body=')[1])).toContain('Hi,\r\n\r\nNoticed');
});
