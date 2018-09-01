var Game = require('../models/game');

// Display list of all Games
exports.game_list = function(req, res) {
    Game.getAll(function(err,row){
      if (err){
        res.send(err);
        console.log(err);
      }
      else{
        console.log(req.body);
        console.log(row);
        res.send(row);
      }
    })
};

// Display detail page for a specific Game
exports.game_detail = function(req, res) {
    Game.getById(req.params.id, function(err,row){
      if (err){
        res.send(err);
        console.log(err);
      }
      else{
        console.log(req.body);
        console.log(row);
        res.send(row);
      }
    })
};

// Display Game create form on GET
exports.game_create_get = function(req, res) {
    res.send('NOT IMPLEMENTED: Game create GET');
};

// Handle Game create on POST
exports.game_create_post = function(req, res) {
    Game.create(req.body, function(err,row){
      if (err){
        res.send(err);
        console.log(err);
      }
      else{
        console.log(req.body);
        console.log(row);
        res.send(row);
      }
    })
};

exports.game_batch_create = function(req, res){
  Game.createBatch(req.body,function(err,result){
    if(err){
      res.send(err);
      console.log(err);
    }
    else{
      // console.log(result)
      res.send(result);
    }
  })
}

// Display Game delete form on GET
exports.game_delete_get = function(req, res) {
    res.send('NOT IMPLEMENTED: Game delete GET');
};

// Handle Game delete on POST
exports.game_delete_post = function(req, res) {
    Game.deleteById(req.params.id, function(err,row){
      if (err){
        res.send(err);
        console.log(err);
      }
      else{
        console.log(req.body);
        console.log(row);
        res.send(row);
      }
    })
};

// Display Game update form on GET
exports.game_update_get = function(req, res) {
    res.send('NOT IMPLEMENTED: Game update GET');
};

// Handle Game update on POST
exports.game_update_post = function(req, res) {
    Game.updateById(req.body,req.params.id,function(err,row){
      if (err){
        res.send(err);
        console.log(err);
      }
      else{
        console.log(req.body);
        console.log(row);
        res.send(row);
      }
    })
};
