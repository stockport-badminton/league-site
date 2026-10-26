// The homepage's Messer gallery: the images Cloudinary holds under one tag.
//
// This used to be an `axios.get` to Cloudinary's **Admin API** inside the homepage
// handler, on every request, with no timeout, awaited before the page could render
// (HARD-43). Three things followed from that, all measured in Oct 2026:
//
// - it set the homepage's floor: ~180 ms of TTFB no other page paid;
// - when Cloudinary was slow the homepage was slow and nothing else was — `/` reached
//   19.4 s on 16 Oct while every other route stayed under 1.2 s;
// - most of the calls were a robot's. A Sentry uptime monitor on `/` asks once a
//   minute, and the Admin API is rate-limited per hour.
//
// So the listing is cached per tag, a refresh happens at most once per FRESH_MS, and the
// request that does it waits at most TIMEOUT_MS. A failed refresh keeps serving the last
// good listing: a gallery a few minutes out of date is fine, an empty one because
// Cloudinary hiccupped is not.
//
// The refresh is awaited inside the request, never left running behind the response.
// It used to be — serve the stale listing, refresh in the background — and on Cloud Run
// that refresh almost never finished: CPU is throttled once the response is sent, so the
// TLS handshake and request could not finish inside the deadline. 25 Oct 2026: 46
// "timed out after 1500 ms" on 10 of 17 instances, each 2.5–3.3 s after a homepage
// request that had answered in 0.1 s, while Cloudinary answers in ~0.35 s. An instance
// kept its cold-start listing for life. (HARD-47 point 3 is the same rule.)

const config = require('../config');
const log = require('./log');
const axios = require('axios')

const FRESH_MS = 10 * 60 * 1000
// After a failed refresh, how long before the next attempt. Without it, every request
// during a Cloudinary outage would start another call.
const FAILURE_MS = 60 * 1000
const TIMEOUT_MS = 1500
const MAX_RESULTS = 30

const cache = new Map() // tag -> { assets, expires, inflight }

function fetchTag(tag) {
  // A deadline of our own rather than axios's `timeout` alone: that one is socket
  // inactivity, so a response that trickles in can outlast it. The abort stops the
  // real request; the race is what bounds the wait whatever the transport does.
  const controller = new AbortController()
  let timer
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort()
      reject(new Error(`timed out after ${TIMEOUT_MS} ms`))
    }, TIMEOUT_MS)
    // Nothing should be kept alive by a deadline on a request nobody is waiting for.
    if (timer.unref) timer.unref()
  })
  // Promise.resolve().then so that a synchronous throw (or a non-promise return) is an
  // ordinary failure handled below, not an exception out of a function that promises
  // never to reject — and so the deadline's timer is always cleared.
  const request = Promise.resolve().then(() => axios.get(
    'https://api.cloudinary.com/v1_1/hvunsveuh/resources/image/tags/' + encodeURIComponent(tag),
    {
      // Credentials as `auth`, not in the URL, so they are not part of any error's
      // config.url that ends up in a log line or a Sentry event.
      auth: { username: config.CLOUDINARY_KEY, password: config.CLOUDINARY_SECRET },
      params: { max_results: MAX_RESULTS, context: true },
      timeout: TIMEOUT_MS,
      signal: controller.signal,
    }
  )).then(response => (response && response.data && response.data.resources) || [])
  return Promise.race([request, deadline]).finally(() => clearTimeout(timer))
}

function refresh(tag, entry) {
  if (entry.inflight) return entry.inflight
  entry.inflight = fetchTag(tag)
    .then(assets => {
      entry.assets = assets
      entry.expires = Date.now() + FRESH_MS
      return assets
    })
    .catch(err => {
      log.error({ err }, 'Cloudinary fetch failed')
      // Keep serving whatever we had (nothing, on a cold start) and try again in a
      // minute rather than on the very next request.
      if (entry.assets === null) entry.assets = []
      entry.expires = Date.now() + FAILURE_MS
      return entry.assets
    })
    .finally(() => { entry.inflight = null })
  return entry.inflight
}

// Resolves to the tag's image resources, never rejects.
async function getGallery(tag) {
  let entry = cache.get(tag)
  if (!entry) {
    entry = { assets: null, expires: 0, inflight: null }
    cache.set(tag, entry)
  }
  // Cold or stale: refresh now, bounded by the timeout. See the top of this file for why
  // never behind the response.
  if (entry.assets === null || Date.now() >= entry.expires) return refresh(tag, entry)
  return entry.assets
}

function _reset() {
  cache.clear()
}

module.exports = { getGallery, _reset, FRESH_MS, FAILURE_MS, TIMEOUT_MS }
