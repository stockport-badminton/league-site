// utils/authCull.js: which logins the monthly cull warns, waits on, or lists for deletion.
const { classify } = require('../../utils/authCull');

const NOW = Date.parse('2026-11-05T12:00:00Z');
const daysAgo = n => new Date(NOW - n * 864e5).toISOString();

const user = (id, o = {}) => ({
  user_id: id, email: id + '@example.com', last_login: daysAgo(400), created_at: daysAgo(900),
  ...o, app_metadata: { betaAccess: true, ...(o.md || {}) },
});
const PLAYER = { id: 1, first_name: 'Dave', family_name: 'Lee' };

function run(users, { players = [], tameside = [], notices = {} } = {}) {
  const playersByEmail = new Map(players.map(id => [`${id}@example.com`, PLAYER]));
  const out = classify(users, { playersByEmail, tamesideLinked: new Set(tameside) },
    new Map(Object.entries(notices)), NOW);
  const ids = list => list.map(e => e.account.user_id);
  return { notify: ids(out.notify), waiting: ids(out.waiting), due: ids(out.due), raw: out };
}

describe('login cull: whose accounts', () => {
  it('ours: linked here, or unlinked and not signed up on Tameside; never one Tameside has linked', () => {
    const r = run([
      user('linked', { md: { league: 'tameside' } }),   // signed up there, plays here: ours
      user('unlinked-untagged'),                         // Google signups carry no tag: ours
      user('unlinked-stockport', { md: { league: 'stockport' } }),
      user('unlinked-tameside', { md: { league: 'tameside' } }), // Tameside's
      user('tameside-linked', { md: { league: 'stockport' } }),  // Tameside's link wins
      user('both-linked'),                                       // so does it here
    ], { players: ['linked', 'both-linked'], tameside: ['tameside-linked', 'both-linked'] });
    expect(r.notify.sort()).toEqual(['linked', 'unlinked-stockport', 'unlinked-untagged']);
    expect([...r.waiting, ...r.due]).toEqual([]);
  });

  it('matches the player by address ignoring case', () => {
    const r = run([user('Mixed', { email: 'MIXED@Example.com' })], { players: ['mixed'] });
    expect(r.raw.notify[0].player).toBe(PLAYER);
  });
});

describe('login cull: the cycle', () => {
  it('leaves a login used within the year alone, on either site', () => {
    expect(run([user('a', { last_login: daysAgo(300) })]).notify).toEqual([]);
  });

  it('judges a never-used login by its signup date', () => {
    const r = run([user('new', { last_login: null, created_at: daysAgo(20) }),
      user('old', { last_login: null, created_at: daysAgo(500) })]);
    expect(r.notify).toEqual(['old']);
  });

  it('warns once, waits a month, then lists it', () => {
    const u = [user('a')];
    expect(run(u, { notices: { a: { notified_at: daysAgo(10) } } }).waiting).toEqual(['a']);
    const due = run(u, { notices: { a: { notified_at: daysAgo(31) } } });
    expect(due.due).toEqual(['a']);
    expect(due.raw.due[0].reason).toBe('no answer to the warning');
  });

  it('a login after the warning is the answer', () => {
    const r = run([user('a', { last_login: daysAgo(5) })], { notices: { a: { notified_at: daysAgo(20) } } });
    expect([...r.notify, ...r.waiting, ...r.due]).toEqual([]);
  });

  it('the keep link counts as use for a year', () => {
    const r = run([user('a')], { notices: { a: { notified_at: daysAgo(40), kept_at: daysAgo(35) } } });
    expect([...r.notify, ...r.waiting, ...r.due]).toEqual([]);
  });

  it('a warning from an earlier year does not count: warn again', () => {
    // Warned 500 days ago, logged in 450 days ago, idle since.
    const r = run([user('a', { last_login: daysAgo(450) })], { notices: { a: { notified_at: daysAgo(500) } } });
    expect(r.notify).toEqual(['a']);
  });

  it('lists one that cannot be warned without emailing it', () => {
    const r = run([
      user('pending', { md: { betaAccess: false } }),
      user('no-address', { email: undefined }),
    ]);
    expect(r.notify).toEqual([]);
    expect(r.raw.due.map(e => [e.account.user_id, e.reason]))
      .toEqual([['pending', 'never approved'], ['no-address', 'no address to warn']]);
  });
});
