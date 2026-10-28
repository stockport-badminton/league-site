// When the results page offers "Send Reminder" for a fixture, and how a typed list of
// reminder recipients is read.
//
// The rules (views/rules.ejs) give the home team seven days from the match to get the
// card in; the Results Secretary allows until close of play on the seventh day. Counted
// in calendar days, UK time, with the match day as day 0 (a 22 October match is due by
// the end of 29 October):
//
//   days 3–7     the reminder: "due by <day 7>"
//   days 8–13    the reminder says the card is overdue
//   otherwise    no link — too early to nag, or two weeks late, which is a
//                rearrangement or a phone call, not a reminder (and without the
//                cut-off every unplayed fixture of 2019/20 offered one)
//
// Calendar days, not multiples of 24 hours: a fixture date is midnight UK time, and
// across the October clock change 8 × 24 hours lands at 11pm the day before.
//
// A fixture with a draft already filed never qualifies: the card is in, and the
// reminder would read as "we have lost your scorecard".

const DAY_MS = 24 * 60 * 60 * 1000;
const REMIND_FROM_DAY = 3;
const DUE_DAY = 7;
const STOP_FROM_DAY = 14;

// One address per entry, so a typed list cannot smuggle a second address (or a
// display-name header injection) inside one entry.
const ONE_ADDRESS = /^[^\s,;<>@]+@[^\s,;<>@]+\.[^\s,;<>@]+$/;
const MAX_RECIPIENTS = 6;

const UK_DATE = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit',
});

// The UK calendar date of an instant, as a UTC-midnight timestamp, so two of them
// subtract to a whole number of days.
function ukDay(value) {
  const t = new Date(value).getTime();
  if (Number.isNaN(t)) return null;
  const [y, m, d] = UK_DATE.format(t).split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

// Which day after the match it is: 0 on the match day.
function dayOf(fixtureDate, now) {
  const match = ukDay(fixtureDate);
  return match == null ? null : Math.round((ukDay(now) - match) / DAY_MS);
}

// The last day the card is on time, as the email says it: "Thursday 29 October".
function dueByLabel(fixtureDate) {
  const match = ukDay(fixtureDate);
  if (match == null) return null;
  return new Date(match + DUE_DAY * DAY_MS).toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC',
  });
}

function isScorecardOverdue(fixtureDate, now = Date.now()) {
  const day = dayOf(fixtureDate, now);
  return day != null && day > DUE_DAY;
}

function isReminderDue(row, now = Date.now()) {
  if (!row || row.status !== 'outstanding') return false;
  if (row.homeScore != null || row.hasDraft) return false;
  const day = dayOf(row.date, now);
  return day != null && day >= REMIND_FROM_DAY && day < STOP_FROM_DAY;
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
  dueByLabel, isScorecardOverdue, isReminderDue, parseRecipients,
  REMIND_FROM_DAY, DUE_DAY, STOP_FROM_DAY, MAX_RECIPIENTS,
};
