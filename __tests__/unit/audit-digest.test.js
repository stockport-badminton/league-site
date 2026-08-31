// The triage layer between `checks.runAll` and the weekly email.
//
// The email only works if a non-empty section means "somebody do something". Three of
// the eleven checks currently report findings that are already owned by another
// hardening package and will stay non-empty for weeks — mailing their full row lists
// every Monday is exactly how a monitoring email becomes something its reader deletes
// unread. So the digest classifies each check rather than just dumping it, and the
// classification is what these tests pin down.

const digest = require('../../utils/auditDigest');
const { buildDigest, TRACKED } = digest;

function check(name, rows, extra = {}) {
  return {
    name,
    description: 'desc for ' + name,
    severity: 'medium',
    rows,
    ...extra,
  };
}

// Every check, clean. Uses the real names so the "everything else looks fine" count
// cannot drift from the real check list.
function allClean() {
  return require('../../tools/audit/checks').all().map(c => ({ ...c, rows: [] }));
}

describe('buildDigest — classification', () => {
  it('reports a check with rows and no tracked baseline as new, in full', () => {
    const d = buildDigest([check('orphan-results', [
      { id: 6600, played: '2026-08-29', home: 'Hazel Grove A', away: 'Marple B' },
    ])]);

    expect(d.attention).toHaveLength(1);
    expect(d.attention[0].status).toBe('new');
    expect(d.attention[0].shown).toHaveLength(1);
    expect(d.attention[0].shown[0].row.id).toBe(6600);
    expect(d.allClear).toBe(false);
  });

  it('collapses a tracked check at its baseline count to a single noted line', () => {
    const rows = Array.from({ length: TRACKED['orphan-team-refs'].count }, (_, i) => ({ id: i }));
    const d = buildDigest([check('orphan-team-refs', rows)]);

    expect(d.attention).toHaveLength(0);
    expect(d.allClear).toBe(true);
    expect(d.noted).toHaveLength(1);
    expect(d.noted[0].status).toBe('tracked');
    // The point of collapsing: no row detail at all, however many rows there are.
    expect(d.noted[0].shown).toHaveLength(0);
    expect(d.noted[0].tracked.owner).toBe('HARD-11');
  });

  it('escalates a tracked check that has grown, and says by how much', () => {
    const n = TRACKED['orphan-team-refs'].count;
    const rows = Array.from({ length: n + 2 }, (_, i) => ({ id: i }));
    const d = buildDigest([check('orphan-team-refs', rows)]);

    expect(d.attention).toHaveLength(1);
    expect(d.attention[0].status).toBe('grown');
    expect(d.attention[0].delta).toBe(2);
    expect(d.attention[0].shown.length).toBeGreaterThan(0);
    expect(d.allClear).toBe(false);
  });

  it('caps how many rows one section lists, and says how many it withheld', () => {
    const rows = Array.from({ length: 55 }, (_, i) => ({ id: i }));
    const d = buildDigest([check('bad-totals', rows)]);

    expect(d.attention[0].shown).toHaveLength(digest.MAX_ROWS);
    expect(d.attention[0].hidden).toBe(55 - digest.MAX_ROWS);
  });

  it('notes a tracked check that has shrunk, without calling it a finding', () => {
    const n = TRACKED['orphan-team-refs'].count;
    const rows = Array.from({ length: n - 5 }, (_, i) => ({ id: i }));
    const d = buildDigest([check('orphan-team-refs', rows)]);

    expect(d.attention).toHaveLength(0);
    expect(d.noted[0].status).toBe('shrunk');
    expect(d.noted[0].delta).toBe(-5);
    expect(d.allClear).toBe(true);
  });

  it('splits a predicate-tracked check: the known row is noted, an unknown one escalates', () => {
    const d = buildDigest([check('short-squads', [
      { team: 'Parrswood C', division: 'Division 5', men: 0, ladies: 0 },
      { team: 'Marple B', division: 'Division 2', men: 2, ladies: 4 },
    ])]);

    expect(d.attention).toHaveLength(1);
    const s = d.attention[0];
    expect(s.status).toBe('new');
    // Only the row nobody has accounted for is listed.
    expect(s.shown).toHaveLength(1);
    expect(s.shown[0].row.team).toBe('Marple B');
    expect(s.trackedRows).toBe(1);
  });

  // A baseline that outlives the problem it describes is the failure mode of putting
  // suppression in code. It has to ask to be deleted, or it silently keeps hiding detail
  // for a check that has nothing to hide.
  it('asks to be deleted once a count-tracked check finds nothing', () => {
    const d = buildDigest([check('orphan-team-refs', [])]);
    expect(d.attention).toHaveLength(0);
    expect(d.noted[0].status).toBe('resolved');
    expect(d.resolved).toHaveLength(1);
    // Resolved is not a known issue, so it must not be counted as one.
    expect(d.known).toHaveLength(0);
    expect(d.subject).toBe('[SBL audit] all clear');
  });

  it('asks to be deleted once a predicate-tracked check finds nothing', () => {
    const d = buildDigest([check('short-squads', [])]);
    expect(d.noted[0].status).toBe('resolved');
    expect(d.known).toHaveLength(0);
  });

  it('is quiet when a predicate-tracked check holds only its known rows', () => {
    const d = buildDigest([check('short-squads', [
      { team: 'Parrswood C', division: 'Division 5', men: 0, ladies: 0 },
    ])]);

    expect(d.attention).toHaveLength(0);
    expect(d.noted[0].status).toBe('tracked');
    expect(d.allClear).toBe(true);
  });
});

describe('buildDigest — a check that could not run', () => {
  it('surfaces the error as a finding rather than losing it', () => {
    const d = buildDigest([
      check('missing-contact', [], { error: 'check "missing-contact" needs DB_PI_KEY in the environment' }),
      check('bad-totals', []),
    ]);

    expect(d.failed).toHaveLength(1);
    expect(d.failed[0].error).toMatch(/DB_PI_KEY/);
    expect(d.attention).toContain(d.failed[0]);
    expect(d.allClear).toBe(false);
    // The other check is still classified, so one bad check does not blank the email.
    expect(d.clean.map(c => c.name)).toContain('bad-totals');
  });
});

describe('buildDigest — subject line', () => {
  it('says all clear when nothing needs attention', () => {
    const d = buildDigest(allClean());
    expect(d.allClear).toBe(true);
    expect(d.subject).toBe('[SBL audit] all clear');
    // Every baselined check finding nothing is 'resolved' rather than 'clean' — the
    // baseline still exists and is now asking to go.
    const nTracked = Object.keys(TRACKED).length;
    expect(d.resolved).toHaveLength(nTracked);
    expect(d.clean).toHaveLength(allClean().length - nTracked);
  });

  it('mentions the tracked issues in an otherwise clear week, so the count is visible', () => {
    const results = allClean();
    const t = results.find(r => r.name === 'ghost-teams');
    t.rows = [{ id: 91, team: 'Parrswood C', division: 'Division 5', players: 0 }];
    const d = buildDigest(results);

    expect(d.allClear).toBe(true);
    expect(d.subject).toBe('[SBL audit] all clear — 1 known issue tracked');
  });

  it('counts findings and failures separately', () => {
    const d = buildDigest([
      check('orphan-results', [{ id: 1 }]),
      check('bad-totals', [{ id: 2 }]),
      check('missing-contact', [], { error: 'boom' }),
    ]);
    expect(d.subject).toBe('[SBL audit] 2 new findings, 1 check failing');
  });

  it('singularises', () => {
    const d = buildDigest([check('orphan-results', [{ id: 1 }])]);
    expect(d.subject).toBe('[SBL audit] 1 new finding');
  });
});

describe('buildDigest — ordering', () => {
  it('puts the most severe finding first, not the check-list order', () => {
    const d = buildDigest([
      check('unranked-players', [{ id: 1 }], { severity: 'low' }),
      check('orphan-results', [{ id: 2 }], { severity: 'critical' }),
      check('orphan-drafts', [{ draft: 3 }], { severity: 'high' }),
    ]);
    expect(d.attention.map(s => s.name)).toEqual(['orphan-results', 'orphan-drafts', 'unranked-players']);
  });
});

describe('linkFor', () => {
  it('links a fixture finding to its own event page, absolutely', () => {
    const url = digest.linkFor('orphan-results',
      { id: 6600, played: '2026-08-29', home: 'Hazel Grove A', away: 'Marple B' });
    // Absolute, and on the real site rather than whatever host called the endpoint.
    expect(url).toMatch(/^https:\/\/stockport-badminton\.co\.uk\/event\/6600\//);
  });

  it('links a ghost team to the team admin page', () => {
    expect(digest.linkFor('ghost-teams', { id: 91, team: 'Parrswood C' }))
      .toBe('https://stockport-badminton.co.uk/admin/teams/91');
  });

  it('has no link for a check whose rows do not identify a page', () => {
    expect(digest.linkFor('duplicate-ranks', { team: 'Marple B', gender: 'Male', rank: 2 }))
      .toBe('https://stockport-badminton.co.uk/manage-players');
    expect(digest.linkFor('orphan-drafts', { draft: 2400 })).toBeNull();
  });
});

describe('TRACKED baselines', () => {
  // A baseline is a decision to stop looking at something, so it has to be reviewable.
  it('names an owning package and a reason for every entry', () => {
    for (const [name, t] of Object.entries(TRACKED)) {
      expect(typeof t.owner).toBe('string');
      expect(t.owner.length).toBeGreaterThan(0);
      expect(typeof t.note).toBe('string');
      expect(t.note.length).toBeGreaterThan(20);
      // Exactly one matching strategy, or the classification is ambiguous.
      expect(Boolean(t.count) !== Boolean(t.match)).toBe(true);
      expect(name).toBe(name.toLowerCase());
    }
  });

  it('only tracks checks that actually exist', () => {
    const names = require('../../tools/audit/checks').all().map(c => c.name);
    for (const name of Object.keys(TRACKED)) expect(names).toContain(name);
  });
});
