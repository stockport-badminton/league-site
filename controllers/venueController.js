var Venue = require('../models/venue');

// Display list of all Venues
exports.venue_list = function(req, res) {
    Venue.getAll(function(err,rows){
      console.log(rows);
      res.send(rows);
    })
};

// Display detail page for a specific Venue
exports.venue_detail = function(req, res) {
    Venue.getById(req.params.id,function(err,row){
      console.log(row);
      res.send(row);
    })
};

// Display Venue create form on GET
exports.venue_create_get = function(req, res) {
    res.send('NOT IMPLEMENTED: Venue create GET');
};

// Handle Venue create on POST
exports.venue_create_post = function(req, res) {
  Venue.create(req.body.name, req.body.address, req.body.gMapUrl, function(err,row){
    console.log(req.body);
    console.log(row);
    res.send(row);
  })
};

// Display Venue delete form on GET
exports.venue_delete_get = function(req, res) {
    res.send('NOT IMPLEMENTED: Venue delete GET');
};

// Handle Venue delete on POST
exports.venue_delete_post = function(req, res) {
    Venue.deleteById(req.params.id,function(err,row){
      console.log(req.params)
      console.log(row);
      res.send(row);
    })
};

// Display Venue update form on GET
exports.venue_update_get = function(req, res) {
    res.send('NOT IMPLEMENTED: Venue update GET');
};

// Handle Venue update on POST
exports.venue_update_post = function(req, res) {
    Venue.updateById(req.body.name, req.body.address, req.body.gMapUrl, req.params.id, function(err,row){
      console.log(req.body);
      console.log(row);
      res.send(row);
    })
};
