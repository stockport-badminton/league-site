const sgMail = require('@sendgrid/mail');
var logger = require('logzio-nodejs').createLogger({
  token: process.env.LOGZ_SECRET,
  host: 'listener.logz.io'
});
const { body,validationResult } = require("express-validator/check");
const { sanitizeBody } = require("express-validator/filter");

function validCaptcha(value,{req}){
  var options = {
    method:'POST',
    url:'https://www.google.com/recaptcha/api/siteverify?secret='+ process.env.RECAPTCHA_SECRET +'&response='+value,
    json:true
  }
  request(options,function(err,response,body){
    if (err){
      // console.log(err)
      return false
    }
    else {
      if (body.success){
        // console.log('recaptcha sucess')
        return value
      }
      else {
        // console.log('recaptcha fail')
        return false
      }
    }

  })
}


function containsProfanity(value,{req}){
  var substringsArray = ["Christ","God","http://","http","https","wininphone","corta.co","Cryptocurrency","adultdating","forex","ahole","anus","ash0le","ash0les","asholes","ass","Ass Monkey","Assface","assh0le","assh0lez","asshole","assholes","assholz","asswipe","azzhole","bassterds","bastard","bastards","bastardz","basterds","basterdz","Biatch","bitch","bitches","Blow Job","boffing","butthole","buttwipe","c0ck","c0cks","c0k","Carpet Muncher","cawk","cawks","Clit","cnts","cntz"," cock","cockhead","cock-head","cocks","CockSucker","cock-sucker","crap","cum","cunt","cunts","cuntz","dick","dild0","dild0s","dildo","dildos","dilld0","dilld0s","dominatricks","dominatrics","dominatrix","dyke","enema","f u c k","f u c k e r","fag","fag1t","faget","fagg1t","faggit","faggot","fagit","fags","fagz","faig","faigs","fart","flipping the bird","fuck","fucker","fuckin","fucking","fucks","Fudge Packer","fuk","Fukah","Fuken","fuker","Fukin","Fukk","Fukkah","Fukken","Fukker","Fukkin","g00k","gay","gayboy","gaygirl","gays","gayz","God-damned","h00r","h0ar","h0re","hells","hoar","hoor","hoore","jackoff","jap","japs","jerk-off","jisim","jiss","jizm","jizz","knob","knobs","knobz","kunt","kunts","kuntz","Lesbian","Lezzian","Lipshits","Lipshitz","masochist","masokist","massterbait","masstrbait","masstrbate","masterbaiter","masterbate","masterbates","Motha Fucker","Motha Fuker","Motha Fukkah","Motha Fukker","Mother Fucker","Mother Fukah","Mother Fuker","Mother Fukkah","Mother Fukker","mother-fucker","Mutha Fucker","Mutha Fukah","Mutha Fuker","Mutha Fukkah","Mutha Fukker","n1gr","nastt","nigger;","nigur;","niiger;","niigr;","orafis","orgasim;","orgasm","orgasum","oriface","orifice","orifiss","packi","packie","packy","paki","pakie","paky","pecker","peeenus","peeenusss","peenus","peinus","pen1s","penas","penis","penis-breath","penus","penuus","Phuc","Phuck","Phuk","Phuker","Phukker","polac","polack","polak","Poonani","pr1c","pr1ck","pr1k","pusse","pussee","pussy","puuke","puuker","queer","queers","queerz","qweers","qweerz","qweir","recktum","rectum","retard","sadist","scank","schlong","screwing","semen","sex","sexy","Sh!t","sh1t","sh1ter","sh1ts","sh1tter","sh1tz","shit","shits","shitter","Shitty","Shity","shitz","Shyt","Shyte","Shytty","Shyty","skanck","skank","skankee","skankey","skanks","Skanky","slut","sluts","Slutty","slutz","son-of-a-bitch","tit","turd","va1jina","vag1na","vagiina","vagina","vaj1na","vajina","vullva","vulva","w0p","wh00r","wh0re","whore","xrated","xxx","b!+ch","bitch","blowjob","clit","arschloch","fuck","shit","ass","asshole","b!tch","b17ch","b1tch","bastard","bi+ch","boiolas","buceta","c0ck","cawk","chink","cipa","clits","cock","cum","cunt","dildo","dirsa","ejakulate","fatass","fcuk","fuk","fux0r","hoer","hore","jism","kawk","l3itch","l3i+ch","lesbian","masturbate","masterbat*","masterbat3","motherfucker","s.o.b.","mofo","nazi","nigga","nigger","nutsack","phuck","pimpis","pusse","pussy","scrotum","sh!t","shemale","shi+","sh!+","slut","smut","teets","tits","boobs","b00bs","teez","testical","testicle","titt","w00se","jackoff","wank","whoar","whore","*damn","*dyke","*fuck*","*shit*","@$$","amcik","andskota","arse*","assrammer","ayir","bi7ch","bitch*","bollock*","breasts","butt-pirate","cabron","cazzo","chraa","chuj","Cock*","cunt*","d4mn","daygo","dego","dick*","dike*","dupa","dziwka","ejackulate","Ekrem*","Ekto","enculer","faen","fag*","fanculo","fanny","feces","feg","Felcher","ficken","fitt*","Flikker","foreskin","Fotze","Fu(*","fuk*","futkretzn","gay","gook","guiena","h0r","h4x0r"," hell ","helvete","hoer*","honkey","Huevon","hui","injun","jizz","kanker*","kike","klootzak","kraut","knulle","kuk","kuksuger","Kurac","kurwa","kusi*","kyrpa*","lesbo","mamhoon","masturbat*","merd*","mibun","monkleigh","mouliewop","muie","mulkku","muschi","nazis","nepesaurio","nigger*","orospu","paska*","perse","picka","pierdol*","pillu*","pimmel","piss*","pizda","poontsee","poop","porn","p0rn","pr0n","preteen","pula","pule","puta","puto","qahbeh","queef*","rautenberg","schaffer","scheiss*","schlampe","schmuck","screw","sh!t*","sharmuta","sharmute","shipal","shiz","skribz","skurwysyn","sphencter","spic","spierdalaj","splooge","suka","b00b*","testicle*","titt*","twat","vittu","wank*","wetback*","wichser","wop*","yed","zabourah"];

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
      switch (req.body.clubSelect) {
        case 'Aerospace':
          msg.to = ['santanareedy@btinternet.com'];
        break;
        case 'Alderley Park':
          msg.to = ['mel.curwen@ntlworld.com'];

        break;
        case 'Altrincham Central':
          msg.to = ['janecave53@gmail.com'];

        break;
        case 'Bramhall Village':
          msg.to = ['jjackson1969@btinternet.com'];

        break;
        case 'CAP':
          msg.to = ['dave_haigh@hotmail.co.uk'];

        break;
        case 'Canute':
          msg.to = ['canutesecretary@gmail.com'];

        break;
        case 'Carrington':
          msg.to = ['darrel@thegoughfamily.co.uk'];

        break;
        case 'Cheadle Hulme':
          msg.to = ['doug.grant@ntlworld.com'];

        break;
        case 'College Green':
          msg.to = ['paulakite@yahoo.co.uk'];

        break;
        case 'David Lloyd':
          msg.to = ['dr_barks@yahoo.co.uk'];

        break;
        case 'Disley':
          msg.to = ['julian.cherryman@gmail.com','karlcramp@aol.com'];

        break;
        case 'Dome':
          msg.to = ['janet_knowles@ymail.com'];

        break;
        case 'G.H.A.P':
          msg.to = ['rossowen40@hotmail.com'];

        break;
        case 'Macclesfield':
          msg.to = ['sueorwin@btinternet.com'];

        break;
        case 'Manor':
          msg.to = ['jo.woolley@tiscali.co.uk'];

        break;
        case 'Mellor':
          msg.to = ['enquiries@mellorbadminton.org.uk'];

        break;
        case 'New Mills':
          msg.to = ['bandibates@tiscali.co.uk'];

        break;
        case 'Parrswood':
          msg.to = ['mikegreatorex@btinternet.com'];

        break;
        case 'Poynton':
          msg.to = ['poyntonbadminton@btinternet.com'];

        break;
        case 'Racketeer':
          msg.to = ['theracketeer@hotmail.com'];

        break;
        case 'Shell':
          msg.to = ['annawiza@aol.co.uk'];

        break;
        case 'Syddal Park':
          msg.to = ['derek.hillesdon@gmail.com'];

        break;
        case 'Tatton':
          msg.to = ['plumley123@btinternet.com'];

        break;
        case 'Blue Triangle':
          msg.to = ['francesedavies@sky.com'];

        break;
        default:
          msg.to = ['stockport.badders.results@gmail.com'];

      }
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

exports.contactus_get = function(req, res) {
  res.render('beta/contact-us-form', {
      static_path: '/static',
      theme: process.env.THEME || 'flatly',
      flask_debug: process.env.FLASK_DEBUG || 'false',
      pageTitle : "Contact Us",
      pageDescription : "Get in touch with your league representatives, or club secretaries",
      recaptcha : process.env.RECAPTCHA
  });
}