// The gap-finder's rules (static/beta/js/gap-finder-core.js, which the page runs) and the
// cross-league assembly (utils/gapFinder.js).
const core = require('../../static/beta/js/gap-finder-core');
const { assemble, ukToday } = require('../../utils/gapFinder');

const WINDOW = { start: '2026-06-20', end: '2027-07-30' };
const team = (id, name, club) => ({ id, name, club, division: 'Division 1' });
const fx = (id, home, away, day, status = 'outstanding') => ({ id, homeTeam: home, awayTeam: away, day, status });

// Stockport: Shell A (Tue nights) and Shell B, Manor A. Tameside: "SHELL" (the same club by
// name, different id) and Aerospace.
function reads(extraS = [], extraT = []) {
  return {
    stockport: {
      teams: [team(1, 'Shell A', 'Shell'), team(2, 'Shell B', 'Shell'), team(3, 'Manor A', 'Manor'), team(9, 'Spare', null)],
      fixtures: [
        fx(100, 1, 3, '2026-11-03'), fx(101, 1, 3, '2026-11-10'), fx(102, 1, 3, '2026-11-17'),
        fx(103, 3, 1, '2026-11-26'),
        ...extraS,
      ],
    },
    tameside: {
      teams: [team(1, 'Shell T1', 'SHELL'), team(2, 'Aerospace T1', 'Aerospace')],
      fixtures: [fx(500, 1, 2, '2026-11-25'), ...extraT],
    },
  };
}
const build = (r = reads(), today = '2026-11-01') => assemble(r, { today, window: WINDOW });

describe('assemble', () => {
  it('reconciles a club across leagues by name and keeps each league\'s ids apart', () => {
    const d = build();
    const shell = d.clubs.find(c => c.key === 'shell');
    expect(shell.leagues).toEqual(['stockport', 'tameside']);
    expect(shell.teamKeys).toEqual(['S:1', 'S:2', 'T:1']);
    expect(d.fixtures.find(f => f.uid === 'T-500')).toMatchObject({ homeKey: 'T:1', homeClubKey: 'shell', awayClubKey: 'aerospace' });
  });

  it('infers a team\'s usual night from its home fixtures, and leaves No Club out of the club list', () => {
    const d = build();
    expect(d.teams.find(t => t.key === 'S:1').homeNight).toBe('Tue');
    expect(d.teams.find(t => t.key === 'S:2').homeNight).toBeNull();
    expect(d.clubs.map(c => c.name)).toEqual(['Aerospace', 'Manor', 'Shell']);
  });

  it('does not count a postponed match towards the usual night', () => {
    const d = build(reads([fx(104, 1, 3, '2026-12-03', 'rearranging'), fx(105, 1, 3, '2026-12-10', 'rearranging'),
      fx(106, 1, 3, '2026-12-17', 'rearranging'), fx(107, 1, 3, '2026-12-24', 'rearranging')]));
    expect(d.teams.find(t => t.key === 'S:1').homeNight).toBe('Tue');
  });

  it('drops a fixture whose team was not returned, and works with Stockport alone', () => {
    const r = reads([fx(108, 1, 77, '2026-12-01')]);
    r.tameside = null;
    const d = build(r);
    expect(d.fixtures.map(f => f.uid)).not.toContain('S-108');
    expect(d.clubs.find(c => c.key === 'shell').leagues).toEqual(['stockport']);
    expect(d.playWindow).toEqual({ start: '2026-11-03', end: '2026-11-26' });
  });
});

describe('candidates', () => {
  const ix = d => core.index(d);
  const row = (c, iso) => c.rows.find(r => r.iso === iso);

  it('rules out a night either team already plays, in either league', () => {
    const d = build();
    const c = core.candidates(ix(d), 'S-101', '2026-11-01', '2026-12-10');
    // Shell A plays Manor A on the 3rd (Stockport) and Shell T1 is a different team, so
    // Tameside's fixture on the 25th does not block Shell A — it is a same-club warning.
    expect(row(c, '2026-11-03')).toMatchObject({ status: 'busy', busyReason: 'Shell A already playing Manor A (H)' });
    expect(row(c, '2026-11-26').status).toBe('busy'); // Manor A v Shell A
    expect(row(c, '2026-11-25').warnings.map(w => w.t)).toContain('Shell ×1');
  });

  it('does not offer the match its own date, but does offer a postponed match its old one', () => {
    expect(row(core.candidates(ix(build()), 'S-101', '2026-11-01', '2026-12-10'), '2026-11-10')).toBeUndefined();
    const d = build(reads([fx(109, 1, 3, '2026-12-01', 'rearranging')]));
    expect(row(core.candidates(ix(d), 'S-109', '2026-11-01', '2026-12-10'), '2026-12-01').status).toBe('free');
  });

  it('frees the old night of a postponed or conceded match', () => {
    const d = build(reads([fx(110, 1, 3, '2026-12-01', 'rearranging'), fx(111, 3, 1, '2026-12-08', 'conceded')]));
    const c = core.candidates(ix(d), 'S-101', '2026-11-01', '2026-12-10');
    expect(row(c, '2026-12-01').status).not.toBe('busy');
    expect(row(c, '2026-12-08').status).not.toBe('busy');
  });

  it('a clean usual night has no warnings; others say why', () => {
    const c = core.candidates(ix(build()), 'S-101', '2026-11-01', '2027-01-10');
    expect(row(c, '2026-12-08')).toMatchObject({ status: 'free', warnings: [], onNight: true, weeks: 4 });
    expect(row(c, '2026-12-05').warnings.map(w => w.t)).toEqual(['off night', 'weekend']);
    expect(row(c, '2026-12-22').warnings.map(w => w.t)).toEqual(['Xmas break']);
    expect(row(c, '2026-11-24').warnings.map(w => w.t)).toEqual(['adjacent night']); // Shell T1 on the 25th
  });

  it('rank drops blocked dates and orders fewest warnings, then nearest', () => {
    const c = core.candidates(ix(build()), 'S-101', '2026-11-01', '2026-12-20');
    const ranked = core.rank(c.rows, { onNightOnly: true, cleanOnly: false }).map(r => r.iso);
    expect(ranked).toEqual(['2026-12-01', '2026-12-08', '2026-12-15', '2026-11-24']);
    expect(core.rank(c.rows, { onNightOnly: true, cleanOnly: true })).toHaveLength(3);
  });
});

describe('dates', () => {
  it('computes Easter, and the Easter break around it', () => {
    expect(core.easter(2027)).toBe('2027-03-28');
    expect(core.easter(2028)).toBe('2028-04-16');
    expect(core.breaksFor(2026)).toEqual([
      { name: 'Xmas', start: '2026-12-19', end: '2027-01-04' },
      { name: 'Easter', start: '2027-03-22', end: '2027-04-05' },
    ]);
  });

  it('only offers dates from tomorrow to three weeks after the last fixture', () => {
    expect(core.moveWindow({ today: '2026-11-15', playWindow: { start: '2026-09-01', end: '2027-04-30' } }))
      .toEqual({ from: '2026-11-16', to: '2027-05-21' });
    expect(core.moveWindow({ today: '2026-07-01', playWindow: { start: '2026-09-01', end: '2027-04-30' } }).from)
      .toBe('2026-09-01');
  });

  it('takes today in UK time, not UTC', () => {
    expect(ukToday(new Date('2026-06-30T23:30:00Z'))).toBe('2026-07-01');
  });
});
