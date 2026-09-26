// Connecting the league's Threads account, and keeping its token alive.
//
//   GET  /admin/threads            the status page, with Connect and Refresh buttons
//   GET  /admin/threads/connect    starts the login: sets `state`, redirects to Threads
//   GET  /admin/threads/callback   Threads sends the person back here with ?code=
//   POST /admin/threads/refresh    weekly, from Cloud Scheduler (SOCIAL_CRON_TOKEN) or the page
//
// The first three are superadmin pages. The login is also the RECOVERY path: when a refresh
// has lapsed for 60 days, this page is the only way back, so it has to work without any
// token at all.
//
// This file stores the token. It does not post anything; that comes later, and reads the
// token through models/socialToken.withToken.

const crypto = require('crypto');
const SocialToken = require('../models/socialToken');
const threads = require('../utils/threadsAuth');
const { absoluteUrl, canonicalFor } = require('../utils/canonical');
const { userLabel } = require('../utils/sessionUser');

const PLATFORM = 'threads';

// The redirect URI must match one registered in the Threads use case exactly, so it is
// built from SITE_ORIGIN, never from the Host header (gotcha 1b: behind Firebase Hosting
// that header is the Cloud Run hostname). It also means a login started on a laptop comes
// back to production. That is correct: the token belongs in production's database.
const CALLBACK_PATH = '/admin/threads/callback';
const redirectUri = () => absoluteUrl(CALLBACK_PATH);

const DAY_MS = 24 * 60 * 60 * 1000;

// Messages the page shows after a redirect, looked up by a fixed code. The query string
// never carries text of its own, so a crafted link cannot make this page say anything.
const NOTICES = {
  connected: ['success', 'Connected. The token is stored and will be refreshed weekly.'],
  refreshed: ['success', 'Refreshed. The token is good for another 60 days.'],
  young: ['info', 'Not refreshed: Threads only refreshes a token that is at least 24 hours old.'],
  superseded: ['warning', 'Not refreshed: the token changed while the refresh was running. Nothing was lost.'],
  none: ['warning', 'Nothing to refresh: no Threads account is connected.'],
  expired: ['danger', 'The token has expired. Connect again below.'],
  failed: ['danger', 'The refresh failed. The reason is recorded below.'],
};

function daysLeft(expiresAt) {
  return expiresAt ? Math.floor((new Date(expiresAt).getTime() - Date.now()) / DAY_MS) : null;
}

function render(req, res, { status = 200, error = null, notice = null, row = null } = {}) {
  res.status(status).render('admin/threads', {
    static_path: '/static',
    pageTitle: 'Threads',
    pageDescription: 'Connect the league Threads account',
    canonical: canonicalFor(req),
    missing: threads.missingConfig(),
    expectedId: process.env.META_THREADS_USER_ID || null,
    redirectUri: redirectUri(),
    row,
    daysLeft: row ? daysLeft(row.expiresAt) : null,
    notice: notice && NOTICES[notice] ? NOTICES[notice] : null,
    error,
  });
}

exports.page = async function(req, res, next) {
  try {
    render(req, res, { row: await SocialToken.status(PLATFORM), notice: req.query.notice });
  } catch (err) {
    next(err);
  }
};

exports.connect = async function(req, res, next) {
  const missing = threads.missingConfig();
  if (missing.length) {
    // Rendered here rather than passed to next(): the central handler turns every 5xx
    // into the generic 500 page, which would hide which setting is missing.
    try {
      return render(req, res, {
        status: 503, row: await SocialToken.status(PLATFORM),
        error: 'Threads is not configured on this server: ' + missing.join(', ') + ' unset.',
      });
    } catch (err) {
      return next(err);
    }
  }
  // `state` ties the callback to a login this session started, so nobody can hand a
  // superadmin a link that connects the league to the sender's own Threads account.
  const state = crypto.randomBytes(24).toString('hex');
  req.session.threadsOAuthState = state;
  // Saved before redirecting. Otherwise a slow store write can lose the race with the
  // person's round trip to Threads, and the callback finds no state.
  req.session.save(err => {
    if (err) return next(err);
    res.redirect(threads.authorizeUrl({ state, redirectUri: redirectUri() }));
  });
};

function sameState(expected, presented) {
  if (!expected || !presented) return false;
  const a = crypto.createHash('sha256').update(String(expected)).digest();
  const b = crypto.createHash('sha256').update(String(presented)).digest();
  return crypto.timingSafeEqual(a, b);
}

exports.callback = async function(req, res, next) {
  const expected = req.session && req.session.threadsOAuthState;
  // One use, whatever happens next.
  if (req.session) delete req.session.threadsOAuthState;

  try {
    // The person pressed Cancel, or Threads refused before issuing a code.
    if (req.query.error) {
      const reason = req.query.error_description || req.query.error_reason || req.query.error;
      return render(req, res, {
        status: 400, row: await SocialToken.status(PLATFORM),
        error: `Threads did not connect: ${String(reason).slice(0, 300)}`,
      });
    }
    if (!sameState(expected, req.query.state)) {
      return render(req, res, {
        status: 400, row: await SocialToken.status(PLATFORM),
        error: 'That link did not come from a login started on this page, so it was ignored. ' +
               'Press Connect to start again.',
      });
    }
    if (!req.query.code) {
      return render(req, res, {
        status: 400, row: await SocialToken.status(PLATFORM),
        error: 'Threads came back without a login code. Press Connect to start again.',
      });
    }

    const shortToken = await threads.exchangeCode({ code: req.query.code, redirectUri: redirectUri() });
    const { token, expiresIn } = await threads.longLived(shortToken);
    const account = await threads.me(token);

    // The trap from 26 Sep: the browser was signed in to Neil's personal Instagram, and
    // that is the account Threads connected. Storing that token would make the league's
    // posts come from a person. Refuse anything but the configured account.
    if (account.id !== String(process.env.META_THREADS_USER_ID)) {
      return render(req, res, {
        status: 400, row: await SocialToken.status(PLATFORM),
        error: `That login was for @${account.username || account.id}, which is not the ` +
               `league's Threads account, so nothing was stored. Sign in to Threads as the ` +
               `league in this browser first, then press Connect again.`,
      });
    }

    await SocialToken.saveLogin(PLATFORM, {
      accountId: account.id, username: account.username, token, expiresIn,
      updatedBy: userLabel(req.user),
    });
    res.redirect('/admin/threads?notice=connected');
  } catch (err) {
    if (err instanceof threads.ThreadsError) {
      return render(req, res, {
        status: 502, row: await SocialToken.status(PLATFORM).catch(() => null), error: err.message,
      });
    }
    next(err);
  }
};

/**
 * Renew the token. Weekly from Cloud Scheduler, or by hand from the page.
 *
 * Answers 200 when nothing went wrong, including the cases where nothing was done, and says
 * which (`refreshed` or `skipped`). It answers an error status when a person needs to act:
 * 409 for an expired token, 502 for a refusal. That turns the scheduler job red, and the
 * job has `retryCount` unset, so a red job is a signal, not a retry storm. The audit digest
 * reports the same row, for the week nobody looks at the scheduler.
 */
exports.refresh = async function(req, res, next) {
  const fromPage = req.body && req.body.from === 'page';
  const reply = (status, notice, body) => fromPage
    ? res.redirect(303, '/admin/threads?notice=' + notice)
    : res.status(status).json({ caller: req.socialCaller, ...body });

  try {
    const row = await SocialToken.withToken(PLATFORM);
    if (!row) return reply(200, 'none', { ok: true, skipped: 'no Threads account is connected' });

    const expiresAt = new Date(row.expiresAt).getTime();
    if (expiresAt <= Date.now()) {
      await SocialToken.recordError(PLATFORM, 'The token expired before it was refreshed');
      return reply(409, 'expired', {
        ok: false, error: 'The Threads token has expired. Connect again at /admin/threads.',
      });
    }
    if (Date.now() - new Date(row.obtainedAt).getTime() < threads.MIN_REFRESH_AGE_MS) {
      return reply(200, 'young', {
        ok: true, skipped: 'the token is under 24 hours old, and Threads refuses to refresh it',
        daysLeft: daysLeft(row.expiresAt),
      });
    }

    let fresh;
    try {
      fresh = await threads.refresh(row.token);
    } catch (err) {
      if (!(err instanceof threads.ThreadsError)) throw err;
      await SocialToken.recordError(PLATFORM, err.message);
      return reply(502, 'failed', { ok: false, error: err.message, daysLeft: daysLeft(row.expiresAt) });
    }

    const written = await SocialToken.saveRefresh(PLATFORM, {
      token: fresh.token, expiresIn: fresh.expiresIn, generation: row.generation,
      updatedBy: req.socialCaller === 'superadmin' ? userLabel(req.user) : 'scheduler',
    });
    if (!written) {
      return reply(200, 'superseded', {
        ok: true, skipped: 'the token was replaced by a login while this refresh ran',
      });
    }

    // Report what the database now holds, not what we meant to write (gotcha 2d).
    const after = await SocialToken.status(PLATFORM);
    reply(200, 'refreshed', {
      ok: true, refreshed: true, expiresAt: after && after.expiresAt, daysLeft: after && daysLeft(after.expiresAt),
    });
  } catch (err) {
    next(err);
  }
};

exports.daysLeft = daysLeft;
