var Game = require('../models/game');

// Display list of all Games
exports.game_list = async function(req, res, next) {
  try {
    const row = await Game.getAll();
    // console.log(req.body);
    // console.log(row);
    res.send(row);
  } catch (err) {
    console.log(err);
    next(err);
  }
};

// Display detail page for a specific Game
exports.game_detail = async function(req, res, next) {
  try {
    const row = await Game.getById(req.params.id);
    // console.log(req.body);
    // console.log(row);
    res.send(row);
  } catch (err) {
    console.log(err);
    next(err);
  }
};

// Display Game create form on GET
exports.game_create_get = function(req, res) {
    res.send('NOT IMPLEMENTED: Game create GET');
};

// Handle Game create on POST
exports.game_create_post = async function(req, res, next) {
  try {
    const row = await Game.create(req.body);
    // console.log(req.body);
    // console.log(row);
    res.send(row);
  } catch (err) {
    console.log(err);
    next(err);
  }
};

exports.game_batch_create = async function(req, res, next) {
  try {
    const result = await Game.createBatch(req.body);
    // console.log(result)
    res.send(result);
  } catch (err) {
    console.log(err);
    next(err);
  }
};

// Display Game delete form on GET
exports.game_delete_get = function(req, res) {
    res.send('NOT IMPLEMENTED: Game delete GET');
};

// Handle Game delete on POST
exports.game_delete_post = async function(req, res, next) {
  try {
    const row = await Game.deleteById(req.params.id);
    // console.log(req.body);
    // console.log(row);
    res.send(row);
  } catch (err) {
    console.log(err);
    next(err);
  }
};

// Display Game update form on GET
exports.game_update_get = function(req, res) {
    res.send('NOT IMPLEMENTED: Game update GET');
};

// Handle Game update on POST
exports.game_update_post = async function(req, res, next) {
  try {
    const row = await Game.updateById(req.body, req.params.id);
    // console.log(req.body);
    // console.log(row);
    res.send(row);
  } catch (err) {
    console.log(err);
    next(err);
  }
};
