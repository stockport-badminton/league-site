var Fixture = require('../models/fixture');
var Game = require('../models/game');
var request = require('request');
var AWS = require('aws-sdk');



// Display fixtures played 6 days ago that haven't had results entered
exports.getLateScorecards = function(req, res) {
    Fixture.getCardsDueToday(function(err,row){
      var params = {
        Destination: { /* required */
          ToAddresses: [
            'stockport.badders.results@gmail.com'
          ]
        },
        Message: { /* required */
          Body: {
            Html: {
             Charset: 'UTF-8',
             Data: ''
            }
           },
           Subject: {
            Charset: 'UTF-8',
            Data: 'Todays outstanding fixtures'
           }
          },
        Source: 'stockport.badders.results@gmail.com', /* required */
        ReplyToAddresses: [
            'stockport.badders.results@gmail.com'
        ],
      };
      if (err){
        params.Message.Body.Html.Data = JSON.stringify(err);
        console.log(err);
      }
      else{
        for (var x = 0; x < row.length; x++){
            params.Message.Body.Html.Data += row[x]['date'] + " - "+ row[x]['homeTeam'] + " - " + row[x]['awayTeam']
        }
      }
      var ses = new AWS.SES({apiVersion: '2010-12-01'});
      ses.sendEmail(params, function(err, data) {
        if (err) {
          console.log(err, err.stack); // an error occurred
          res.send(err);
        }
        else {
          console.log(data);           // successful response
          res.send(data);
        }
      })
    })
};

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

// Return fixture id given home and away team ids
exports.fixture_id = function(req, res) {
    obj = {
      "homeTeam":req.params.homeTeam,
      "awayTeam":req.params.awayTeam
    }
    console.log(JSON.stringify(obj));
    Fixture.getFixtureId(obj,function(err,row){
      if (err){
        res.send(err);
      }
      else{
        res.send(row);
      }
    })
};

// Return fixture id given home and away team names
exports.fixture_id_from_team_names = function(req, res) {
    obj = {
      "homeTeam":req.params.homeTeam,
      "awayTeam":req.params.awayTeam
    }
    Fixture.getFixtureIdFromTeamNames(obj,function(err,row){
      if (err){
        res.send(err);
      }
      else{
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
      case 'All':
        divisionId = 0
        break;
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



// Handle getting results from previous 7 days
exports.fixture_get_summary = function(req, res,next) {
    Fixture.getRecent(function(err,row){
      if (err){
        console.log(err);
        next(err);
      }
      else{
        Fixture.getupComing(function(err,result){
          if (err){
            console.log(err);
            next(err);
          }
          else{
            console.log(result);
            res.render('beta/homepage', {
                static_path: '/static',
                pageTitle : "Homepage",
                pageDescription : "Clubs: Aerospace, Astrazeneca, Altrincham Central, Bramhall Village, CAP, Canute, Carrington, Cheadle Hulme, College Green, David Lloyd, Disley, Dome, GHAP, Macclesfield, Manor, Mellor, New Mills, Parrswood, Poynton, Racketeer, Shell, Syddal Park, Tatton. Social and Competitive badminton in and around Stockport.",
                result : row,
                row : result
            });
          }
        })
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

exports.fixture_update_by_team_name = function(req, res,next){
  Fixture.updateByTeamNames(req.body,function(err,result){
    if(err){
      next(err);
      console.log(err);
    }
    else{
      // console.log(result)
      res.send(result);
    }
  })
}

exports.fixture_rearrange_by_team_name = function(req, res,next){
  Fixture.rearrangeByTeamNames(req.body,function(err,result){
    if(err){
      next(err);
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
