const JuniorClub = require('../models/juniorClub');
const Venue = require('../models/venue');
const { canonicalFor } = require('../utils/canonical');

// GET /info/junior-clubs — the public list. Each club publishes different details (an
// email, only a website, fees or not), so the view shows whichever are set.
exports.list = async function(req, res, next) {
  try {
    const clubs = await JuniorClub.getActive();
    res.render('junior-clubs', {
      static_path: '/static',
      pageTitle: 'Junior Badminton Clubs',
      pageDescription: 'Junior badminton clubs in and around Stockport: where and when they play, and how to get in touch.',
      clubs,
      canonical: canonicalFor(req)
    });
  } catch (err) {
    next(err);
  }
};

// ---------------------------------------------------------------------------
// Superadmin admin UI — /admin/junior-clubs
// ---------------------------------------------------------------------------

// Column widths from migrations/028_junior_club.sql, checked before the write so an
// over-long value is a message on the form rather than a 500 from Postgres.
const MAX_LENGTH = { name: 100, venue_note: 200, session_times: 200, fees: 200, contact_email: 200, website: 300 };
const LABELS = { name: 'Name', venue_note: 'Venue note', session_times: 'Sessions', fees: 'Fees',
  contact_email: 'Enquiries email', website: 'Website' };

// The form body as the row to write, and what is wrong with it. Blank optional fields
// become null so an edit can clear them. A website typed without its scheme
// ("mgbadders.com") gets https://; anything else that is not http(s) is refused, as it
// becomes an href on a public page.
function readForm(body) {
  const text = k => {
    const v = String(body[k] == null ? '' : body[k]).trim();
    return v === '' ? null : v;
  };
  const venue = parseInt(body.venue, 10);
  let website = text('website');
  if (website && !/^[a-z][a-z0-9+.-]*:/i.test(website)) website = 'https://' + website;

  const data = {
    name: text('name') || '',
    venue: isNaN(venue) ? null : venue,
    venue_note: text('venue_note'),
    session_times: text('session_times'),
    fees: text('fees'),
    contact_email: text('contact_email'),
    website,
    notes: text('notes'),
    active: body.active === 'on',
  };

  const errors = [];
  if (!data.name) errors.push('Name is required.');
  Object.keys(MAX_LENGTH).forEach(k => {
    if (data[k] && data[k].length > MAX_LENGTH[k]) {
      errors.push(LABELS[k] + ' must be ' + MAX_LENGTH[k] + ' characters or fewer.');
    }
  });
  if (data.contact_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.contact_email)) {
    errors.push('Enquiries email does not look like an email address.');
  }
  if (data.website && !/^https?:\/\/[^\s]+$/i.test(data.website)) {
    errors.push('Website must be a web address (https://…).');
  }
  return { data, errors };
}

async function renderForm(res, req, { club, data, errors, status }) {
  const venues = await Venue.getAll();
  venues.sort((a, b) => a.name.localeCompare(b.name));
  res.status(status || 200).render('admin/junior-club-form', {
    static_path: '/static',
    pageTitle: club ? 'Edit Junior Club' : 'New Junior Club',
    pageDescription: club ? 'Edit a junior club' : 'Add a junior club',
    club,
    // What the form shows: the submitted values after a failed save, else the stored row.
    data: data || club || { active: true },
    venues,
    errors: errors || [],
    canonical: canonicalFor(req)
  });
}

exports.admin_list = async function(req, res, next) {
  try {
    const clubs = await JuniorClub.getAll();
    res.render('admin/junior-club-list', {
      static_path: '/static',
      pageTitle: 'Junior Clubs',
      pageDescription: 'Add, edit and remove junior clubs',
      clubs,
      canonical: canonicalFor(req)
    });
  } catch (err) {
    next(err);
  }
};

exports.admin_createForm = async function(req, res, next) {
  try {
    await renderForm(res, req, { club: null });
  } catch (err) {
    next(err);
  }
};

exports.admin_create = async function(req, res, next) {
  try {
    const { data, errors } = readForm(req.body);
    if (errors.length) return await renderForm(res, req, { club: null, data, errors, status: 400 });
    await JuniorClub.create(data);
    res.redirect('/admin/junior-clubs');
  } catch (err) {
    next(err);
  }
};

exports.admin_editForm = async function(req, res, next) {
  try {
    const club = await JuniorClub.getById(parseInt(req.params.id, 10));
    if (!club) return res.status(404).send('Not found');
    await renderForm(res, req, { club });
  } catch (err) {
    next(err);
  }
};

exports.admin_update = async function(req, res, next) {
  try {
    const id = parseInt(req.params.id, 10);
    const club = await JuniorClub.getById(id);
    if (!club) return res.status(404).send('Not found');
    const { data, errors } = readForm(req.body);
    if (errors.length) return await renderForm(res, req, { club, data, errors, status: 400 });
    await JuniorClub.updateById(id, data);
    res.redirect('/admin/junior-clubs');
  } catch (err) {
    next(err);
  }
};

exports.admin_delete = async function(req, res, next) {
  try {
    await JuniorClub.deleteById(parseInt(req.params.id, 10));
    res.redirect('/admin/junior-clubs');
  } catch (err) {
    next(err);
  }
};
