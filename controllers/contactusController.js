var Club = require('../models/club.js');
var Player = require('../models/players.js');
const sgMail = require('@sendgrid/mail');
require('dotenv').config()
var logger = require('logzio-nodejs').createLogger({
  token: process.env.LOGZ_SECRET,
  host: 'listener-uk.logz.io'
});
const { body,validationResult } = require("express-validator");
const { sanitizeBody } = require("express-validator");
var axios = require('axios');
const { read } = require('fs');
const { MigrationHubStrategy } = require('aws-sdk');
const fs = require('fs');

function validCaptcha(value,{req}){
  // console.log('https://www.google.com/recaptcha/api/siteverify?secret='+ process.env.RECAPTCHA_SECRET +'&response='+value);
  axios.post("https://www.google.com/recaptcha/api/siteverify?secret="+ process.env.RECAPTCHA_SECRET +"&response="+value)
    .then(response => {
      //console.log(response.request)
      //console.log(response.config)
      //console.log(response.data)
      if (response.data.success){
        // console.log('recaptcha sucess')
        return value
      }
      else {
        console.log('recaptcha fail')
        return false
      }
    })
    .catch(err => {
      logger.log("error")
      logger.log(err)
      return false
    })
}


function containsProfanity(value,{req}){
  var substringsArray = ["000***","brokerage","pharm","Blockchain","blockchain","@Cryptaxbot","pharma","mail.ru","@FeedbackMessages","messages exploitation","Financial Strategic Firm","Business Financial Team","Christ","God","http://","http","https","wininphone","corta.co","Cryptocurrency","adultdating","forex","ahole","anus","ash0le","ash0les","asholes","ass","Ass Monkey","Assface","assh0le","assh0lez","asshole","assholes","assholz","asswipe","azzhole","bassterds","bastard","bastards","bastardz","basterds","basterdz","Biatch","bitch","bitches","Blow Job","boffing","butthole","buttwipe","c0ck","c0cks","c0k","Carpet Muncher","cawk","cawks","Clit","cnts","cntz"," cock","cockhead","cock-head","cocks","CockSucker","cock-sucker","crap","cum","cunt","cunts","cuntz","dick","dild0","dild0s","dildo","dildos","dilld0","dilld0s","dominatricks","dominatrics","dominatrix","dyke","enema","f u c k","f u c k e r","fag","fag1t","faget","fagg1t","faggit","faggot","fagit","fags","fagz","faig","faigs","fart","flipping the bird","fuck","fucker","fuckin","fucking","fucks","Fudge Packer","fuk","Fukah","Fuken","fuker","Fukin","Fukk","Fukkah","Fukken","Fukker","Fukkin","g00k","gay","gayboy","gaygirl","gays","gayz","God-damned","h00r","h0ar","h0re","hells","hoar","hoor","hoore","jackoff","jap","japs","jerk-off","jisim","jiss","jizm","jizz","knob","knobs","knobz","kunt","kunts","kuntz","Lesbian","Lezzian","Lipshits","Lipshitz","masochist","masokist","massterbait","masstrbait","masstrbate","masterbaiter","masterbate","masterbates","Motha Fucker","Motha Fuker","Motha Fukkah","Motha Fukker","Mother Fucker","Mother Fukah","Mother Fuker","Mother Fukkah","Mother Fukker","mother-fucker","Mutha Fucker","Mutha Fukah","Mutha Fuker","Mutha Fukkah","Mutha Fukker","n1gr","nastt","nigger;","nigur;","niiger;","niigr;","orafis","orgasim;","orgasm","orgasum","oriface","orifice","orifiss","packi","packie","packy","paki","pakie","paky","pecker","peeenus","peeenusss","peenus","peinus","pen1s","penas","penis","penis-breath","penus","penuus","Phuc","Phuck","Phuk","Phuker","Phukker","polac","polack","polak","Poonani","pr1c","pr1ck","pr1k","pusse","pussee","pussy","puuke","puuker","queer","queers","queerz","qweers","qweerz","qweir","recktum","rectum","retard","sadist","scank","schlong","screwing","semen","sex","sexy","Sh!t","sh1t","sh1ter","sh1ts","sh1tter","sh1tz","shit","shits","shitter","Shitty","Shity","shitz","Shyt","Shyte","Shytty","Shyty","skanck","skank","skankee","skankey","skanks","Skanky","slut","sluts","Slutty","slutz","son-of-a-bitch","tit","turd","va1jina","vag1na","vagiina","vagina","vaj1na","vajina","vullva","vulva","w0p","wh00r","wh0re","whore","xrated","xxx","b!+ch","bitch","blowjob","clit","arschloch","fuck","shit","ass","asshole","b!tch","b17ch","b1tch","bastard","bi+ch","boiolas","buceta","c0ck","cawk","chink","cipa","clits","cock","cum","cunt","dildo","dirsa","ejakulate","fatass","fcuk","fuk","fux0r","hoer","hore","jism","kawk","l3itch","l3i+ch","lesbian","masturbate","masterbat*","masterbat3","motherfucker","s.o.b.","mofo","nazi","nigga","nigger","nutsack","phuck","pimpis","pusse","pussy","scrotum","sh!t","shemale","shi+","sh!+","slut","smut","teets","tits","boobs","b00bs","teez","testical","testicle","titt","w00se","jackoff","wank","whoar","whore","*damn","*dyke","*fuck*","*shit*","@$$","amcik","andskota","arse*","assrammer","ayir","bi7ch","bitch*","bollock*","breasts","butt-pirate","cabron","cazzo","chraa","chuj","Cock*","cunt*","d4mn","daygo","dego","dick*","dike*","dupa","dziwka","ejackulate","Ekrem*","Ekto","enculer","faen","fag*","fanculo","fanny","feces","feg","Felcher","ficken","fitt*","Flikker","foreskin","Fotze","Fu(*","fuk*","futkretzn","gay","gook","guiena","h0r","h4x0r"," hell ","helvete","hoer*","honkey","Huevon","hui","injun","jizz","kanker*","kike","klootzak","kraut","knulle","kuk","kuksuger","Kurac","kurwa","kusi*","kyrpa*","lesbo","mamhoon","masturbat*","merd*","mibun","monkleigh","mouliewop","muie","mulkku","muschi","nazis","nepesaurio","nigger*","orospu","paska*","perse","picka","pierdol*","pillu*","pimmel","piss*","pizda","poontsee","poop","porn","p0rn","pr0n","preteen","pula","pule","puta","puto","qahbeh","queef*","rautenberg","schaffer","scheiss*","schlampe","schmuck","screw","sh!t*","sharmuta","sharmute","shipal","shiz","skribz","skurwysyn","sphencter","spic","spierdalaj","splooge","suka","b00b*","testicle*","titt*","twat","vittu","wank*","wetback*","wichser","wop*","zabourah"];

  if (substringsArray.some(function(v) { if (value.indexOf(v) >= 0) {console.log(v)}; return value.indexOf(v) >= 0; })) {
     logger.log('containsProfanity fail')
    // console.log('containsProfanity fail')
    return false
  }
  // if (substringsArray.some(substring=>yourBigString.includes(substring))) {

  // }
  else{
    // console.log('containsProfanity sucess')
     logger.log(value)
    return value
  }
}

function containsDodgyEmail(value,{req}){
  var substringsArray = ["yjdisantoyjdissemin@gmail.com","lucido.leinteract@gmail.com","projectdept@kanzalshamsprojectmgt.com","evalidator.test@gmail.com","simpsonmiddleton1111@gmail.com","simpsonmiddleton@bankingandfinanceconsultantsltd.com","breiner@cljfarmaceutisch.nl","drbreiner233@gmail.com","smithduncan610@gmail.com","5rdhp2fe29yb@beconfidential.com","stevenlove88@163.com","artweb.agency@gmail.com","help@aweb.sbs","hrhbah-mbi@aghemfondom.com","hrhmbambi@gmail.com","nhu-tran@sac-city.k12.ca.us","yourmail@gmail.com","kaenquirynicholls@gmail.com"];

  if (substringsArray.some(function(v) { if (value.indexOf(v) >= 0) {console.log(v)}; return value.indexOf(v) >= 0; })) {
     logger.log('dodgyEmail fail')
    // console.log('containsProfanity fail')
    return false
  }
  // if (substringsArray.some(substring=>yourBigString.includes(substring))) {

  // }
  else{
    // console.log('containsProfanity sucess')
     logger.log(value)
    return value
  }
}


exports.validateContactUs = [
  body('contactEmail').not().isEmpty().withMessage('please enter an Email address').isEmail().withMessage('Please enter a valid email address').custom(containsDodgyEmail).withMessage("You have been blocked for spamming the contact form"),
  body('contactQuery').not().isEmpty().withMessage('Please enter something in message field.').custom(containsProfanity).withMessage("Please don't use profanity in the message body"),
  body('g-recaptcha-response').not().custom(validCaptcha).withMessage('your not a human')
]

exports.contactus = function(req, res,next){
  var errors = validationResult(req);
  if (!errors.isEmpty()) {
      logger.log("errors array");
      logger.log(errors.array());
      res.render('beta/contact-us-form-delivered', {
        pageTitle: 'Contact Us - Error',
        pageDescription: 'Sorry we weren\'t able sent your email - something went wrong',
        message: 'Sorry something went wrong',
        static_path:'/static',
        theme:'flatly',
        content: errors.array()
      });
      return;
  }
  else {

  const msg = {
    to: '',
    cc: 'stockport.badders.results@gmail.com',
    from: 'stockport.badders.results@stockport-badminton.co.uk',
    replyto: req.body.contactEmail,
    templateId:'d-53fc74c4a6cc4b85bb3126418087cf0b',
    dynamic_template_data:{
      "message":req.body.contactQuery,
      "email":req.body.contactEmail
    }
  };
    var clubEmail = '';
    
    if(req.body.contactType == 'Clubs'){
      Club.getContactDetailsById(req.body.clubSelect, function(err,rows){
        if (err){
          console.log(err);
          next(err);
        }
        else {
          // msg.to = rows[0].contactUs;
          msg.to = (rows[0].clubSecEmail.indexOf(',') > 0 ? rows[0].clubSecEmail.split(',') : rows[0].clubSecEmail);
          sgMail.send(msg)
            .then(()=>{
              logger.log(msg);
              res.render('beta/contact-us-form-delivered', {
                  static_path: '/static',
                  theme: process.env.THEME || 'flatly',
                  flask_debug: process.env.FLASK_DEBUG || 'false',
                  pageTitle: 'Contact Us - Success',
                  pageDescription: 'Success - we\'ve sent an email to your chosen contact for you',
                  message: 'Success - we\'ve sent your email to your chosen contact'
              });
            })
            .catch(error => {
              logger.log(error.toString());
              return next("Sorry something went wrong sending your email.");
            })
        }
      })
      
    }
    if (req.body.contactType == 'League'){
      switch (req.body.leagueSelect) {
        case 'results':
          msg.to = ['stockport.badders.results@gmail.com','neil.cooper.241180@gmail.com']
          msg.cc = null;
          break;
        case 'tournament':
          msg.to = ['sueorwin@btinternet.com']
          break;
        case 'league':
          msg.to = ['leaguesec.sdbl@gmail.com']
          break;
        case 'chair':
          msg.to = ['mel.curwen@ntlworld.com']
          break;
        case 'messer':
          msg.to = ['sueorwin@btinternet.com']
          break;
        case 'junior':
          msg.to = ['stuartscoffins@btinternet.com']
          break;
        case 'juniortournament':
          msg.to = ['aim@talktalk.net']
          break;
        case 'treasurer':
          msg.to = ['rossowen40@hotmail.com']
          break;
        default:
      }
      sgMail.send(msg)
      .then(()=>{
        logger.log(msg);
        res.render('beta/contact-us-form-delivered', {
            static_path: '/static',
            theme: process.env.THEME || 'flatly',
            flask_debug: process.env.FLASK_DEBUG || 'false',
            pageTitle: 'Contact Us - Success',
            pageDescription: 'Success - we\'ve sent an email to your chosen contact for you',
            message: 'Success - we\'ve sent your email to your chosen contact'
        });
      })
      .catch(error => {
        logger.log(error.toString());
        return next("Sorry something went wrong sending your email.");
      })
    }
  }
}


// Display list of all Players
exports.distribution_list = async function(req,res,next) {

  console.log("from: " + req.body.from);
  console.log("to: " + req.body.to);
  console.log("subject: " + req.body.subject);
  // logger.log("html: " + req.body.html);
  
  var recipient = req.body.to.substring(0,req.body.to.indexOf("@"));
  recipient = recipient.replace("\"","")
  console.log("recipint : stockport.badders.results\+"+recipient+"@gmail.com")

  var msg = {
    "to": ["stockport.badders.results\+"+recipient+"@gmail.com"],
    "from": "stockport.badders.results@stockport-badminton.co.uk",
    "subject": req.body.subject,
    "text": "Email from sengrid parse send to "+req.body.to,
    "html": req.body.html,
    "isMultiple":true
  };
  // console.log(req.body.to.indexOf("test"))
  if (req.body.to.indexOf("test") >= 0 ){
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
      console.log(file);
    })
    //console.log("attachments: " + req.body['attachment-info']);
    var attachments = [];
    for (i = 1; i <= req.body.attachments; i++){
        console.log(req.body["attachment-info"]["attachment"+i])
        var attachment = {
          content: req.files[i-1].buffer.toString("base64"),
          filename: req.files[i-1].originalname,
          type: req.files[i-1].mimetype,
          disposition: "attachment"
        };

        attachments.push(attachment);
      };
    msg.attachments = attachments;
  }

  console.log(msg)
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
    { "match": "canute", "search": 47 },
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
    await Player.getEmails(searchObject, function (err, rows) {
      if (err) {
        console.error(err);
        next(err)
      }
      else {
        //console.log(rows);
        if (msg.subject.indexOf('test') == -1){
          var tempArray = msg.to
          msg.to = tempArray.concat(rows)
          // console.log(msg.to)
          sgMail.send(msg)
          .then((msg,response)=>{
            // logger.log(msg);
            // console.info("within sgMail send then");
            console.info(msg);
            res.sendStatus(200);
          })
          .catch(error => {
            console.error("within error catch");
            console.error(error.response.body.errors)
            console.info(msg);
            next("Sorry something went wrong sending your email.");
          })
        }
        else {
          msg.html = msg.html.replace("<body>","<body><p id=\"emaillist\"></p>")
          msg.text += rows.join()
          msg.html = msg.html.replace("<body><p id=\"emaillist\">","<body><p id=\"emaillist\">"+rows.join()+"<br/>")
          console.log(msg)
          // console.log(msg.to)
          sgMail.send(msg)
          .then((response)=>{
            // logger.log(msg);
            // console.info("within sgMail send then");
            // console.info(response);
            res.sendStatus(200);
          })
          .catch(error => {
            // console.error("within error catch");
            console.error(error);
            console.error(error.response.body.errors)
            console.info(msg);
            next("Sorry something went wrong sending your email.");
          })
        }
      }
    })
  }
  else {
    // console.log(msg)
    // console.log(msg.to)
    sgMail.send(msg)
    .then((response)=>{
      // logger.log(msg);
      // console.info("within sgMail send then");
      // console.info(response);
      res.sendStatus(200);
    })
    .catch(error => {
      console.error("within error catch");
      console.error(error);
      console.info(msg);
      next("Sorry something went wrong sending your email.");
    })
  }
    
  }


exports.contactus_get = function(req, res,next) {
  Club.getAll(function(err,rows){
    if(err){
      console.log(err);
      next(err);
    }
    else {
      res.render('beta/contact-us-form', {
        static_path: '/static',
        theme: process.env.THEME || 'flatly',
        flask_debug: process.env.FLASK_DEBUG || 'false',
        pageTitle : "Contact Us",
        pageDescription : "Get in touch with your league representatives, or club secretaries",
        recaptcha : process.env.RECAPTCHA,
        clubs:rows
      });
    }
      
  })
  
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

exports.generateContactUsHTML = function() {
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
            <div>{{message}}</div>

<div>from: {{email}}</div>
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

exports.generateMissingScorecardHTML = function() {
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
  {{#if error}}
    {{error}}
  {{else if noFixtures}}
    {{noFixtures}}
  {{else}}
    {{#each missingFixtures}}
      {{date}}: {{homeTeam}} vs {{awayTeam}}<br>
    {{/each}}    
  {{/if}}

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