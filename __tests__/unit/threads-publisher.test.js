// What we send to Threads, asserted on the request bodies with axios mocked at the boundary.

jest.mock('axios');
const axios = require('axios');
const threads = require('../../utils/threadsPublisher');

const USER = '28753684917596556';
const TOKEN = 'THAA-not-real';
const JPEG = n => `https://stockport-badminton.co.uk/league-table-image/Division%20${n}.jpg`;
const FAST = { pollMs: 1, timeoutMs: 50 };

const bodyOf = call => Object.fromEntries(new URLSearchParams(call[1]));
const posts = () => axios.post.mock.calls;

let statuses;
beforeEach(() => {
  jest.resetAllMocks();
  let n = 0;
  axios.post.mockImplementation(async () => ({ data: { id: `c${++n}` } }));
  statuses = {};
  axios.get.mockImplementation(async url => {
    const id = url.split('/').pop();
    const queue = statuses[id] || ['FINISHED'];
    return { data: { status: queue.length > 1 ? queue.shift() : queue[0] } };
  });
});

describe('a carousel', () => {
  it('makes a child per image, waits for each, then a parent, then publishes the parent', async () => {
    statuses.c1 = ['IN_PROGRESS', 'IN_PROGRESS', 'FINISHED'];
    const out = await threads.publishCarousel(USER, TOKEN,
      { imageUrls: [JPEG(1), JPEG(2), JPEG(3), JPEG(4)], text: 'Tables' }, FAST);

    expect(posts()).toHaveLength(6);                       // 4 children, parent, publish
    posts().slice(0, 4).forEach((call, i) => {
      expect(call[0]).toBe(`https://graph.threads.net/v1.0/${USER}/threads`);
      expect(bodyOf(call)).toMatchObject({ media_type: 'IMAGE', image_url: JPEG(i + 1), is_carousel_item: 'true' });
    });
    expect(bodyOf(posts()[4])).toMatchObject({ media_type: 'CAROUSEL', children: 'c1,c2,c3,c4', text: 'Tables' });
    expect(posts()[5][0]).toBe(`https://graph.threads.net/v1.0/${USER}/threads_publish`);
    // The parent is what gets published, not a child.
    expect(bodyOf(posts()[5]).creation_id).toBe('c5');
    expect(out.mediaId).toBe('c6');
    // c1 was polled until it finished.
    expect(axios.get.mock.calls.filter(c => c[0].endsWith('/c1'))).toHaveLength(3);
  });

  it('checks every image and the text before creating anything', async () => {
    await expect(threads.publishCarousel(USER, TOKEN, { imageUrls: [JPEG(1)] }, FAST)).rejects.toThrow(/2 to 20/);
    await expect(threads.publishCarousel(USER, TOKEN,
      { imageUrls: [JPEG(1), 'https://x.co/a.gif'] }, FAST)).rejects.toThrow(/JPEG or PNG/);
    await expect(threads.publishCarousel(USER, TOKEN,
      { imageUrls: [JPEG(1), JPEG(2)], text: 'x'.repeat(501) }, FAST)).rejects.toThrow(/at most 500/);
    expect(axios.post).not.toHaveBeenCalled();
  });

  it('publishes nothing when a container fails', async () => {
    statuses.c2 = ['ERROR'];
    await expect(threads.publishCarousel(USER, TOKEN, { imageUrls: [JPEG(1), JPEG(2)] }, FAST))
      .rejects.toThrow(/could not prepare the post \(ERROR\)/);
    expect(posts().some(c => /threads_publish$/.test(c[0]))).toBe(false);
  });

  it('publishes nothing when a container never finishes', async () => {
    statuses.c1 = ['IN_PROGRESS'];
    await expect(threads.publishCarousel(USER, TOKEN, { imageUrls: [JPEG(1), JPEG(2)] }, FAST))
      .rejects.toThrow(/had not finished preparing the post/);
    expect(posts().some(c => /threads_publish$/.test(c[0]))).toBe(false);
  });
});

describe('the dry run', () => {
  it('prepares each image and publishes nothing', async () => {
    statuses.c2 = ['ERROR'];
    const out = await threads.validateImages(USER, TOKEN, [JPEG(1), JPEG(2)], FAST);
    expect(out.ok).toBe(false);
    expect(out.refused.map(r => r.url)).toEqual([JPEG(2)]);
    expect(posts().every(c => bodyOf(c).is_carousel_item === undefined)).toBe(true);
    expect(posts().some(c => /threads_publish$/.test(c[0]))).toBe(false);
  });
});

describe('a single image', () => {
  const CARD = 'https://stockport-badminton.co.uk/resultImage/Tatton%20A/Mellor%20B/10/8/Premier.jpg';

  it('makes one container carrying the text, waits for it, then publishes it', async () => {
    statuses.c1 = ['IN_PROGRESS', 'FINISHED'];
    const out = await threads.publishImage(USER, TOKEN, { imageUrl: CARD, text: 'Result' }, FAST);

    expect(posts()).toHaveLength(2);
    expect(bodyOf(posts()[0])).toMatchObject({ media_type: 'IMAGE', image_url: CARD, text: 'Result' });
    expect(bodyOf(posts()[0]).is_carousel_item).toBeUndefined();
    expect(posts()[1][0]).toBe(`https://graph.threads.net/v1.0/${USER}/threads_publish`);
    expect(bodyOf(posts()[1])).toMatchObject({ creation_id: 'c1' });
    expect(out).toEqual({ mediaId: 'c2', creationId: 'c1' });
  });

  it('refuses text over 500 characters before creating anything', async () => {
    await expect(threads.publishImage(USER, TOKEN, { imageUrl: CARD, text: 'x'.repeat(501) }, FAST))
      .rejects.toMatchObject({ step: 'validate' });
    expect(posts()).toHaveLength(0);
  });

  it('publishes nothing when the container fails', async () => {
    statuses.c1 = ['ERROR'];
    await expect(threads.publishImage(USER, TOKEN, { imageUrl: CARD, text: 'Result' }, FAST))
      .rejects.toThrow(/could not prepare the post/);
    expect(posts().some(c => /threads_publish$/.test(c[0]))).toBe(false);
  });
});
