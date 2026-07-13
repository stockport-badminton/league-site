var HomepageContent = require('../models/homepageContent');
const sanitizeHtml = require('sanitize-html');

const SANITIZE_OPTS = {
  allowedTags: ['p', 'br', 'strong', 'em', 'a', 'img', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4'],
  allowedAttributes: {
    a: ['href', 'target'],
    img: ['src', 'alt']
  }
};

function isSuperAdmin(req) {
  return !!(req.user && req.user._json && req.user._json['https://my-app.example.com/role'] === 'superadmin');
}

function canonicalFor(req) {
  return ("https://" + req.get("host") + req.originalUrl).replace("www.'", "").replace(".com", ".co.uk").replace("-badders.herokuapp", "-badminton");
}

exports.list = async function(req, res, next) {
  if (!isSuperAdmin(req)) return res.status(403).send('Forbidden');
  try {
    const announcements = await HomepageContent.getAll();
    res.render('admin/homepage-content-list', {
      static_path: '/static',
      pageTitle: 'Content Admin',
      pageDescription: 'Manage homepage announcements',
      announcements,
      canonical: canonicalFor(req)
    });
  } catch (err) {
    next(err);
  }
};

exports.createForm = async function(req, res, next) {
  if (!isSuperAdmin(req)) return res.status(403).send('Forbidden');
  res.render('admin/homepage-content-form', {
    static_path: '/static',
    pageTitle: 'New Announcement',
    pageDescription: 'Create a homepage announcement',
    announcement: null,
    canonical: canonicalFor(req)
  });
};

exports.create = async function(req, res, next) {
  if (!isSuperAdmin(req)) return res.status(403).send('Forbidden');
  try {
    await HomepageContent.create({
      title: req.body.title,
      teaser_html: sanitizeHtml(req.body.teaser_html || '', SANITIZE_OPTS),
      modal_body_html: req.body.modal_body_html ? sanitizeHtml(req.body.modal_body_html, SANITIZE_OPTS) : null,
      image_url: req.body.image_url || null,
      show_gallery_link: req.body.show_gallery_link === 'on',
      sort_order: parseInt(req.body.sort_order, 10) || 0,
      active: req.body.active === 'on'
    });
    res.redirect('/admin/homepage-content');
  } catch (err) {
    next(err);
  }
};

exports.editForm = async function(req, res, next) {
  if (!isSuperAdmin(req)) return res.status(403).send('Forbidden');
  try {
    const announcement = await HomepageContent.getById(req.params.id);
    if (!announcement) return res.status(404).send('Not found');
    res.render('admin/homepage-content-form', {
      static_path: '/static',
      pageTitle: 'Edit Announcement',
      pageDescription: 'Edit a homepage announcement',
      announcement,
      canonical: canonicalFor(req)
    });
  } catch (err) {
    next(err);
  }
};

exports.update = async function(req, res, next) {
  if (!isSuperAdmin(req)) return res.status(403).send('Forbidden');
  try {
    await HomepageContent.updateById(req.params.id, {
      title: req.body.title,
      teaser_html: sanitizeHtml(req.body.teaser_html || '', SANITIZE_OPTS),
      modal_body_html: req.body.modal_body_html ? sanitizeHtml(req.body.modal_body_html, SANITIZE_OPTS) : null,
      image_url: req.body.image_url || null,
      show_gallery_link: req.body.show_gallery_link === 'on',
      sort_order: parseInt(req.body.sort_order, 10) || 0,
      active: req.body.active === 'on'
    });
    res.redirect('/admin/homepage-content');
  } catch (err) {
    next(err);
  }
};

exports.remove = async function(req, res, next) {
  if (!isSuperAdmin(req)) return res.status(403).send('Forbidden');
  try {
    await HomepageContent.deleteById(req.params.id);
    res.redirect('/admin/homepage-content');
  } catch (err) {
    next(err);
  }
};
