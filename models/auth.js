const axios = require('axios');
const ses = require('../utils/ses');

exports.getManagementAPIKey = async function() {
  const response = await axios.post(`https://${process.env.AUTH0_DOMAIN}/oauth/token`, {
    client_id: process.env.AUTH0_CLIENTID,
    client_secret: process.env.AUTH0_CLIENT_SECRET,
    audience: 'https://stockport-badminton.eu.auth0.com/api/v2/',
    grant_type: 'client_credentials'
  })
  if (!response.data.access_token) throw new Error('token fail')
  return response.data.access_token
}

exports.getAPIKey = async function() {
  const response = await axios.post(`https://${process.env.AUTH0_DOMAIN}/oauth/token`, {
    client_id: process.env.AUTH0_CLIENTID,
    client_secret: process.env.AUTH0_CLIENT_SECRET,
    audience: 'http://stockport-badminton.co.uk',
    grant_type: 'client_credentials'
  })
  if (!response.data.access_token) throw new Error('token fail')
  return response.data.access_token
}

exports.grantResultsAccess = async function(req, res, next) {
  try {
    const apiKey = await module.exports.getManagementAPIKey()
    const userResponse = await axios.patch(
      `https://${process.env.AUTH0_DOMAIN}/api/v2/users/${req.params.userId}`,
      { app_metadata: { betaAccess: true } },
      { headers: { Authorization: `Bearer ${apiKey}` } }
    )
    const userBody = userResponse.data

    await ses.sendEmail({
      Destination: {
        ToAddresses: [userBody.email],
        BccAddresses: ['bigcoops@outlook.com', 'bigcoops@gmail.com', 'stockport.badders.results@gmail.com']
      },
      Message: {
        Body: {
          Html: {
            Charset: 'UTF-8',
            Data: '<p>Thanks for registering - i\'ve approved your access</p>'
          }
        },
        Subject: {
          Charset: 'UTF-8',
          Data: 'Results Entry Access'
        }
      },
      Source: 'results@stockport-badminton.co.uk',
      ReplyToAddresses: ['stockport.badders.results@gmail.com']
    })

    res.render('beta/userapproved', {
      static_path: '/static',
      theme: process.env.THEME || 'flatly',
      pageTitle: 'Results Access Approved',
      pageDescription: 'Results Access Approved',
      result: JSON.stringify(userBody),
      canonical: ('https://' + req.get('host') + req.originalUrl).replace("www.'", '').replace('.com', '.co.uk').replace('-badders.herokuapp', '-badminton')
    })
  } catch (err) {
    next(err)
  }
}
