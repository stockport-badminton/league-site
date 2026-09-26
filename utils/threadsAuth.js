// Logging in to Threads, and keeping the token alive.
//
// Threads is a separate integration from the rest of Meta, even though it shares the
// developer dashboard: a different host (graph.threads.net), its own app id and secret
// (META_THREADS_APP_ID / META_THREADS_APP_SECRET), and a token that EXPIRES. See
// docs/plans/stories-and-threads.md for what was measured on 26 Sep 2026.
//
// ── The token lifecycle ──────────────────────────────────────────────────────
//
//   authorize URL  -> a person approves, Threads redirects back with ?code=  (one use, ~1h)
//   exchangeCode   -> a short-lived token (1 hour)
//   longLived      -> a 60-day token     (grant_type=th_exchange_token)
//   refresh        -> a fresh 60 days, but ONLY for a token at least 24 hours old and not
//                     yet expired        (grant_type=th_refresh_token)
//
// A token that reaches 60 days unrefreshed is dead. No API call brings it back; a person
// has to log in again. That is why the refresh runs weekly, and why the audit digest reports
// on it.
//
// ── Two setup traps, both met on 26 Sep 2026 ─────────────────────────────────
//
// - **A browser login lands on whichever Instagram identity is signed in.** On the first
//   attempt that was Neil's personal account. A token for the wrong account would post as
//   that person, so the callback refuses any account that is not META_THREADS_USER_ID.
// - **The Instagram Tester role is not the Threads Tester role.** Without the Threads one,
//   the code exchange SUCCEEDS and every later call fails with a message about
//   `threads_basic` and "Threads testers". `describeFailure` names that case, because
//   "the exchange worked and nothing else does" looks like a code bug.
//
// Nothing here logs or rethrows an axios error. Its `config` carries the app secret and the
// token in its params, and Sentry would serialise all of it.

const axios = require('axios');

const AUTHORIZE = 'https://threads.net/oauth/authorize';
const GRAPH = 'https://graph.threads.net';
const VERSION = process.env.META_THREADS_GRAPH_VERSION || 'v1.0';
const SCOPES = ['threads_basic', 'threads_content_publish'];

// Threads refuses to refresh a token younger than this.
const MIN_REFRESH_AGE_MS = 24 * 60 * 60 * 1000;

class ThreadsError extends Error {
  constructor(message, { status, code, step } = {}) {
    super(message);
    this.name = 'ThreadsError';
    Object.assign(this, { status, code, step });
  }
}

function describeFailure(err, step) {
  const body = err && err.response && err.response.data;
  const e = (body && body.error) || {};
  const detail = e.error_user_msg || e.message || (body && body.error_message)
    || (err && err.code) || 'no response';
  let message = `Threads refused ${step}: ${detail}`;
  if (/threads_basic|testers/i.test(String(detail))) {
    message += ' — this is what a missing Threads Tester role looks like. The Instagram ' +
      'Tester role does not count; add the account under the Threads use case, then ' +
      'accept the invite in Threads (Settings → Account → Website permissions → Invites).';
  }
  return new ThreadsError(message, {
    status: err && err.response && err.response.status, code: e.code, step,
  });
}

async function call(method, path, params, step) {
  const url = `${GRAPH}/${path.replace(/^\//, '')}`;
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

/**
 * Everything the login needs. The expected account id counts too, because without it the
 * callback cannot tell the league's account from whoever happened to be signed in. Absence
 * closes the path.
 */
function missingConfig() {
  return ['META_THREADS_APP_ID', 'META_THREADS_APP_SECRET', 'META_THREADS_USER_ID']
    .filter(name => !process.env[name]);
}

function authorizeUrl({ state, redirectUri }) {
  const q = new URLSearchParams({
    client_id: process.env.META_THREADS_APP_ID,
    redirect_uri: redirectUri,
    scope: SCOPES.join(','),
    response_type: 'code',
    state,
  });
  return `${AUTHORIZE}?${q.toString()}`;
}

/**
 * The one-use code from the redirect, for a 1-hour token. `redirect_uri` has to be
 * byte-for-byte the one the authorize URL carried.
 */
async function exchangeCode({ code, redirectUri }) {
  // Threads documents that the code can arrive with `#_` on the end. A browser never
  // sends the fragment to a server, but a code pasted by hand keeps it.
  const clean = String(code || '').replace(/#_$/, '');
  const data = await call('POST', 'oauth/access_token', {
    client_id: process.env.META_THREADS_APP_ID,
    client_secret: process.env.META_THREADS_APP_SECRET,
    grant_type: 'authorization_code',
    redirect_uri: redirectUri,
    code: clean,
  }, 'the login code');
  if (!data || !data.access_token) throw new ThreadsError('Threads returned no token for the login code');
  return data.access_token;
}

function expectLongLived(data, step) {
  if (!data || !data.access_token || !Number(data.expires_in)) {
    throw new ThreadsError(`Threads answered ${step} without a token and an expiry`);
  }
  return { token: data.access_token, expiresIn: Number(data.expires_in) };
}

async function longLived(shortToken) {
  const data = await call('GET', 'access_token', {
    grant_type: 'th_exchange_token',
    client_secret: process.env.META_THREADS_APP_SECRET,
    access_token: shortToken,
  }, 'the long-lived token exchange');
  return expectLongLived(data, 'the long-lived token exchange');
}

async function refresh(token) {
  const data = await call('GET', 'refresh_access_token', {
    grant_type: 'th_refresh_token',
    access_token: token,
  }, 'the token refresh');
  return expectLongLived(data, 'the token refresh');
}

async function me(token) {
  const data = await call('GET', `${VERSION}/me`, { fields: 'id,username', access_token: token },
    'the account lookup');
  if (!data || !data.id) throw new ThreadsError('Threads did not say which account the token is for');
  return { id: String(data.id), username: data.username || null };
}

module.exports = {
  missingConfig, authorizeUrl, exchangeCode, longLived, refresh, me,
  ThreadsError, describeFailure, SCOPES, MIN_REFRESH_AGE_MS,
};
