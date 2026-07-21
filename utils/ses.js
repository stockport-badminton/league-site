const { SESClient, SendEmailCommand, SendRawEmailCommand } = require('@aws-sdk/client-ses');

const client = new SESClient({ region: 'eu-west-1' });

// Exposed for nodemailer's SES transport, which wants the raw v3 client +
// SendRawEmailCommand (see controllers/contactusController.js) rather than
// going through sendEmail() below.
exports.client = client;
exports.SendRawEmailCommand = SendRawEmailCommand;

exports.sendEmail = function(params) {
  return client.send(new SendEmailCommand(params));
};
