// Published results to Threads, from the queue, on the `sbl-results-threads` job.

process.env.NODE_ENV = 'test';

jest.mock('../../utils/threadsPublisher', () => ({ publishImage: jest.fn() }));
// The real `usable` over a mocked `withToken`, so the expiry rule itself is under test.
jest.mock('../../models/socialToken', () => {
  const m = jest.requireActual('../../models/socialToken');
  m.withToken = jest.fn();
  return m;
});
jest.mock('../../models/threadsResultPost', () => ({
  claim: jest.fn(), resultFor: jest.fn(),
  markPosted: jest.fn(), markFailed: jest.fn(), markSkipped: jest.fn(), release: jest.fn(),
}));

const request = require('supertest');
const app = require('../../app');
const threads = require('../../utils/threadsPublisher');
const SocialToken = require('../../models/socialToken');
const Queue = require('../../models/threadsResultPost');
const { ThreadsError } = require('../../utils/threadsAuth');

const TOKEN = 'social-cron-token-not-real';
const DAY = 24 * 60 * 60 * 1000;
const ACCOUNT = { accountId: '28753684917596556', token: 'THAA-stored', expiresAt: new Date(Date.now() + 50 * DAY) };
const RESULT = { status: 'complete', homeTeam: 'Tatton A', awayTeam: 'Mellor B', homeScore: 10, awayScore: 8, division: 'Division 1' };
const row = (over = {}) => ({ id: 1, fixtureId: 7200, attempts: 1, queuedAt: new Date(), ...over });

beforeEach(() => {
  jest.clearAllMocks();
  process.env.SOCIAL_CRON_TOKEN = TOKEN;
  SocialToken.withToken.mockResolvedValue(ACCOUNT);
  Queue.claim.mockResolvedValue([row()]);
  Queue.resultFor.mockResolvedValue(RESULT);
  threads.publishImage.mockResolvedValue({ mediaId: 't9', creationId: 'c1' });
});
afterEach(() => { delete process.env.SOCIAL_CRON_TOKEN; });

const post = () => request(app).post('/admin/social/results/threads').set('X-Social-Token', TOKEN);

it('refuses an anonymous caller with 403, not a redirect', async () => {
  const res = await request(app).post('/admin/social/results/threads');
  expect(res.status).toBe(403);
  expect(res.headers.location).toBeUndefined();
  expect(Queue.claim).not.toHaveBeenCalled();
});

it('posts the result card with the result as text, and records the post', async () => {
  const res = await post();
  expect(res.status).toBe(200);
  expect(res.body).toMatchObject({ ok: true, results: [{ fixtureId: 7200, outcome: 'posted', id: 't9' }] });

  const [userId, token, payload] = threads.publishImage.mock.calls[0];
  expect([userId, token]).toEqual(['28753684917596556', 'THAA-stored']);
  expect(payload.imageUrl).toBe(
    'https://stockport-badminton.co.uk/resultImage/Tatton%20A/Mellor%20B/10/8/Division%201.jpg');
  expect(payload.text).toContain('Division 1: Tatton A 10-8 Mellor B');
  expect([...payload.text].length).toBeLessThanOrEqual(500);
  expect(payload.text.match(/#\w+/g)).toEqual(['#badminton']);
  expect(Queue.markPosted).toHaveBeenCalledWith(1, 't9');
  expect(JSON.stringify(res.body)).not.toContain('THAA');
});

it('claims a bounded batch, so a backlog cannot hold one request for minutes', async () => {
  await post();
  expect(Queue.claim).toHaveBeenCalledWith(3);
});

it('answers 200 with nothing to do', async () => {
  Queue.claim.mockResolvedValue([]);
  const res = await post();
  expect(res.status).toBe(200);
  expect(res.body).toMatchObject({ ok: true, results: [] });
  expect(threads.publishImage).not.toHaveBeenCalled();
});

it('answers 503 with no account connected, and claims nothing so the queue waits', async () => {
  SocialToken.withToken.mockResolvedValue(null);
  const res = await post();
  expect(res.status).toBe(503);
  expect(res.body.error).toMatch(/\/admin\/threads/);
  expect(Queue.claim).not.toHaveBeenCalled();
});

it('answers 503 on an expired token, and claims nothing', async () => {
  SocialToken.withToken.mockResolvedValue({ ...ACCOUNT, expiresAt: new Date(Date.now() - 1000) });
  const res = await post();
  expect(res.status).toBe(503);
  expect(Queue.claim).not.toHaveBeenCalled();
});

it('skips a result queued over 48 hours ago rather than posting old news', async () => {
  Queue.claim.mockResolvedValue([row({ queuedAt: new Date(Date.now() - 3 * DAY) })]);
  const res = await post();
  expect(res.status).toBe(200);
  expect(threads.publishImage).not.toHaveBeenCalled();
  expect(Queue.markSkipped).toHaveBeenCalledWith(1, expect.stringMatching(/stale/));
});

it('skips a fixture that no longer has a result', async () => {
  Queue.resultFor.mockResolvedValue({ ...RESULT, homeScore: null, awayScore: null });
  await post();
  expect(threads.publishImage).not.toHaveBeenCalled();
  expect(Queue.markSkipped).toHaveBeenCalledWith(1, expect.stringMatching(/no longer has a result/));
});

describe('when Threads fails', () => {
  it('re-queues a post Threads cannot have published, and goes red', async () => {
    threads.publishImage.mockRejectedValue(new ThreadsError('Threads refused the image container: busy',
      { status: 500, step: 'the image container' }));
    const res = await post();
    expect(res.status).toBe(502);
    expect(res.body.results[0].outcome).toBe('retrying');
    expect(Queue.release).toHaveBeenCalledWith(1, expect.stringMatching(/busy/));
    expect(Queue.markFailed).not.toHaveBeenCalled();
  });

  it('re-queues a publish Threads answered with a refusal', async () => {
    threads.publishImage.mockRejectedValue(new ThreadsError('Threads refused the publish: nope',
      { status: 400, step: 'the publish' }));
    await post();
    expect(Queue.release).toHaveBeenCalled();
  });

  it('never re-queues a publish that got no answer, because it may be live', async () => {
    threads.publishImage.mockRejectedValue(new ThreadsError('Threads refused the publish: ECONNABORTED',
      { step: 'the publish' }));
    const res = await post();
    expect(res.status).toBe(502);
    expect(Queue.release).not.toHaveBeenCalled();
    expect(Queue.markFailed).toHaveBeenCalledWith(1, expect.stringMatching(/may be live/));
  });

  it('gives up after three attempts', async () => {
    Queue.claim.mockResolvedValue([row({ attempts: 3 })]);
    threads.publishImage.mockRejectedValue(new ThreadsError('busy', { status: 500, step: 'the container' }));
    await post();
    expect(Queue.release).not.toHaveBeenCalled();
    expect(Queue.markFailed).toHaveBeenCalled();
  });

  it('does not retry a post it refused itself', async () => {
    threads.publishImage.mockRejectedValue(new ThreadsError('too long', { step: 'validate' }));
    await post();
    expect(Queue.markFailed).toHaveBeenCalled();
    expect(Queue.release).not.toHaveBeenCalled();
  });
});

it('does not re-queue a live post whose recording failed', async () => {
  Queue.markPosted.mockRejectedValue(new Error('connection reset'));
  const res = await post();
  expect(res.status).toBe(500);
  expect(Queue.release).not.toHaveBeenCalled();
  expect(Queue.markFailed).not.toHaveBeenCalled();
});
