// What we send to Meta, asserted rather than assumed.
//
// `sendResultZap` is the cautionary tale this file is written against: it was mocked in
// every suite that reached it, so what it actually posted had never been checked by
// anything — and it had been posting a malformed URL that Facebook rejected with
// `Missing or invalid image file (324)`. A function that is only ever mocked is untested,
// however many tests mention it.
//
// So these assert on the exact request bodies, with axios mocked at the boundary and
// nothing else. Every expectation below corresponds to something measured against the real
// Graph API on 15 Sep 2026.

jest.mock('axios');
const axios = require('axios');

const meta = require('../../utils/metaPublisher');

const PAGE = '101950371354925';
const IG = '17841409056774880';
const TOKEN = 'test-page-token-not-real';
const JPEG = 'https://stockport-badminton.co.uk/league-table-image/Premier';

// The request bodies are form-encoded, so decode them back to compare.
const bodyOf = call => Object.fromEntries(new URLSearchParams(call[1]));
const urlOf = call => call[0];

beforeEach(() => {
  jest.clearAllMocks();
  let n = 0;
  axios.post.mockImplementation(async () => ({ data: { id: `id-${++n}` } }));
  axios.get.mockResolvedValue({ data: { data: [{ config: { quota_total: 100 }, quota_usage: 3 }] } });
});

describe('the image rules, enforced before Meta sees them', () => {
  // The single fault that stopped the weekly carousel working for its whole existence.
  it('refuses a PNG for Instagram, naming why', () => {
    expect(() => meta.assertPublishableImage(
      'https://stockport-badminton.co.uk/x/league-table-Premier.png', { forInstagram: true }))
      .toThrow(/Instagram accepts JPEG only/);
  });

  it('allows the same PNG for Facebook, which does accept them', () => {
    expect(() => meta.assertPublishableImage(
      'https://stockport-badminton.co.uk/x/league-table-Premier.png')).not.toThrow();
  });

  it('accepts a .jpg and a .jpeg, with or without a query string', () => {
    for (const u of ['https://x.co/a.jpg', 'https://x.co/a.jpeg', 'https://x.co/a.jpg?v=2']) {
      expect(() => meta.assertPublishableImage(u, { forInstagram: true })).not.toThrow();
    }
  });

  // Meta fetches the URL from its own servers, so anything not publicly resolvable is
  // guaranteed to fail — and fail minutes later, in a scheduled job nobody is watching.
  it('refuses a relative or non-https URL', () => {
    expect(() => meta.assertPublishableImage('/league-table-image/Premier')).toThrow(/absolute https/);
    expect(() => meta.assertPublishableImage('http://x.co/a.jpg')).toThrow(/absolute https/);
    expect(() => meta.assertPublishableImage('')).toThrow(/absolute https/);
  });

  it('knows Instagram\'s aspect-ratio window', () => {
    expect(meta.ratioOk(1080, 1350)).toBe(true);    // the result card, 0.800 exactly
    expect(meta.ratioOk(1080, 1080)).toBe(true);    // the tables
    expect(meta.ratioOk(1080, 1920)).toBe(false);   // a story, too tall
    expect(meta.ratioOk(null, null)).toBe(true);    // unknown is not a failure
  });
});

describe('a Facebook page post', () => {
  it('uploads each photo unpublished, then attaches them to one feed post', async () => {
    const out = await meta.publishPageAlbum(PAGE, TOKEN, {
      imageUrls: [JPEG + '.jpg', JPEG + '2.jpg'], message: 'League tables',
    });

    expect(axios.post).toHaveBeenCalledTimes(3);          // two photos, one post

    // Each photo is published:false — this is what keeps it off the page until the post.
    for (const call of axios.post.mock.calls.slice(0, 2)) {
      expect(urlOf(call)).toMatch(new RegExp(`/${PAGE}/photos$`));
      expect(bodyOf(call).published).toBe('false');
    }

    const feed = axios.post.mock.calls[2];
    expect(urlOf(feed)).toMatch(new RegExp(`/${PAGE}/feed$`));
    const body = bodyOf(feed);
    expect(body.message).toBe('League tables');
    // attached_media is indexed and each value is JSON, not a bare id.
    expect(JSON.parse(body['attached_media[0]'])).toEqual({ media_fbid: 'id-1' });
    expect(JSON.parse(body['attached_media[1]'])).toEqual({ media_fbid: 'id-2' });
    expect(out).toEqual({ postId: 'id-3', photoIds: ['id-1', 'id-2'] });
  });

  it('sends a single photo down the same path, so there is one thing to test', async () => {
    await meta.publishPageAlbum(PAGE, TOKEN, { imageUrls: JPEG + '.jpg', message: 'x' });
    expect(axios.post).toHaveBeenCalledTimes(2);
    expect(urlOf(axios.post.mock.calls[1])).toMatch(/\/feed$/);
  });

  it('refuses to post nothing', async () => {
    await expect(meta.publishPageAlbum(PAGE, TOKEN, { imageUrls: [] })).rejects.toThrow(/No images/);
    expect(axios.post).not.toHaveBeenCalled();
  });
});

describe('an Instagram post', () => {
  it('creates a container then publishes it, and never publishes the container id', async () => {
    const out = await meta.publishInstagramPhoto(IG, TOKEN, {
      imageUrl: JPEG + '.jpg', caption: 'Result',
    });

    expect(axios.post).toHaveBeenCalledTimes(2);
    const [create, publish] = axios.post.mock.calls;
    expect(urlOf(create)).toMatch(new RegExp(`/${IG}/media$`));
    expect(bodyOf(create)).toMatchObject({ image_url: JPEG + '.jpg', caption: 'Result' });
    expect(urlOf(publish)).toMatch(new RegExp(`/${IG}/media_publish$`));
    // The published id is the media id, not the creation id — confusing them posts nothing
    // and reports success.
    expect(bodyOf(publish).creation_id).toBe('id-1');
    expect(out.mediaId).toBe('id-2');
  });

  it('builds a carousel as children, then a parent, then one publish', async () => {
    const urls = ['a', 'b', 'c'].map(x => `https://stockport-badminton.co.uk/${x}.jpg`);
    const out = await meta.publishInstagramCarousel(IG, TOKEN, { imageUrls: urls, caption: 'Tables' });

    expect(axios.post).toHaveBeenCalledTimes(5);          // 3 children + parent + publish
    for (const call of axios.post.mock.calls.slice(0, 3)) {
      expect(bodyOf(call).is_carousel_item).toBe('true');
    }
    const parent = bodyOf(axios.post.mock.calls[3]);
    expect(parent.media_type).toBe('CAROUSEL');
    expect(parent.children).toBe('id-1,id-2,id-3');       // comma-joined, in order
    expect(parent.caption).toBe('Tables');
    expect(out.mediaId).toBe('id-5');
  });

  it('refuses more than ten, rather than letting Meta refuse the whole parent', async () => {
    const urls = Array.from({ length: 11 }, (_, i) => `https://x.co/${i}.jpg`);
    await expect(meta.publishInstagramCarousel(IG, TOKEN, { imageUrls: urls }))
      .rejects.toThrow(/at most 10 images, got 11/);
    expect(axios.post).not.toHaveBeenCalled();            // nothing created, nothing to leak
  });

  it('checks every carousel image before creating any container', async () => {
    // One PNG among JPEGs must stop the whole thing, not leave half a carousel built.
    await expect(meta.publishInstagramCarousel(IG, TOKEN, {
      imageUrls: ['https://x.co/a.jpg', 'https://x.co/b.png'],
    })).rejects.toThrow(/JPEG only/);
    expect(axios.post).not.toHaveBeenCalled();
  });
});

describe('asking Meta without publishing', () => {
  it('validateImages creates containers and publishes none of them', async () => {
    const out = await meta.validateImages(IG, TOKEN, [JPEG + '.jpg', JPEG + '2.jpg']);
    expect(out.ok).toBe(true);
    expect(axios.post).toHaveBeenCalledTimes(2);
    // The absence of this is the whole point: nothing became visible.
    expect(axios.post.mock.calls.every(c => !/media_publish/.test(urlOf(c)))).toBe(true);
  });

  it('reports which image was refused and why, without throwing', async () => {
    const out = await meta.validateImages(IG, TOKEN, [JPEG + '.jpg', 'https://x.co/b.png']);
    expect(out.ok).toBe(false);
    expect(out.refused).toHaveLength(1);
    expect(out.refused[0]).toMatchObject({ url: 'https://x.co/b.png' });
    expect(out.refused[0].reason).toMatch(/JPEG only/);
  });

  it('reads the publishing quota', async () => {
    expect(await meta.publishingQuota(IG, TOKEN)).toEqual({ used: 3, total: 100 });
  });
});

describe('when Meta says no', () => {
  const refuse = (code, message, userMsg) => {
    const err = new Error('Request failed');
    err.response = { status: 400, data: { error: { code, message, error_user_msg: userMsg, fbtrace_id: 'A1' } } };
    return err;
  };

  it('surfaces the sentence a human can act on, not the HTTP status', async () => {
    axios.post.mockRejectedValueOnce(refuse(9004, 'Unsupported post request',
      'The media could not be fetched from this URI'));
    await expect(meta.publishInstagramPhoto(IG, TOKEN, { imageUrl: JPEG + '.jpg' }))
      .rejects.toThrow(/could not be fetched from this URI/);
  });

  // A Page token has no expiry, so code 190 never means "it timed out" — it means a person
  // changed something and no retry will help. Saying so is the difference between a
  // five-minute fix and an afternoon looking for a bug that is not there.
  it('explains a revoked token instead of reporting OAuthException', async () => {
    axios.post.mockRejectedValueOnce(refuse(190, 'Error validating access token'));
    await expect(meta.publishPageAlbum(PAGE, TOKEN, { imageUrls: JPEG + '.jpg' }))
      .rejects.toThrow(/does not expire on a clock.*re-minting by hand/s);
  });

  it('carries the trace id and the step for triage', async () => {
    axios.post.mockRejectedValueOnce(refuse(100, 'Bad'));
    const err = await meta.publishInstagramPhoto(IG, TOKEN, { imageUrl: JPEG + '.jpg' }).catch(e => e);
    expect(err).toBeInstanceOf(meta.MetaError);
    expect(err).toMatchObject({ code: 100, fbtrace: 'A1', status: 400 });
    expect(err.step).toMatch(/container/);
  });
});

describe('targets come from the environment, and absence closes the path', () => {
  const saved = { ...process.env };
  afterEach(() => { process.env = { ...saved }; });

  it('is null when the token is missing, rather than posting somewhere else', () => {
    delete process.env.META_PAGE_TOKEN;
    process.env.META_PAGE_ID = PAGE;
    const t = meta.targets();
    expect(t.stockportPage).toBeNull();
    expect(t.instagram).toBeNull();
  });

  it('pairs each id with its own token', () => {
    process.env.META_PAGE_ID = PAGE;
    process.env.META_PAGE_TOKEN = TOKEN;
    process.env.META_IG_USER_ID = IG;
    process.env.META_TAMESIDE_PAGE_ID = '413441425183665';
    process.env.META_TAMESIDE_PAGE_TOKEN = 'tameside-token';
    const t = meta.targets();
    expect(t.stockportPage).toEqual({ id: PAGE, token: TOKEN });
    // Instagram is reached through the Stockport PAGE token — there is no separate
    // Instagram credential, which is how Meta models it.
    expect(t.instagram).toEqual({ id: IG, token: TOKEN });
    expect(t.tamesidePage).toEqual({ id: '413441425183665', token: 'tameside-token' });
  });
});
