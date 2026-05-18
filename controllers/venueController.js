var Venue = require('../models/venue');

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
        canonical:("https://" + req.get("host") + req.originalUrl).replace("www.'","").replace(".com",".co.uk").replace("-badders.herokuapp","-badminton")
    });
  } catch (err) {
    res.status(500);
    next(err);
  }
};

// Display detail page for a specific Venue
exports.venue_detail = async function(req, res, next) {
  try {
    const row = await Venue.getById(req.params.id);
    // console.log(row);
    res.send(row);
  } catch (err) {
    next(err);
  }
};

// Display Venue create form on GET
exports.venue_create_get = function(req, res) {
    res.send('NOT IMPLEMENTED: Venue create GET');
};

// Handle Venue create on POST
exports.venue_create_post = async function(req, res, next) {
  try {
    const row = await Venue.create(req.body.name, req.body.address, req.body.gMapUrl);
    // console.log(req.body);
    // console.log(row);
    res.send(row);
  } catch (err) {
    next(err);
  }
};

exports.venue_batch_create = async function(req, res, next) {
  try {
    const result = await Venue.createBatch(req.body);
    // console.log(result)
    res.send(result);
  } catch (err) {
    next(err);
    // console.log(err);
  }
};

// Display Venue delete form on GET
exports.venue_delete_get = function(req, res) {
    res.send('NOT IMPLEMENTED: Venue delete GET');
};

// Handle Venue delete on POST
exports.venue_delete_post = async function(req, res, next) {
  try {
    const row = await Venue.deleteById(req.params.id);
    // console.log(req.params)
    // console.log(row);
    res.send(row);
  } catch (err) {
    next(err);
  }
};

// Display Venue update form on GET
exports.venue_update_get = function(req, res) {
    res.send('NOT IMPLEMENTED: Venue update GET');
};

// Handle Venue update on POST
exports.venue_update_post = async function(req, res, next) {
  try {
    const row = await Venue.updateById(req.body.name, req.body.address, req.body.gMapUrl, req.params.id);
    // console.log(req.body);
    // console.log(row);
    res.send(row);
  } catch (err) {
    next(err);
  }
};
