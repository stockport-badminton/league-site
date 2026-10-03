// Posting to the league's Threads account.
//
// A sibling of metaPublisher.js rather than part of it: a different host
// (graph.threads.net), a different token (60 days, kept in `social_token` and renewed by
// POST /admin/threads/refresh), and different rules. The flow is the same shape as
// Instagram's: create a container, then publish it.
//
// ── What differs from Instagram, and each costs a post if got wrong ───────────
//
// 1. **A container is not ready the moment it is created.** Meta's Threads docs recommend
//    waiting about 30 seconds before publishing. This polls the container's `status` until
//    it reads FINISHED rather than sleeping a fixed 30s, so a quick container costs a few
//    seconds and a slow one is waited for. The first IMAGE container of our result card
//    reached FINISHED within 5s (26 Sep 2026).
// 2. **That wait is why nothing here runs inside another request.** The weekly tables post
//    to Facebook and Instagram already takes 39s, and Firebase Hosting cuts a request at
//    60s while Cloud Run carries on (CLAUDE.md 1bc). A Threads carousel is four child
//    containers, a parent and the waits between them, so it has its own route and its own
//    scheduler job, which calls Cloud Run directly.
// 3. **Text is at most 500 characters**, a carousel has 2 to 20 items, and images are JPEG or
//    PNG. Checked here, before anything is created.
//
// It publishes or it throws, like metaPublisher. The caller decides what a failure means.

const axios = require('axios');
const { ThreadsError, describeFailure } = require('./threadsAuth');

const GRAPH = 'https://graph.threads.net';
const VERSION = process.env.META_THREADS_GRAPH_VERSION || 'v1.0';

const MAX_TEXT = 500;
const MIN_CAROUSEL = 2;
const MAX_CAROUSEL = 20;
const IMAGE_PATH = /\.(jpe?g|png)($|\?)/i;

const POLL_MS = 3000;
const TIMEOUT_MS = 120000;

async function call(method, path, params, step) {
  const url = `${GRAPH}/${VERSION}/${path.replace(/^\//, '')}`;
  try {
    const res = method === 'GET'
      ? await axios.get(url, { params, timeout: 30000 })
      : await axios.post(url, new URLSearchParams(params).toString(), {
          timeout: 30000,
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        });
    return res.data;
  } catch (err) {
    throw describeFailure(err, step);
  }
}

function assertImage(url) {
  if (!/^https:\/\//i.test(String(url || ''))) {
    throw new ThreadsError(`Image URL must be absolute https, got ${url || '(empty)'}: Threads ` +
      `fetches it from its own servers.`, { step: 'validate' });
  }
  if (!IMAGE_PATH.test(url)) {
    throw new ThreadsError(`Threads takes JPEG or PNG, and this URL is neither: ${url}`, { step: 'validate' });
  }
}

function assertText(text) {
  const n = [...String(text || '')].length;
  if (n > MAX_TEXT) {
    throw new ThreadsError(`Threads text is at most ${MAX_TEXT} characters, and this is ${n}`, { step: 'validate' });
  }
}

async function createImageContainer(userId, token, { imageUrl, carouselItem = false, text }) {
  assertImage(imageUrl);
  const params = { media_type: 'IMAGE', image_url: imageUrl, access_token: token };
  if (carouselItem) params.is_carousel_item = 'true';
  if (text) params.text = text;
  const r = await call('POST', `${userId}/threads`, params, 'the image container');
  return r.id;
}

/**
 * Wait until a container is FINISHED. Throws on ERROR or EXPIRED, which are final, and on
 * running out of time, in which case the container may still finish on its own. Nothing is
 * visible until it is published, so a timeout here is safe to leave behind.
 */
async function waitForContainer(containerId, token, { pollMs = POLL_MS, timeoutMs = TIMEOUT_MS } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const r = await call('GET', containerId, { fields: 'status,error_message', access_token: token },
      'the container status check');
    if (r.status === 'FINISHED') return r;
    if (r.status === 'ERROR' || r.status === 'EXPIRED') {
      throw new ThreadsError(`Threads could not prepare the post (${r.status}): ` +
        `${r.error_message || 'no reason given'}`, { step: 'the container' });
    }
    if (Date.now() + pollMs > deadline) {
      throw new ThreadsError(`Threads had not finished preparing the post after ` +
        `${Math.round(timeoutMs / 1000)}s (last status ${r.status || 'none'}). Nothing was published.`,
        { step: 'the container' });
    }
    await new Promise(resolve => setTimeout(resolve, pollMs));
  }
}

async function publishContainer(userId, token, creationId) {
  const r = await call('POST', `${userId}/threads_publish`, { creation_id: creationId, access_token: token },
    'the publish');
  return r.id;
}

/** One image with text, as one post: container, wait, publish. */
async function publishImage(userId, token, { imageUrl, text }, waitOpts) {
  assertImage(imageUrl);
  assertText(text);
  const id = await createImageContainer(userId, token, { imageUrl, text });
  await waitForContainer(id, token, waitOpts);
  return { mediaId: await publishContainer(userId, token, id), creationId: id };
}

/**
 * Two to twenty images as one post. Every image is checked before any container is made,
 * so a bad URL cannot leave half a carousel behind.
 */
async function publishCarousel(userId, token, { imageUrls, text }, waitOpts) {
  const urls = [].concat(imageUrls || []);
  if (urls.length < MIN_CAROUSEL || urls.length > MAX_CAROUSEL) {
    throw new ThreadsError(`A Threads carousel takes ${MIN_CAROUSEL} to ${MAX_CAROUSEL} images, ` +
      `got ${urls.length}`, { step: 'validate' });
  }
  urls.forEach(assertImage);
  assertText(text);

  const children = [];
  for (const imageUrl of urls) {
    children.push(await createImageContainer(userId, token, { imageUrl, carouselItem: true }));
  }
  for (const id of children) await waitForContainer(id, token, waitOpts);

  const parent = await call('POST', `${userId}/threads`, {
    media_type: 'CAROUSEL', children: children.join(','), text: text || '', access_token: token,
  }, 'the carousel container');
  await waitForContainer(parent.id, token, waitOpts);

  return { mediaId: await publishContainer(userId, token, parent.id), creationId: parent.id };
}

/**
 * Ask Threads to fetch and prepare each image, and publish nothing. Containers that are
 * never published expire on their own. Returns `{ok, refused: [{url, error}]}`.
 */
async function validateImages(userId, token, imageUrls, waitOpts) {
  const refused = [];
  for (const url of [].concat(imageUrls || [])) {
    try {
      const id = await createImageContainer(userId, token, { imageUrl: url });
      await waitForContainer(id, token, waitOpts);
    } catch (err) {
      refused.push({ url, error: err.message });
    }
  }
  return { ok: refused.length === 0, refused };
}

module.exports = {
  publishImage, publishCarousel, validateImages, createImageContainer, waitForContainer, publishContainer,
  MAX_TEXT, MIN_CAROUSEL, MAX_CAROUSEL,
};
