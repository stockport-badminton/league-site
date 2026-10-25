// models/registrationRequest.js against a real Postgres (REARCH-01).
//
// Snapshots cover the reads. The writes are jsonb surgery — jsonb_set on one array index,
// an append, a redelivery that must not queue twice — and are run here, against the
// string queries first and then, unchanged, against the typed ones.
const db = require('../../db_connect');
const Requests = require('../../models/registrationRequest');

const run = (text, params) => db.otherConnect().then(c => c.query(text, params)).then(([r]) => [...r]);

const email = (over = {}) => Object.assign({
  messageId: 'rearch01-reg-1', forwardedBy: 'sec@club.example.invalid', originalFrom: 'captain@club.example.invalid',
  subject: 'New players', bodyText: 'Please register Ann and Bob',
  attachments: [{ name: 'form.pdf', key: 'inbound-email/x' }],
  candidates: [{ name: 'Ann Example', team: 4 }, { name: 'Bob Example', team: 4 }],
}, over);

describe('registrationRequest', () => {
  it('create queues an email once; a redelivery answers null and adds nothing', async () => {
    const id = await Requests.create(email());
    expect(typeof id).toBe('number');
    expect(await Requests.create(email())).toBeNull();
    expect(await run("SELECT count(*)::int AS n FROM registration_request WHERE message_id = 'rearch01-reg-1'"))
      .toEqual([{ n: 1 }]);

    const [kinds] = await run(
      'SELECT jsonb_typeof(attachments) AS a, jsonb_typeof(candidates) AS c FROM registration_request WHERE id = ?', [id]);
    expect(kinds).toEqual({ a: 'array', c: 'array' });
  });

  it('getById and list return the request in the shape the page reads', async () => {
    const id = await Requests.create(email());
    const got = await Requests.getById(id);
    expect(Object.keys(got).sort()).toEqual(['attachments', 'bodyText', 'candidates', 'closedAt', 'closedBy',
      'forwardedBy', 'id', 'originalFrom', 'receivedAt', 'status', 'subject']);
    expect(got).toMatchObject({ status: 'pending', bodyText: 'Please register Ann and Bob',
      candidates: email().candidates, attachments: email().attachments });

    const listed = (await Requests.list('pending')).find(r => r.id === id);
    expect(Object.keys(listed).sort()).toEqual(['candidates', 'closedAt', 'closedBy', 'forwardedBy', 'id',
      'originalFrom', 'receivedAt', 'status', 'subject']);
    expect(await Requests.getById(999999)).toBeNull();
  });

  it('setCandidate replaces one person in place, and refuses an index past the end', async () => {
    const id = await Requests.create(email());
    const after = await Requests.setCandidate(id, 1, { name: 'Robert Example', team: 4, outcome: 'created' });
    expect(after).toEqual([{ name: 'Ann Example', team: 4 }, { name: 'Robert Example', team: 4, outcome: 'created' }]);
    expect(await Requests.setCandidate(id, 2, { name: 'Nobody' })).toBeNull();
    expect((await Requests.getById(id)).candidates).toHaveLength(2);
  });

  it('appendCandidate adds a person the reading missed', async () => {
    const id = await Requests.create(email());
    expect(await Requests.appendCandidate(id, { name: 'Cat Example' })).toEqual([...email().candidates, { name: 'Cat Example' }]);
    expect(await Requests.appendCandidate(999999, { name: 'x' })).toBeNull();
  });

  it('setStatus closes with who and when, and reopening clears both; countPending follows', async () => {
    const before = await Requests.countPending();
    const id = await Requests.create(email());
    expect(await Requests.countPending()).toBe(before + 1);

    expect(await Requests.setStatus(id, 'done', 'admin@example.invalid')).toBe(true);
    expect(await Requests.getById(id)).toMatchObject({ status: 'done', closedBy: 'admin@example.invalid' });
    expect((await Requests.getById(id)).closedAt).toBeInstanceOf(Date);
    expect(await Requests.countPending()).toBe(before);

    expect(await Requests.setStatus(id, 'pending', 'admin@example.invalid')).toBe(true);
    expect(await Requests.getById(id)).toMatchObject({ status: 'pending', closedBy: null, closedAt: null });
    expect(await Requests.setStatus(999999, 'dismissed', 'x')).toBe(false);
  });

  it('registrableTeams leaves out the No Club sentinel', async () => {
    const [noClub] = await run("SELECT id FROM club ORDER BY id LIMIT 1");
    const teams = await Requests.registrableTeams(noClub.id);
    expect(teams.length).toBeGreaterThan(0);
    expect(teams.some(t => t.clubId === noClub.id)).toBe(false);
    expect(Object.keys(teams[0]).sort()).toEqual(['clubId', 'clubName', 'id', 'name']);
  });
});
