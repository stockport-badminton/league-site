var Division = require('../models/division');

// Display list of all Divisions
exports.division_list = async function(req, res, next) {
  try {
    const rows = await Division.getAll();
    // console.log(rows);
    res.send(rows);
  } catch (err) {
    // console.log(err);
    next(err);
  }
};

// Display detail page for a specific Division
exports.division_detail = async function(req, res, next) {
  try {
    const rows = await Division.getById(req.params.id);
    // console.log(rows);
    res.send(rows);
  } catch (err) {
    next(err);
  }
};

// Display Division create form on GET
exports.division_create_get = function(req, res) {
    res.send('NOT IMPLEMENTED: Division create GET');
};

// Handle Division create on POST
exports.division_create_post = async function(req, res, next) {
  try {
    const row = await Division.create(req.body.name, req.body.league, req.body.rank);
    // console.log(req.body);
    // console.log(row);
    res.send(row);
  } catch (err) {
    // console.log(err);
    next(err);
  }
};

exports.division_batch_create = async function(req, res, next) {
  try {
    const result = await Division.createBatch(req.body);
    // console.log(result)
    res.send(result);
  } catch (err) {
    res.send(err);
    // console.log(err);
  }
};

// Display Division delete form on GET
exports.division_delete_get = function(req, res) {
    res.send('NOT IMPLEMENTED: Division delete GET');
};

// Handle Division delete on POST
exports.division_delete_post = async function(req, res, next) {
  try {
    const rows = await Division.deleteById(req.params.id);
    // console.log(rows);
    res.send(rows);
  } catch (err) {
    next(err);
  }
};

// Display Division update form on GET
exports.division_update_get = function(req, res) {
    res.send('NOT IMPLEMENTED: Division update GET');
};

// Handle Division update on POST
exports.division_update_post = async function(req, res, next) {
  try {
    const row = await Division.updateById(req.body.name, req.body.league, req.body.rank, req.params.id);
    // console.log(req.body);
    // console.log(row);
    res.send(row);
  } catch (err) {
    next(err);
  }
};
