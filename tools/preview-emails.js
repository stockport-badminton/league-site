#!/usr/bin/env node
/**
 * Render the compiled email templates with sample data, for looking at.
 *
 *   node tools/preview-emails.js [outDir]     # default: /tmp/email-preview
 *
 * A preview is not proof: it renders in a browser, and an email renders in Outlook,
 * which lays out through Word. It is enough to check hierarchy, spacing and colour
 * before sending a real one, and nothing more than that.
 */
const fs = require('fs');
const path = require('path');
const ejs = require('ejs');

const OUT = process.argv[2] || '/tmp/email-preview';
const TEMPLATES = path.join(__dirname, '..', 'views', 'emails');
const logoUrl = 'https://stockport-badminton.co.uk/touch-icon-192x192.png';


// The reminder's own date formatter, so a preview shows what the email will.
const longDate = v => new Date(v).toLocaleDateString('en-GB',
  { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/London' });

const DIGEST_CLUBS = [
  { name: 'Aerospace',  firstFixture: '2026-09-03', daysAway: -1, chased: true,
    chasedAt: '2026-09-01' },
  { name: 'Mellor',     firstFixture: '2026-09-03', daysAway: -1, chased: false, chasedAt: null },
  { name: 'Racketeer',  firstFixture: '2026-09-07', daysAway: 3,  chased: false, chasedAt: null },
];

const SAMPLES = {
  'scorecard-received': {
    logoUrl,
    whyReceiving: 'Sent to the results secretary whenever a captain files a scorecard.',
    homeTeamName: 'Mellor A', awayTeamName: 'Aerospace A',
    divisionName: 'Division 1', matchDate: 'Thursday 3 September',
    confirmUrl: 'https://stockport-badminton.co.uk/populated-scorecard-beta/2435?t=abc123',
    photoUrl: 'https://stockport-badminton.co.uk/scorecard-photo/2435?t=abc123',
    photoLine: 'A scorecard has been entered, with a photo attached.',
  },
  'registration-reminder': {
    logoUrl,
    whyReceiving: 'You are listed as a secretary for Aerospace in the league.',
    clubName: 'Aerospace', seasonLabel: '2026-27', greetingName: ' Anne',
    firstFixture: 'Thursday 10 September', overdue: false, daysLine: ', 5 days away',
    replyTo: 'results@stockport-badminton.co.uk',
    rosterUrl: 'https://stockport-badminton.co.uk/manage-players',
  },
  'registration-digest': {
    logoUrl,
    whyReceiving: 'You are listed as a recipient of the league admin digests.',
    seasonLabel: '2026-27', longDate,
    adminUrl: 'https://stockport-badminton.co.uk/admin/registrations',
    digest: {
      withinDays: 3, received: 2, total: 18,
      dueSoon: DIGEST_CLUBS.slice(1),
      chased: [DIGEST_CLUBS[0]],
    },
  },
  'contact-us': {
    logoUrl,
    whyReceiving: 'You are listed as a secretary for this club.',
    message: 'Hello — my daughter is 14 and keen to start playing. Do you have a junior night?',
    senderEmail: 'a.parent@example.com',
    aboutClub: 'Mellor',
  },
  'scorecard-reminder': {
    logoUrl,
    whyReceiving: 'You are listed as a captain for one of the teams in this fixture.',
    matchLine: '',
    submitUrl: 'https://stockport-badminton.co.uk/scorecard-beta',
  },
  'access-approved': {
    logoUrl,
    whyReceiving: 'You asked for access to enter results for your team.',
    submitUrl: 'https://stockport-badminton.co.uk/scorecard-beta',
  },
  'access-request': {
    logoUrl,
    whyReceiving: 'You are a league administrator, so you are told when someone asks for results access.',
    // Deliberately hostile: this value arrives on an unauthenticated endpoint, and the
    // version this template replaced concatenated it into HTML by hand. If the preview
    // shows tags rather than rendering them, the escaping is doing its job.
    userLabel: 'Priya Ramanathan <priya@example.com> "&" <script>alert(1)</script>',
    approveUrl: 'https://stockport-badminton.co.uk/approve-user/auth0%7Cabc123',
  },
  'scorecard-photo-added': {
    logoUrl,
    whyReceiving: 'You are the league results secretary.',
    photoUrl: 'https://stockport-badminton.co.uk/scorecard-photo/2437?t=abc123',
    confirmUrl: 'https://stockport-badminton.co.uk/populated-scorecard-beta/2437?t=abc123',
  },
  'missing-scorecards': {
    logoUrl,
    whyReceiving: 'You are listed as a recipient of the league admin digests.',
    fixtures: [
      { date: '03/09/2026', homeTeam: 'Mellor A', awayTeam: 'Aerospace A' },
      { date: '03/09/2026', homeTeam: 'Shell C', awayTeam: 'Dome B' },
    ],
  },
  'transfer-request': {
    logoUrl,
    whyReceiving: 'You are the league results secretary, who approves transfers.',
    requester: 'Anne Secretary', requesterClub: 'Mellor',
    playerName: 'Jill Jackson', playerId: 1042,
    currentlyAt: 'Aerospace — Aerospace A',
    destTeam: 'Mellor B', destClub: 'Mellor',
    rosterUrl: 'https://stockport-badminton.co.uk/manage-players',
  },
  'messer-result': {
    logoUrl,
    whyReceiving: 'You administer the Messer knockout for the league.',
    state: 'submitted', homeTeam: 'Mellor A', awayTeam: 'Aerospace A',
    matchDate: '2026-09-03', submittedBy: 'captain@example.com',
    actionUrl: 'https://stockport-badminton.co.uk/messer-result/12',
    actionLabel: 'Review and approve',
  },
  'website-updated': {
    logoUrl,
    whyReceiving: 'Sent when a result you filed is published on the website.',
    homeTeamName: 'Mellor A', awayTeamName: 'Aerospace A', divisionName: 'Division 1',
    homeScore: 13, awayScore: 5,
    matchStats: [
      { name: 'Chris Petty',  teamName: 'Mellor A',    gamesWon: 4, avgPtsFor: 21, avgPtsAgainst: 14 },
      { name: 'Jo Hilliard',  teamName: 'Mellor A',    gamesWon: 3, avgPtsFor: 19, avgPtsAgainst: 16 },
      { name: 'Molly McMackay', teamName: 'Aerospace A', gamesWon: 1, avgPtsFor: 15, avgPtsAgainst: 21 },
    ],
    resultImageUrl: '',
  },
};

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  for (const [name, data] of Object.entries(SAMPLES)) {
    const html = await ejs.renderFile(path.join(TEMPLATES, name + '.ejs'), data);
    const out = path.join(OUT, name + '.html');
    fs.writeFileSync(out, html);
    console.log(`  ${out}  (${html.length} bytes)`);
  }
  // The no-photo and no-stats variants, since those are the mj-raw conditionals.
  const variants = {
    'scorecard-received-no-photo': ['scorecard-received',
      Object.assign({}, SAMPLES['scorecard-received'], {
        photoUrl: '', photoLine: 'A scorecard has been entered, with no photo attached.' })],
    'website-updated-no-stats': ['website-updated',
      Object.assign({}, SAMPLES['website-updated'], { matchStats: [] })],
    // The overdue wording, which is the reminder's own mj-raw conditional.
    'registration-reminder-overdue': ['registration-reminder',
      Object.assign({}, SAMPLES['registration-reminder'], {
        overdue: true, firstFixture: 'Thursday 3 September' })],
    // A digest with nothing chased yet — the state on the first morning of a season, and
    // the one where a discarded mj-raw tag would show an empty heading.
    // The three states of the messer email, which are its mj-raw conditionals.
    'messer-result-approved': ['messer-result',
      Object.assign({}, SAMPLES['messer-result'], {
        state: 'approved', submittedBy: '', actionUrl: '', actionLabel: '' })],
    'messer-result-rejected': ['messer-result',
      Object.assign({}, SAMPLES['messer-result'], {
        state: 'rejected', submittedBy: '', actionUrl: '', actionLabel: '' })],
    // ...and the empty day, which is the other conditional.
    'missing-scorecards-none': ['missing-scorecards',
      Object.assign({}, SAMPLES['missing-scorecards'], { fixtures: [] })],
    'registration-digest-none-chased': ['registration-digest',
      Object.assign({}, SAMPLES['registration-digest'], {
        digest: Object.assign({}, SAMPLES['registration-digest'].digest, { chased: [] }) })],
  };
  for (const [label, [tpl, data]] of Object.entries(variants)) {
    const html = await ejs.renderFile(path.join(TEMPLATES, tpl + '.ejs'), data);
    fs.writeFileSync(path.join(OUT, label + '.html'), html);
    console.log(`  ${path.join(OUT, label + '.html')}  (variant)`);
  }
})().catch(e => { console.error(e.message); process.exit(1); });
