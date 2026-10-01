// The notice sent to a club when one of its nominated players has missed three
// consecutive matches (/missed-three). Built as a mailto: link rather than sent by
// the server: the results secretary reads it over and sends it from their own
// mailbox, so the club's reply comes back to a person rather than to results@.

// The rule the notice cites: Stockport's 19(b), "If a player misses 3 consecutive
// matches..." (views/rules.ejs). Not 18, which is Tameside's numbering. One place, so
// it changes once if the rules are renumbered.
const RULE = '19b';

function pronouns(gender) {
  return gender === 'Female'
    ? { subject: 'she', possessive: 'her' }
    : { subject: 'he', possessive: 'his' };
}

function clean(s) {
  return String(s || '').trim().replace(/\s+/g, ' ');
}

// The sender's first name for the sign-off, or '' when the session only has an
// email address for a display name.
function signOffName(displayName) {
  const name = clean(displayName);
  if (!name || name.includes('@')) return '';
  return name.split(' ')[0];
}

function buildMissedThreeEmail(row, recipients, senderName) {
  const first = clean(row.first_name);
  const fullName = clean(`${row.first_name || ''} ${row.family_name || ''}`);
  const team = clean(row.team_name);
  const nextTeam = clean(row.next_team_name);
  const p = pronouns(row.gender);
  const sender = signOffName(senderName);

  const subject = `${fullName}, ${team}`;
  const body = [
    'Hi,',
    '',
    `Noticed that ${first} has missed 3 consecutive games for the ${team} team now.`,
    '',
    `In order to remain a nominated player ${p.subject} should play the next match, ` +
      `or a member of the ${nextTeam} team needs to be nominated in ${p.possessive} place ` +
      `to remain in line with rule ${RULE}.`,
    '',
    'Thanks',
    ...(sender ? ['', sender] : []),
  ].join('\n');

  const to = [...new Set(recipients.map(clean).filter(Boolean))];
  // encodeURIComponent, not URLSearchParams: the latter writes spaces as '+', which
  // mail clients show literally in a mailto: body.
  const href = `mailto:${to.map(encodeURIComponent).join(',')}` +
    `?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body.replace(/\n/g, '\r\n'))}`;

  return { to, subject, body, href };
}

module.exports = { buildMissedThreeEmail, RULE };
