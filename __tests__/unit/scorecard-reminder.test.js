const {
  isReminderDue, isScorecardOverdue, dueByLabel, parseRecipients, scorecardDueAt,
} = require('../../utils/scorecardReminder');

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
// Midnight UK time on Thursday 22 October, as the fixture table stores it.
const FIXTURE = '2026-10-21T23:00:00.000Z';
const at = days => new Date(FIXTURE).getTime() + days * DAY;

function row(overrides) {
  return { status: 'outstanding', date: FIXTURE, homeScore: null, hasDraft: false, ...overrides };
}

describe('isReminderDue', () => {
  it('is due seven days after the fixture, as the rules say', () => {
    expect(scorecardDueAt(FIXTURE).getTime()).toBe(at(7));
  });

  it('offers nothing in the first two days', () => {
    expect(isReminderDue(row(), at(1))).toBe(false);
    expect(isReminderDue(row(), at(2))).toBe(false);
  });

  it('offers the reminder from two days after the fixture, through the deadline and the week after', () => {
    expect(isReminderDue(row(), at(2) + HOUR)).toBe(true);
    expect(isReminderDue(row(), at(7))).toBe(true);
    expect(isReminderDue(row(), at(13))).toBe(true);
  });

  it('stops at two weeks — older than that is a rearrangement, not a reminder', () => {
    expect(isReminderDue(row(), at(14))).toBe(false);
    expect(isReminderDue(row(), at(400))).toBe(false);
  });

  it('never offers it when a draft has been filed', () => {
    expect(isReminderDue(row({ hasDraft: true }), at(5))).toBe(false);
  });

  it('never offers it for a result already in, or a fixture that is not outstanding', () => {
    expect(isReminderDue(row({ homeScore: 10 }), at(5))).toBe(false);
    for (const status of ['rearranged', 'rearranging', 'conceded', 'complete', 'void']) {
      expect(isReminderDue(row({ status }), at(5))).toBe(false);
    }
  });
});

describe('isScorecardOverdue', () => {
  it('is overdue once more than seven days have passed', () => {
    expect(isScorecardOverdue(FIXTURE, at(6))).toBe(false);
    expect(isScorecardOverdue(FIXTURE, at(7))).toBe(false);
    expect(isScorecardOverdue(FIXTURE, at(7) + 1)).toBe(true);
    expect(isScorecardOverdue(FIXTURE, at(10))).toBe(true);
  });

  it('is not overdue without a usable date', () => {
    expect(isScorecardOverdue(undefined, at(10))).toBe(false);
    expect(isScorecardOverdue('not a date', at(10))).toBe(false);
  });
});

describe('dueByLabel', () => {
  it('names the last day the card is on time, in UK time', () => {
    expect(dueByLabel(FIXTURE)).toBe('Wednesday 28 October');
  });

  it('has nothing to say without a date', () => {
    expect(dueByLabel(undefined)).toBeNull();
  });
});

describe('parseRecipients', () => {
  it('splits on commas, semicolons and spaces and drops duplicates', () => {
    expect(parseRecipients('a@x.com, b@y.com; A@X.com  c@z.org')).toEqual({
      addresses: ['a@x.com', 'b@y.com', 'c@z.org'], invalid: [],
    });
  });

  it('reports anything that is not one address', () => {
    const { invalid } = parseRecipients('ok@x.com, nope, <evil@x.com>');
    expect(invalid).toEqual(['nope', '<evil@x.com>']);
  });

  it('treats blank input as no addresses', () => {
    expect(parseRecipients(undefined)).toEqual({ addresses: [], invalid: [] });
    expect(parseRecipients(' , ')).toEqual({ addresses: [], invalid: [] });
  });
});
