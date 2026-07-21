const { SESClient, SendEmailCommand } = require('@aws-sdk/client-ses');

const client = new SESClient({ region: 'eu-west-1' });

exports.sendEmail = function(params) {
  return client.send(new SendEmailCommand(params));
};
