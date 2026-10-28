const {
  isReminderDue, isScorecardOverdue, dueByLabel, matchLabel, parseRecipients,
} = require('../../utils/scorecardReminder');

// Midnight UK time on Thursday 22 October, as the fixture table stores it. The clocks
// go back on 25 October, so these also hold the count to calendar days.
const FIXTURE = '2026-10-21T23:00:00.000Z';
const uk = iso => Date.parse(iso); // instants written in UTC; comments give UK time

function row(overrides) {
  return { status: 'outstanding', date: FIXTURE, homeScore: null, hasDraft: false, ...overrides };
}

describe('isReminderDue', () => {
  it('offers nothing until day 3', () => {
    expect(isReminderDue(row(), uk('2026-10-22T19:00:00Z'))).toBe(false); // match night
    expect(isReminderDue(row(), uk('2026-10-24T22:59:00Z'))).toBe(false); // 23:59 BST, 24th
  });

  it('offers the reminder from day 3 to day 13', () => {
    expect(isReminderDue(row(), uk('2026-10-24T23:01:00Z'))).toBe(true); // 00:01 BST, 25th
    expect(isReminderDue(row(), uk('2026-10-29T23:30:00Z'))).toBe(true); // 23:30 GMT, 29th
    expect(isReminderDue(row(), uk('2026-11-04T23:59:00Z'))).toBe(true); // 23:59, 4 Nov
  });

  it('stops on day 14 — older than that is a rearrangement, not a reminder', () => {
    expect(isReminderDue(row(), uk('2026-11-05T00:01:00Z'))).toBe(false);
    expect(isReminderDue(row(), uk('2027-10-01T12:00:00Z'))).toBe(false);
  });

  it('never offers it when a draft has been filed', () => {
    expect(isReminderDue(row({ hasDraft: true }), uk('2026-10-27T12:00:00Z'))).toBe(false);
  });

  it('never offers it for a result already in, or a fixture that is not outstanding', () => {
    const now = uk('2026-10-27T12:00:00Z');
    expect(isReminderDue(row({ homeScore: 10 }), now)).toBe(false);
    for (const status of ['rearranged', 'rearranging', 'conceded', 'complete', 'void']) {
      expect(isReminderDue(row({ status }), now)).toBe(false);
    }
  });
});

describe('isScorecardOverdue', () => {
  it('is on time until close of play on day 7, overdue from day 8', () => {
    expect(isScorecardOverdue(FIXTURE, uk('2026-10-29T23:59:00Z'))).toBe(false); // 23:59 GMT, 29th
    expect(isScorecardOverdue(FIXTURE, uk('2026-10-30T00:01:00Z'))).toBe(true);
  });

  it('is not overdue without a usable date', () => {
    expect(isScorecardOverdue(undefined, uk('2026-11-01T12:00:00Z'))).toBe(false);
    expect(isScorecardOverdue('not a date', uk('2026-11-01T12:00:00Z'))).toBe(false);
  });
});

describe('dueByLabel', () => {
  it('names day 7 — a 22 October match is due by the 29th', () => {
    expect(dueByLabel(FIXTURE)).toBe('Thursday 29 October');
  });

  it('has nothing to say without a date', () => {
    expect(dueByLabel(undefined)).toBeNull();
  });
});

describe('matchLabel', () => {
  it('names the teams and the match day, in UK time', () => {
    expect(matchLabel({ homeTeam: 'Mellor A', awayTeam: 'Shell C', date: FIXTURE }))
      .toBe('Mellor A v Shell C, Thursday 22 October');
  });

  it('falls back to the teams alone without a date', () => {
    expect(matchLabel({ homeTeam: 'Mellor A', awayTeam: 'Shell C' })).toBe('Mellor A v Shell C');
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
