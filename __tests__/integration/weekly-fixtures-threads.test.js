// The weekly fixtures cards to Threads, on their own route and scheduler job.
//
// What differs from the tables carousel: the number of cards follows the week, so one card
// has to go out as a single image (a Threads carousel takes at least two), and an empty
// week posts nothing and must not need a token to say so.

process.env.NODE_ENV = 'test';

jest.mock('../../utils/threadsPublisher', () => ({
  publishImage: jest.fn(),
  publishCarousel: jest.fn(),
  validateImages: jest.fn(),
}));
// The real `usable` over a mocked `withToken`, so the expiry rule itself is under test.
jest.mock('../../models/socialToken', () => {
  const m = jest.requireActual('../../models/socialToken');
  m.withToken = jest.fn();
  return m;
});
jest.mock('../../models/club', () => ({ getInstagramHandles: jest.fn() }));

const request = require('supertest');
const app = require('../../app');
const threads = require('../../utils/threadsPublisher');
const SocialToken = require('../../models/socialToken');
const Club = require('../../models/club');
const Fixture = require('../../models/fixture');

const TOKEN = 'social-cron-token-not-real';
const DAY = 24 * 60 * 60 * 1000;
const ACCOUNT = { accountId: '28753684917596556', token: 'THAA-stored', expiresAt: new Date(Date.now() + 50 * DAY) };

const fixture = (id, divisionName) => ({
  id, dayLabel: 'Mon 5 Oct', homeTeam: 'Mellor A', awayTeam: 'GHAP A',
  homeClub: 'Mellor', awayClub: 'G.H.A.P', divisionName,
});
const TWO_DIVISIONS = [fixture(1, 'Premier'), fixture(2, 'Premier'), fixture(3, 'Division 2')];

let spy;
beforeEach(() => {
  jest.clearAllMocks();
  process.env.SOCIAL_CRON_TOKEN = TOKEN;
  spy = jest.spyOn(Fixture, 'getUpcomingWeek').mockResolvedValue(TWO_DIVISIONS);
  SocialToken.withToken.mockResolvedValue(ACCOUNT);
  threads.publishCarousel.mockResolvedValue({ mediaId: 't1', creationId: 'c9' });
  threads.publishImage.mockResolvedValue({ mediaId: 't2', creationId: 'c8' });
  threads.validateImages.mockResolvedValue({ ok: true, refused: [] });
  Club.getInstagramHandles.mockResolvedValue([{ name: 'Mellor', handle: 'mellorbadminton' }]);
});
afterEach(() => {
  spy.mockRestore();
  delete process.env.SOCIAL_CRON_TOKEN;
});

const post = (qs = '') => request(app).post('/admin/social/weekly-fixtures/threads' + qs)
  .set('X-Social-Token', TOKEN);

it('refuses an anonymous caller with 403, not a redirect', async () => {
  const res = await request(app).post('/admin/social/weekly-fixtures/threads');
  expect(res.status).toBe(403);
  expect(res.headers.location).toBeUndefined();
  expect(threads.publishCarousel).not.toHaveBeenCalled();
});

it('posts the divisions that are playing as one carousel, in table order', async () => {
  const res = await post();
  expect(res.status).toBe(200);
  expect(res.body).toMatchObject({ ok: true, fixtures: 3, posted: [{ target: 'Threads', id: 't1' }] });

  const [userId, token, payload] = threads.publishCarousel.mock.calls[0];
  expect([userId, token]).toEqual(['28753684917596556', 'THAA-stored']);
  expect(payload.imageUrls).toEqual([
    'https://stockport-badminton.co.uk/fixtures-image/Premier.jpg',
    'https://stockport-badminton.co.uk/fixtures-image/Division%202.jpg',
  ]);
  expect(JSON.stringify(res.body)).not.toContain('THAA');
});

it('posts a single card as an image, because a carousel needs two', async () => {
  spy.mockResolvedValue([fixture(1, 'Division 3')]);
  const res = await post();
  expect(res.status).toBe(200);
  expect(threads.publishCarousel).not.toHaveBeenCalled();
  expect(threads.publishImage.mock.calls[0][2]).toMatchObject({
    imageUrl: 'https://stockport-badminton.co.uk/fixtures-image/Division%203.jpg',
  });
  expect(res.body.posted).toEqual([{ target: 'Threads', id: 't2' }]);
});

it('fits Threads: under 500 characters, one tag, no mentions', async () => {
  await post();
  const { text } = threads.publishCarousel.mock.calls[0][2];
  expect(text).toMatch(/^3 matches this week\./);
  expect([...text].length).toBeLessThanOrEqual(500);
  expect(text.match(/#\w+/g)).toEqual(['#badminton']);
  expect(text).not.toContain('@');
});

describe('an empty week', () => {
  beforeEach(() => spy.mockResolvedValue([]));

  it('posts nothing and says it skipped', async () => {
    const res = await post();
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, skipped: expect.any(String), posted: [] });
    expect(threads.publishCarousel).not.toHaveBeenCalled();
    expect(threads.publishImage).not.toHaveBeenCalled();
  });

  it('does not need a token, so a lapsed one cannot turn a summer Sunday red', async () => {
    SocialToken.withToken.mockResolvedValue(null);
    const res = await post();
    expect(res.status).toBe(200);
    expect(res.body.skipped).toBeTruthy();
  });
});

it('answers 503 on an expired token with fixtures to post', async () => {
  SocialToken.withToken.mockResolvedValue({ ...ACCOUNT, expiresAt: new Date(Date.now() - 1000) });
  const res = await post();
  expect(res.status).toBe(503);
  expect(res.body.error).toMatch(/\/admin\/threads/);
  expect(threads.publishCarousel).not.toHaveBeenCalled();
});

it('answers 502 when Threads refuses, so the job goes red', async () => {
  threads.publishCarousel.mockRejectedValue(new Error('Threads refused the publish: nope'));
  const res = await post();
  expect(res.status).toBe(502);
  expect(res.body).toMatchObject({ ok: false, error: 'Threads refused the publish: nope' });
});

it('?dry=1 prepares the images and publishes nothing', async () => {
  const res = await post('?dry=1');
  expect(res.status).toBe(200);
  expect(res.body).toMatchObject({ ok: true, dry: true });
  expect(threads.validateImages).toHaveBeenCalled();
  expect(threads.publishCarousel).not.toHaveBeenCalled();
  expect(threads.publishImage).not.toHaveBeenCalled();
});
