// Published results to Facebook and Instagram, from the queue, on the `sbl-results-meta` job
// (HARD-47). The same rules as the Threads job (threads-results.test.js), per target.

process.env.NODE_ENV = 'test';

// The real resultTargets/resultPostContent over mocked credentials, so what is posted and to
// whom is the production code's answer, not the mock's.
jest.mock('../../utils/metaPublisher', () => {
  const actual = jest.requireActual('../../utils/metaPublisher');
  return { ...actual, targets: jest.fn(), publishEverywhere: jest.fn() };
});
jest.mock('../../models/socialResultPost', () => ({
  claim: jest.fn(), resultFor: jest.fn(),
  markPosted: jest.fn(), markFailed: jest.fn(), markSkipped: jest.fn(), release: jest.fn(),
}));

const request = require('supertest');
const app = require('../../app');
const meta = require('../../utils/metaPublisher');
const Queue = require('../../models/socialResultPost');

const TOKEN = 'social-cron-token-not-real';
const DAY = 24 * 60 * 60 * 1000;
const PAGE = { id: '101950371354925', token: 'page-token-not-real' };
const IG = { id: '17841409056774880', token: 'page-token-not-real' };
const RESULT = { status: 'complete', homeTeam: 'Tatton A', awayTeam: 'Mellor B', homeScore: 10, awayScore: 8, division: 'Division 1' };
const row = (over = {}) => ({ id: 1, fixtureId: 7200, target: 'instagram', attempts: 1, queuedAt: new Date(), ...over });
const failedWith = (step, status, message = 'Meta refused it') => ({
  posted: [], failed: [{ target: 'Instagram', error: new meta.MetaError(message, { step, status }) }], ok: false,
});

beforeEach(() => {
  jest.clearAllMocks();
  process.env.SOCIAL_CRON_TOKEN = TOKEN;
  meta.targets.mockReturnValue({ stockportPage: PAGE, instagram: IG, tamesidePage: null });
  Queue.claim.mockResolvedValue([row()]);
  Queue.resultFor.mockResolvedValue(RESULT);
  meta.publishEverywhere.mockResolvedValue({ posted: [{ target: 'Instagram', kind: 'instagram', id: 'm9' }], failed: [], ok: true });
});
afterEach(() => {
  delete process.env.SOCIAL_CRON_TOKEN;
  delete process.env.SOCIAL_POST_STORY;
  delete process.env.SOCIAL_POST_FB_STORY;
});

const post = () => request(app).post('/admin/social/results/meta').set('X-Social-Token', TOKEN);

it('refuses an anonymous caller with 403, not a redirect', async () => {
  const res = await request(app).post('/admin/social/results/meta');
  expect(res.status).toBe(403);
  expect(res.headers.location).toBeUndefined();
  expect(Queue.claim).not.toHaveBeenCalled();
});

it('posts the result card to the row\'s target only, and records the post', async () => {
  const res = await post();
  expect(res.status).toBe(200);
  expect(res.body).toMatchObject({ ok: true, results: [{ fixtureId: 7200, target: 'instagram', outcome: 'posted', id: 'm9' }] });

  const [targets, payload] = meta.publishEverywhere.mock.calls[0];
  expect(targets).toHaveLength(1);
  expect(targets[0]).toMatchObject({ kind: 'instagram', name: 'Instagram', id: IG.id, token: IG.token });
  expect(payload.imageUrls).toBe(
    'https://stockport-badminton.co.uk/resultImage/Tatton%20A/Mellor%20B/10/8/Division%201.jpg');
  expect(payload.message).toContain('Result: Tatton A vs Mellor B : 10-8');
  expect(Queue.markPosted).toHaveBeenCalledWith(1, 'm9');
  expect(JSON.stringify(res.body)).not.toContain('page-token');
});

it('posts each of a fixture\'s targets as its own row, the story with the 9:16 card', async () => {
  process.env.SOCIAL_POST_FB_STORY = 'true';
  Queue.claim.mockResolvedValue([row({ id: 1, target: 'page' }), row({ id: 2, target: 'page-story' })]);
  const res = await post();
  expect(res.status).toBe(200);
  expect(meta.publishEverywhere.mock.calls.map(c => c[0][0].kind)).toEqual(['page', 'page-story']);
  expect(meta.publishEverywhere.mock.calls[1][1].storyImageUrl).toMatch(/\/Division%201\/story\.jpg$/);
});

it('claims a bounded batch, so a backlog cannot hold one request for minutes', async () => {
  await post();
  expect(Queue.claim).toHaveBeenCalledWith(8);
});

it('answers 200 with nothing to do', async () => {
  Queue.claim.mockResolvedValue([]);
  const res = await post();
  expect(res.status).toBe(200);
  expect(res.body).toMatchObject({ ok: true, results: [] });
  expect(meta.publishEverywhere).not.toHaveBeenCalled();
});

it('skips a result queued over 48 hours ago rather than posting old news', async () => {
  Queue.claim.mockResolvedValue([row({ queuedAt: new Date(Date.now() - 3 * DAY) })]);
  const res = await post();
  expect(res.status).toBe(200);
  expect(meta.publishEverywhere).not.toHaveBeenCalled();
  expect(Queue.markSkipped).toHaveBeenCalledWith(1, expect.stringMatching(/stale/));
});

it('skips a fixture that no longer has a result', async () => {
  Queue.resultFor.mockResolvedValue({ ...RESULT, homeScore: null, awayScore: null });
  await post();
  expect(meta.publishEverywhere).not.toHaveBeenCalled();
  expect(Queue.markSkipped).toHaveBeenCalledWith(1, expect.stringMatching(/no longer has a result/));
});

// Queued while the story flag was on, posted after it was turned off, or with a credential
// gone from the service: either way a person has something to fix, so it is not "skipped".
it('fails a row whose target is no longer configured, and goes red', async () => {
  Queue.claim.mockResolvedValue([row({ target: 'instagram-story' })]);
  const res = await post();
  expect(res.status).toBe(502);
  expect(meta.publishEverywhere).not.toHaveBeenCalled();
  expect(Queue.markFailed).toHaveBeenCalledWith(1, expect.stringMatching(/no instagram-story target/));
});

describe('when Meta fails', () => {
  // The one that actually happened, five times: answered, so nothing was published.
  it('re-queues "media is not ready", and goes red', async () => {
    meta.publishEverywhere.mockResolvedValue(failedWith('the Instagram publish', 400,
      'Meta refused the Instagram publish: The media is not ready to be published. Please wait a moment.'));
    const res = await post();
    expect(res.status).toBe(502);
    expect(res.body.results[0].outcome).toBe('retrying');
    expect(Queue.release).toHaveBeenCalledWith(1, expect.stringMatching(/not ready/));
    expect(Queue.markFailed).not.toHaveBeenCalled();
  });

  it('re-queues a failure before the publishing step', async () => {
    meta.publishEverywhere.mockResolvedValue(failedWith('an Instagram media container'));
    await post();
    expect(Queue.release).toHaveBeenCalled();
  });

  it('never re-queues a publish that got no answer, because it may be live', async () => {
    meta.publishEverywhere.mockResolvedValue(failedWith('the Instagram publish', undefined, 'timeout of 60000ms exceeded'));
    const res = await post();
    expect(res.status).toBe(502);
    expect(Queue.release).not.toHaveBeenCalled();
    expect(Queue.markFailed).toHaveBeenCalledWith(1, expect.stringMatching(/may be live; check Instagram/));
  });

  it('gives up after three attempts', async () => {
    Queue.claim.mockResolvedValue([row({ attempts: 3 })]);
    meta.publishEverywhere.mockResolvedValue(failedWith('an Instagram media container', 500));
    await post();
    expect(Queue.release).not.toHaveBeenCalled();
    expect(Queue.markFailed).toHaveBeenCalled();
  });

  it('does not retry a post it refused itself', async () => {
    meta.publishEverywhere.mockResolvedValue(failedWith('validate'));
    await post();
    expect(Queue.markFailed).toHaveBeenCalled();
    expect(Queue.release).not.toHaveBeenCalled();
  });

  it('carries on to the next row when one fails', async () => {
    Queue.claim.mockResolvedValue([row({ id: 1, target: 'page' }), row({ id: 2, target: 'instagram' })]);
    meta.publishEverywhere
      .mockResolvedValueOnce(failedWith('a photo upload', 500))
      .mockResolvedValueOnce({ posted: [{ target: 'Instagram', kind: 'instagram', id: 'm9' }], failed: [], ok: true });
    const res = await post();
    expect(res.status).toBe(502);
    expect(res.body.results.map(r => r.outcome)).toEqual(['retrying', 'posted']);
    expect(Queue.markPosted).toHaveBeenCalledWith(2, 'm9');
  });
});

it('does not re-queue a live post whose recording failed', async () => {
  Queue.markPosted.mockRejectedValue(new Error('connection reset'));
  const res = await post();
  expect(res.status).toBe(500);
  expect(Queue.release).not.toHaveBeenCalled();
  expect(Queue.markFailed).not.toHaveBeenCalled();
});
