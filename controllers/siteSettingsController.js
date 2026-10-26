var SiteSettings = require('../models/siteSettings');
const { canonicalFor } = require('../utils/canonical');

exports.form = async function(req, res, next) {
  try {
    const settings = await SiteSettings.getAll();
    res.render('admin/site-settings-form', {
      static_path: '/static',
      pageTitle: 'Site Settings',
      pageDescription: 'Manage site settings',
      settings,
      canonical: canonicalFor(req)
    });
  } catch (err) {
    next(err);
  }
};

exports.update = async function(req, res, next) {
  try {
    await SiteSettings.set('homepage_gallery_tag', req.body.homepage_gallery_tag || '');
    res.redirect('/admin/site-settings');
  } catch (err) {
    next(err);
  }
};
