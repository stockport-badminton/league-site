const LeagueEvent = require('../models/leagueEvent');
const Venue = require('../models/venue');
const { canonicalFor } = require('../utils/canonical');

// /admin/league-events — the Messer finals and any other date that is not a fixture but
// belongs in the fixtures list. A Messer admin keeps them (access.messerAdmin), so the
// dates can be set each season without a deploy. The fixtures controller adds them to
// the list (withEvents in controllers/fixtureController.js).

// Column widths from migrations/040_league_event.sql, checked before the write so an
// over-long value is a message on the form rather than a 500 from Postgres.
const MAX_LENGTH = { title: 100, detail: 100 };
const LABELS = { title: 'Title', detail: 'Detail' };

// A real calendar day as YYYY-MM-DD (what <input type="date"> sends). 2027-02-30 is not.
function isDay(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

// The form body as the row to write, and what is wrong with it. A blank detail becomes
// null so an edit can clear it.
async function readForm(body) {
  const text = k => {
    const v = String(body[k] == null ? '' : body[k]).trim();
    return v === '' ? null : v;
  };
  const venue = parseInt(body.venue, 10);
  const data = {
    date: text('date') || '',
    title: text('title') || '',
    detail: text('detail'),
    venue: isNaN(venue) ? null : venue,
  };

  const errors = [];
  if (!isDay(data.date)) {
    errors.push('Date is required.');
  } else if (!(await LeagueEvent.seasonOf(data.date))) {
    // Saved, it would be on no fixtures list: the list shows the events in its season.
    errors.push('That date is not in any season, so it would not appear on the fixtures list.');
  }
  if (!data.title) errors.push('Title is required.');
  Object.keys(MAX_LENGTH).forEach(k => {
    if (data[k] && data[k].length > MAX_LENGTH[k]) {
      errors.push(LABELS[k] + ' must be ' + MAX_LENGTH[k] + ' characters or fewer.');
    }
  });
  return { data, errors };
}

async function renderForm(res, req, { event, data, errors, status }) {
  const venues = await Venue.getAll();
  venues.sort((a, b) => a.name.localeCompare(b.name));
  res.status(status || 200).render('admin/league-event-form', {
    static_path: '/static',
    pageTitle: event ? 'Edit Event Date' : 'New Event Date',
    pageDescription: event ? 'Edit a date on the fixtures list' : 'Add a date to the fixtures list',
    event,
    // What the form shows: the submitted values after a failed save, else the stored row
    // (whose day is `day`; the form's field is `date`).
    data: data || (event ? { ...event, date: event.day } : {}),
    venues,
    errors: errors || [],
    canonical: canonicalFor(req)
  });
}

exports.admin_list = async function(req, res, next) {
  try {
    const events = await LeagueEvent.getAll();
    res.render('admin/league-event-list', {
      static_path: '/static',
      pageTitle: 'Event Dates',
      pageDescription: 'Messer finals and other dates on the fixtures list',
      events,
      canonical: canonicalFor(req)
    });
  } catch (err) {
    next(err);
  }
};

exports.admin_createForm = async function(req, res, next) {
  try {
    await renderForm(res, req, { event: null });
  } catch (err) {
    next(err);
  }
};

exports.admin_create = async function(req, res, next) {
  try {
    const { data, errors } = await readForm(req.body);
    if (errors.length) return await renderForm(res, req, { event: null, data, errors, status: 400 });
    await LeagueEvent.create(data);
    res.redirect('/admin/league-events');
  } catch (err) {
    next(err);
  }
};

exports.admin_editForm = async function(req, res, next) {
  try {
    const event = await LeagueEvent.getById(parseInt(req.params.id, 10));
    if (!event) return res.status(404).send('Not found');
    await renderForm(res, req, { event });
  } catch (err) {
    next(err);
  }
};

exports.admin_update = async function(req, res, next) {
  try {
    const id = parseInt(req.params.id, 10);
    const event = await LeagueEvent.getById(id);
    if (!event) return res.status(404).send('Not found');
    const { data, errors } = await readForm(req.body);
    if (errors.length) return await renderForm(res, req, { event, data, errors, status: 400 });
    await LeagueEvent.updateById(id, data);
    res.redirect('/admin/league-events');
  } catch (err) {
    next(err);
  }
};

exports.admin_delete = async function(req, res, next) {
  try {
    await LeagueEvent.deleteById(parseInt(req.params.id, 10));
    res.redirect('/admin/league-events');
  } catch (err) {
    next(err);
  }
};
