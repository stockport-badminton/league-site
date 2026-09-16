// The weekly fixtures post — what the league is playing in the coming week.
//
// Sunday evening, one card per division goes to the league's Facebook page as an album and
// to its Instagram account as a carousel. It is the forward-looking twin of the Saturday
// tables post in `weeklyTablesController`, and it deliberately borrows that file's shape:
// same `publishEverywhere` call, same per-target reporting, same gate, same caption rules.
//
// It is a new post rather than a ported one. Make.com never did this — its League Tables
// scenario looked backwards only — so there is no scenario to read and nothing to keep
// bug-compatible with.
//
// ── The one thing this post does that the tables post does not ───────────────
//
// **Its content can legitimately be empty, and then it must not post.** The league plays
// from September to April; a scheduled job that fires all year would spend the summer
// publishing four cards reading "Fixtures this week" with nothing under the heading, and
// Christmas doing the same. So the division list is built from the fixtures that exist,
// and a week with none is a no-op that says so rather than a post nobody looks at.
//
// That is also why the division cards are chosen rather than fixed. The tables post always
// has four tables because a division always has a table; a division can easily have no
// fixtures in a given week while the other three do.

const { canonicalFor, absoluteUrl, fixturesImagePath } = require('../utils/canonical');
const meta = require('../utils/metaPublisher');
const Club = require('../models/club');
const Fixture = require('../models/fixture');
const { DIVISIONS } = require('./weeklyTablesController');

const SITE = 'https://stockport-badminton.co.uk';
const HASHTAGS = '#badminton #stockport #sdbl #fixtures #bulutangkis';

/**
 * The divisions that have at least one fixture in the window, in table order.
 *
 * Driven by DIVISIONS rather than by whatever `divisionName` values come back, so the
 * cards read top division first and an unexpected division name — a friendly, a
 * tournament, a team whose division was renamed mid-season — cannot silently add a fifth
 * card to the carousel. Instagram's limit is 10, so a runaway list would fail the post
 * rather than look odd.
 */
function divisionsWithFixtures(rows) {
  const present = new Set(rows.map(r => String(r.divisionName || '').trim()));
  return DIVISIONS.filter(d => present.has(d));
}

function imageUrls(rows) {
  return divisionsWithFixtures(rows).map(d => absoluteUrl(fixturesImagePath(d)));
}

/**
 * The same cards as same-origin paths, for the preview page to display.
 *
 * `imageUrls` is absolute because Meta fetches those from Meta's own servers, and that is
 * not negotiable. But an absolute URL in the preview's `<img src>` means the page always
 * shows **production's** rendering of the card, whatever server you are looking at — so a
 * change to the renderer appears to do nothing locally, and a route that is not deployed
 * yet shows no image at all while the page cheerfully reports how many there are.
 *
 * A relative path resolves against whichever host is serving the page, which is what a
 * preview wants. The absolute URL is still shown, as text, because "what will actually be
 * posted" is information the preview exists to give.
 */
function imagePaths(rows) {
  return divisionsWithFixtures(rows).map(d => fixturesImagePath(d));
}

/**
 * Captions.
 *
 * The clubs mentioned are the ones actually playing, not every club with a handle. That is
 * the difference from the tables post, where all four tables name every club anyway — here
 * a mention is a notification, and notifying a club about a week it is not playing in is
 * how an account gets muted.
 *
 * Facebook gets no @-names. A page mention is not @-syntax at all: it is display-name text
 * plus a separate tag record, it needs the Page Mentioning feature, and that feature needs
 * App Review plus business verification. Measured 16 Sep 2026 — `@[page-id]` is silently
 * consumed, leaving an orphaned space. See docs/plans/social-mentions.md; do not "fix"
 * this by writing `@Club Name` into the message, which is what Make did for years to no
 * effect whatsoever.
 */
async function captions(rows) {
  const playing = new Set();
  for (const r of rows) {
    if (r.homeClub) playing.add(String(r.homeClub).trim());
    if (r.awayClub) playing.add(String(r.awayClub).trim());
  }

  const clubs = (await Club.getInstagramHandles()).filter(c => playing.has(String(c.name).trim()));
  const mentions = clubs.map(c => '@' + c.handle).join(' ');
  const count = rows.length;
  const headline = `${count} ${count === 1 ? 'match' : 'matches'} this week.`;

  return {
    facebook: `${headline} Full fixture list and venues at ${SITE}\n\n${HASHTAGS}`,
    instagram: [
      `${headline} Full fixture list and venues at ${SITE}`,
      mentions,
      HASHTAGS,
    ].filter(Boolean).join('\n\n'),
    mentioned: clubs.map(c => c.name),
  };
}

/**
 * POST /admin/social/weekly-fixtures — publish it.
 *
 * `?dry=1` validates the images through Meta and posts nothing, the same free check the
 * tables post has. Worth running before a season's first real post: a scheduled job nobody
 * is watching is exactly where a silent refusal hides, which is how the Instagram carousel
 * on the other post managed never to work for as long as it existed.
 */
exports.run = async function (req, res, next) {
  try {
    const dry = req.query.dry === '1' || req.body?.dry === '1';
    const rows = await Fixture.getUpcomingWeek();
    const urls = imageUrls(rows);
    const t = meta.targets();

    const configured = [
      t.stockportPage && { ...t.stockportPage, name: 'Stockport page', kind: 'page' },
      t.instagram && { ...t.instagram, name: 'Instagram', kind: 'instagram' },
    ].filter(Boolean);

    // Same rule as the tables post and the result post: a switch whose halves live in
    // different places must fail loudly when only one is set. Posting nowhere is not a
    // quiet success.
    if (!configured.length) {
      return res.status(500).json({
        ok: false,
        error: 'No Meta credentials configured, so this would have posted nowhere. ' +
               'Set META_PAGE_ID, META_PAGE_TOKEN and META_IG_USER_ID on the service.',
      });
    }

    // Nothing to announce. A 200, because nothing went wrong and a scheduler retrying a
    // 4xx every Sunday through the summer would be noise — but with `skipped` set and
    // `posted` empty, so it can never be read as "the post went out".
    if (!urls.length) {
      return res.json({
        ok: true, skipped: 'no fixtures in the coming week', fixtures: 0,
        posted: [], failed: [], caller: req.socialCaller,
      });
    }

    if (dry) {
      const check = await meta.validateImages(t.instagram.id, t.instagram.token, urls);
      return res.json({ ok: check.ok, dry: true, images: urls, fixtures: rows.length, refused: check.refused });
    }

    const text = await captions(rows);
    const out = await meta.publishEverywhere(configured, {
      imageUrls: urls,
      message: text.facebook,
      caption: text.instagram,
    });

    for (const f of out.failed) console.error(`weekly fixtures -> ${f.target} failed:`, f.error.message);
    if (out.posted.length) console.log('weekly fixtures posted to', out.posted.map(p => p.target).join(', '));

    // 207 when some targets took it and some did not — reporting only success would make a
    // half failure indistinguishable from a whole one.
    return res.status(out.ok ? 200 : (out.posted.length ? 207 : 502)).json({
      ok: out.ok,
      images: urls,
      fixtures: rows.length,
      mentioned: text.mentioned,
      posted: out.posted,
      failed: out.failed.map(f => ({ target: f.target, error: f.error.message })),
      caller: req.socialCaller,
    });
  } catch (err) {
    next(err);
  }
};

/** GET /admin/social/weekly-fixtures — what would be posted, sending nothing. */
exports.preview = async function (req, res, next) {
  try {
    const rows = await Fixture.getUpcomingWeek();
    const text = await captions(rows);
    res.render('admin/weekly-fixtures-preview', {
      static_path: '/static',
      theme: process.env.THEME || 'flatly',
      pageTitle: 'Weekly fixtures post',
      pageDescription: 'What the weekly fixtures post will contain',
      canonical: canonicalFor(req),
      images: imageUrls(rows),
      imagePaths: imagePaths(rows),
      divisions: divisionsWithFixtures(rows),
      fixtureCount: rows.length,
      captions: text,
      targetsConfigured: Object.values(meta.targets()).filter(Boolean).length,
    });
  } catch (err) {
    next(err);
  }
};

exports.captions = captions;
exports.imageUrls = imageUrls;
exports.imagePaths = imagePaths;
exports.divisionsWithFixtures = divisionsWithFixtures;
