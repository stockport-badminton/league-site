var Club = require('../models/club.js');
var seasonModel = require("../models/season");
var League = require('../models/league.js');
var Player = require('../models/players.js');
require('dotenv').config()
const sesUtil = require('../utils/ses');
const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
const { SESv2Client, SendEmailCommand } = require('@aws-sdk/client-sesv2');
const https = require('node:https');
const verifySns = require('../middleware/verifySns');
const Spam = require('../models/spamControls');
const spamGate = require('../middleware/spamGate');
const { clientIp, forwardedChain } = require('../utils/clientIp');
const nodemailer = require('nodemailer');
const { simpleParser } = require("mailparser");
const { body,validationResult, param } = require("express-validator");
const { sanitizeBody } = require("express-validator");
var axios = require('axios');
const { read } = require('fs');
const fs = require('fs');
const { networkInterfaces } = require('node:os');
const { find } = require('async');
const { canonicalFor } = require('../utils/canonical');

const FIRSTYEAR = new Date().getMonth() < 7 ? `${new Date().getFullYear() - 1}` : `${new Date().getFullYear()}`

exports.generateContactUsHTML = function(message, email) {
  return `
  <!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Strict//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-strict.dtd">
<html data-editor-version="2" class="sg-campaigns" xmlns="http://www.w3.org/1999/xhtml">
    <head>
      <meta http-equiv="Content-Type" content="text/html; charset=utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1, minimum-scale=1, maximum-scale=1">
      <!--[if !mso]><!-->
      <meta http-equiv="X-UA-Compatible" content="IE=Edge">
      <!--<![endif]-->
      <!--[if (gte mso 9)|(IE)]>
      <xml>
        <o:OfficeDocumentSettings>
          <o:AllowPNG/>
          <o:PixelsPerInch>96</o:PixelsPerInch>
        </o:OfficeDocumentSettings>
      </xml>
      <![endif]-->
      <!--[if (gte mso 9)|(IE)]>
  <style type="text/css">
    body {width: 600px;margin: 0 auto;}
    table {border-collapse: collapse;}
    table, td {mso-table-lspace: 0pt;mso-table-rspace: 0pt;}
    img {-ms-interpolation-mode: bicubic;}
  </style>
<![endif]-->
      <style type="text/css">
    body, p, div {
      font-family: arial,helvetica,sans-serif;
      font-size: 14px;
    }
    body {
      color: #000000;
    }
    body a {
      color: #1188E6;
      text-decoration: none;
    }
    p { margin: 0; padding: 0; }
    table.wrapper {
      width:100% !important;
      table-layout: fixed;
      -webkit-font-smoothing: antialiased;
      -webkit-text-size-adjust: 100%;
      -moz-text-size-adjust: 100%;
      -ms-text-size-adjust: 100%;
    }
    img.max-width {
      max-width: 100% !important;
    }
    .column.of-2 {
      width: 50%;
    }
    .column.of-3 {
      width: 33.333%;
    }
    .column.of-4 {
      width: 25%;
    }
    ul ul ul ul  {
      list-style-type: disc !important;
    }
    ol ol {
      list-style-type: lower-roman !important;
    }
    ol ol ol {
      list-style-type: lower-latin !important;
    }
    ol ol ol ol {
      list-style-type: decimal !important;
    }
    @media screen and (max-width:480px) {
      .preheader .rightColumnContent,
      .footer .rightColumnContent {
        text-align: left !important;
      }
      .preheader .rightColumnContent div,
      .preheader .rightColumnContent span,
      .footer .rightColumnContent div,
      .footer .rightColumnContent span {
        text-align: left !important;
      }
      .preheader .rightColumnContent,
      .preheader .leftColumnContent {
        font-size: 80% !important;
        padding: 5px 0;
      }
      table.wrapper-mobile {
        width: 100% !important;
        table-layout: fixed;
      }
      img.max-width {
        height: auto !important;
        max-width: 100% !important;
      }
      a.bulletproof-button {
        display: block !important;
        width: auto !important;
        font-size: 80%;
        padding-left: 0 !important;
        padding-right: 0 !important;
      }
      .columns {
        width: 100% !important;
      }
      .column {
        display: block !important;
        width: 100% !important;
        padding-left: 0 !important;
        padding-right: 0 !important;
        margin-left: 0 !important;
        margin-right: 0 !important;
      }
      .social-icon-column {
        display: inline-block !important;
      }
    }
  </style>
      <!--user entered Head Start-->
    
     <!--End Head user entered-->
    </head>
    <body>
      <center class="wrapper" data-link-color="#1188E6" data-body-style="font-size:14px; font-family:arial,helvetica,sans-serif; color:#000000; background-color:#ffffff;">
        <div class="webkit">
          <table cellpadding="0" cellspacing="0" border="0" width="100%" class="wrapper" bgcolor="#ffffff">
            <tr>
              <td valign="top" bgcolor="#ffffff" width="100%">
                <table width="100%" role="content-container" class="outer" align="center" cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    <td width="100%">
                      <table width="100%" cellpadding="0" cellspacing="0" border="0">
                        <tr>
                          <td>
                            <!--[if mso]>
    <center>
    <table><tr><td width="600">
  <![endif]-->
                                    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%; max-width:600px;" align="center">
                                      <tr>
                                        <td role="modules-container" style="padding:0px 0px 0px 0px; color:#000000; text-align:left;" bgcolor="#ffffff" width="100%" align="left"><table class="module preheader preheader-hide" role="module" data-type="preheader" border="0" cellpadding="0" cellspacing="0" width="100%" style="display: none !important; mso-hide: all; visibility: hidden; opacity: 0; color: transparent; height: 0; width: 0;">
    <tr>
      <td role="module-content">
        <p></p>
      </td>
    </tr>
  </table><table class="module" role="module" data-type="text" border="0" cellpadding="0" cellspacing="0" width="100%" style="table-layout: fixed;" data-mc-module-version="2019-10-22">
      <tr>
        <td style="background-color:#343a40;padding:18px 010px 18px 010px;line-height:22px;text-align:inherit;" height="100%" valign="top" bgcolor="#343a40">
            <div><span style="font-size:24px;"><span style="color:#FFFFFF;">Stockport &amp; District Badminton League</span></span></div>
        </td>
      </tr>
    </table><table class="module" role="module" data-type="text" border="0" cellpadding="0" cellspacing="0" width="100%" style="table-layout: fixed;" data-mc-module-version="2019-10-22">
      <tr>
        <td style="padding:18px 10px 18px 10px;line-height:22px;text-align:inherit;" height="100%" valign="top" bgcolor="">
            <div>${message}</div>

<div>from: ${email}</div>
        </td>
      </tr>
    </table><div data-role="module-unsubscribe" class="module unsubscribe-css__unsubscribe___2CDlR" role="module" data-type="unsubscribe" style="color:#444444;font-size:12px;line-height:20px;padding:16px 16px 16px 16px;text-align:center"><p style="font-family:[Sender_Name];font-size:12px;line-height:20px"><a class="Unsubscribe--unsubscribeLink" href="<%asm_group_unsubscribe_raw_url%>">Unsubscribe</a> - <a class="Unsubscribe--unsubscribePreferences" href="<%asm_preferences_raw_url%>">Unsubscribe Preferences</a></p></div></td>
                                      </tr>
                                    </table>
                                    <!--[if mso]>
                                  </td>
                                </tr>
                              </table>
                            </center>
                            <![endif]-->
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </div>
      </center>
    </body>
  </html>
  `
}

// oldValidCaptcha lived here. It was already unused, and it never worked: an async
// axios chain inside a synchronous validator, so it returned undefined before the
// verification resolved. validCaptcha below is the one wired up, and it awaits.
async function validCaptcha(value, { req }) {
  if (!value) {
    throw new Error('reCAPTCHA response is required');
  }

  try {
    const response = await axios.post('https://www.google.com/recaptcha/api/siteverify', null, {
      params: {
        secret: process.env.RECAPTCHA_SECRET,
        response: value,
        remoteip: req.ip // Optional: include user's IP for additional security
      }
    });

    console.log('reCAPTCHA response:', response.data);

    if (!response.data.success) {
      // Log specific error codes for debugging
      console.log('reCAPTCHA errors:', response.data['error-codes']);
      throw new Error('reCAPTCHA verification failed');
    }

    // For reCAPTCHA v3, you can also check the score
    if (response.data.score && response.data.score < 0.5) {
      console.log('Low reCAPTCHA score:', response.data.score);
      throw new Error('reCAPTCHA score too low');
    }

    return true;
  } catch (error) {
    console.error('reCAPTCHA validation error:', error.message);
    throw new Error('reCAPTCHA verification failed');
  }
}


// Both of these used to carry their lists inline: ~180 phrases and 89 spammer email
// addresses, meaning every new spammer cost a source edit and a deploy. They now read
// models/spamControls (table blocked_entry, admin screen at /admin/spam), which is
// cached for a minute so this costs nothing per request.
//
// The profanity half of the old phrase list was deliberately not carried over. It was
// politeness policing rather than spam defence, and it cost legitimate messages — "hell",
// "gay", "sex" and "ass" were whole-word blocks, and Gay is a real surname. The terms
// that were actually catching spam (links, brokerage, pharma, crypto, forex) are seeded
// in migration 010. Anything worth re-adding can be added through the admin screen, as a
// 'word' entry for whole-word matching or 'phrase' for a substring.
async function containsProfanity(value, { req }) {
  const hit = await Spam.matchBlockedText(value);
  if (hit) {
    req._spamReason = 'blocked-' + hit.kind;
    req._spamMatch = hit.value;
    throw new Error('blocked content');
  }
  return true;
}

async function containsDodgyEmail(value, { req }) {
  if (await Spam.isBlockedEmail(value)) {
    req._spamReason = 'blocked-email';
    req._spamMatch = String(value).toLowerCase();
    throw new Error('blocked sender');
  }
  return true;
}

exports.validateContactUs = [
  body('contactEmail').not().isEmpty().withMessage('please enter an Email address').isEmail().withMessage('Please enter a valid email address').custom(containsDodgyEmail).withMessage("You have been blocked for spamming the contact form"),
  body('contactQuery').not().isEmpty().withMessage('Please enter something in message field.').custom(containsProfanity).withMessage("Please don't use profanity in the message body"),
  // body('g-recaptcha-response').not().custom(validCaptcha).withMessage('your not a human')
  body('g-recaptcha-response')
    .custom(validCaptcha)
    .withMessage('Please complete the reCAPTCHA verification')
]

exports.contactus = async function(req, res, next) {
  var errors = validationResult(req);
  if (!errors.isEmpty()) {
    console.log("errors array");
    for (i of errors.array()) {
      console.log(i)
    }
    // `req._spamReason` is set by the blocklist validators; anything else that failed
    // validation is a real person getting a field wrong, which is worth telling apart
    // from spam in the log.
    spamGate.logOutcome(req, {
      verdict: 'rejected',
      reason: req._spamReason || 'validation',
    });
    res.render('contact-us-form-delivered', {
      pageTitle: 'Contact Us - Error',
      pageDescription: 'Sorry we weren\'t able sent your email - something went wrong',
      message: 'Sorry something went wrong',
      static_path: '/static',
      theme: 'flatly',
      content: errors.array(),
      canonical: canonicalFor(req)
    });
    return;
  }

  spamGate.logOutcome(req, { verdict: 'accepted' });

  const msg = {
    to: '',
    cc: 'stockport.badders.results@gmail.com',
    from: 'stockport.badders.results@stockport-badminton.co.uk',
    replyto: req.body.contactEmail,
    templateId: 'd-53fc74c4a6cc4b85bb3126418087cf0b',
    dynamic_template_data: {
      "message": req.body.contactQuery,
      "email": req.body.contactEmail
    }
  };

  try {
    if (req.body.contactType == 'Clubs') {
      console.log(`clubSelect ${req.body.clubSelect}`)
      const rows = await Club.getContactDetailsById(req.body.clubSelect);
      var params = {
        Destination: {
          ToAddresses: [],
          BccAddresses: ['stockport.badders.results@gmail.com', 'bigcoops@outlook.com']
        },
        Message: {
          Body: {
            Html: {
              Charset: 'UTF-8',
              Data: exports.generateContactUsHTML(req.body.contactQuery, req.body.contactEmail)
            }
          },
          Subject: {
            Charset: 'UTF-8',
            Data: 'Somebody is trying to get in touch'
          }
        },
        Source: 'results@stockport-badminton.co.uk',
        ReplyToAddresses: ['stockport.badders.results@gmail.com', req.body.contactEmail],
      };
      params.Destination.ToAddresses = (rows[0].clubSecEmail.indexOf(',') > 0 ? rows[0].clubSecEmail.split(',') : [rows[0].clubSecEmail]);
      await sesUtil.sendEmail(params);
      console.log(msg);
      res.render('contact-us-form-delivered', {
        static_path: '/static',
        theme: process.env.THEME || 'flatly',
        flask_debug: process.env.FLASK_DEBUG || 'false',
        pageTitle: 'Contact Us - Success',
        pageDescription: 'Success - we\'ve sent an email to your chosen contact for you',
        message: 'Success - we\'ve sent your email to your chosen contact',
        canonical: canonicalFor(req)
      });
    }
    if (req.body.contactType == 'League') {
      switch (req.body.leagueSelect) {
        case 'results':
          msg.to = ['stockport.badders.results@gmail.com', 'neil.cooper.241180@gmail.com']
          msg.cc = null;
          break;
        case 'tournament':
          msg.to = ['sueorwin@btinternet.com']
          break;
        case 'league':
          msg.to = ['santanareedy@btinternet.com']
          break;
        case 'chair':
          msg.to = ['mel.curwen@ntlworld.com']
          break;
        case 'messer':
          msg.to = ['sueorwin@btinternet.com']
          break;
        case 'junior':
          msg.to = ['stockport.badders.results+junior@gmail.com']
          break;
        case 'juniortournament':
          msg.to = ['stockport.badders.results+juniortournament@gmail.com']
          break;
        case 'treasurer':
          msg.to = ['rossowen40@hotmail.com']
          break;
        default:
      }
      var params = {
        Destination: {
          ToAddresses: [],
          BccAddresses: ['stockport.badders.results@gmail.com', 'bigcoops@outlook.com']
        },
        Message: {
          Body: {
            Html: {
              Charset: 'UTF-8',
              Data: exports.generateContactUsHTML(req.body.contactQuery, req.body.contactEmail)
            }
          },
          Subject: {
            Charset: 'UTF-8',
            Data: 'Somebody is trying to get in touch'
          }
        },
        Source: 'results@stockport-badminton.co.uk',
        ReplyToAddresses: ['stockport.badders.results@gmail.com', req.body.contactEmail],
      };
      params.Destination.ToAddresses = msg.to;
      await sesUtil.sendEmail(params);
      console.log(msg);
      res.render('contact-us-form-delivered', {
        static_path: '/static',
        theme: process.env.THEME || 'flatly',
        flask_debug: process.env.FLASK_DEBUG || 'false',
        pageTitle: 'Contact Us - Success',
        pageDescription: 'Success - we\'ve sent an email to your chosen contact for you',
        message: 'Success - we\'ve sent your email to your chosen contact',
        canonical: canonicalFor(req)
      });
    }
  } catch (error) {
    console.log(error.toString());
    return next("Sorry something went wrong sending your email.");
  }
}
exports.send_invoices = async function(req, res, next) {
  try {
    const rows = await League.getAnnualInvoices(req.params.club);
    let invoiceDate = new Date(`09-01-${FIRSTYEAR}`);
    let today = new Date();
    let dateCheck = today.getMonth() === invoiceDate.getMonth() && today.getFullYear() === invoiceDate.getFullYear() && today.getDate() === invoiceDate.getDate();

    console.log(`today: ${today} invoiceDate: ${invoiceDate} dateCheck:${dateCheck}`);
    console.log(JSON.stringify(rows))

    const ejs = require('ejs');
    let allData = [];
    let outputs = [];

    for (let club of rows) {
      let data = {};
      data.fines = [];
      data.season = seasonModel.current();
      data.firstYear = FIRSTYEAR;
      data.name = club.clubName;
      data.teamsCount = club.teamsCount;
      data.secretary = club.secretary;
      data.email = club.playerEmail;

      // `clubFee`, not `teamFee`. The column is season."clubFee" and has been since
      // b3b8efd ("rule and fee changes", 21 May 2026), which renamed it in the query and
      // left this reading the old name. `undefined` multiplied by anything is NaN, EJS
      // renders NaN as the string "NaN", and the invoices went out reading
      // "2 league team(s): £NaN ... TOTAL: £NaN" to all 18 clubs on 1 Sep 2026.
      //
      // It survived four months because this runs once a year: the date guard below
      // means the only execution that matters is the annual send, so a rename in May is
      // not exercised until September. Despite the name, the fee is per *team* — the
      // multiplication is the long-standing behaviour and is not what was wrong.
      let clubTotal = club.teamsCount * club.clubFee;

      let fineRows = rows.filter(fine => fine.clubId === club.clubId);
      for (let fine of fineRows) {
        if (fine.desc !== null) {
          data.fines.push({ desc: fine.desc, amount: fine.amount });
          clubTotal += fine.amount;
        }
      }

      data.teamsCost = club.teamsCount * club.clubFee;
      data.feesTotal = clubTotal;

      // Never mail a number we cannot compute. A missing or renamed column yields NaN
      // rather than throwing, EJS prints it happily, and the result is an invoice asking
      // a club for £NaN — which is worse than no invoice, because it is authoritative,
      // it reaches every club at once, and it only happens on the one day a year anybody
      // would notice. Fail this club loudly and keep going for the rest.
      if (!Number.isFinite(Number(data.teamsCost)) || !Number.isFinite(Number(data.feesTotal))) {
        const detail = `teamsCount=${JSON.stringify(club.teamsCount)} clubFee=${JSON.stringify(club.clubFee)}`;
        console.error(`[invoices] ${data.name}: refusing to send, non-numeric total (${detail})`);
        outputs.push(`${data.name} invoice NOT sent: total did not compute (${detail})`);
        continue;
      }

      if (!allData.some(row => row.name === data.name)) {
        allData.push(data);

        if (!dateCheck) {
          return res.send(["not the right date for invoices"]);
        }

        const currentData = JSON.parse(JSON.stringify(data));
        try {
          const str = await ejs.renderFile('views/emails/clubInvoice.ejs', { data: currentData }, { debug: false });
          const params = {
            Destination: {
              ToAddresses: [currentData.email],
              CcAddresses: [`treasurer.sdbl+${currentData.name.replace(/ |\./g, '')}@hotmail.com`],
              BccAddresses: [
                'bigcoops@outlook.com',
                'bigcoops@gmail.com',
                `stockport.badders.results+${currentData.name.replace(/ |\./g, '')}@gmail.com`
              ]
            },
            Message: {
              Body: {
                Html: {
                  Charset: 'UTF-8',
                  Data: str
                }
              },
              Subject: {
                Charset: 'UTF-8',
                Data: `Annual Invoice for ${currentData.name}`
              }
            },
            Source: 'results@stockport-badminton.co.uk',
            ReplyToAddresses: ['stockport.badders.results@gmail.com', 'treasurer.sdbl@hotmail.com']
          };
          await sesUtil.sendEmail(params);
          outputs.push(`${currentData.name} invoice sent successfully`);
        } catch (sendErr) {
          console.log(sendErr.toString());
          outputs.push(`${currentData.name} invoice failed: ${sendErr}`);
        }
      }
    }
    res.send(outputs);
  } catch (err) {
    next(err);
  }
}


// Display list of all Players
exports.distribution_list = async function(req,res,next) {
  let recipient = ""
  let subject = ""
  let textBody = ""
  let htmlBody = ""
  let sender = ""
  // console.log(req.headers)
  // req.snsMessage is the body already parsed *and signature-verified* by
  // middleware/verifySns. The branch below used to switch on the
  // x-amz-sns-message-type header, which any caller can set; it now switches on the
  // verified message's own Type.
  const snsMsg = req.snsMessage || {};
  if (snsMsg.Type === 'SubscriptionConfirmation'){
    let msgBody = snsMsg
    // The URL is fetched by our own server, so it is checked against the SNS host
    // pattern rather than followed on trust — otherwise a confirmation message is an
    // SSRF primitive pointed at anything reachable from inside GCP.
    if (!verifySns.isAmazonSubscribeUrl(msgBody.SubscribeURL)) {
      console.warn('Refusing to fetch non-SNS SubscribeURL:', msgBody.SubscribeURL)
      return res.status(400).send('bad SubscribeURL')
    }
    console.log(`found message header: ${msgBody.SubscribeURL}`)

    https.get(msgBody.SubscribeURL, (res) => {
    console.log('statusCode:', res.statusCode);
    console.log('headers:', res.headers);

    res.on('data', (d) => {
      process.stdout.write(d);
    });

  }).on('error', (e) => {
    console.error("error:")
    console.error(e);
  });
  }
  else if (snsMsg.Type === 'Notification'){
    try {
      let message = snsMsg;
      const notification = JSON.parse(message["Message"]);

      // Obtain the raw MIME message. Small emails may arrive inline via the SES
      // SNS action (notification.content). Anything with attachments exceeds the
      // ~256KB SNS limit and is instead stored in S3 by the SES S3 action, with
      // only a pointer delivered here (receipt.action). Handle both so deploy
      // order vs. the receipt-rule change doesn't matter.
      let buffer;
      if (notification.content) {
        buffer = Buffer.from(notification.content, "base64");
      } else if (notification.receipt && notification.receipt.action && notification.receipt.action.type === "S3") {
        const { bucketName, objectKey } = notification.receipt.action;
        console.log(`fetching raw email from s3://${bucketName}/${objectKey}`);
        const s3 = new S3Client({ region: 'eu-west-1' });
        const obj = await s3.send(new GetObjectCommand({ Bucket: bucketName, Key: objectKey }));
        buffer = Buffer.from(await obj.Body.transformToByteArray());
      } else {
        throw new Error("SNS notification had neither inline content nor an S3 action");
      }

      // Parse the email using mailparser
      const parsedEmail = await simpleParser(buffer);
      console.log("Parsed email:", JSON.stringify(parsedEmail));
      console.log(`parsed email to: ${JSON.stringify(parsedEmail.to.value)}`)
      console.log(`parsed email to: ${JSON.stringify(parsedEmail.from.value)}`)

      // Use the envelope recipients SES actually matched, not the To header.
      // A BCC'd list address (common for distribution lists) never appears in
      // To, so header-based extraction would silently miss it.
      let recipients = notification.receipt.recipients
      let stockportrecips = recipients.filter(row => row.indexOf('@stockport-badminton.co.uk') > -1 )
      
      for (row of stockportrecips){
        // row = row.substring(0,row.indexOf("@"))
        recipient += row.substring(0,row.indexOf("@"))
      }
      let otherrecips = recipients.filter(row => row.indexOf('@stockport-badminton.co.uk') < 0)
      console.log("recipients: " + JSON.stringify(recipients))
      console.log("stockportrecipients: " + JSON.stringify(stockportrecips))
      
      

      // Extract email details
      sender = parsedEmail.from.value[0].address;
      // recipient = parsedEmail.to.text;
      subject = parsedEmail.subject || "No Subject";
      textBody = parsedEmail.text || "No text content";
      htmlBody = parsedEmail.html || parsedEmail.textAsHtml || parsedEmail.text;
      console.log(JSON.stringify(parsedEmail))

      // Extract attachments (if any)
      const attachments = await parsedEmail.attachments.map((attachment) => ({
          filename: attachment.filename,
          content: attachment.content,
          encoding: "base64",
      }));

      
      // recipient = recipient.substring(0,recipient.indexOf("@"));
      // recipient = recipient.replace("\"","")
      console.log("recipint : stockport.badders.results\+"+recipient+"@gmail.com")

      var msg = {
        "to": ["stockport.badders.results\+"+recipient+"@gmail.com"],
        // "to": ["stockport.badders.results@gmail.com"],
        "from": "stockport.badders.results@stockport-badminton.co.uk",
        "subject": subject,
        "text": "Email from sengrid parse send to "+recipient,
        "html": htmlBody,
        "isMultiple":true
      };

      let nodemailconfig = {
        from: 'results@stockport-badminton.co.uk',
        to: "stockport.badders.results\+"+recipient+"@gmail.com",
        bcc: "bigcoops\+"+recipient+"@outlook.com",
        subject: subject,                // Subject line
        text: "Email from sengrid parse send to "+recipient,                      // plaintext version
        html: htmlBody, // html version
        attachments:attachments
      }
      
      

      let transporter = nodemailer.createTransport({
        SES: { sesClient: new SESv2Client({ region: 'eu-west-1' }), SendEmailCommand }
      });
      
      
      // send mail with defined transport object
      


      var searchObject = {}
      var roles = [
        {
          "match":"clubSecretaries",
          "search":"club Sec"
        },
        {
          "match":"matchSecretaries",
          "search":"match Sec"
        },
        {
          "match":"teamCaptains",
          "search":"team Captain"
        },
        {
          "match":"treasurers",
          "search":"treasurer"
        },
        {
          "match":"leagueComms",
          "search":"otherComms"
        }
      ]
      var divisions = [
        {
          "match":"Premier",
          "search":7
        },
        {
          "match":"division1",
          "search":8
        },
        {
          "match":"division2",
          "search":9
        },
        {
          "match":"division3",
          "search":10
        }
      ]
      var clubNames = [
        { "match": "aerospace", "search": 42 },
        { "match": "alderleypark", "search": 43 },
        { "match": "altrinchamcentral", "search": 44 },
        { "match": "remnants", "search": 47 },
        { "match": "featherforce", "search": 64 },
        { "match": "cheadlehulme", "search": 49 },
        { "match": "collegegreen", "search": 61 },
        { "match": "davidlloyd", "search": 50 },
        { "match": "disley", "search": 51 },
        { "match": "dome", "search": 52 },
        { "match": "ghap", "search": 53 },
        { "match": "macclesfield", "search": 54 },
        { "match": "manor", "search": 55 },
        { "match": "mellor", "search": 39 },
        { "match": "noclub", "search": 63 },
        { "match": "parrswood", "search": 57 },
        { "match": "racketeer", "search": 59 },
        { "match": "shell", "search": 40 },
        { "match": "syddalpark", "search": 41 },
        { "match": "tatton", "search": 60 }
      ]
      /* await Club.getAll(function(err,rows){
        if (err) {
          console.log(err);
          next(err);
        }
        else{
          rows.forEach(club => {
            var clubName = club.name.replace(' ','').replace('.','')toLowerCase()
            clubNames.push({"match":clubName,"search":club.id})
          })
        }
      }) */
      
      roles.forEach(role => {
        if(recipient.indexOf(role.match) >= 0){
          searchObject.role = role.search
        }
      })
      divisions.forEach(division => {
        if(recipient.indexOf(division.match) >= 0){
          searchObject.division = division.search
        }
      })
      //console.log(clubNames);
      clubNames.forEach(club => {
        if(recipient.indexOf(club.match) >= 0){
          searchObject.club = club.search
        }
      })

      if (searchObject.role || searchObject.division || searchObject.club) {
        const rows = await Player.getEmails(searchObject);
        if (subject.indexOf('test') == -1) {
          var tempArray = msg.to
          msg.to = tempArray.concat(rows)
          nodemailconfig.bcc = tempArray.concat(rows)
          const info = await transporter.sendMail(nodemailconfig);
          console.log(info.messageId);
          res.sendStatus(200)
        } else {
          msg.html = msg.html.replace("<body>", "<body><p id=\"emaillist\"></p>")
          msg.text += rows.join()
          msg.html = msg.html.replace("<body><p id=\"emaillist\">", "<body><p id=\"emaillist\">" + rows.join() + "<br/>")
          nodemailconfig.html = nodemailconfig.html.replace("</body>", "<p id=\"emaillist\"></p></body>")
          nodemailconfig.html = nodemailconfig.html.replace("<p id=\"emaillist\"></p></body>", "<p id=\"emaillist\">" + rows.join() + "<br/></p></body>")
          console.log("--- NODEMAIL HTML---- ")
          console.log(nodemailconfig.html)
          const info = await transporter.sendMail(nodemailconfig);
          console.log(info.envelope);
          console.log(info.messageId);
          res.sendStatus(200)
        }
      } else {
        console.log("nodeemailconfig" + JSON.stringify(nodemailconfig))
        const info = await transporter.sendMail(nodemailconfig);
        console.log(JSON.stringify(info))
        console.log(info.envelope);
        console.log(info.messageId);
        res.sendStatus(200)
      }
      
    } catch (error) {
        console.error("Error processing message:", error);
        // res.status(500).send("Internal Server Error");
        next(error)
    }
  }
  else {
    console.log(`didn't find message header: ${JSON.stringify(req.body)}`)
  }

   //console.log("from: " + req.body.from);
   //console.log("to: " + req.body.to);
   //console.log("subject: " + req.body.subject);
  // console.log("html: " + req.body.html);
  
  
  var params = {
    Destination: { /* required */
      ToAddresses: ["stockport.badders.results\+"+recipient+"@gmail.com"],
      // ToAddresses: ["stockport.badders.results@gmail.com"],
      BccAddresses:["bigcoops\+"+recipient+"@outlook.com"]
      // BccAddresses:["bigcoops@outlook.com"]
    },
    Message: { /* required */
      Body: {
        Html: {
          Charset: 'UTF-8',
          Data: htmlBody
        },
        Text:{
          Charset: 'UTF-8',
          Data: textBody
        }
      },
      Subject: {
      Charset: 'UTF-8',
      Data: subject
      }
    },
    Source: 'results@stockport-badminton.co.uk', /* required */
    ReplyToAddresses: [
      'stockport.badders.results@gmail.com'
    ],
  };
  // console.log(req.body.to.indexOf("test"))
  /* if (req.body.to.indexOf("test") >= 0 ){
    // console.log("detected test")
    msg["mail_settings"] = {
      "sandbox_mode": {
          "enable": true
        }
    }
    // console.log(msg)
  } 
  
  if(req.files){
    // console.log("files" + req.files)
    req.files.forEach(file =>{
       //console.log(file);
    })
    //console.log("attachments: " + req.body['attachment-info']);
    var attachments = [];
    for (i = 1; i <= req.body.attachments; i++){
         //console.log(req.body["attachment-info"]["attachment"+i])
        var attachment = {
          content: req.files[i-1].buffer.toString("base64"),
          filename: req.files[i-1].originalname,
          type: req.files[i-1].mimetype,
          disposition: "attachment"
        };

        attachments.push(attachment);
      };
    msg.attachments = attachments;
  } */

   //console.log(msg)
  
  
    
  }


exports.contactus_get = async function(req, res, next) {
  try {
    const rows = await Club.getAll();
    res.render('contact-us-form', {
      static_path: '/static',
      theme: process.env.THEME || 'flatly',
      flask_debug: process.env.FLASK_DEBUG || 'false',
      pageTitle: "Contact Us",
      pageDescription: "Get in touch with your league representatives, or club secretaries",
      recaptcha: process.env.RECAPTCHA,
      clubs: rows,
      // The club pages link here as /contact-us?club=<id> so the dropdown arrives
      // already set to the club the visitor came from.
      selectedClub: req.query.club,
      canonical: canonicalFor(req)
    });
  } catch (err) {
    next(err);
  }
}

exports.generateScorecardReminderHTML = function (){
  return `
  <!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Strict//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-strict.dtd">
<html data-editor-version="2" class="sg-campaigns" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta http-equiv="Content-Type" content="text/html; charset=utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, minimum-scale=1, maximum-scale=1">
  <!--[if !mso]><!-->
  <meta http-equiv="X-UA-Compatible" content="IE=Edge">
  <!--<![endif]-->
  <!--[if (gte mso 9)|(IE)]>
  <xml>
    <o:OfficeDocumentSettings>
      <o:AllowPNG/>
      <o:PixelsPerInch>96</o:PixelsPerInch>
    </o:OfficeDocumentSettings>
  </xml>
  <![endif]-->
  <!--[if (gte mso 9)|(IE)]>
<style type="text/css">
body {width: 600px;margin: 0 auto;}
table {border-collapse: collapse;}
table, td {mso-table-lspace: 0pt;mso-table-rspace: 0pt;}
img {-ms-interpolation-mode: bicubic;}
</style>
<![endif]-->
  <style type="text/css">
body, p, div {
  font-family: arial,helvetica,sans-serif;
  font-size: 14px;
}
body {
  color: #000000;
}
body a {
  color: #1188E6;
  text-decoration: none;
}
p { margin: 0; padding: 0; }
table.wrapper {
  width:100% !important;
  table-layout: fixed;
  -webkit-font-smoothing: antialiased;
  -webkit-text-size-adjust: 100%;
  -moz-text-size-adjust: 100%;
  -ms-text-size-adjust: 100%;
}
img.max-width {
  max-width: 100% !important;
}
.column.of-2 {
  width: 50%;
}
.column.of-3 {
  width: 33.333%;
}
.column.of-4 {
  width: 25%;
}
ul ul ul ul  {
  list-style-type: disc !important;
}
ol ol {
  list-style-type: lower-roman !important;
}
ol ol ol {
  list-style-type: lower-latin !important;
}
ol ol ol ol {
  list-style-type: decimal !important;
}
@media screen and (max-width:480px) {
  .preheader .rightColumnContent,
  .footer .rightColumnContent {
    text-align: left !important;
  }
  .preheader .rightColumnContent div,
  .preheader .rightColumnContent span,
  .footer .rightColumnContent div,
  .footer .rightColumnContent span {
    text-align: left !important;
  }
  .preheader .rightColumnContent,
  .preheader .leftColumnContent {
    font-size: 80% !important;
    padding: 5px 0;
  }
  table.wrapper-mobile {
    width: 100% !important;
    table-layout: fixed;
  }
  img.max-width {
    height: auto !important;
    max-width: 100% !important;
  }
  a.bulletproof-button {
    display: block !important;
    width: auto !important;
    font-size: 80%;
    padding-left: 0 !important;
    padding-right: 0 !important;
  }
  .columns {
    width: 100% !important;
  }
  .column {
    display: block !important;
    width: 100% !important;
    padding-left: 0 !important;
    padding-right: 0 !important;
    margin-left: 0 !important;
    margin-right: 0 !important;
  }
  .social-icon-column {
    display: inline-block !important;
  }
}
</style>
  <!--user entered Head Start-->

 <!--End Head user entered-->
</head>
<body>
  <center class="wrapper" data-link-color="#1188E6" data-body-style="font-size:14px; font-family:arial,helvetica,sans-serif; color:#000000; background-color:#ffffff;">
    <div class="webkit">
      <table cellpadding="0" cellspacing="0" border="0" width="100%" class="wrapper" bgcolor="#ffffff">
        <tr>
          <td valign="top" bgcolor="#ffffff" width="100%">
            <table width="100%" role="content-container" class="outer" align="center" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td width="100%">
                  <table width="100%" cellpadding="0" cellspacing="0" border="0">
                    <tr>
                      <td>
                        <!--[if mso]>
<center>
<table><tr><td width="600">
<![endif]-->
                                <table width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%; max-width:600px;" align="center">
                                  <tr>
                                    <td role="modules-container" style="padding:0px 0px 0px 0px; color:#000000; text-align:left;" bgcolor="#ffffff" width="100%" align="left"><table class="module preheader preheader-hide" role="module" data-type="preheader" border="0" cellpadding="0" cellspacing="0" width="100%" style="display: none !important; mso-hide: all; visibility: hidden; opacity: 0; color: transparent; height: 0; width: 0;">
<tr>
  <td role="module-content">
    <p>The Scorecard for your recent match is due</p>
  </td>
</tr>
</table><table class="module" role="module" data-type="text" border="0" cellpadding="0" cellspacing="0" width="100%" style="table-layout: fixed;" data-mc-module-version="2019-10-22">
  <tr>
    <td style="background-color:#343a40;padding:18px 10px 18px 10px;line-height:22px;text-align:inherit;" height="100%" valign="top" bgcolor="#343a40">
        <div><span style="color:#FFFFFF;"><span style="font-size:24px;">Stockport &amp; District Badminton League</span></span></div>
    </td>
  </tr>
</table><table class="module" role="module" data-type="text" border="0" cellpadding="0" cellspacing="0" width="100%" style="table-layout: fixed;" data-mc-module-version="2019-10-22">
  <tr>
    <td style="padding:18px 05px 18px 05px;line-height:22px;text-align:justify;" height="100%" valign="top" bgcolor="">
        <div>Just a timely reminder that the scorecard for your recent match is due by close of play tomorrow to avoid a late card mark</div>

<div>&nbsp;</div>

<div>Thanks</div>

<div>&nbsp;</div>

<div>Neil</div>
    </td>
  </tr>
</table></td>
                                  </tr>
                                </table>
                                <!--[if mso]>
                              </td>
                            </tr>
                          </table>
                        </center>
                        <![endif]-->
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </div>
  </center>
</body>
</html>
  `
}

exports.generateMissingScorecardHTML = function(fixtures) {
  let missingFixtures = ""
  for (fixture of fixtures){
    missingFixtures += `${fixture.date}: ${fixture.homeTeam} vs ${fixture.awayTeam} 
    <br />`
  }
  return `
  <!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Strict//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-strict.dtd">
<html data-editor-version="2" class="sg-campaigns" xmlns="http://www.w3.org/1999/xhtml">
    <head>
      <meta http-equiv="Content-Type" content="text/html; charset=utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1, minimum-scale=1, maximum-scale=1">
      <!--[if !mso]><!-->
      <meta http-equiv="X-UA-Compatible" content="IE=Edge">
      <!--<![endif]-->
      <!--[if (gte mso 9)|(IE)]>
      <xml>
        <o:OfficeDocumentSettings>
          <o:AllowPNG/>
          <o:PixelsPerInch>96</o:PixelsPerInch>
        </o:OfficeDocumentSettings>
      </xml>
      <![endif]-->
      <!--[if (gte mso 9)|(IE)]>
  <style type="text/css">
    body {width: 600px;margin: 0 auto;}
    table {border-collapse: collapse;}
    table, td {mso-table-lspace: 0pt;mso-table-rspace: 0pt;}
    img {-ms-interpolation-mode: bicubic;}
  </style>
<![endif]-->
      <style type="text/css">
    body, p, div {
      font-family: arial,helvetica,sans-serif;
      font-size: 14px;
    }
    body {
      color: #000000;
    }
    body a {
      color: #1188E6;
      text-decoration: none;
    }
    p { margin: 0; padding: 0; }
    table.wrapper {
      width:100% !important;
      table-layout: fixed;
      -webkit-font-smoothing: antialiased;
      -webkit-text-size-adjust: 100%;
      -moz-text-size-adjust: 100%;
      -ms-text-size-adjust: 100%;
    }
    img.max-width {
      max-width: 100% !important;
    }
    .column.of-2 {
      width: 50%;
    }
    .column.of-3 {
      width: 33.333%;
    }
    .column.of-4 {
      width: 25%;
    }
    ul ul ul ul  {
      list-style-type: disc !important;
    }
    ol ol {
      list-style-type: lower-roman !important;
    }
    ol ol ol {
      list-style-type: lower-latin !important;
    }
    ol ol ol ol {
      list-style-type: decimal !important;
    }
    @media screen and (max-width:480px) {
      .preheader .rightColumnContent,
      .footer .rightColumnContent {
        text-align: left !important;
      }
      .preheader .rightColumnContent div,
      .preheader .rightColumnContent span,
      .footer .rightColumnContent div,
      .footer .rightColumnContent span {
        text-align: left !important;
      }
      .preheader .rightColumnContent,
      .preheader .leftColumnContent {
        font-size: 80% !important;
        padding: 5px 0;
      }
      table.wrapper-mobile {
        width: 100% !important;
        table-layout: fixed;
      }
      img.max-width {
        height: auto !important;
        max-width: 100% !important;
      }
      a.bulletproof-button {
        display: block !important;
        width: auto !important;
        font-size: 80%;
        padding-left: 0 !important;
        padding-right: 0 !important;
      }
      .columns {
        width: 100% !important;
      }
      .column {
        display: block !important;
        width: 100% !important;
        padding-left: 0 !important;
        padding-right: 0 !important;
        margin-left: 0 !important;
        margin-right: 0 !important;
      }
      .social-icon-column {
        display: inline-block !important;
      }
    }
  </style>
      <!--user entered Head Start-->
    
     <!--End Head user entered-->
    </head>
    <body>
      <center class="wrapper" data-link-color="#1188E6" data-body-style="font-size:14px; font-family:arial,helvetica,sans-serif; color:#000000; background-color:#ffffff;">
        <div class="webkit">
          <table cellpadding="0" cellspacing="0" border="0" width="100%" class="wrapper" bgcolor="#ffffff">
            <tr>
              <td valign="top" bgcolor="#ffffff" width="100%">
                <table width="100%" role="content-container" class="outer" align="center" cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    <td width="100%">
                      <table width="100%" cellpadding="0" cellspacing="0" border="0">
                        <tr>
                          <td>
                            <!--[if mso]>
    <center>
    <table><tr><td width="600">
  <![endif]-->
                                    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%; max-width:600px;" align="center">
                                      <tr>
                                        <td role="modules-container" style="padding:0px 0px 0px 0px; color:#000000; text-align:left;" bgcolor="#ffffff" width="100%" align="left"><table class="module preheader preheader-hide" role="module" data-type="preheader" border="0" cellpadding="0" cellspacing="0" width="100%" style="display: none !important; mso-hide: all; visibility: hidden; opacity: 0; color: transparent; height: 0; width: 0;">
    <tr>
      <td role="module-content">
        <p></p>
      </td>
    </tr>
  </table><table class="module" role="module" data-type="text" border="0" cellpadding="0" cellspacing="0" width="100%" style="table-layout: fixed;" data-mc-module-version="2019-10-22">
      <tr>
        <td style="background-color:#343a40;padding:18px 10px 18px 10px;line-height:22px;text-align:inherit;" height="100%" valign="top" bgcolor="#343a40">
            <div><span style="font-size:24px;"><span style="color:#FFFFFF;">Stockport &amp; District Badminton League</span></span></div>
        </td>
      </tr>
    </table><table class="module" role="module" data-type="code" border="0" cellpadding="0" cellspacing="0" width="100%" style="table-layout: fixed;">
      <tr>
        <td height="100%" valign="top">
          <div style="padding:18px 10px">
  ${missingFixtures}

</div>
        </td>
      </tr>
    </table><div data-role="module-unsubscribe" class="module unsubscribe-css__unsubscribe___2CDlR" role="module" data-type="unsubscribe" style="color:#444444;font-size:12px;line-height:20px;padding:16px 16px 16px 16px;text-align:center"><p style="font-family:[Sender_Name];font-size:12px;line-height:20px"><a class="Unsubscribe--unsubscribeLink" href="<%asm_group_unsubscribe_raw_url%>">Unsubscribe</a></p></div></td>
                                      </tr>
                                    </table>
                                    <!--[if mso]>
                                  </td>
                                </tr>
                              </table>
                            </center>
                            <![endif]-->
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </div>
      </center>
    </body>
  </html>
  `
}

exports.generateWebsiteUpdateHTML = function(){
  return `
  <!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Strict//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-strict.dtd">
  <html data-editor-version="2" class="sg-campaigns" xmlns="http://www.w3.org/1999/xhtml">
      <head>
        <meta http-equiv="Content-Type" content="text/html; charset=utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1, minimum-scale=1, maximum-scale=1">
        <!--[if !mso]><!-->
        <meta http-equiv="X-UA-Compatible" content="IE=Edge">
        <!--<![endif]-->
        <!--[if (gte mso 9)|(IE)]>
        <xml>
          <o:OfficeDocumentSettings>
            <o:AllowPNG/>
            <o:PixelsPerInch>96</o:PixelsPerInch>
          </o:OfficeDocumentSettings>
        </xml>
        <![endif]-->
        <!--[if (gte mso 9)|(IE)]>
    <style type="text/css">
      body {width: 600px;margin: 0 auto;}
      table {border-collapse: collapse;}
      table, td {mso-table-lspace: 0pt;mso-table-rspace: 0pt;}
      img {-ms-interpolation-mode: bicubic;}
    </style>
  <![endif]-->
        <style type="text/css">
      body, p, div {
        font-family: arial,helvetica,sans-serif;
        font-size: 14px;
      }
      body {
        color: #000000;
      }
      body a {
        color: #1188E6;
        text-decoration: none;
      }
      p { margin: 0; padding: 0; }
      table.wrapper {
        width:100% !important;
        table-layout: fixed;
        -webkit-font-smoothing: antialiased;
        -webkit-text-size-adjust: 100%;
        -moz-text-size-adjust: 100%;
        -ms-text-size-adjust: 100%;
      }
      img.max-width {
        max-width: 100% !important;
      }
      .column.of-2 {
        width: 50%;
      }
      .column.of-3 {
        width: 33.333%;
      }
      .column.of-4 {
        width: 25%;
      }
      ul ul ul ul  {
        list-style-type: disc !important;
      }
      ol ol {
        list-style-type: lower-roman !important;
      }
      ol ol ol {
        list-style-type: lower-latin !important;
      }
      ol ol ol ol {
        list-style-type: decimal !important;
      }
      @media screen and (max-width:480px) {
        .preheader .rightColumnContent,
        .footer .rightColumnContent {
          text-align: left !important;
        }
        .preheader .rightColumnContent div,
        .preheader .rightColumnContent span,
        .footer .rightColumnContent div,
        .footer .rightColumnContent span {
          text-align: left !important;
        }
        .preheader .rightColumnContent,
        .preheader .leftColumnContent {
          font-size: 80% !important;
          padding: 5px 0;
        }
        table.wrapper-mobile {
          width: 100% !important;
          table-layout: fixed;
        }
        img.max-width {
          height: auto !important;
          max-width: 100% !important;
        }
        a.bulletproof-button {
          display: block !important;
          width: auto !important;
          font-size: 80%;
          padding-left: 0 !important;
          padding-right: 0 !important;
        }
        .columns {
          width: 100% !important;
        }
        .column {
          display: block !important;
          width: 100% !important;
          padding-left: 0 !important;
          padding-right: 0 !important;
          margin-left: 0 !important;
          margin-right: 0 !important;
        }
        .social-icon-column {
          display: inline-block !important;
        }
      }
    </style>
        <!--user entered Head Start-->
      
       <!--End Head user entered-->
      </head>
      <body>
        <center class="wrapper" data-link-color="#1188E6" data-body-style="font-size:14px; font-family:arial,helvetica,sans-serif; color:#000000; background-color:#ffffff;">
          <div class="webkit">
            <table cellpadding="0" cellspacing="0" border="0" width="100%" class="wrapper" bgcolor="#ffffff">
              <tr>
                <td valign="top" bgcolor="#ffffff" width="100%">
                  <table width="100%" role="content-container" class="outer" align="center" cellpadding="0" cellspacing="0" border="0">
                    <tr>
                      <td width="100%">
                        <table width="100%" cellpadding="0" cellspacing="0" border="0">
                          <tr>
                            <td>
                              <!--[if mso]>
      <center>
      <table><tr><td width="600">
    <![endif]-->
                                      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%; max-width:600px;" align="center">
                                        <tr>
                                          <td role="modules-container" style="padding:0px 0px 0px 0px; color:#000000; text-align:left;" bgcolor="#ffffff" width="100%" align="left"><table class="module preheader preheader-hide" role="module" data-type="preheader" border="0" cellpadding="0" cellspacing="0" width="100%" style="display: none !important; mso-hide: all; visibility: hidden; opacity: 0; color: transparent; height: 0; width: 0;">
      <tr>
        <td role="module-content">
          <p>Thanks for sending in your scorecard</p>
        </td>
      </tr>
    </table><table class="module" role="module" data-type="text" border="0" cellpadding="0" cellspacing="0" width="100%" style="table-layout: fixed;" data-mc-module-version="2019-10-22" data-muid="6SYCUJTDLfWZjyifivtvTu">
        <tbody><tr>
          <td style="background-color:#343a40; padding:18px 10px 18px 10px; line-height:22px; text-align:inherit;" height="100%" valign="top" bgcolor="#343a40"><div><div style="font-family: inherit; text-align: inherit"><span style="color: #ffffff; font-size: 24px">Stockport & District Badminton League</span></div><div></div></div></td>
        </tr>
      </tbody></table><table class="module" role="module" data-type="text" border="0" cellpadding="0" cellspacing="0" width="100%" style="table-layout: fixed;" data-mc-module-version="2019-10-22" data-muid="hoLg8RyX8dbLbRo4q71hiG">
        <tbody><tr>
          <td style="padding:18px 5px 18px 5px; line-height:22px; text-align:justify;" height="100%" valign="top" bgcolor=""><div><div style="font-family: inherit; text-align: inherit">Thanks for sending your scorecard - website updated</div>
  <div style="font-family: inherit; text-align: inherit"><br></div>
  <div style="font-family: inherit; text-align: inherit">Match Stats:</div><div></div></div></td>
        </tr>
      </tbody></table><table class="module" role="module" data-type="code" border="0" cellpadding="0" cellspacing="0" width="100%" style="table-layout: fixed;" data-muid="e7fe70a3-c58c-4fc2-b0c3-140fc075bf80.1">
      <tbody>
        <tr>
          <td height="100%" valign="top" role="module-content">
  {{#each matchStats }}
  
  {{/each}}
  <table border="0" cellpadding="0" cellspacing="0" width="100%">
  <thead><tr>
      <th>Name</th>
      <th>Team</th>
      <th>Games Won</th>
      <th>Avg Pts For</th>
      <th>Avg Pts Against</th>
  </tr>
  </thead>
  <tbody><tr>
      <td>{{matchStats.name}}</td>
      <td>{{matchStats.teamName}}</td>
      <td>{{matchStats.gamesWon}}</td>
      <td>{{matchStats.avgPtsFor}}</td>
      <td>{{matchStats.avgPtsAgainst}}</td>
  </tr></tbody></table></td>
        </tr>
      </tbody>
    </table><table class="module" role="module" data-type="code" border="0" cellpadding="0" cellspacing="0" width="100%" style="table-layout: fixed;" data-muid="e7fe70a3-c58c-4fc2-b0c3-140fc075bf80.1.1">
      <tbody>
        <tr>
          <td height="100%" valign="top" role="module-content"><img src="https://stockport-badminton.co.uk/static/beta/images/generated/{{generatedImage}}.jpg" border="0" width="100%"></td>
        </tr>
      </tbody>
    </table><table class="module" role="module" data-type="social" align="center" border="0" cellpadding="0" cellspacing="0" width="100%" style="table-layout: fixed;" data-muid="686282d6-f872-4078-8c3a-5d591bc69836">
      <tbody>
        <tr>
          <td valign="top" style="padding:0px 0px 0px 0px; font-size:6px; line-height:10px;" align="center">
            <table align="center" style="-webkit-margin-start:auto;-webkit-margin-end:auto;">
              <tbody>
                <tr><td style="padding: 0px 5px;">
        <a role="social-icon-link" href="http://facebook.com/stockportbadminton" target="_blank" alt="Facebook" title="Facebook" style="display:inline-block; background-color:#3B579D; height:21px; width:21px;">
          <img role="social-icon" alt="Facebook" title="Facebook" src="https://marketing-image-production.s3.amazonaws.com/social/white/facebook.png" style="height:21px; width:21px;" height="21" width="21">
        </a>
      </td><td style="padding: 0px 5px;">
        <a role="social-icon-link" href="http://twitter.com/baddersresults" target="_blank" alt="Twitter" title="Twitter" style="display:inline-block; background-color:#7AC4F7; height:21px; width:21px;">
          <img role="social-icon" alt="Twitter" title="Twitter" src="https://marketing-image-production.s3.amazonaws.com/social/white/twitter.png" style="height:21px; width:21px;" height="21" width="21">
        </a>
      </td><td style="padding: 0px 5px;">
        <a role="social-icon-link" href="http://instagram.com/stockport.badders.results" target="_blank" alt="Instagram" title="Instagram" style="display:inline-block; background-color:#7F4B30; height:21px; width:21px;">
          <img role="social-icon" alt="Instagram" title="Instagram" src="https://marketing-image-production.s3.amazonaws.com/social/white/instagram.png" style="height:21px; width:21px;" height="21" width="21">
        </a>
      </td></tr>
              </tbody>
            </table>
          </td>
        </tr>
      </tbody>
    </table><div data-role="module-unsubscribe" class="module unsubscribe-css__unsubscribe___2CDlR" role="module" data-type="unsubscribe" style="color:#444444; font-size:12px; line-height:20px; padding:16px 16px 16px 16px; text-align:center;" data-muid="htgBhbVWDRSdRdt96Zg7Gn"><p style="font-family:Arial,Helvetica, sans-serif;font-size:12px;line-height:20px"><a class="Unsubscribe--unsubscribeLink" href="<%asm_group_unsubscribe_raw_url%>">Unsubscribe</a></p></div></td>
                                        </tr>
                                      </table>
                                      <!--[if mso]>
                                    </td>
                                  </tr>
                                </table>
                              </center>
                              <![endif]-->
                            </td>
                          </tr>
                        </table>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>
          </div>
        </center>
      </body>
    </html>
  `
}