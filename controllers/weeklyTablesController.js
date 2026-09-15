// The weekly league-tables post, from here rather than from a Make.com scenario.
//
// Saturday lunchtime, four division tables go to the league's Facebook page as one album
// and to its Instagram account as one carousel. That is what Make has been doing — or
// rather, half of it: **the Instagram carousel has never worked**, because the images were
// PNG and Instagram takes JPEG only, and because they were files on a container's disk that
// 404'd by the time Meta fetched them. Both are fixed; this is what posts them.
//
// ── What the Make scenario actually does, having read it ─────────────────────
//
// Three routes, and **two of them are dead**. Routes 1 and 2 add tournament posters and are
// both gated on a `tournament` variable that the scenario hardcodes to `"false"`, so
// neither has fired since someone set it. Route 3 has no filter and is the whole live
// behaviour: four tables to Stockport, and Tameside's two to the Tameside page.
//
// So this reproduces route 3's Stockport half. **The Tameside half deliberately stays in
// Make** until that league is ported — see CLAUDE.md, "Two leagues, one Make account".
//
// The tournament posters are kept reachable (`?posters=handicap,open`) rather than dropped,
// because the capability was built and only the trigger had rotted. A date-driven variable
// nobody remembers to flip is not a feature worth reproducing.

const { canonicalFor, absoluteUrl, leagueTableImagePath, tournamentImagePath } = require('../utils/canonical');
const meta = require('../utils/metaPublisher');
const Club = require('../models/club');
const { TOURNAMENT_POSTERS } = require('./socialController');

// The order the tables read in the post: top division first.
const DIVISIONS = ['Premier', 'Division 1', 'Division 2', 'Division 3'];

const SITE = 'https://stockport-badminton.co.uk';
const HASHTAGS = '#badmintonresults #stockport #badminton #sdbl #bulutangkis';

/**
 * Captions.
 *
 * Instagram turns a bare `@handle` in a caption into a real mention, so the clubs we hold
 * handles for are named there. Facebook's are omitted rather than faked: a page mention
 * needs the Pages API and the `@Club Name` text the Make scenario carries does nothing at
 * all — it has been posting literal `@Shell Badminton Club` into the message for years.
 */
async function captions() {
  const clubs = await Club.getInstagramHandles();
  const mentions = clubs.map(c => '@' + c.handle).join(' ');

  return {
    facebook: `League tables for this week. ${SITE}\n\n${HASHTAGS}`,
    instagram: [
      `This week's league tables. ${SITE}`,
      mentions,
      HASHTAGS,
    ].filter(Boolean).join('\n\n'),
    mentioned: clubs.map(c => c.name),
  };
}

/** The images, in order: tables first, then any tournament posters asked for. */
function imageUrls({ posters = [] } = {}) {
  const tables = DIVISIONS.map(d => absoluteUrl(leagueTableImagePath(d)));
  const extra = posters
    .filter(p => Object.prototype.hasOwnProperty.call(TOURNAMENT_POSTERS, p))
    .map(p => absoluteUrl(tournamentImagePath(p)));
  return [...tables, ...extra];
}

function parsePosters(value) {
  return String(value || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
}

/**
 * POST /admin/social/weekly-tables — publish it.
 *
 * `?dry=1` validates the images through Meta and posts nothing. Worth running before a
 * season's first real post, because a scheduled job nobody is watching is exactly where a
 * silent refusal hides — which is how the Instagram carousel managed never to work.
 */
exports.run = async function (req, res, next) {
  try {
    const dry = req.query.dry === '1' || req.body?.dry === '1';
    const posters = parsePosters(req.query.posters ?? req.body?.posters);
    const urls = imageUrls({ posters });
    const t = meta.targets();

    const configured = [
      t.stockportPage && { ...t.stockportPage, name: 'Stockport page', kind: 'page' },
      t.instagram && { ...t.instagram, name: 'Instagram', kind: 'instagram' },
    ].filter(Boolean);

    // Same rule as the result post: a switch whose halves live in different places must
    // fail loudly when only one is set. Posting nowhere is not a quiet success.
    if (!configured.length) {
      return res.status(500).json({
        ok: false,
        error: 'No Meta credentials configured, so this would have posted nowhere. ' +
               'Set META_PAGE_ID, META_PAGE_TOKEN and META_IG_USER_ID on the service.',
      });
    }

    if (dry) {
      const check = await meta.validateImages(t.instagram.id, t.instagram.token, urls);
      return res.json({ ok: check.ok, dry: true, images: urls, refused: check.refused });
    }

    const text = await captions();
    const out = await meta.publishEverywhere(configured, {
      imageUrls: urls,
      message: text.facebook,
      caption: text.instagram,
    });

    for (const f of out.failed) console.error(`weekly tables -> ${f.target} failed:`, f.error.message);
    if (out.posted.length) console.log('weekly tables posted to', out.posted.map(p => p.target).join(', '));

    // 207 when some targets took it and some did not. Reporting only success would make a
    // half failure indistinguishable from a whole one, which is the mistake this codebase
    // has made in three different places.
    return res.status(out.ok ? 200 : (out.posted.length ? 207 : 502)).json({
      ok: out.ok,
      images: urls,
      mentioned: text.mentioned,
      posted: out.posted,
      failed: out.failed.map(f => ({ target: f.target, error: f.error.message })),
      caller: req.socialCaller,
    });
  } catch (err) {
    next(err);
  }
};

/** GET /admin/social/weekly-tables — what would be posted, sending nothing. */
exports.preview = async function (req, res, next) {
  try {
    const posters = parsePosters(req.query.posters);
    const text = await captions();
    res.render('admin/weekly-tables-preview', {
      static_path: '/static',
      theme: process.env.THEME || 'flatly',
      pageTitle: 'Weekly tables post',
      pageDescription: 'What the weekly league tables post will contain',
      canonical: canonicalFor(req),
      images: imageUrls({ posters }),
      captions: text,
      posters: Object.keys(TOURNAMENT_POSTERS),
      selectedPosters: posters,
      targetsConfigured: Object.values(meta.targets()).filter(Boolean).length,
    });
  } catch (err) {
    next(err);
  }
};

exports.captions = captions;
exports.imageUrls = imageUrls;
exports.DIVISIONS = DIVISIONS;
