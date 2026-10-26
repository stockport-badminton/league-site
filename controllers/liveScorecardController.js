// The live scorecard — filled in at the match by anybody holding its link, signed off by
// both captains, then filed as an ordinary draft (proof of concept).
//
// Shape and reasons: migrations/022_live_scorecard.sql. Rules: utils/liveScorecard.js.
//
//   GET  /live-scorecard                 secured   pick tonight's fixture
//   POST /live-scorecard                 secured   start a card for it
//   GET  /live-scorecard/:id/share       secured   QR code + links (creator or superadmin)
//   GET  /live-scorecard/:id?t=[&c=]     token     the card; `c` is a captain's token
//   GET  /api/live-scorecard/:id/state   token     polled; mounted in app.js above globalLimiter
//   POST /api/live-scorecard/:id/players token     pick a player for a slot
//   POST /api/live-scorecard/:id/games/:n token    enter or clear a game
//   POST /api/live-scorecard/:id/sign    captain   sign the version on screen
//
// Nothing here publishes a result. When both captains have signed, the card becomes a
// `scorecardstore` draft and the results secretary gets the same "scorecard received" email
// a paper card produces, with the same confirmation link — so the publish step, its
// authority (requirePublishAuthority) and its fixture matching are untouched.
//
// A bad or missing token is a 404, never a 403: a 403 would confirm the card exists.

const QRCode = require('qrcode');
const log = require('../utils/log');
const LiveScorecard = require('../models/liveScorecard');
const Fixture = require('../models/fixture');
const Player = require('../models/players');
const live = require('../utils/liveScorecard');
const { newDraftToken, tokenMatches } = require('../utils/scorecardLinks');
const { absoluteUrl } = require('../utils/canonical');
const { userEmail } = require('../utils/sessionUser');
const { isSuperAdmin } = require('../middleware/requireClubAccess');
const { afterCommit } = require('../utils/afterCommit');
const scorecardController = require('./scorecardController');

// The start page offers fixtures from this many days either side of today. A match is
// sometimes played a few days off its listed date; anything older is a late scorecard,
// which is the paper flow's job.
const START_WINDOW_DAYS_BACK = 10;

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function cardId(raw) {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) throw httpError(404, 'No such scorecard');
  return id;
}

// The card, if `t` is its edit token or either captain's token — a captain's link is also
// an edit link. Returns { card, side } where side is the captain's, or null.
async function authorise(req, idParam) {
  const card = await LiveScorecard.getById(cardId(idParam));
  const t = String((req.body && req.body.t) || req.query.t || '');
  const c = String((req.body && req.body.c) || req.query.c || '');
  if (!card) throw httpError(404, 'No such scorecard');
  let side = null;
  if (c && tokenMatches(card.home_token, c)) side = 'home';
  else if (c && tokenMatches(card.away_token, c)) side = 'away';
  if (!side && !tokenMatches(card.edit_token, t)) throw httpError(404, 'No such scorecard');
  return { card, side };
}

function isCreator(req, card) {
  return !!(req.user && card.created_by === String(req.user.id)) || isSuperAdmin(req);
}

function links(card) {
  const base = '/live-scorecard/' + card.id + '?t=' + card.edit_token;
  return {
    player: absoluteUrl(base),
    home: absoluteUrl(base + '&c=' + card.home_token),
    away: absoluteUrl(base + '&c=' + card.away_token),
  };
}

function noStore(res) {
  res.set('Cache-Control', 'no-store');
}

function pageLocals(req, extra) {
  return Object.assign({
    static_path: '/static',
    // The card's own URL carries its token, so the canonical is the start page.
    canonical: absoluteUrl('/live-scorecard'),
    noindex: true,
    useLiveScorecardCss: true,
  }, extra);
}

function shortDate(d) {
  const date = d instanceof Date ? d : new Date(d);
  return date.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

exports.start = async function(req, res, next) {
  try {
    const now = Date.now();
    const earliest = now - START_WINDOW_DAYS_BACK * 86400000;
    const fixtures = (await Fixture.getScorecardCandidates())
      .filter(f => new Date(f.date).getTime() >= earliest)
      .sort((a, b) => Math.abs(new Date(a.date) - now) - Math.abs(new Date(b.date) - now));
    const cards = await LiveScorecard.getForFixtures(fixtures.map(f => f.id));
    const byFixture = new Map(cards.map(c => [c.fixture_id, c]));
    const rows = fixtures.map(f => {
      const card = byFixture.get(f.id);
      return {
        id: f.id,
        date: shortDate(f.date),
        homeName: f.homeName,
        awayName: f.awayName,
        card: card ? {
          id: card.id,
          status: card.status,
          mine: isCreator(req, card),
        } : null,
      };
    });
    noStore(res);
    res.render('live-scorecard-start', pageLocals(req, {
      pageTitle: 'Live scorecard',
      pageDescription: 'Fill in a match scorecard live, from everyone\'s phones',
      fixtures: rows,
      taken: Number(req.query.taken) || null,
    }));
  } catch (err) { next(err); }
};

exports.create = async function(req, res, next) {
  try {
    const fixtureId = Number(req.body.fixtureId);
    // Only a fixture the start page would have offered: outstanding, this season, due.
    const candidates = await Fixture.getScorecardCandidates();
    if (!candidates.some(f => f.id === fixtureId)) {
      throw httpError(404, 'That fixture is not open for a scorecard');
    }
    let card = await LiveScorecard.create({
      fixtureId,
      tokens: { edit: newDraftToken(), home: newDraftToken(), away: newDraftToken() },
      createdBy: String(req.user && req.user.id || ''),
      createdEmail: userEmail(req.user),
    });
    if (!card) {
      // Somebody else started this match's card first. The creator (or a superadmin) is
      // sent to it; anyone else is told to ask, because the share page hands out the
      // captains' signing links.
      card = await LiveScorecard.getByFixture(fixtureId);
      if (!card || !isCreator(req, card)) {
        return res.redirect('/live-scorecard?taken=' + fixtureId);
      }
    }
    res.redirect('/live-scorecard/' + card.id + '/share');
  } catch (err) { next(err); }
};

exports.share = async function(req, res, next) {
  try {
    const card = await LiveScorecard.getById(cardId(req.params.id));
    // Only the person who started it. The captains' links are on this page, and a captain's
    // link is a signature.
    if (!card || !isCreator(req, card)) throw httpError(404, 'No such scorecard');
    const ctx = await LiveScorecard.getContext(card.fixture_id);
    const urls = links(card);
    // Server-side SVG: no script, no CDN, nothing for the CSP to allow. The input is our
    // own URL, so the markup is the library's and safe to inline.
    const qrSvg = await QRCode.toString(urls.player, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
    noStore(res);
    res.render('live-scorecard-share', pageLocals(req, {
      pageTitle: 'Share live scorecard',
      pageDescription: 'Share the live scorecard with the players',
      ctx, card, urls, qrSvg,
    }));
  } catch (err) { next(err); }
};

exports.card = async function(req, res, next) {
  try {
    const { card, side } = await authorise(req, req.params.id);
    const ctx = await LiveScorecard.getContext(card.fixture_id);
    if (!ctx) throw httpError(404, 'No such scorecard');
    const [homeMen, homeLadies, awayMen, awayLadies] = await Promise.all([
      Player.findElgiblePlayersFromTeamId(ctx.homeTeamId, 'Male'),
      Player.findElgiblePlayersFromTeamId(ctx.homeTeamId, 'Female'),
      Player.findElgiblePlayersFromTeamId(ctx.awayTeamId, 'Male'),
      Player.findElgiblePlayersFromTeamId(ctx.awayTeamId, 'Female'),
    ]);
    const roster = rows => rows.map(p => ({ id: p.id, name: (p.first_name + ' ' + p.family_name).trim() }));
    const boot = {
      id: card.id,
      t: card.edit_token,
      c: side ? card[side + '_token'] : '',
      side,
      home: ctx.homeTeamName,
      away: ctx.awayTeamName,
      games: live.GAMES,
      slots: live.SLOTS,
      players: {
        homeMale: roster(homeMen), homeFemale: roster(homeLadies),
        awayMale: roster(awayMen), awayFemale: roster(awayLadies),
      },
      state: live.publicState(card),
    };
    noStore(res);
    res.render('live-scorecard', pageLocals(req, {
      pageTitle: ctx.homeTeamName + ' v ' + ctx.awayTeamName,
      pageDescription: 'Live scorecard',
      ctx, side,
      cardId: card.id,
      canShare: isCreator(req, card),
      // JSON in a <script type="application/json">: `<` escaped so a player called
      // "</script>" cannot end the block.
      bootJson: JSON.stringify(boot).replace(/</g, '\\u003c'),
    }));
  } catch (err) { next(err); }
};

// Polled every few seconds by every phone at the match, so it answers 204 when nothing has
// changed. Mounted in app.js ABOVE globalLimiter, with its own limiter: a dozen phones on
// one club's wifi share an IP, and at 600 per quarter hour they would lock each other —
// and the whole site — out partway through the second set.
exports.state = async function(req, res) {
  noStore(res);
  try {
    const { card } = await authorise(req, req.params.id);
    if (String(card.rev) === String(req.query.rev || '')) return res.status(204).end();
    res.json(live.publicState(card));
  } catch (err) {
    const status = err.status || 500;
    if (status >= 500) log.error({ err }, 'live scorecard state');
    res.status(status).json({ ok: false, error: status < 500 ? err.message : 'Something went wrong' });
  }
};

function locked() {
  return httpError(409, 'This scorecard has been signed off and filed, so it can no longer be changed');
}

exports.setPlayer = async function(req, res, next) {
  try {
    const { card } = await authorise(req, req.params.id);
    const slot = String(req.body.slot || '');
    if (live.SLOTS.indexOf(slot) === -1) throw httpError(400, 'Unknown player slot');
    const raw = req.body.playerId;
    let playerId = null;
    if (raw !== null && raw !== undefined && raw !== '') {
      playerId = Number(raw);
      if (!Number.isInteger(playerId) || playerId < 0) throw httpError(400, 'Unknown player');
      // 0 is No Player. Anyone else must be someone the paper form would offer for that
      // team and gender, so the draft cannot carry a player the publish step would refuse.
      if (playerId !== 0) {
        const ctx = await LiveScorecard.getContext(card.fixture_id);
        const teamId = live.slotSide(slot) === 'home' ? ctx.homeTeamId : ctx.awayTeamId;
        const eligible = await Player.findElgiblePlayersFromTeamId(teamId, live.slotGender(slot));
        if (!eligible.some(p => p.id === playerId)) throw httpError(400, 'That player cannot play in this slot');
      }
    }
    const updated = await LiveScorecard.setPlayer(card.id, slot, playerId);
    if (!updated) throw locked();
    res.json({ ok: true, state: live.publicState(updated) });
  } catch (err) { next(err); }
};

exports.setGame = async function(req, res, next) {
  try {
    const { card } = await authorise(req, req.params.id);
    const n = live.gameNumber(req.params.n);
    if (!n) throw httpError(400, 'Unknown game');
    const parsed = live.parseGame(req.body);
    if (parsed.error) throw httpError(400, parsed.error);
    const updated = await LiveScorecard.setGame(card.id, n, parsed.clear
      ? null
      : { h: parsed.h, a: parsed.a, by: live.cleanName(req.body.by) });
    if (!updated) throw locked();
    res.json({ ok: true, state: live.publicState(updated) });
  } catch (err) { next(err); }
};

exports.sign = async function(req, res, next) {
  try {
    const { card, side } = await authorise(req, req.params.id);
    if (!side) throw httpError(403, 'Only a captain\'s link can sign the scorecard');
    if (card.status !== 'live') throw locked();
    const name = live.cleanName(req.body.name, 80);
    if (!name) throw httpError(400, 'Type your name to sign');
    const problems = live.problems(card);
    if (problems.length) throw httpError(409, 'Not ready to sign yet: ' + problems.join('; '));

    const signed = await LiveScorecard.sign(card.id, side, name, Number(req.body.version));
    if (!signed) {
      throw httpError(409, 'The scorecard changed while you were looking at it. Check it again, then sign.');
    }

    // The second signature files it. claimForFiling is conditional, so if both captains
    // sign in the same instant exactly one request does this.
    const claimed = await LiveScorecard.claimForFiling(card.id);
    if (!claimed) return res.json({ ok: true, state: live.publicState(signed) });

    const filed = await fileDraft(claimed);
    res.json({ ok: true, state: live.publicState(filed) });
  } catch (err) { next(err); }
};

// Write the card into scorecardstore as a draft, and tell the results secretary.
async function fileDraft(card) {
  const ctx = await LiveScorecard.getContext(card.fixture_id);
  const confirmToken = newDraftToken();
  const row = live.toDraftRow(card, ctx, { email: card.created_email, confirmToken });
  let draftId;
  try {
    const rows = await Fixture.createScorecard(row);
    draftId = rows[0] && rows[0].id;
    if (!draftId) throw new Error('live scorecard: draft saved but no id came back');
  } catch (err) {
    // Nothing was filed, so put the card back where the captains can sign it again.
    // Their signatures stand: the content they signed has not changed.
    await LiveScorecard.releaseClaim(card.id);
    throw err;
  }
  const filed = await LiveScorecard.markFiled(card.id, draftId);

  // From here the draft exists, so nothing may fail the request (utils/afterCommit.js).
  await afterCommit('supersede earlier drafts', () => Fixture.supersedeEarlierDrafts(
    draftId, { homeTeam: row.homeTeam, awayTeam: row.awayTeam, date: row.date }
  ), { stage: 'live-scorecard' });
  await scorecardController.sendDraftReceivedEmail({
    scorecardId: draftId,
    confirmToken,
    scorecardObj: row,
    photoUrl: '',
    submitterEmail: card.created_email || '',
    submitterName: '',
    photoLine: 'Entered on the live scorecard and signed off by ' + card.home_signed_by +
      ' (home) and ' + card.away_signed_by + ' (away). No photo attached.',
  });
  return filed || card;
}
