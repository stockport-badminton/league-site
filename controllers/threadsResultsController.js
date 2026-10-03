// POST /admin/social/results/threads — post published results to Threads.
//
// Publishing a result posts it to Facebook, Instagram and the story inside the publish
// request. Threads cannot go there: each container has to be waited on before it can be
// published, and that wait would sit in front of whoever is publishing, in a request that
// Firebase Hosting cuts at 60 seconds (CLAUDE.md 1bc). So publishing only queues the fixture
// (`threads_result_post`, migration 021) and this route, called by the scheduler job
// `sbl-results-threads` every few minutes, posts what is waiting.
//
// The job calls Cloud Run directly and carries no retries, like the other Threads job: a
// retry of a post that timed out on the way back is a second post. Retrying is done here
// instead, per row, and only where Threads cannot have published anything.

const ThreadsResultPost = require('../models/threadsResultPost');
const SocialToken = require('../models/socialToken');
const threads = require('../utils/threadsPublisher');
const { absoluteUrl, resultImagePath } = require('../utils/canonical');

const SITE = 'https://stockport-badminton.co.uk';

// A run posts at most this many, so a backlog cannot hold one request for minutes. Each
// post is a few seconds; the rest wait for the next run.
const PER_RUN = 3;
// A result queued this long ago is news nobody wants, typically because the Threads account
// was disconnected for a while. Skipped, not posted as a burst of old results.
const STALE_MS = 48 * 60 * 60 * 1000;
// Attempts at a post Threads definitely did not publish, before giving up.
const MAX_ATTEMPTS = 3;

/** The post text: the result, the league, the site, and one tag (Threads takes one topic). */
function caption(r) {
  return `Result, ${r.division}: ${r.homeTeam} ${r.homeScore}-${r.awayScore} ${r.awayTeam}\n\n` +
    `Stockport & District Badminton League. ${SITE}\n\n#badminton`;
}

/**
 * Whether Threads might have published this post despite the error. Only the publish call
 * can publish, and if Threads answered it with an error status, it refused. With no answer
 * at all (a timeout, a dropped connection) the post may be live, so it must not be retried.
 */
function mayHavePublished(err) {
  return err && err.step === 'the publish' && !err.status;
}

async function postOne(row, account) {
  if (Date.now() - new Date(row.queuedAt).getTime() > STALE_MS) {
    await ThreadsResultPost.markSkipped(row.id, 'stale: queued over 48 hours ago');
    return { outcome: 'skipped', reason: 'stale' };
  }

  const r = await ThreadsResultPost.resultFor(row.fixtureId);
  if (!r || r.homeScore == null || r.awayScore == null || !r.homeTeam || !r.awayTeam) {
    await ThreadsResultPost.markSkipped(row.id, 'the fixture no longer has a result');
    return { outcome: 'skipped', reason: 'no result' };
  }

  const imageUrl = absoluteUrl(resultImagePath(r));
  let out;
  try {
    out = await threads.publishImage(account.accountId, account.token,
      { imageUrl, text: caption(r) });
  } catch (err) {
    const retry = !mayHavePublished(err) && err.step !== 'validate' && row.attempts < MAX_ATTEMPTS;
    const message = mayHavePublished(err)
      ? `${err.message} — no answer to the publish, so it may be live; check Threads before retrying`
      : err.message;
    console.error(`result for fixture ${row.fixtureId} -> Threads failed:`, message);
    if (retry) await ThreadsResultPost.release(row.id, message);
    else await ThreadsResultPost.markFailed(row.id, message);
    return { outcome: retry ? 'retrying' : 'failed', error: message };
  }

  // Outside the try on purpose. The post is live by now, so a failure to record it must not
  // be mistaken for a Threads failure and released for another go; it throws, the row stays
  // `posting`, and the audit digest asks a person to look.
  await ThreadsResultPost.markPosted(row.id, out.mediaId);
  console.log(`result for fixture ${row.fixtureId} posted to Threads`, out.mediaId);
  return { outcome: 'posted', id: out.mediaId };
}

exports.run = async function (req, res, next) {
  try {
    // Checked before anything is claimed, so with no usable token the queue simply waits.
    const { account, error } = await SocialToken.usable('threads');
    if (error) return res.status(503).json({ ok: false, error });

    const rows = await ThreadsResultPost.claim(PER_RUN);
    const results = [];
    for (const row of rows) {
      results.push({ fixtureId: row.fixtureId, ...(await postOne(row, account)) });
    }

    // Red when anything did not post, retries included: a job that is green while posts
    // fail is the shape this codebase keeps getting caught by.
    const ok = results.every(r => r.outcome === 'posted' || r.outcome === 'skipped');
    return res.status(ok ? 200 : 502).json({ ok, results, caller: req.socialCaller });
  } catch (err) {
    next(err);
  }
};

exports.caption = caption;
exports.PER_RUN = PER_RUN;
