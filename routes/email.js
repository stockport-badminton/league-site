// Inbound mail (SNS), SES delivery events, the signup notice and the contact form.
// Mounted by routes/index.js, in the order listed there (REARCH-04).
const express = require('express');
const router = express.Router();
const access = require('../middleware/access');
const mailer = require('../utils/mailer');
const { absoluteUrl } = require('../utils/canonical');
const contact_controller = require('../controllers/contactusController');
const email_event_controller = require('../controllers/emailEventController');
const spamGate = require('../middleware/spamGate');
const { publicFormLimiter, contactLimiter } = require('../middleware/rateLimit');

// /SESemail is gone. It was an unauthenticated POST that sent a hardcoded message
// to three of our own inboxes — a one-line curl loop was a mail bomb, and nothing
// in the app ever called it. /mailtest went with it for the same reason: an
// unauthenticated twin of the /mail webhook below.
// verifySns runs first: without it this endpoint accepted any POST that set the
// x-amz-sns-message-type header, and forwarded the attached MIME message to a real
// distribution list.
router.post('/mail', access.sns, contact_controller.distribution_list);

// SES delivery events from the baddersEmail configuration set's SNS topic, stored so the
// weekly digest can report a failed send. verifySns for the same reason /mail has it:
// without it anyone could POST invented bounces, and they would appear in the results
// secretary's weekly email as fact.
router.post('/ses-events', access.sns,
  email_event_controller.ses_events);

// Tells the results secretary that somebody has signed up and is waiting on approval.
//
// This was the last send in the codebase still building its HTML by hand, and it was
// missed when the other ten moved onto the MJML pipeline because it lives in a route
// rather than a controller — there was no template file sitting in views/emails/ to look
// conspicuously unstyled. __tests__/unit/mail-sends-use-mailer.test.js now fails if
// another one appears.
// Public: called by the Auth0 signup flow, with no session. The recipients are fixed here.
router.post('/new-users-v2', access.public, publicFormLimiter, async (req, res, next) => {
  const id = String(req.body.id || '');
  if (id.length <= 3 || id === 'undefined') return res.sendStatus(200);

  try {
    await mailer.send({
      template: 'access-request',
      // Derived here, never from the request. `req.body.contactEmail` used to go into
      // ReplyToAddresses on this unauthenticated endpoint, so the sender could choose
      // where a reply landed.
      to: ['stockport.badders.results@gmail.com'],
      bcc: ['bigcoops@outlook.com'],
      replyTo: mailer.RESULTS_MAILBOX,
      subject: 'New user signup — approval needed',
      whyReceiving: 'You are a league administrator, so you are told when someone asks for results access.',
      data: {
        // Whatever the signup form was given, capped. The template escapes it; the
        // concatenated version this replaces needed a hand-rolled escapeHtml() to do the
        // same job, and that is exactly the pattern the pipeline retires.
        userLabel: String(req.body.user || 'Someone').slice(0, 200),
        // req.body.id is an Auth0 user_id (e.g. "auth0|abc123") — must be encoded before
        // going into a URL, or the emailed link breaks. absoluteUrl rather than a
        // hardcoded host: see gotcha 1b, req.get('host') is the Cloud Run hostname.
        approveUrl: absoluteUrl('/approve-user/' + encodeURIComponent(id)),
      },
      text: [
        'A new user has signed up for results entry and is waiting for approval.',
        '',
        String(req.body.user || 'Someone').slice(0, 200),
        '',
        'Approve them here:',
        absoluteUrl('/approve-user/' + encodeURIComponent(id)),
      ].join('\n'),
    });
    res.sendStatus(200);
  } catch (err) {
    console.log(err.toString());
    next(err);
  }
});

// Contact us
router.get('/contact-us', access.public, contact_controller.contactus_get);
router.post('/contact-us', access.public, contactLimiter, spamGate({ endpoint: '/contact-us' }), contact_controller.validateContactUs, contact_controller.contactus);

module.exports = router;
