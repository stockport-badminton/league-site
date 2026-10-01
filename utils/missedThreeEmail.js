// The notice sent to a club when one of its nominated players has missed three
// consecutive matches (/missed-three). Sent through mailer.send on the
// `missed-three` template, after the results secretary has previewed it.
//
// Everything here comes from the server — the row from getMissedThreePlayers, the
// recipients from Club.getOfficerEmails — and nothing from the request, because the
// send is a POST and a POST body is whatever the caller chose to write.

const mailer = require('./mailer');

// The rule the notice cites: Stockport's 19(b), "If a player misses 3 consecutive
// matches..." (views/rules.ejs). Not 18, which is Tameside's numbering. One place, so
// it changes once if the rules are renumbered.
const RULE = '19b';

function pronouns(gender) {
  return gender === 'Female'
    ? { pronoun: 'she', possessive: 'her' }
    : { pronoun: 'he', possessive: 'his' };
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

// row: a getMissedThreePlayers row. officers: that club's getOfficerEmails rows.
// Returns the mailer.send arguments, so the preview and the send cannot disagree.
function buildMissedThreeNotice(row, officers, senderDisplayName) {
  const firstName = clean(row.first_name);
  const playerName = clean(`${row.first_name || ''} ${row.family_name || ''}`);
  const teamName = clean(row.team_name);
  const nextTeamName = clean(row.next_team_name);
  const clubName = clean((officers[0] && officers[0].clubName) || '');
  const { pronoun, possessive } = pronouns(row.gender);
  const senderName = signOffName(senderDisplayName);

  const to = [...new Set(officers.map(o => clean(o.email)).filter(Boolean))];
  const subject = `${playerName}, ${teamName}`;
  const text = [
    'Hi,',
    '',
    `Noticed that ${firstName} has missed 3 consecutive games for the ${teamName} team now.`,
    '',
    `In order to remain a nominated player ${pronoun} should play the next match, ` +
      `or a member of the ${nextTeamName} team needs to be nominated in ${possessive} place ` +
      `to remain in line with rule ${RULE}.`,
    '',
    'Thanks',
    ...(senderName ? ['', senderName] : []),
  ].join('\n');

  return {
    template: 'missed-three',
    to,
    // A filed copy, and replies to the mailbox the results secretary reads — the same
    // arrangement as the registration chase.
    bcc: [mailer.RESULTS_MAILBOX],
    replyTo: mailer.RESULTS_MAILBOX,
    subject,
    text,
    whyReceiving:
      `You are listed as a secretary for ${clubName || 'your club'} in the Stockport & ` +
      `District Badminton League.`,
    data: { playerName, firstName, teamName, nextTeamName, pronoun, possessive, rule: RULE, senderName },
    recipients: officers.filter(o => clean(o.email)).map(o => ({ name: clean(o.name), email: clean(o.email) })),
  };
}

module.exports = { buildMissedThreeNotice, RULE };
