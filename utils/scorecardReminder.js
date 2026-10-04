// When the results page offers "Send Reminder" for a fixture, and how a typed list of
// reminder recipients is read.
//
// A scorecard is due five days after the fixture. The reminder is only worth sending
// in the last 48 hours before that — any earlier and it nags a captain who still has
// days in hand; any later and the email's "due by close of play tomorrow" is untrue.
// A fixture with a draft already filed never qualifies: the card is in, and the
// reminder would read as "we have lost your scorecard".

const DUE_AFTER_DAYS = 5;
const REMIND_WITHIN_MS = 48 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

// One address per entry, so a typed list cannot smuggle a second address (or a
// display-name header injection) inside one entry.
const ONE_ADDRESS = /^[^\s,;<>@]+@[^\s,;<>@]+\.[^\s,;<>@]+$/;
const MAX_RECIPIENTS = 6;

function scorecardDueAt(fixtureDate) {
  const t = new Date(fixtureDate).getTime();
  return Number.isNaN(t) ? null : new Date(t + DUE_AFTER_DAYS * DAY_MS);
}

function isReminderDue(row, now = Date.now()) {
  if (!row || row.status !== 'outstanding') return false;
  if (row.homeScore != null || row.hasDraft) return false;
  const due = scorecardDueAt(row.date);
  if (!due) return false;
  const remaining = due.getTime() - now;
  return remaining > 0 && remaining <= REMIND_WITHIN_MS;
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
  scorecardDueAt, isReminderDue, parseRecipients,
  DUE_AFTER_DAYS, REMIND_WITHIN_MS, MAX_RECIPIENTS,
};
