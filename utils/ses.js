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

// `message` is a nodemailer message object: { from, to, cc, bcc, subject, html, text,
// attachments: [{ filename, content, contentType }] }.
//
// `Destinations` is passed EXPLICITLY, and that is not belt-and-braces.
//
// MailComposer strips the `Bcc` header when it builds the message -- which is exactly what
// blind carbon copy means, and exactly what you want in the delivered mail. But with no
// `Destinations`, SES works out who to deliver to by READING THE HEADERS. So a bcc would be
// silently dropped: the send succeeds, SES reports success, To and Cc get their mail, and
// the blind copy simply never exists. Nothing anywhere reports it.
//
// Listing every recipient here delivers to all three while the built message still shows
// only To and Cc, which is what both halves of that are after.
const addresses = v => (Array.isArray(v) ? v : [v]).filter(Boolean);

exports.sendRawEmail = async function(message) {
  const MailComposer = require('nodemailer/lib/mail-composer');
  const raw = await new MailComposer(message).compile().build();
  return client.send(new SendRawEmailCommand({
    RawMessage: { Data: raw },
    Destinations: [
      ...addresses(message.to),
      ...addresses(message.cc),
      ...addresses(message.bcc),
    ],
  }));
};
