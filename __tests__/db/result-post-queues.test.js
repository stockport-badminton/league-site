// The two result-post queues against a real Postgres (REARCH-01): claim and the finishing
// writes are on the typed query layer; enqueue is still the string query, because it runs
// inside the publish request and that path is converted in the off-season. Testing the
// queue end to end covers both halves meeting.
const db = require('../../db_connect');
const SocialResultPost = require('../../models/socialResultPost');
const ThreadsResultPost = require('../../models/threadsResultPost');

const run = (text, params) => db.otherConnect().then(c => c.query(text, params)).then(([r]) => [...r]);

// Seed fixtures, in id order. None is queued in the seed.
const FIXTURES = [301, 302, 303];

const queues = [
  ['social_result_post', SocialResultPost, async id => SocialResultPost.enqueue(id, ['page'])],
  ['threads_result_post', ThreadsResultPost, async id => ThreadsResultPost.enqueue(id)],
];

describe.each(queues)('%s', (table, Queue, enqueue) => {
  beforeEach(async () => {
    const existing = await run(`SELECT id FROM fixture WHERE id IN (${FIXTURES.join(',')})`);
    expect(existing).toHaveLength(FIXTURES.length);
    for (const id of FIXTURES) await enqueue(id);
  });

  it('claim takes the oldest pending rows up to the limit, marks them posting, and counts the attempt', async () => {
    const claimed = await Queue.claim(2);
    expect(claimed.map(r => r.fixtureId).sort()).toEqual([301, 302]);
    for (const r of claimed) {
      expect(r.attempts).toBe(1);
      expect(r.queuedAt).toBeInstanceOf(Date);
    }
    const states = await run(`SELECT fixture_id, state, claimed_at IS NOT NULL AS claimed FROM ${table} ORDER BY fixture_id`);
    expect(states.filter(s => FIXTURES.includes(s.fixture_id))).toEqual([
      { fixture_id: 301, state: 'posting', claimed: true },
      { fixture_id: 302, state: 'posting', claimed: true },
      { fixture_id: 303, state: 'pending', claimed: false },
    ]);
  });

  it('a finishing write closes only a row this run claimed, and says how many it wrote', async () => {
    const [row] = await Queue.claim(1);
    expect(await Queue.markPosted(row.id, 'media-1')).toBe(1);
    // Already posted: no longer `posting`, so nothing to close.
    expect(await Queue.markFailed(row.id, 'late failure')).toBe(0);
    expect(await run(`SELECT state, media_id, last_error, posted_at IS NOT NULL AS posted FROM ${table} WHERE id = ?`, [row.id]))
      .toEqual([{ state: 'posted', media_id: 'media-1', last_error: null, posted: true }]);

    const [unclaimed] = await run(`SELECT id FROM ${table} WHERE state = 'pending' ORDER BY id LIMIT 1`);
    expect(await Queue.markSkipped(unclaimed.id, 'never claimed')).toBe(0);
  });

  it('release puts a claimed row back in the queue with its error; the next claim takes it again', async () => {
    const [row] = await Queue.claim(1);
    expect(await Queue.release(row.id, 'Meta said try later')).toBe(1);
    expect(await run(`SELECT state, last_error FROM ${table} WHERE id = ?`, [row.id]))
      .toEqual([{ state: 'pending', last_error: 'Meta said try later' }]);
    const [again] = await Queue.claim(1);
    expect(again).toMatchObject({ id: row.id, attempts: 2 });
  });

  it('resultFor reads the fixture as it stands', async () => {
    const r = await Queue.resultFor(302);
    expect(Object.keys(r).sort()).toEqual(['awayScore', 'awayTeam', 'division', 'homeScore', 'homeTeam', 'status']);
    expect(await Queue.resultFor(999999)).toBeNull();
  });
});
