// SES, in the two shapes we need.
//
// `sendEmail` is the simple one and stays the default: SES builds the MIME itself from a
// subject and two bodies, which is all any of our mail needed until the registration
// reminder had to carry a Word document.
//
// `sendRawEmail` is for that. SES cannot attach a file through SendEmail at all — an
// attachment means handing it a complete RFC 5322 message — so the message is composed
// here and posted whole. nodemailer's MailComposer does the composing rather than a
// hand-rolled multipart writer: it is already a dependency (contactusController uses it),
// and quoting, base64 chunking, boundary generation and header folding are all places
// where a hand-rolled version is subtly wrong in a way that renders fine in Gmail and
// breaks in Outlook.
const { SESClient, SendEmailCommand, SendRawEmailCommand } = require('@aws-sdk/client-ses');

const client = new SESClient({ region: 'eu-west-1' });

exports.sendEmail = function(params) {
  return client.send(new SendEmailCommand(params));
};

// `message` is a nodemailer message object: { from, to, cc, subject, html, text,
// attachments: [{ filename, content, contentType }] }.
//
// Note SES applies its own recipient list from the message headers for a raw send, so
// there is no Destination to get out of step with what the message says.
exports.sendRawEmail = async function(message) {
  const MailComposer = require('nodemailer/lib/mail-composer');
  const raw = await new MailComposer(message).compile().build();
  return client.send(new SendRawEmailCommand({ RawMessage: { Data: raw } }));
};
