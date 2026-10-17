// HARD-35. The 2026 invoice run failed on 1 Sep and nothing said so; the next signal
// would have been a treasurer asking. The weekly audit digest now reports from
// invoice_run, and this is its decision: models/invoiceRun.js findingsFor.
//
// The case that matters most is the first one. A run that never happens writes no row
// and raises no error, so the only evidence is an absence — and a check that only
// reports failed rows would stay silent through exactly the failure that bit.

const { findingsFor, UNRECORDED_SEASONS } = require('../../models/invoiceRun');

const SEASON = '20272028';                     // invoices due 1 Sep 2027
const at = s => new Date(s);
const run = (ran_at, status, outcomes) => ({ ran_at, status, outcomes });
const sent = club => ({ club, sent: true, detail: `${club} invoice sent successfully` });
const notSent = (club, why) => ({ club, sent: false, detail: `${club} invoice NOT sent: ${why}` });

describe('no run at all', () => {
  it('is reported once the window after 1 September has closed', () => {
    const rows = findingsFor({ season: SEASON, runs: [], now: at('2027-09-08T12:00:00Z') });
    expect(rows).toEqual([expect.objectContaining({
      season: SEASON,
      club: '(all clubs)',
      problem: expect.stringMatching(/NOT sent — due 01 Sept? 2027/),
      last_attempt: 'no run recorded at all',
    })]);
  });

  it('is not reported while a late run is still allowed', () => {
    // The run may fire up to three days after 1 Sep (INVOICE_WINDOW_DAYS), so a failure
    // on the day that is retried on the 3rd must never have been reported.
    expect(findingsFor({ season: SEASON, runs: [], now: at('2027-09-04T12:00:00Z') })).toEqual([]);
    expect(findingsFor({ season: SEASON, runs: [], now: at('2027-08-20T12:00:00Z') })).toEqual([]);
  });

  it('keeps being reported for the rest of the season', () => {
    // Asked in January, the season name still says which September was missed.
    const rows = findingsFor({ season: SEASON, runs: [], now: at('2028-01-15T12:00:00Z') });
    expect(rows).toHaveLength(1);
  });
});

describe('a run that was refused', () => {
  it('is still a missing run, and says what the last attempt was told', () => {
    const rows = findingsFor({
      season: SEASON,
      runs: [run('2027-09-10T09:01:00Z', 409, [])],
      now: at('2027-09-14T12:00:00Z'),
    });
    expect(rows).toEqual([expect.objectContaining({
      club: '(all clubs)',
      last_attempt: expect.stringMatching(/10 Sept? 2027, answered 409/),
    })]);
  });
});

describe('a run that happened', () => {
  it('reports nothing when every club was sent', () => {
    const rows = findingsFor({
      season: SEASON,
      runs: [run('2027-09-01T09:01:00Z', 200, [sent('Mellor'), sent('Tatton')])],
      now: at('2027-09-14T12:00:00Z'),
    });
    expect(rows).toEqual([]);
  });

  it('names each club that was not sent, and only those', () => {
    const rows = findingsFor({
      season: SEASON,
      runs: [run('2027-09-01T09:01:00Z', 200, [sent('Mellor'), notSent('Tatton', 'no club secretary email on file')])],
      now: at('2027-09-02T12:00:00Z'),        // inside the window: a partial run is reportable at once
    });
    expect(rows).toEqual([expect.objectContaining({
      club: 'Tatton', problem: 'Tatton invoice NOT sent: no club secretary email on file',
    })]);
  });

  it('clears a club once a later run sends it', () => {
    const rows = findingsFor({
      season: SEASON,
      runs: [
        // Out of order on purpose: the latest outcome is decided by ran_at, not row order.
        run('2027-09-05T10:00:00Z', 200, [sent('Tatton')]),
        run('2027-09-01T09:01:00Z', 200, [sent('Mellor'), notSent('Tatton', 'no email')]),
      ],
      now: at('2027-09-14T12:00:00Z'),
    });
    expect(rows).toEqual([]);
  });

  it('reports a club that went from sent to failed on a re-run', () => {
    const rows = findingsFor({
      season: SEASON,
      runs: [
        run('2027-09-01T09:01:00Z', 200, [sent('Mellor')]),
        run('2027-09-02T09:01:00Z', 200, [notSent('Mellor', 'total did not compute')]),
      ],
      now: at('2027-09-14T12:00:00Z'),
    });
    expect(rows.map(r => r.club)).toEqual(['Mellor']);
  });
});

describe('seasons from before the table existed', () => {
  it('2026/27 is exempt, because its invoices went out by hand before anything recorded runs', () => {
    expect(UNRECORDED_SEASONS).toEqual(['20262027']);
    expect(findingsFor({ season: '20262027', runs: [], now: at('2026-10-17T12:00:00Z') })).toEqual([]);
  });
});
