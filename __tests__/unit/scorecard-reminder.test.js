const { isReminderDue, parseRecipients, scorecardDueAt } = require('../../utils/scorecardReminder');

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const FIXTURE = '2026-10-05T00:00:00.000Z';
const due = new Date(FIXTURE).getTime() + 5 * DAY;

function row(overrides) {
  return { status: 'outstanding', date: FIXTURE, homeScore: null, hasDraft: false, ...overrides };
}

describe('isReminderDue', () => {
  it('is due five days after the fixture', () => {
    expect(scorecardDueAt(FIXTURE).getTime()).toBe(due);
  });

  it('offers the reminder only in the last 48 hours before the card is due', () => {
    expect(isReminderDue(row(), due - 49 * HOUR)).toBe(false);
    expect(isReminderDue(row(), due - 48 * HOUR)).toBe(true);
    expect(isReminderDue(row(), due - 1 * HOUR)).toBe(true);
  });

  it('stops once the card is due — the email says "due by close of play tomorrow"', () => {
    expect(isReminderDue(row(), due)).toBe(false);
    expect(isReminderDue(row(), due + DAY)).toBe(false);
  });

  it('never offers it when a draft has been filed', () => {
    expect(isReminderDue(row({ hasDraft: true }), due - HOUR)).toBe(false);
  });

  it('never offers it for a result already in, or a fixture that is not outstanding', () => {
    expect(isReminderDue(row({ homeScore: 10 }), due - HOUR)).toBe(false);
    for (const status of ['rearranged', 'rearranging', 'conceded', 'complete', 'void']) {
      expect(isReminderDue(row({ status }), due - HOUR)).toBe(false);
    }
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
