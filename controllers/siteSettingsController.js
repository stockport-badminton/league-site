var SiteSettings = require('../models/siteSettings');

function isSuperAdmin(req) {
  return !!(req.user && req.user._json && req.user._json['https://my-app.example.com/role'] === 'superadmin');
}

function canonicalFor(req) {
  return ("https://" + req.get("host") + req.originalUrl).replace("www.'", "").replace(".com", ".co.uk").replace("-badders.herokuapp", "-badminton");
}

exports.form = async function(req, res, next) {
  if (!isSuperAdmin(req)) return res.status(403).send('Forbidden');
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
  if (!isSuperAdmin(req)) return res.status(403).send('Forbidden');
  try {
    await SiteSettings.set('homepage_gallery_tag', req.body.homepage_gallery_tag || '');
    res.redirect('/admin/site-settings');
  } catch (err) {
    next(err);
  }
};
