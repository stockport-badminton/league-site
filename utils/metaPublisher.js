// Posting to the league's Facebook Pages and Instagram account, directly.
//
// This replaces what Make.com scenarios have been doing. Everything here was measured
// against the real Graph API on 15 Sep 2026, and the measurements are what the shape of
// this file is for — see CLAUDE.md, "Posting to Meta directly", for the full record.
//
// ── Four things that are not obvious, and each costs a post if got wrong ──────
//
// 1. **Instagram accepts JPEG and nothing else.** Not PNG, not WebP. The weekly tables
//    carousel handed it `.png` URLs for as long as it existed and was refused every time,
//    silently, because the Facebook branch of the same scenario worked — Make uploads
//    bytes there, so it never meets the format check. `assertPublishableImage` below is
//    the guard, and it checks the URL we are about to hand over rather than trusting the
//    caller.
//
// 2. **Meta fetches `image_url` itself, from its own servers, later.** So the URL must be
//    public, unauthenticated and still serving when Meta gets round to it. Anything behind
//    `secured`, and anything written to a container's local disk, cannot work. That is why
//    `/league-table-image/:division` and `/resultImage/...` generate on demand.
//
// 3. **Both platforms have a "not yet visible" step, and it is free.** Instagram creates a
//    container (`POST /media`) that shows nowhere until `media_publish`; Facebook uploads
//    with `published=false` and the photo shows nowhere until a feed post attaches it.
//    Both expire on their own. Use them to find out whether Meta will accept an image
//    before anybody can see the answer — `validateImage()` does exactly that.
//
// 4. **A Page access token does not expire.** `debug_token` reports `expires: never`. It
//    dies only if the granting user changes their Facebook password or loses their role on
//    the Page, and when it does, everything here fails at once and needs a human with a
//    browser. `describeFailure` names that case specifically, because "OAuthException" on
//    its own sends you looking for a code bug that is not there.
//
// ── What this file will not do ────────────────────────────────────────────────
//
// **It does not decide whether to post, and it does not swallow failures.** It publishes
// or it throws. Callers wrap it in `afterCommit` so that a social post failing can never
// fail the write it is reporting — a captain's result is saved before any of this runs,
// and `utils/afterCommit.js` explains at length why that separation is not optional.

const axios = require('axios');

const GRAPH = 'https://graph.facebook.com';
const VERSION = process.env.META_GRAPH_VERSION || 'v21.0';

// Instagram's rules, from Meta's own documentation and confirmed by what it refused.
const JPEG_PATH = /\.jpe?g($|\?)/i;
const IG_MIN_RATIO = 0.8;    // 4:5 portrait
const IG_MAX_RATIO = 1.91;   // landscape
const IG_MAX_CAROUSEL = 10;

class MetaError extends Error {
  constructor(message, { status, code, subcode, fbtrace, step } = {}) {
    super(message);
    this.name = 'MetaError';
    Object.assign(this, { status, code, subcode, fbtrace, step });
  }
}

// Meta's errors are JSON in the body, not the HTTP status, and the useful sentence is
// sometimes `error_user_msg` and sometimes `message`. Flattening them here means every
// caller gets one shape, and means a token that has been revoked says so in English.
function describeFailure(err, step) {
  const body = err && err.response && err.response.data;
  const e = (body && body.error) || {};
  const detail = e.error_user_msg || e.message || (err && err.message) || 'unknown error';

  // 190 is "access token problem", and for a Page token that never expires it means a
  // person did something: changed their password, or lost their role on the Page. No
  // amount of retrying fixes it.
  const revoked = Number(e.code) === 190;
  const message = revoked
    ? `Meta rejected the access token during ${step}. A Page token does not expire on a ` +
      `clock, so this means the granting account changed its password or lost its role on ` +
      `the Page — it needs re-minting by hand. (${detail})`
    : `Meta refused ${step}: ${detail}`;

  return new MetaError(message, {
    status: err && err.response && err.response.status,
    code: e.code, subcode: e.error_subcode, fbtrace: e.fbtrace_id, step,
  });
}

async function graph(path, params, { method = 'POST', step } = {}) {
  const url = `${GRAPH}/${VERSION}/${path.replace(/^\//, '')}`;
  try {
    const res = method === 'GET'
      ? await axios.get(url, { params, timeout: 60000 })
      : await axios.post(url, new URLSearchParams(params).toString(), {
          timeout: 60000,
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        });
    return res.data;
  } catch (err) {
    throw describeFailure(err, step || path);
  }
}

/**
 * Refuse an image Instagram will refuse, before Meta does and before anyone sees it.
 *
 * Checked here rather than at the call site because every caller would otherwise have to
 * remember, and the one that forgot is the reason this file exists.
 */
function assertPublishableImage(url, { forInstagram = false } = {}) {
  if (!/^https:\/\//i.test(String(url || ''))) {
    throw new MetaError(
      `Image URL must be absolute https, got ${url || '(empty)'} — Meta fetches it from ` +
      `its own servers, so a relative or local URL can never resolve.`, { step: 'validate' });
  }
  if (forInstagram && !JPEG_PATH.test(url)) {
    throw new MetaError(
      `Instagram accepts JPEG only and this URL is not one: ${url}. This is the fault that ` +
      `stopped the weekly tables carousel working for its whole existence — the images were ` +
      `PNG. Serve JPEG rather than renaming the file.`, { step: 'validate' });
  }
}

/** Instagram's aspect-ratio window, for a caller that knows its dimensions. */
function ratioOk(width, height) {
  if (!width || !height) return true;      // unknown is not a failure
  const r = width / height;
  return r >= IG_MIN_RATIO && r <= IG_MAX_RATIO;
}

// ── Facebook Pages ───────────────────────────────────────────────────────────

/**
 * Upload a photo WITHOUT publishing it. Returns the photo id.
 *
 * This is the half that makes an album possible and the half that makes testing safe:
 * nothing is on the page until `publishPageAlbum` attaches it.
 */
async function uploadPagePhoto(pageId, token, imageUrl) {
  assertPublishableImage(imageUrl);
  const r = await graph(`${pageId}/photos`, {
    url: imageUrl, published: 'false', access_token: token,
  }, { step: 'a photo upload' });
  return r.id;
}

/**
 * One post carrying one or more photos.
 *
 * Facebook has no single call for this: each photo is uploaded unpublished, then one feed
 * post attaches them by id. A single photo goes the same way rather than through
 * `/photos` with `published=true`, so there is one code path and one thing to test.
 */
async function publishPageAlbum(pageId, token, { imageUrls, message }) {
  const urls = [].concat(imageUrls || []);
  if (!urls.length) throw new MetaError('No images to post', { step: 'validate' });

  const ids = [];
  for (const url of urls) ids.push(await uploadPagePhoto(pageId, token, url));

  const params = { message: message || '', access_token: token };
  ids.forEach((id, i) => { params[`attached_media[${i}]`] = JSON.stringify({ media_fbid: id }); });

  const r = await graph(`${pageId}/feed`, params, { step: 'the page post' });
  return { postId: r.id, photoIds: ids };
}

// ── Instagram ────────────────────────────────────────────────────────────────

/**
 * Create a media container. Nothing is visible until it is published, and an unpublished
 * container expires by itself in 24 hours — so this is the free way to ask Meta whether it
 * will accept an image.
 */
async function createContainer(igUserId, token, params) {
  const r = await graph(`${igUserId}/media`, { ...params, access_token: token },
    { step: 'an Instagram media container' });
  return r.id;
}

async function publishContainer(igUserId, token, creationId) {
  const r = await graph(`${igUserId}/media_publish`, { creation_id: creationId, access_token: token },
    { step: 'the Instagram publish' });
  return r.id;
}

/** One image. Two calls: container, then publish. */
async function publishInstagramPhoto(igUserId, token, { imageUrl, caption }) {
  assertPublishableImage(imageUrl, { forInstagram: true });
  const creationId = await createContainer(igUserId, token, {
    image_url: imageUrl, caption: caption || '',
  });
  return { mediaId: await publishContainer(igUserId, token, creationId), creationId };
}

/**
 * Up to ten images as one carousel, which counts as ONE post against the publishing quota.
 *
 * Each child is its own container with `is_carousel_item`, then a parent container names
 * them, then the parent is published.
 */
async function publishInstagramCarousel(igUserId, token, { imageUrls, caption }) {
  const urls = [].concat(imageUrls || []);
  if (!urls.length) throw new MetaError('No images to post', { step: 'validate' });
  if (urls.length > IG_MAX_CAROUSEL) {
    throw new MetaError(
      `Instagram carousels take at most ${IG_MAX_CAROUSEL} images, got ${urls.length}. ` +
      `Meta refuses the parent container rather than truncating, so decide here which ones ` +
      `to drop.`, { step: 'validate' });
  }
  urls.forEach(u => assertPublishableImage(u, { forInstagram: true }));

  const children = [];
  for (const url of urls) {
    children.push(await createContainer(igUserId, token, {
      image_url: url, is_carousel_item: 'true',
    }));
  }
  const parent = await createContainer(igUserId, token, {
    media_type: 'CAROUSEL', children: children.join(','), caption: caption || '',
  });
  return { mediaId: await publishContainer(igUserId, token, parent), childIds: children };
}

/**
 * Ask Meta whether it would accept these images, without publishing anything.
 *
 * Returns `{ok, refused: [{url, reason}]}`. Containers created here are simply abandoned
 * and expire in 24 hours. Worth running before a scheduled post that nobody is watching.
 */
async function validateImages(igUserId, token, imageUrls) {
  const refused = [];
  for (const url of [].concat(imageUrls || [])) {
    try {
      assertPublishableImage(url, { forInstagram: true });
      await createContainer(igUserId, token, { image_url: url, is_carousel_item: 'true' });
    } catch (err) {
      refused.push({ url, reason: err.message });
    }
  }
  return { ok: refused.length === 0, refused };
}

/** How much of Instagram's 100-posts-per-rolling-24-hours is spent. A carousel counts as 1. */
async function publishingQuota(igUserId, token) {
  const r = await graph(`${igUserId}/content_publishing_limit`,
    { fields: 'config,quota_usage', access_token: token },
    { method: 'GET', step: 'the publishing quota' });
  const d = (r.data && r.data[0]) || {};
  return { used: Number(d.quota_usage) || 0, total: Number((d.config || {}).quota_total) || 100 };
}

// ── The league's own accounts ────────────────────────────────────────────────

/**
 * Targets from the environment, or null when the credential is absent.
 *
 * Null rather than a throw, and rather than a default: an unset token must mean "this
 * league does not post" and not "post somewhere else". Same reasoning as the cron tokens —
 * absence closes the path rather than opening it.
 */
function targets() {
  const pageToken = process.env.META_PAGE_TOKEN;
  const igId = process.env.META_IG_USER_ID;
  return {
    stockportPage: process.env.META_PAGE_ID && pageToken
      ? { id: process.env.META_PAGE_ID, token: pageToken } : null,
    instagram: igId && pageToken ? { id: igId, token: pageToken } : null,
    tamesidePage: process.env.META_TAMESIDE_PAGE_ID && process.env.META_TAMESIDE_PAGE_TOKEN
      ? { id: process.env.META_TAMESIDE_PAGE_ID, token: process.env.META_TAMESIDE_PAGE_TOKEN } : null,
  };
}

/**
 * Post the same thing to several places, and let each succeed or fail on its own.
 *
 * Returns `{posted: [...], failed: [{target, error}]}` and does NOT throw. Three reasons,
 * and the first is the one that matters:
 *
 * - **A post that lands on Facebook and not Instagram has still landed on Facebook.**
 *   Throwing on the first failure would either lose that or, worse, make a retry
 *   double-post to the platform that worked.
 * - The caller is already inside `afterCommit`, so the write it reports is committed and
 *   nothing here can undo it. What the caller needs is an account of what happened, not an
 *   exception.
 * - **And then say which of the two happened.** Reporting only success makes a half
 *   failure indistinguishable from a whole one — the same rule `utils/afterCommit.js`
 *   states for notification email, and the same one `POST /fixture/rearrangement` broke.
 *
 * `targets` entries are `{name, kind: 'page'|'instagram', id, token}`. A null entry is
 * skipped rather than being an error: that is how an unset credential means "this league
 * does not post there" instead of "crash".
 */
async function publishEverywhere(targets, { imageUrls, message, caption }) {
  const posted = [];
  const failed = [];

  for (const t of (targets || []).filter(Boolean)) {
    try {
      if (t.kind === 'page') {
        const r = await publishPageAlbum(t.id, t.token, { imageUrls, message });
        posted.push({ target: t.name, kind: t.kind, id: r.postId });
      } else if (t.kind === 'instagram') {
        const urls = [].concat(imageUrls || []);
        const r = urls.length > 1
          ? await publishInstagramCarousel(t.id, t.token, { imageUrls: urls, caption: caption ?? message })
          : await publishInstagramPhoto(t.id, t.token, { imageUrl: urls[0], caption: caption ?? message });
        posted.push({ target: t.name, kind: t.kind, id: r.mediaId });
      } else {
        failed.push({ target: t.name, error: new MetaError(`Unknown target kind ${t.kind}`, { step: 'validate' }) });
      }
    } catch (err) {
      failed.push({ target: t.name, error: err });
    }
  }

  return { posted, failed, ok: failed.length === 0 };
}

module.exports = {
  MetaError,
  assertPublishableImage, ratioOk,
  uploadPagePhoto, publishPageAlbum,
  publishInstagramPhoto, publishInstagramCarousel,
  createContainer, publishContainer,
  validateImages, publishingQuota, publishEverywhere,
  targets,
  IG_MAX_CAROUSEL, IG_MIN_RATIO, IG_MAX_RATIO,
};
