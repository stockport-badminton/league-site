// models/spamControls.js and models/homepageContent.js against a real Postgres (REARCH-01).
//
// The snapshots covered the reads that have local data. The local submission_log is
// empty, so its two reads answered [] before and after whatever the query did, and none
// of the writes can be snapshotted. Those are here.
const db = require('../../db_connect');
const Spam = require('../../models/spamControls');
const HomepageContent = require('../../models/homepageContent');

const run = (text, params) => db.otherConnect().then(c => c.query(text, params)).then(([r]) => [...r]);

describe('spamControls', () => {
  it('add is case-insensitive on the value, reactivates, and keeps an existing note', async () => {
    const id = await Spam.add({ kind: 'email', value: '  Spammer@Example.invalid ', note: 'first seen', createdBy: 'admin' });
    expect(Number.isInteger(id)).toBe(true);
    expect(await Spam.isBlockedEmail('spammer@example.invalid')).toBe(true);

    await Spam.setActive(id, false);
    expect(await Spam.isBlockedEmail('spammer@example.invalid')).toBe(false);

    // Same entry in different case: the unique index on LOWER(value) makes it the same row.
    expect(await Spam.add({ kind: 'email', value: 'SPAMMER@example.invalid' })).toBe(id);
    expect(await run('SELECT value, note, active FROM blocked_entry WHERE id = ?', [id]))
      .toEqual([{ value: 'Spammer@Example.invalid', note: 'first seen', active: true }]);
    expect(await Spam.isBlockedEmail('spammer@example.invalid')).toBe(true);
  });

  it('list orders by kind, newest first within a kind', async () => {
    const rows = await Spam.list();
    expect(Object.keys(rows[0]).sort()).toEqual(['active', 'created_at', 'created_by', 'id', 'kind', 'note', 'value']);
    const kinds = rows.map(r => r.kind);
    expect(kinds).toEqual([...kinds].sort());
  });

  it('logSubmission truncates what it keeps, and the admin reads count it', async () => {
    await run("DELETE FROM submission_log");
    await Spam.logSubmission({ endpoint: '/contact-us', ip: '10.0.0.9', verdict: 'rejected', reason: 'honeypot',
      excerpt: 'x'.repeat(500), userAgent: 'u'.repeat(400) });
    await Spam.logSubmission({ endpoint: '/contact-us', verdict: 'accepted' });
    await Spam.logSubmission({ endpoint: '/contact-us', verdict: 'rejected', reason: 'honeypot' });
    await run("UPDATE submission_log SET created_at = now() - interval '3 days' WHERE verdict = 'accepted'");

    const recent = await Spam.recentSubmissions(2);
    expect(recent).toHaveLength(2);
    expect(recent.every(r => r.verdict === 'rejected')).toBe(true);
    const long = recent.find(r => r.excerpt);
    expect(long.excerpt).toHaveLength(200);
    expect(long.user_agent).toHaveLength(300);
    expect(long.email).toBeNull();

    expect([...await Spam.submissionStats()]).toEqual([
      { verdict: 'rejected', reason: 'honeypot', n: 2, last7: 2, last24h: 2 },
      { verdict: 'accepted', reason: null, n: 1, last7: 1, last24h: 0 },
    ]);
  });

  it('logSubmission never throws, even when the write fails', async () => {
    const errors = jest.spyOn(require('../../utils/log'), 'error').mockImplementation(() => {});
    await expect(Spam.logSubmission({ endpoint: '/x', verdict: null })).resolves.toBeUndefined();
    expect(errors).toHaveBeenCalledWith(
      { err: expect.objectContaining({ message: expect.stringMatching(/null value/) }) },
      'spamControls: could not log submission');
    errors.mockRestore();
  });

  // The blocklist is refreshed by the request path, not a timer (a timer fires on a
  // CPU-throttled Cloud Run instance; see refreshIfStale). So a new entry must reach the
  // synchronous IP check through refreshIfStale alone, once the cache has gone stale.
  it('refreshIfStale reloads a stale cache once, however many requests ask', async () => {
    const ip = '203.0.113.77';
    await Spam.refresh();
    // Straight into the table: Spam.add reloads the cache itself, which is not the path under test.
    await run('INSERT INTO blocked_entry (kind, value) VALUES (?, ?)', ['ip', ip]);

    expect(Spam.refreshIfStale()).toBeNull();                 // fresh: nothing to do
    expect(Spam.isBlockedIpSync(ip)).toBe(false);

    const now = Date.now();
    const clock = jest.spyOn(Date, 'now').mockReturnValue(now + 61 * 1000);
    try {
      const first = Spam.refreshIfStale();
      expect(first).toBeInstanceOf(Promise);
      expect(Spam.refreshIfStale()).toBe(first);              // concurrent requests share it
      await first;
      expect(Spam.isBlockedIpSync(ip)).toBe(true);
      expect(Spam.refreshIfStale()).toBeNull();               // and it is fresh again
    } finally {
      clock.mockRestore();
    }
  });
});

describe('homepageContent', () => {
  const card = { title: 'Messer final', teaser_html: '<p>Sunday</p>', modal_body_html: null, image_url: null,
    show_gallery_link: true, sort_order: -5, active: true };

  it('create, update and delete an announcement; getActive orders by sort_order', async () => {
    await HomepageContent.create(card);
    const [made] = (await HomepageContent.getActive()).filter(a => a.title === 'Messer final');
    expect(made).toMatchObject(card);
    expect((await HomepageContent.getActive())[0].id).toBe(made.id);

    await run("UPDATE homepage_announcement SET updated_at = now() - interval '1 day' WHERE id = ?", [made.id]);
    await HomepageContent.updateById(made.id, { ...card, title: 'Messer final — moved', active: false });
    const updated = await HomepageContent.getById(made.id);
    expect(updated).toMatchObject({ title: 'Messer final — moved', active: false });
    expect(Date.now() - updated.updated_at.getTime()).toBeLessThan(60000);
    expect((await HomepageContent.getActive()).some(a => a.id === made.id)).toBe(false);
    expect((await HomepageContent.getAll()).some(a => a.id === made.id)).toBe(true);

    await HomepageContent.deleteById(made.id);
    expect(await HomepageContent.getById(made.id)).toBeUndefined();
  });
});
