// Chasing clubs for their player registration forms.
//
// Every club must return the league's team registration form before its first fixture.
// This is the once-a-season job that has always been done from memory, and the three
// pieces here are:
//
//   GET  /admin/registrations           the working page — who is outstanding, who is due
//   POST /admin/registrations/:club/... mark received / not received / send a chase
//   GET  /admin/registrations/digest    preview the daily email, sends nothing
//   POST /admin/registrations/run       the daily email itself, for Cloud Scheduler
//
// The token/superadmin gate on the last one is lifted wholesale from
// controllers/auditController.js, deliberately: a second, subtly different way of
// authenticating a scheduler is how one of them ends up wrong.

const crypto = require('crypto');
const Registration = require('../models/clubRegistration');
const seasonModel = require('../models/season');
const documents = require('./documentsController');
const mailer = require('../utils/mailer');
const { absoluteUrl, canonicalFor } = require('../utils/canonical');
const { isSuperAdmin } = require('../utils/authz');
const { seasonLabel } = require('../utils/teamRegistrationDoc');

const TOKEN_HEADER = 'x-registration-token';
const DEFAULT_DUE_DAYS = 3;

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

// Unset means nothing is ever sent, which is the safe default and why it is unset
// locally: dev.env points at production, so a stray run would otherwise mail 18 real club
// secretaries. Same rule as AUDIT_EMAIL_TO.
function digestRecipients() {
  return String(process.env.REGISTRATION_EMAIL_TO || process.env.AUDIT_EMAIL_TO || '')
    .split(',').map(s => s.trim()).filter(s => s.includes('@'));
}

// ---------------------------------------------------------------------------
// Who may run the scheduled send
// ---------------------------------------------------------------------------

function cronTokenOk(req) {
  // An unset token closes the path rather than opening it: "empty secret matches empty
  // header" is how an unconfigured deploy becomes a public endpoint.
  const expected = process.env.REGISTRATION_CRON_TOKEN || '';
  if (!expected) return false;
  const presented = req.get(TOKEN_HEADER) || '';
  if (!presented) return false;
  // Hashed first so timingSafeEqual gets equal-length buffers; comparing raw strings
  // means either leaking the length or throwing on a mismatch.
  const a = crypto.createHash('sha256').update(expected).digest();
  const b = crypto.createHash('sha256').update(presented).digest();
  return crypto.timingSafeEqual(a, b);
}

// Not `secured`: that redirects an anonymous caller to /login, and a scheduler following
// a 302 to Auth0 reports the job as a success.
function requireReminderCaller(req, res, next) {
  if (cronTokenOk(req)) { req.reminderCaller = 'scheduler'; return next(); }
  if (isSuperAdmin(req)) { req.reminderCaller = 'superadmin'; return next(); }
  const err = new Error('Not authorised to run the registration reminder');
  err.status = 403;
  next(err);
}

// ---------------------------------------------------------------------------
// The chase email
// ---------------------------------------------------------------------------

const plural = (n, one, many) => n === 1 ? one : (many || one + 's');

// Formats as the league writes dates: "Thursday 3 September".
function longDate(value) {
  return new Date(value).toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/London',
  });
}

// Send one club its form. Returns what was sent, for the caller to report.
//
// The recipients are derived SERVER-SIDE from the club's own officers and never taken
// from the request — `/fixture/reminder` took its address from the body and was an open
// relay from our own verified domain.
async function sendChase(club, sentBy) {
  const to = club.officers.filter(o => o.email && o.role === 'club secretary').map(o => o.email);
  const cc = club.officers.filter(o => o.email && o.role !== 'club secretary').map(o => o.email);
  // One person often holds both roles, and a club with no club secretary still has a
  // match secretary worth writing to.
  const recipients = to.length ? to : cc;
  const copies = to.length ? cc : [];
  if (!recipients.length) {
    const err = new Error(`${club.name} has no contactable officer`);
    err.status = 422;
    throw err;
  }

  const doc = await documents.buildPrefilledRegistrationDocx(club.name);
  const label = seasonLabel(seasonModel.current());
  const overdue = club.daysAway < 0;
  const days = Math.abs(club.daysAway);

  // Greet by name when writing to one person, and not at all when it is a group —
  // "Hello Anne and John," is worse than "Hello,".
  const named = club.officers.filter(o => recipients.includes(o.email));
  const greetingName = named.length === 1 ? ' ' + named[0].name.split(' ')[0] : '';

  // Blind-copy the league's own address, so there is a record of what went out and to
  // whom without waiting on SES's own notifications. Bcc rather than Cc: the reply-to is
  // already the results mailbox, so a visible copy to it reads as clutter to the club,
  // and the point is a filed copy rather than a signal to the reader.
  //
  // This works only because utils/ses.sendRawEmail passes Destinations explicitly —
  // MailComposer strips the Bcc header, so SES would otherwise never see the address.
  const fileCopy = digestRecipients();

  await mailer.send({
    template: 'registration-reminder',
    to: recipients,
    cc: copies,
    bcc: fileCopy.length ? fileCopy : [mailer.RESULTS_MAILBOX],
    replyTo: mailer.RESULTS_MAILBOX,
    subject: `${club.name} player registration form — ${label}`,
    whyReceiving:
      `You are listed as a secretary for ${club.name} in the Stockport & District ` +
      `Badminton League.`,
    text: [
      `Hello${greetingName},`,
      '',
      `We have not yet received ${club.name}'s player registration form for the ${label} season.`,
      overdue
        ? `${club.name}'s first match was ${longDate(club.firstFixture)}, so the form is overdue.`
        : `Your first match is ${longDate(club.firstFixture)}` +
          (days > 0 ? `, ${days} ${plural(days, 'day')} away.` : ', today.'),
      '',
      'The form is attached as a Word document, already filled in with the players we have',
      'on your teams. Add anyone missing, delete anyone who has left, and send it back to',
      mailer.RESULTS_MAILBOX + '.',
      '',
      'You can also keep your squads up to date on the website:',
      absoluteUrl('/manage-players'),
    ].join('\n'),
    data: {
      clubName: club.name,
      seasonLabel: label,
      greetingName,
      firstFixture: longDate(club.firstFixture),
      overdue,
      daysLine: days > 0 ? `, ${days} ${plural(days, 'day')} away` : ', today',
      replyTo: mailer.RESULTS_MAILBOX,
      rosterUrl: absoluteUrl('/manage-players'),
    },
    // buildPrefilledRegistrationDocx returns null for a club with nobody on its books.
    // Still worth writing to them — arguably more so — just with nothing attached.
    attachments: doc ? [{
      filename: doc.filename, content: doc.buffer, contentType: doc.contentType,
    }] : [],
  });

  await Registration.recordChase(seasonModel.current(), club.id, sentBy);
  return { club: club.name, to: recipients, cc: copies,
           bcc: fileCopy.length ? fileCopy : [mailer.RESULTS_MAILBOX],
           attached: doc ? doc.filename : null };
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

exports.registrations_page = async function(req, res, next) {
  try {
    const season = seasonModel.current();
    const clubs = await Registration.getStatus(season);
    const dueDays = DEFAULT_DUE_DAYS;
    res.render('admin/registrations', {
      // header.ejs reads pageTitle/pageDescription/static_path/canonical — a `title`
      // local renders nothing and throws on `pageTitle.indexOf`.
      static_path: '/static',
      pageTitle: 'Player registrations',
      pageDescription: 'Which clubs still owe their registration forms',
      canonical: canonicalFor(req),
      clubs,
      season,
      seasonLabel: seasonLabel(season),
      dueDays,
      outstanding: clubs.filter(c => !c.received).length,
      dueSoon: clubs.filter(c => !c.received && c.daysAway <= dueDays).length,
      sent: req.query.sent || null,
      problem: req.query.problem || null,
      user: req.user,
    });
  } catch (err) { next(err); }
};

const findClub = async (season, clubId) =>
  (await Registration.getStatus(season)).find(c => String(c.id) === String(clubId));

exports.mark_received = async function(req, res, next) {
  try {
    const season = seasonModel.current();
    const received = req.body.received !== 'false';
    const who = (req.user && (req.user.displayName || req.user.email)) || 'unknown';
    if (received) await Registration.markReceived(season, req.params.club, who);
    else await Registration.markNotReceived(season, req.params.club, who);
    res.redirect('/admin/registrations');
  } catch (err) { next(err); }
};

exports.send_chase = async function(req, res, next) {
  try {
    const season = seasonModel.current();
    const club = await findClub(season, req.params.club);
    if (!club) { const e = new Error('Unknown club'); e.status = 404; throw e; }

    const who = (req.user && (req.user.displayName || req.user.email)) || 'unknown';
    const sent = await sendChase(club, who);
    res.redirect('/admin/registrations?sent=' + encodeURIComponent(sent.club));
  } catch (err) {
    // A club with no contactable officer is a data problem, not a server fault, and the
    // page can say so rather than throwing a 500 at someone mid-chase.
    if (err.status === 422) {
      return res.redirect('/admin/registrations?problem=' + encodeURIComponent(err.message));
    }
    next(err);
  }
};

// ---------------------------------------------------------------------------
// The daily digest
// ---------------------------------------------------------------------------

async function buildDigestEmail(preview) {
  const season = seasonModel.current();
  const digest = await Registration.getDigest(season, DEFAULT_DUE_DAYS);
  return {
    digest,
    data: {
      digest,
      seasonLabel: seasonLabel(season),
      adminUrl: absoluteUrl('/admin/registrations'),
      longDate,
      preview: !!preview,
    },
  };
}

// GET /admin/registrations/digest — renders the email, sends nothing.
exports.digest_preview = async function(req, res, next) {
  try {
    const { data } = await buildDigestEmail(true);
    // The email itself rather than a page wrapping it, so what is checked in the browser
    // is what lands in the inbox.
    const ejs = require('ejs');
    const html = await ejs.renderFile('views/emails/registration-digest.ejs',
      Object.assign({ logoUrl: absoluteUrl(mailer.LOGO_PATH), whyReceiving: 'Preview.' }, data));
    res.send(html);
  } catch (err) { next(err); }
};

// POST /admin/registrations/run — the scheduled send.
exports.digest_run = async function(req, res, next) {
  try {
    const to = digestRecipients();
    const { digest, data } = await buildDigestEmail(false);

    // Nothing outstanding is not worth an email every morning. The season is over, or
    // everyone has sent theirs in; either way a daily "nothing to do" trains the reader
    // to ignore it.
    if (!digest.dueSoon.length && !digest.chased.length) {
      return res.json({ ok: true, sent: false, reason: 'nothing outstanding',
                        caller: req.reminderCaller });
    }
    if (!to.length) {
      return res.json({ ok: true, sent: false, reason: 'REGISTRATION_EMAIL_TO is unset',
                        caller: req.reminderCaller });
    }

    const due = digest.dueSoon.length;
    await mailer.send({
      template: 'registration-digest',
      to,
      subject: due
        ? `${due} club ${plural(due, 'registration')} due in the next ${DEFAULT_DUE_DAYS} days`
        : 'Player registrations still outstanding',
      whyReceiving: 'You are listed as a recipient of the league admin digests.',
      text: [
        `Player registrations, ${seasonLabel(seasonModel.current())}.`,
        '',
        `Due within ${digest.withinDays} days and not received (${digest.dueSoon.length}):`,
        ...digest.dueSoon.map(c => `  ${c.name} — first match ${longDate(c.firstFixture)}` +
          (c.chased ? ` (chased ${longDate(c.chasedAt)})` : ' (not chased)')),
        '',
        `Chased and still outstanding (${digest.chased.length}):`,
        ...digest.chased.map(c => `  ${c.name} — chased ${longDate(c.chasedAt)}, ` +
          `first match ${longDate(c.firstFixture)}`),
        '',
        `${digest.received} of ${digest.total} received.`,
        '',
        absoluteUrl('/admin/registrations'),
      ].join('\n'),
      data,
    });

    res.json({ ok: true, sent: true, to, caller: req.reminderCaller,
               dueSoon: digest.dueSoon.length, chased: digest.chased.length });
  } catch (err) { next(err); }
};

exports.requireReminderCaller = requireReminderCaller;
exports.digestRecipients = digestRecipients;
exports.sendChase = sendChase;
exports.DEFAULT_DUE_DAYS = DEFAULT_DUE_DAYS;
