const Spam = require('../models/spamControls');
const { canonicalFor } = require('../utils/canonical');
const { isSuperAdmin } = require('../utils/authz');

// /admin/spam — the blocklist and the submission log.
//
// This screen is the whole point of Tier 2. Blocking a spammer used to mean editing
// controllers/contactusController.js and running a deploy, which is why 89 addresses
// accumulated in source. Now it's a form.
//
// The log half answers a question nothing could answer before: whether this is three a
// week or three hundred, and whether any of the controls are catching real people.

const KINDS = ['ip', 'email', 'phrase', 'word'];

exports.form = async function(req, res, next) {
  if (!isSuperAdmin(req)) return res.status(403).send('Forbidden');
  try {
    const [entries, stats, recent] = await Promise.all([
      Spam.list(),
      Spam.submissionStats(),
      Spam.recentSubmissions(100),
    ]);

    res.render('admin/spam', {
      static_path: '/static',
      pageTitle: 'Spam controls',
      pageDescription: 'Blocklists and recent submissions',
      entries,
      stats,
      recent,
      kinds: KINDS,
      message: req.query.msg || null,
      error: req.query.err || null,
      canonical: canonicalFor(req),
    });
  } catch (err) {
    next(err);
  }
};

exports.add = async function(req, res, next) {
  if (!isSuperAdmin(req)) return res.status(403).send('Forbidden');
  try {
    const kind = String(req.body.kind || '').trim();
    const value = String(req.body.value || '').trim();
    const note = String(req.body.note || '').trim() || null;

    if (!KINDS.includes(kind)) {
      return res.redirect('/admin/spam?err=' + encodeURIComponent('Unknown kind'));
    }
    if (!value) {
      return res.redirect('/admin/spam?err=' + encodeURIComponent('Nothing to block'));
    }
    // A one or two character phrase would match nearly every message. Cheap guard against
    // a typo taking the contact form offline.
    if (kind !== 'ip' && value.length < 3) {
      return res.redirect('/admin/spam?err=' + encodeURIComponent(
        'Too short to be safe — a 1-2 character phrase would block almost everything'));
    }

    await Spam.add({
      kind,
      value,
      note,
      createdBy: (req.user && req.user.email) || 'admin',
    });
    res.redirect('/admin/spam?msg=' + encodeURIComponent('Added ' + kind + ' ' + value));
  } catch (err) {
    next(err);
  }
};

exports.toggle = async function(req, res, next) {
  if (!isSuperAdmin(req)) return res.status(403).send('Forbidden');
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) {
      return res.redirect('/admin/spam?err=' + encodeURIComponent('Bad id'));
    }
    // Deactivated rather than deleted, so the note explaining why it was added survives.
    await Spam.setActive(id, req.body.active === 'true');
    res.redirect('/admin/spam?msg=' + encodeURIComponent('Updated'));
  } catch (err) {
    next(err);
  }
};
