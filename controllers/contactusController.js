var Club = require('../models/club.js');
const sgMail = require('@sendgrid/mail');
require('dotenv').config()
var logger = require('logzio-nodejs').createLogger({
  token: process.env.LOGZ_SECRET,
  host: 'listener-uk.logz.io'
});
const { body,validationResult } = require("express-validator/check");
const { sanitizeBody } = require("express-validator/filter");
var axios = require('axios')

function validCaptcha(value,{req}){
  // console.log('https://www.google.com/recaptcha/api/siteverify?secret='+ process.env.RECAPTCHA_SECRET +'&response='+value);
  axios.post("https://www.google.com/recaptcha/api/siteverify?secret="+ process.env.RECAPTCHA_SECRET +"&response="+value)
    .then(response => {
      console.log(response.request)
      console.log(response.config)
      console.log(response.data)
      if (response.data.success){
        console.log('recaptcha sucess')
        return value
      }
      else {
        console.log('recaptcha fail')
        return false
      }
    })
    .catch(err => {
      console.log("error")
      console.log(err)
      return false
    })
}


function containsProfanity(value,{req}){
  var substringsArray = ["mail.ru","@FeedbackMessages","messages exploitation","Financial Strategic Firm","Business Financial Team","Christ","God","http://","http","https","wininphone","corta.co","Cryptocurrency","adultdating","forex","ahole","anus","ash0le","ash0les","asholes","ass","Ass Monkey","Assface","assh0le","assh0lez","asshole","assholes","assholz","asswipe","azzhole","bassterds","bastard","bastards","bastardz","basterds","basterdz","Biatch","bitch","bitches","Blow Job","boffing","butthole","buttwipe","c0ck","c0cks","c0k","Carpet Muncher","cawk","cawks","Clit","cnts","cntz"," cock","cockhead","cock-head","cocks","CockSucker","cock-sucker","crap","cum","cunt","cunts","cuntz","dick","dild0","dild0s","dildo","dildos","dilld0","dilld0s","dominatricks","dominatrics","dominatrix","dyke","enema","f u c k","f u c k e r","fag","fag1t","faget","fagg1t","faggit","faggot","fagit","fags","fagz","faig","faigs","fart","flipping the bird","fuck","fucker","fuckin","fucking","fucks","Fudge Packer","fuk","Fukah","Fuken","fuker","Fukin","Fukk","Fukkah","Fukken","Fukker","Fukkin","g00k","gay","gayboy","gaygirl","gays","gayz","God-damned","h00r","h0ar","h0re","hells","hoar","hoor","hoore","jackoff","jap","japs","jerk-off","jisim","jiss","jizm","jizz","knob","knobs","knobz","kunt","kunts","kuntz","Lesbian","Lezzian","Lipshits","Lipshitz","masochist","masokist","massterbait","masstrbait","masstrbate","masterbaiter","masterbate","masterbates","Motha Fucker","Motha Fuker","Motha Fukkah","Motha Fukker","Mother Fucker","Mother Fukah","Mother Fuker","Mother Fukkah","Mother Fukker","mother-fucker","Mutha Fucker","Mutha Fukah","Mutha Fuker","Mutha Fukkah","Mutha Fukker","n1gr","nastt","nigger;","nigur;","niiger;","niigr;","orafis","orgasim;","orgasm","orgasum","oriface","orifice","orifiss","packi","packie","packy","paki","pakie","paky","pecker","peeenus","peeenusss","peenus","peinus","pen1s","penas","penis","penis-breath","penus","penuus","Phuc","Phuck","Phuk","Phuker","Phukker","polac","polack","polak","Poonani","pr1c","pr1ck","pr1k","pusse","pussee","pussy","puuke","puuker","queer","queers","queerz","qweers","qweerz","qweir","recktum","rectum","retard","sadist","scank","schlong","screwing","semen","sex","sexy","Sh!t","sh1t","sh1ter","sh1ts","sh1tter","sh1tz","shit","shits","shitter","Shitty","Shity","shitz","Shyt","Shyte","Shytty","Shyty","skanck","skank","skankee","skankey","skanks","Skanky","slut","sluts","Slutty","slutz","son-of-a-bitch","tit","turd","va1jina","vag1na","vagiina","vagina","vaj1na","vajina","vullva","vulva","w0p","wh00r","wh0re","whore","xrated","xxx","b!+ch","bitch","blowjob","clit","arschloch","fuck","shit","ass","asshole","b!tch","b17ch","b1tch","bastard","bi+ch","boiolas","buceta","c0ck","cawk","chink","cipa","clits","cock","cum","cunt","dildo","dirsa","ejakulate","fatass","fcuk","fuk","fux0r","hoer","hore","jism","kawk","l3itch","l3i+ch","lesbian","masturbate","masterbat*","masterbat3","motherfucker","s.o.b.","mofo","nazi","nigga","nigger","nutsack","phuck","pimpis","pusse","pussy","scrotum","sh!t","shemale","shi+","sh!+","slut","smut","teets","tits","boobs","b00bs","teez","testical","testicle","titt","w00se","jackoff","wank","whoar","whore","*damn","*dyke","*fuck*","*shit*","@$$","amcik","andskota","arse*","assrammer","ayir","bi7ch","bitch*","bollock*","breasts","butt-pirate","cabron","cazzo","chraa","chuj","Cock*","cunt*","d4mn","daygo","dego","dick*","dike*","dupa","dziwka","ejackulate","Ekrem*","Ekto","enculer","faen","fag*","fanculo","fanny","feces","feg","Felcher","ficken","fitt*","Flikker","foreskin","Fotze","Fu(*","fuk*","futkretzn","gay","gook","guiena","h0r","h4x0r"," hell ","helvete","hoer*","honkey","Huevon","hui","injun","jizz","kanker*","kike","klootzak","kraut","knulle","kuk","kuksuger","Kurac","kurwa","kusi*","kyrpa*","lesbo","mamhoon","masturbat*","merd*","mibun","monkleigh","mouliewop","muie","mulkku","muschi","nazis","nepesaurio","nigger*","orospu","paska*","perse","picka","pierdol*","pillu*","pimmel","piss*","pizda","poontsee","poop","porn","p0rn","pr0n","preteen","pula","pule","puta","puto","qahbeh","queef*","rautenberg","schaffer","scheiss*","schlampe","schmuck","screw","sh!t*","sharmuta","sharmute","shipal","shiz","skribz","skurwysyn","sphencter","spic","spierdalaj","splooge","suka","b00b*","testicle*","titt*","twat","vittu","wank*","wetback*","wichser","wop*","yed","zabourah"];

  if (substringsArray.some(function(v) { return value.indexOf(v) >= 0; })) {
     logger.log(value)
     logger.log('containsProfanity fail')
    console.log('containsProfanity fail')
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
  body('contactEmail').not().isEmpty().withMessage('please enter an Email address').isEmail().withMessage('Please enter a valid email address'),
  body('contactQuery').not().isEmpty().withMessage('Please enter something in message field.').custom(containsProfanity).withMessage("Please don't use profanity in the message body"),
  body('g-recaptcha-response').not().custom(validCaptcha).withMessage('your not a human')
]

exports.contactus = function(req, res,next){
  var errors = validationResult(req);
  if (!errors.isEmpty()) {
      console.log("errors array");
      console.log(errors.array());
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
      Club.getById(req.body.clubSelect, function(err,rows){
        if (err){
          console.log(err);
          next(err);
        }
        else {
          // msg.to = rows[0].contactUs;
          msg.to = (rows[0].contactUs.indexOf(',') > 0 ? rows[0].contactUs.split(',') : rows[0].contactUs);
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
          msg.to = ['walkerd.sdbl@gmail.com']
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