var request = require('request');

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
      request(options,function(err,response,body){
        if (err){
          console.log(err)
          return false
        }
        else {
          if (body.access_token){
            console.log('token granted')
            return value
          }
          else {
            console.log('recaptcha fail')
            return false
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
        request(options,function(err,response,body){
          if (err){
            console.log(err)
            return false
          }
          else {
            if (body.access_token){
              console.log('token granted')
              return value
            }
            else {
              console.log('recaptcha fail')
              return false
            }
          }
  
        })
  }