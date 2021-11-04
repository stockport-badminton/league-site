var request = require('request');
const sgMail = require('@sendgrid/mail');
sgMail.setApiKey(process.env.SENDGRID_API_KEY);
var logger = require('logzio-nodejs').createLogger({
  token: process.env.LOGZ_SECRET,
  host: 'listener-uk.logz.io'
});

exports.getManagementAPIKey = function(done){
  var options = {
        method:'POST',
        url:'https://'+ process.env.AUTH0_DOMAIN +'/oauth/token',
        body:{
            "client_id":process.env.AUTH0_CLIENTID,
            "client_secret":process.env.AUTH0_CLIENT_SECRET,
            "audience":"https://stockport-badminton.eu.auth0.com/api/v2/",
            "grant_type":"client_credentials"
        },
        json:true
      }
      console.log(options);
      request(options,function(err,response,body){
        if (err){
          console.log("getManagementAPIKey error");
          console.log(err)
          return done(err);
        }
        else {
          //console.log(body)
          if (body.access_token){
            console.log('token granted')
            return done(null,body.access_token)
          }
          else {
            console.log('recaptcha fail')
            return done(null,"token fail")
          }
        }

      })
}

exports.getAPIKey = function(done){
    var options = {
          method:'POST',
          url:'https://'+ process.env.AUTH0_DOMAIN +'/oauth/token',
          body:{
              "client_id":process.env.AUTH0_CLIENTID,
              "client_secret":process.env.AUTH0_CLIENT_SECRET,
              "audience":"http://stockport-badminton.co.uk",
              "grant_type":"client_credentials"
          },
          json:true
        }
        // console.log(options);
        request(options,function(err,response,body){
          if (err){
            console.log(err)
            return done(err)
          }
          else {
            console.log(body)
            if (body.access_token){
              console.log('token granted')
              done(body.access_token)
            }
            else {
              console.log('recaptcha fail')
              done("token fail")
            }
          }
  
        })
  }

  exports.getAppMetadata = function(done){
    module.exports.getManagementAPIKey(function(err,apiKey){
      //console.log("getAppMetadataUser")
      console.log(user)
      if (err){
        return done(err);
      }
      else{
        var options = {
          method:'GET',
          headers:{
            "Authorization":"Bearer "+apiKey
          },
          url:'https://'+process.env.AUTH0_DOMAIN+'/api/v2/users/'+user.user_id,
        }
        console.log(options);
        request(options,function(err,response,userBody){
          if (err){
            return done(err)
          }
          else{  
            console.log(userBody);
            done(userBody)
          }
        })
      }
    })
  }

  exports.grantResultsAccess = function(req,res,next){
    module.exports.getManagementAPIKey(function(err,apiKey){
    if (err){
      next(err);
    }
    else{
      var options = {
        method:'PATCH',
        headers:{
          "Authorization":"Bearer "+apiKey
        },
        url:'https://'+process.env.AUTH0_DOMAIN+'/api/v2/users/'+req.params.userId,
        body:{
          app_metadata:{
            "betaAccess":true
          }
        },
        json:true
      }
      console.log(options);
      request(options,function(err,response,userBody){
        //console.log(options);
        if (err){
          res.error(err);
        }
        else{       
          const msg = {
            to: userBody.email,
            cc:'stockport.badders.results@gmail.com',
            from: 'stockport.badders.results@stockport-badminton.co.uk',
            subject: 'Result Entry Access',
            text: 'Thanks for registering - i\'ve approved your access',
            html: '<p>Thanks for registering - i\'ve approved your access</p>'
          };
          sgMail.send(msg)
              .then(()=>{
                console.log(msg)
                res.render('beta/userapproved',{
                  static_path:'/static',
                  theme:process.env.THEME || 'flatly',
                  pageTitle : "Results Access Approved",
                  pageDescription : "Results Access Approved",
                  result:JSON.stringify(userBody)
                });
              })
              .catch(error => {
                logger.log(error.toString());
                next("Sorry something went wrong sending your email.");
              })   
          
        }
      })
    }
  })
  }