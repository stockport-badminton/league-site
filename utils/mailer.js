// Sending an email, in one place.
//
// Before this, 13 emails were built at 13 call sites across six controllers: ten as
// inline HTML string literals and three from SendGrid/Mailchimp exports (the invoice
// template still carries its `data-muid` module ids). Adding an email meant copying
// whichever block looked closest, which is how the palette ended up with a #343a40
// header bar, #1188E6 links and three different greys.
//
// Now: `send({ template, data, subject, text, to, whyReceiving })`. The template is one
// of views/emails/*.ejs, compiled from emails/*.mjml by `npm run build:email`.
//
// WHAT THIS DELIBERATELY OWNS
//
//   - **The From address**, so it is one string rather than thirteen.
//   - **A plain-text alternative on every message.** None of the existing senders set
//     one. A message with no text part scores worse with spam filters and shows an empty
//     body in a text-only client, and with SES a complaint counts against the domain's
//     reputation — shared with every other email the league sends, including the invoices.
//   - **The `whyReceiving` line the footer prints**, and it is REQUIRED. The audiences
//     differ — the results secretary, a club secretary, a captain — and a transactional
//     email nobody can place is one somebody marks as junk.
//   - **The absolute logo URL.** Emails have no request to build a URL from, and
//     `req.get('host')` behind Firebase is the Cloud Run hostname anyway (gotcha 1b), so
//     it comes from `absoluteUrl()`.
//
// Escaping is now EJS's job rather than each caller's. CLAUDE.md's rule that hand-built
// email HTML must escape through utils/html.js exists because string concatenation does
// not escape; a template does. Anything that must arrive as markup goes through
// `textToHtml` below and is printed with `<%- %>`.

const path = require('path');
const ejs = require('ejs');
const ses = require('./ses');
const { absoluteUrl } = require('./canonical');

const TEMPLATE_DIR = path.join(__dirname, '..', 'views', 'emails');

// Every league email comes from here. It is the address people already recognise and the
// one the ReplyTo generally points at.
const FROM = 'results@stockport-badminton.co.uk';

// The results mailbox, copied on anything a captain does so there is a record.
const RESULTS_MAILBOX = 'stockport.badders.results@gmail.com';

// The PWA/touch icon: real transparency, drawn for a dark tile, so it sits on the navy
// header without a seam. Served from rootfiles at the site root.
const LOGO_PATH = '/touch-icon-192x192.png';

// Operator- or public-typed text into the HTML a template expects. Escaped FIRST, then
// newlines become <br />, because the templates print it with <%- %> — escaping here is
// what stops a contact-form submission injecting markup into an email sent to a club
// secretary.
function textToHtml(text) {
  return ejs.escapeXML(String(text == null ? '' : text)).replace(/\r?\n/g, '<br />');
}

// The PROMISE form of renderFile, deliberately — `renderFile(path, data)` with no
// callback returns one. The callback form looks equivalent and is not: scorecard.test.js
// mocks ejs with `renderFile: jest.fn().mockResolvedValue(...)`, which never invokes a
// callback, so a callback-wrapped promise there never settles and every test that sends
// an email sat until Jest's timeout. Twenty-one of them, at 15s each.
function renderTemplate(name, data) {
  return ejs.renderFile(path.join(TEMPLATE_DIR, name + '.ejs'), data || {});
}

const asList = value => (Array.isArray(value) ? value : [value]).filter(Boolean);

/**
 * @param {object}   opts
 * @param {string}   opts.template      views/emails/<name>.ejs
 * @param {object}  [opts.data]         locals for the template
 * @param {string}   opts.subject
 * @param {string}   opts.text          plain-text alternative — required, see above
 * @param {string}   opts.whyReceiving  the footer's "why you got this" line — required
 * @param {string|string[]} opts.to
 * @param {string|string[]} [opts.cc]
 * @param {string|string[]} [opts.bcc]
 * @param {string|string[]} [opts.replyTo]
 */
async function send(opts) {
  const { template, data, subject, text, whyReceiving, to, cc, bcc, replyTo } = opts || {};
  if (!template) throw new Error('mailer.send: template is required');
  if (!subject) throw new Error('mailer.send: subject is required');
  // Both are required rather than defaulted, so a new email cannot quietly ship without
  // a text part or without telling its reader why they got it.
  if (!text) throw new Error(`mailer.send: text is required (${template})`);
  if (!whyReceiving) throw new Error(`mailer.send: whyReceiving is required (${template})`);

  const recipients = asList(to);
  if (!recipients.length) throw new Error(`mailer.send: no recipient (${template})`);

  const html = await renderTemplate(template, Object.assign({
    logoUrl: absoluteUrl(LOGO_PATH),
    whyReceiving,
  }, data));

  const params = {
    Destination: { ToAddresses: recipients },
    Message: {
      Body: {
        Html: { Charset: 'UTF-8', Data: html },
        Text: { Charset: 'UTF-8', Data: text },
      },
      Subject: { Charset: 'UTF-8', Data: subject },
    },
    Source: FROM,
  };
  if (asList(cc).length) params.Destination.CcAddresses = asList(cc);
  if (asList(bcc).length) params.Destination.BccAddresses = asList(bcc);
  if (asList(replyTo).length) params.ReplyToAddresses = asList(replyTo);

  await ses.sendEmail(params);
  return params;
}

module.exports = { send, textToHtml, FROM, RESULTS_MAILBOX, LOGO_PATH };
