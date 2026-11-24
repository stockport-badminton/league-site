// models/push.js against a real Postgres: the subscription store, who a notification reaches,
// the at-most-once send ledger, and the fixtures a reminder or result is built from.
const db = require('../../db_connect');
const Push = require('../../models/push');

const run = (text, params) => db.otherConnect().then(c => c.query(text, params)).then(([r]) => [...r]);

const sub = (id, teams, types = []) => ({
  id, endpoint: `https://fcm.googleapis.com/fcm/send/${id}`, p256dh: 'p' + id, auth: 'a' + id, teams, types,
});

beforeEach(async () => {
  await run('DELETE FROM push_subscription');
  await run('DELETE FROM push_send');
});

describe('subscriptions', () => {
  it('saves, updates in place keeping created_at, reads back and removes', async () => {
    await Push.upsertSubscription(sub('s1', [1, 2], ['results']));
    const [before] = await run('SELECT created_at FROM push_subscription WHERE id = ?', ['s1']);
    await Push.upsertSubscription({ ...sub('s1', [3]), p256dh: 'rotated' });

    expect(await Push.getSubscription('s1')).toEqual({ teams: [3], types: [] });
    const [after] = await run('SELECT p256dh, created_at, updated_at FROM push_subscription WHERE id = ?', ['s1']);
    expect(after.p256dh).toBe('rotated');
    expect(after.created_at).toEqual(before.created_at);
    expect(await run('SELECT count(*)::int AS n FROM push_subscription')).toEqual([{ n: 1 }]);

    expect(await Push.removeSubscriptions(['s1', 'nope'])).toBe(1);
    expect(await Push.getSubscription('s1')).toBeNull();
    expect(await Push.removeSubscriptions([])).toBe(0);
  });

  it('refuses a subscription with no teams', async () => {
    await expect(Push.upsertSubscription(sub('s0', []))).rejects.toThrow(/check/i);
  });

  it('subscribersFor matches any shared team, and a type unless the subscription wants all types', async () => {
    await Push.upsertSubscription(sub('home', [1]));
    await Push.upsertSubscription(sub('away', [2, 5], ['reminders']));
    await Push.upsertSubscription(sub('results-only', [2], ['results']));
    await Push.upsertSubscription(sub('other', [7]));

    const ids = async what => (await Push.subscribersFor(what)).map(r => r.id);
    expect(await ids({ teams: [1, 2], type: 'results' })).toEqual(['home', 'results-only']);
    expect(await ids({ teams: [1, 2], type: 'reminders' })).toEqual(['away', 'home']);
    expect(await ids({ teams: [5] })).toEqual(['away']);
    expect(await ids({})).toEqual(['away', 'home', 'other', 'results-only']);

    const [row] = await Push.subscribersFor({ teams: [1] });
    expect(row).toEqual({ id: 'home', endpoint: 'https://fcm.googleapis.com/fcm/send/home', p256dh: 'phome', auth: 'ahome' });
  });

  it('markSent stamps last_sent_at; teamCounts counts followers per team with names', async () => {
    await Push.upsertSubscription(sub('a', [1, 2]));
    await Push.upsertSubscription(sub('b', [1]));
    await Push.markSent(['a']);
    expect(await run('SELECT id, last_sent_at IS NOT NULL AS sent FROM push_subscription ORDER BY id'))
      .toEqual([{ id: 'a', sent: true }, { id: 'b', sent: false }]);

    expect(await Push.teamCounts()).toEqual({
      subscriptions: 2,
      teams: [{ id: 1, name: 'Northfield A', subscribers: 2 }, { id: 2, name: 'Southgate A', subscribers: 1 }],
    });
  });
});

describe('the send ledger', () => {
  it('claimSend is true once per key; recordSummary and recentSends read it back', async () => {
    expect(await Push.claimSend('result-301')).toBe(true);
    expect(await Push.claimSend('result-301')).toBe(false);
    expect(await Push.claimSend('result-302')).toBe(true);
    await Push.recordSummary('result-301', { sent: 3 });

    const recent = await Push.recentSends(10);
    expect(recent.map(r => r.key).sort()).toEqual(['result-301', 'result-302']);
    expect(recent.find(r => r.key === 'result-301')).toMatchObject({ summary: { sent: 3 } });
    expect(recent[0].sentAt).toBeInstanceOf(Date);
  });
});

describe('fixtures', () => {
  afterEach(() => run("UPDATE team SET starttime = NULL WHERE id = 4"));

  it('remindersFor returns that UK day\'s outstanding fixtures with start time, venue and division', async () => {
    // 304 (Northfield B v Eastbank A) is still to be played; 303, the same day's other
    // meeting the season before, was played in the seed.
    await run("UPDATE team SET starttime = '19:30' WHERE id = 4");
    const rows = await Push.remindersFor('2027-02-09');
    expect(rows).toEqual([expect.objectContaining({
      id: 304, homeTeamId: 4, awayTeamId: 3, homeTeam: 'Northfield B', awayTeam: 'Eastbank A',
      startTime: '19:30', venueName: 'Northfield Leisure Centre', status: 'outstanding',
    })]);
    expect(rows[0].divisionName).toEqual(expect.any(String));
    expect(await Push.remindersFor('2027-02-08')).toEqual([]);
    expect(await Push.remindersFor('2027-02-10')).not.toContainEqual(expect.objectContaining({ id: 304 }));
  });

  it('remindersFor leaves out a fixture that is no longer outstanding', async () => {
    expect(await run('SELECT status FROM fixture WHERE id = 303')).toEqual([{ status: 'complete' }]);
    expect(await Push.remindersFor('2026-09-17')).toEqual([]);
    try {
      await run("UPDATE fixture SET status = 'rearranged' WHERE id = 304");
      expect(await Push.remindersFor('2027-02-09')).toEqual([]);
    } finally {
      await run("UPDATE fixture SET status = 'outstanding' WHERE id = 304");
    }
  });

  it('remindersFor refuses anything but a date', async () => {
    await expect(Push.remindersFor("2026-09-17' OR 1=1")).rejects.toThrow(/not a date/);
  });

  it('resultFor reads one fixture, or null', async () => {
    expect(await Push.resultFor(301)).toMatchObject({ id: 301, homeTeam: 'Northfield A', awayTeam: 'Southgate A' });
    expect(await Push.resultFor(999999)).toBeNull();
  });

  it('followableTeams leaves out a team whose division does not exist (the "No Team" placeholder)', async () => {
    await run('UPDATE team SET division = 0 WHERE id = 8');
    try {
      expect((await Push.followableTeams()).map(t => t.id)).not.toContain(8);
    } finally {
      await run('UPDATE team SET division = 4 WHERE id = 8');
    }
  });

  it('followableTeams are the league teams, not withdrawn, with their club', async () => {
    const teams = await Push.followableTeams();
    expect(teams.length).toBeGreaterThan(0);
    expect(teams.find(t => t.id === 1)).toMatchObject({ name: 'Northfield A', clubName: 'Northfield' });
    const clubs = teams.map(t => t.clubName);
    expect(clubs).toEqual([...clubs].sort());
    expect(teams.every(t => t.divisionName)).toBe(true);
  });
});
