var AWS = require('aws-sdk');
AWS.config.update({
  region: 'eu-west-1'
});
var ses = new AWS.SES({apiVersion: '2010-12-01'});

// render contact us form
exports.contact_us_get = function(req, res) {
    res.render('beta/contact-us-form', {
        static_path: '/static',
        theme: process.env.THEME || 'flatly',
        flask_debug: process.env.FLASK_DEBUG || 'false'
    });
}

// capture contact us form and send email
exports.contact_us_post = function(req, res) {
  req.checkBody('contactEmail', 'must enter an email address').notEmpty();
  req.checkBody('contactQuery', 'Please enter something in message field.').notEmpty();

  req.sanitize('contactQuery').escape();
  req.sanitize('contactQuery').trim();

  var errors = req.validationErrors();
  if (errors) {
      // logger.log(errors);
      res.render('beta/contact-us-form-delivered', { title: 'Contact Us - Error', static_path:'/static', theme:'flatly', content: errors});
  return;
  }
  else {
  //console.log(req.body);
  var params = {
    Destination: { /* required */
      ToAddresses: [
      ]
    },
    Message: { /* required */
      Body: {
        Html: {
         Charset: 'UTF-8',
         Data: 'contact from the website:<br />'+ req.body.contactQuery +'<br /> from email address:'+req.body.contactEmail
        }
       },
       Subject: {
        Charset: 'UTF-8',
        Data: 'Somebody is trying to get in touch'
       }
      },
    Source: 'stockport.badders.results@gmail.com', /* required */
    ReplyToAddresses: [
        'stockport.badders.results@gmail.com'
    ],
  };
  var clubEmail = '';
  if(req.body.contactType == 'Clubs'){
    switch (req.body.clubSelect) {
      case 'Aerospace':
        params.Destination.ToAddresses = ['santanareedy@btinternet.com'];
      break;
      case 'AstraZeneca':
        params.Destination.ToAddresses = ['mel.curwen@ntlworld.com'];

      break;
      case 'AltrinchamCentral':
        params.Destination.ToAddresses = ['janecave53@gmail.com'];

      break;
      case 'BramhallQueensgate':
        params.Destination.ToAddresses = ['jjackson1969@btinternet.com'];

      break;
      case 'CAP':
        params.Destination.ToAddresses = ['dave_haigh@hotmail.co.uk'];

      break;
      case 'Canute':
        params.Destination.ToAddresses = ['canutesecretary@gmail.com'];

      break;
      case 'Carrington':
        params.Destination.ToAddresses = ['darrel@thegoughfamily.co.uk'];

      break;
      case 'CheadleHulme':
        params.Destination.ToAddresses = ['doug.grant@ntlworld.com'];

      break;
      case 'CollegeGreen':
        params.Destination.ToAddresses = ['paulakite@yahoo.co.uk'];

      break;
      case 'DavidLloyd':
        params.Destination.ToAddresses = ['dr_barks@yahoo.co.uk'];

      break;
      case 'Disley':
        params.Destination.ToAddresses = ['julian.cherryman@gmail.com','karlcramp@aol.com'];

      break;
      case 'Dome':
        params.Destination.ToAddresses = ['janet_knowles@ymail.com'];

      break;
      case 'GHAP':
        params.Destination.ToAddresses = ['rossowen40@hotmail.com'];

      break;
      case 'Macclesfield':
        params.Destination.ToAddresses = ['sueorwin@btinternet.com'];

      break;
      case 'Manor':
        params.Destination.ToAddresses = ['jo.woolley@tiscali.co.uk'];

      break;
      case 'Mellor':
        params.Destination.ToAddresses = ['enquiries@mellorbadminton.org.uk'];

      break;
      case 'NewMills':
        params.Destination.ToAddresses = ['bandibates@tiscali.co.uk'];

      break;
      case 'ParrsWood':
        params.Destination.ToAddresses = ['mikegreatorex@btinternet.com'];

      break;
      case 'Poynton':
        params.Destination.ToAddresses = ['ian.anderson12@ntlworld.com'];

      break;
      case 'Racketeer':
        params.Destination.ToAddresses = ['theracketeer@hotmail.com'];

      break;
      case 'Shell':
        params.Destination.ToAddresses = ['annawiza@aol.co.uk'];

      break;
      case 'SyddalPark':
        params.Destination.ToAddresses = ['derek.hillesdon@gmail.com'];

      break;
      case 'Tatton':
        params.Destination.ToAddresses = ['plumley123@btinternet.com'];

      break;
      default:
        params.Destination.ToAddresses = ['stockport.badders.results@gmail.com'];

    }
  }
  if (req.body.contactType == 'League'){
    switch (req.body.leagueSelect) {
      case 'results':
        params.Destination.ToAddresses = ['stockport.badders.results@gmail.com','neil.cooper.241180@gmail.com']
        break;
      case 'tournament':
        params.Destination.ToAddresses = ['sueorwin@btinternet.com']
        break;
      case 'league':
        params.Destination.ToAddresses = ['leaguesec.sdbl@gmail.com']
        break;
      case 'chair':
        params.Destination.ToAddresses = ['walkerd.sdbl@gmail.com']
        break;
      case 'messer':
        params.Destination.ToAddresses = ['sueorwin@btinternet.com']
        break;
      case 'junior':
        params.Destination.ToAddresses = ['stuartscoffins@btinternet.com']
        break;
      case 'juniortournament':
        params.Destination.ToAddresses = ['aim@talktalk.net']
        break;
      case 'treasurer':
        params.Destination.ToAddresses = ['rossowen40@hotmail.com']
        break;
      default:
    }
  }

  // Create sendEmail params


  // logger.log(params);


  ses.sendEmail(params, function(err, data) {
    if (err) {
      // logger.log(err); // an error occurred
      // logger.log(err.stack)
    }
    else {
      //console.log(data);           // successful response
      res.render('beta/contact-us-form-delivered', {
            static_path: '/static',
            theme: process.env.THEME || 'flatly',
            flask_debug: process.env.FLASK_DEBUG || 'false'
        });
    }
  });


  }
};
