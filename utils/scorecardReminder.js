// When the results page offers "Send Reminder" for a fixture, and how a typed list of
// reminder recipients is read.
//
// The rules (views/rules.ejs) give the home team seven days from the match to get the
// card in. Counted from the fixture's date (midnight, UK time):
//
//   more than 2 days, up to 7   the reminder: "due by <last day>"
//   more than 7 days, under 14  the reminder says the card is overdue
//   otherwise                   no link — too early to nag, or two weeks late, which is
//                               a rearrangement or a phone call, not a reminder (and
//                               without the cut-off every unplayed fixture of 2019/20
//                               offered one)
//
// A fixture with a draft already filed never qualifies: the card is in, and the
// reminder would read as "we have lost your scorecard".

const DAY_MS = 24 * 60 * 60 * 1000;
const REMIND_AFTER_DAYS = 2;
const DUE_AFTER_DAYS = 7;
const STOP_AFTER_DAYS = 14;

// One address per entry, so a typed list cannot smuggle a second address (or a
// display-name header injection) inside one entry.
const ONE_ADDRESS = /^[^\s,;<>@]+@[^\s,;<>@]+\.[^\s,;<>@]+$/;
const MAX_RECIPIENTS = 6;

function daysSince(fixtureDate, now) {
  const t = new Date(fixtureDate).getTime();
  return Number.isNaN(t) ? null : (now - t) / DAY_MS;
}

function scorecardDueAt(fixtureDate) {
  const t = new Date(fixtureDate).getTime();
  return Number.isNaN(t) ? null : new Date(t + DUE_AFTER_DAYS * DAY_MS);
}

// The last day the card is on time, as the email says it: "Wednesday 28 October". The
// deadline is midnight at the start of the next day, so the day before it.
function dueByLabel(fixtureDate) {
  const due = scorecardDueAt(fixtureDate);
  if (!due) return null;
  return new Date(due.getTime() - 1).toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/London',
  });
}

function isScorecardOverdue(fixtureDate, now = Date.now()) {
  const days = daysSince(fixtureDate, now);
  return days != null && days > DUE_AFTER_DAYS;
}

function isReminderDue(row, now = Date.now()) {
  if (!row || row.status !== 'outstanding') return false;
  if (row.homeScore != null || row.hasDraft) return false;
  const days = daysSince(row.date, now);
  return days != null && days > REMIND_AFTER_DAYS && days < STOP_AFTER_DAYS;
}

// "a@x.com, b@y.com; c@z.com" -> { addresses, invalid }. Duplicates are dropped
// case-insensitively; anything that is not one address lands in `invalid` so the
// caller can refuse the whole send rather than quietly skip someone.
function parseRecipients(input) {
  const raw = Array.isArray(input) ? input.join(',') : String(input || '');
  const addresses = [];
  const invalid = [];
  for (const part of raw.split(/[,;\s]+/)) {
    const candidate = part.trim();
    if (!candidate) continue;
    if (!ONE_ADDRESS.test(candidate)) { invalid.push(candidate); continue; }
    if (!addresses.some(a => a.toLowerCase() === candidate.toLowerCase())) {
      addresses.push(candidate);
    }
  }
  return { addresses, invalid };
}

module.exports = {
  scorecardDueAt, dueByLabel, isScorecardOverdue, isReminderDue, parseRecipients,
  REMIND_AFTER_DAYS, DUE_AFTER_DAYS, STOP_AFTER_DAYS, MAX_RECIPIENTS,
};
