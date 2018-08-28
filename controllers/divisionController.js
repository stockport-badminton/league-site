var Division = require('../models/division');

// Display list of all Divisions
exports.division_list = function(req, res) {
    Division.getAll(function(err,rows){
      if (err) {
        console.log(err);
        res.send(err);
      }
      console.log(rows);
      res.send(rows);
    })
};

// Display detail page for a specific Division
exports.division_detail = function(req, res) {
    Division.getById(req.params.id,function(err,rows){
      console.log(rows);
      res.send(rows);
    })
};

// Display Division create form on GET
exports.division_create_get = function(req, res) {
    res.send('NOT IMPLEMENTED: Division create GET');
};

// Handle Division create on POST
exports.division_create_post = function(req, res) {
  Division.create(req.body.name, req.body.league, req.body.rank, function(err,row){
    if (err){
      console.log(err);
      res.send(err);
    }
    console.log(req.body);
    console.log(row);
    res.send(row);
  })
};

// Display Division delete form on GET
exports.division_delete_get = function(req, res) {
    res.send('NOT IMPLEMENTED: Division delete GET');
};

// Handle Division delete on POST
exports.division_delete_post = function(req, res) {
    Division.deleteById(req.params.id,function(err,rows){
      console.log(rows);
      res.send(rows);
    })
};

// Display Division update form on GET
exports.division_update_get = function(req, res) {
    res.send('NOT IMPLEMENTED: Division update GET');
};

// Handle Division update on POST
exports.division_update_post = function(req, res) {
    Division.updateById(req.body.name, req.body.league, req.body.rank, req.params.id, function(err,row){
      console.log(req.body);
      console.log(row);
      res.send(row);
    })
};
