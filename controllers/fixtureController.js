var Fixture = require('../models/fixture');

// Display list of all Fixtures
exports.fixture_list = function(req, res) {
    Fixture.getAll(function(err,row){
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

// Display detail page for a specific Fixture
exports.fixture_detail = function(req, res) {
    Fixture.getById(req.params.id, function(err,row){
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

// Display detail page for a specific Fixture
exports.fixture_detail_byDivision = function(req, res,next) {
    var divisionId = 0;
    switch (req.params.division) {
      case 'Division-1':
        divisionId = 8
        break;
      case 'Premier':
        divisionId = 7
        break;
      case 'Division-2':
        divisionId = 9
        break;
      case 'Division-3':
        divisionId = 10
        break;
      case 'Division-4':
        divisionId = 11
        break;
      default:
        next(err);
    }
    Fixture.getFixtureDetails(divisionId, function(err,result){
      if (err){
        next(err);
      }
      else{
        // console.log(result)
        res.status(200);
       res.render('beta/fixtures-results', {
           static_path: '/static',
           pageTitle : "Fixtures & Results: " + req.params.division.replace('-',' '),
           pageDescription : "Find out how the teams in your division have got on, and check when your next match is",
           result: result,
           error: false,
           division : req.params.division
       });
      }
    })
};

// Display Fixture create form on GET
exports.fixture_create_get = function(req, res) {
    res.send('NOT IMPLEMENTED: Fixture create GET');
};

// Handle Fixture create on POST
exports.fixture_create_post = function(req, res) {
    Fixture.create(req.body, function(err,row){
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

exports.fixture_batch_create = function(req, res){
  Fixture.createBatch(req.body,function(err,result){
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

// Display Fixture delete form on GET
exports.fixture_delete_get = function(req, res) {
    res.send('NOT IMPLEMENTED: Fixture delete GET');
};

// Handle Fixture delete on POST
exports.fixture_delete_post = function(req, res) {
    Fixture.deleteById(req.params.id, function(err,row){
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

// Display Fixture update form on GET
exports.fixture_update_get = function(req, res) {
    res.send('NOT IMPLEMENTED: Fixture update GET');
};

// Handle Fixture update on POST
exports.fixture_update_post = function(req, res) {
    Fixture.updateById(req.body,req.params.id,function(err,row){
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
