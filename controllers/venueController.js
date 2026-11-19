var Venue = require('../models/venue');
const log = require('../utils/log');
var { generateVenuesMap } = require('../utils/venues-map-generator');
const { canonicalFor } = require('../utils/canonical');

// Fire-and-forget: never awaited by callers, never blocks/fails the CRUD
// response. Logged rather than thrown so a Google Static Maps hiccup can't
// break venue create/update/delete.
function regenerateVenuesMap() {
  generateVenuesMap().catch(function(err) {
    log.error({ err }, '[venues-map] regen failed');
  });
}

// Display list of all Venues
exports.venue_list = async function(req, res, next) {
  try {
    const result = await Venue.getAll();
    // console.log(result)
    res.status(200);
    res.render('venues', {
        static_path: '/static',
        pageTitle : "Venues",
        pageDescription : "Venues",
        result: result,
        error: false,
        canonical:canonicalFor(req)
    });
  } catch (err) {
    res.status(500);
    next(err);
  }
};

// Manual override: mirrors the existing /shuttle-prices/refresh gating -
// covers the case where the fire-and-forget regen above failed, or an
// admin wants to force a rebuild without a data change.
exports.venues_map_refresh = async function(req, res, next) {

  try {
    await generateVenuesMap();
  } catch (err) {
    return next(err);
  }
  res.redirect('/info/clubs');
};

// ---------------------------------------------------------------------------------------
// /admin/venues — list, add and edit venues (Nov 2026). Before this, venues were only ever
// edited in the database, which is how three sentences of parking directions ended up in
// Everybody Sport and Recreation's address: there was nowhere else to put them.
//
// No delete, on purpose. club.venue, club.matchVenue and team.venue are reached with INNER
// JOINs in models/club.js and models/fixture.js, so a deleted venue would take club and
// event pages with it (gotcha 1c). An unused venue is harmless; the list says which are.

// Column widths from the venue table, checked before the write so an over-long value is a
// message on the form rather than a 500 from Postgres. directions is TEXT; the cap is ours.
const MAX_LENGTH = { name: 45, address: 255, gMapUrl: 100, directions: 1000 };
const LABELS = { name: 'Name', address: 'Address', gMapUrl: 'Map link', directions: 'Getting there' };

function readVenueForm(body) {
  const text = k => {
    const v = String(body[k] == null ? '' : body[k]).trim();
    return v === '' ? null : v;
  };
  // A number, or what was typed when it isn't one, so a failed save shows it back.
  const num = k => {
    const v = text(k);
    if (v === null) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : v;
  };
  const data = {
    name: text('name') || '',
    address: text('address') || '',
    gMapUrl: text('gMapUrl') || '',
    // Line breaks are kept: directions are often a short list ("South entrance. Overflow
    // car park in front of …"), and the views print them with white-space: pre-line.
    directions: text('directions'),
    Lat: num('Lat'),
    Lng: num('Lng'),
  };

  const errors = [];
  if (!data.name) errors.push('Name is required.');
  if (!data.address) errors.push('Address is required.');
  if (!data.gMapUrl) errors.push('Map link is required.');
  else if (!/^https?:\/\/\S+$/i.test(data.gMapUrl)) errors.push('Map link must be a web address (https://…).');
  Object.keys(MAX_LENGTH).forEach(k => {
    if (data[k] && data[k].length > MAX_LENGTH[k]) {
      errors.push(LABELS[k] + ' must be ' + MAX_LENGTH[k] + ' characters or fewer.');
    }
  });
  if ((data.Lat === null) !== (data.Lng === null)) {
    errors.push('Give both latitude and longitude, or neither.');
  } else if (data.Lat !== null) {
    if (typeof data.Lat !== 'number' || data.Lat < -90 || data.Lat > 90) errors.push('Latitude must be a number between -90 and 90.');
    if (typeof data.Lng !== 'number' || data.Lng < -180 || data.Lng > 180) errors.push('Longitude must be a number between -180 and 180.');
  }
  return { data, errors };
}

function renderVenueForm(res, req, { venue, data, errors, status }) {
  res.status(status || 200).render('admin/venue-form', {
    static_path: '/static',
    pageTitle: venue ? 'Edit Venue' : 'New Venue',
    pageDescription: venue ? 'Edit a venue' : 'Add a venue',
    venue,
    // What the form shows: the submitted values after a failed save, else the stored row.
    data: data || venue || {},
    errors: errors || [],
    canonical: canonicalFor(req)
  });
}

exports.admin_list = async function(req, res, next) {
  try {
    const venues = await Venue.getAllWithUse();
    res.render('admin/venue-list', {
      static_path: '/static',
      pageTitle: 'Venues',
      pageDescription: 'Add and edit venues',
      venues,
      canonical: canonicalFor(req)
    });
  } catch (err) {
    next(err);
  }
};

exports.admin_createForm = function(req, res) {
  renderVenueForm(res, req, { venue: null });
};

exports.admin_create = async function(req, res, next) {
  try {
    const { data, errors } = readVenueForm(req.body);
    if (errors.length) return renderVenueForm(res, req, { venue: null, data, errors, status: 400 });
    await Venue.create(data);
    regenerateVenuesMap();
    res.redirect('/admin/venues');
  } catch (err) {
    next(err);
  }
};

exports.admin_editForm = async function(req, res, next) {
  try {
    const venue = await Venue.getById(parseInt(req.params.id, 10));
    if (!venue) return res.status(404).send('Not found');
    renderVenueForm(res, req, { venue });
  } catch (err) {
    next(err);
  }
};

exports.admin_update = async function(req, res, next) {
  try {
    const id = parseInt(req.params.id, 10);
    const venue = await Venue.getById(id);
    if (!venue) return res.status(404).send('Not found');
    const { data, errors } = readVenueForm(req.body);
    if (errors.length) return renderVenueForm(res, req, { venue, data, errors, status: 400 });
    await Venue.updateById(id, data);
    regenerateVenuesMap();
    res.redirect('/admin/venues');
  } catch (err) {
    next(err);
  }
};
