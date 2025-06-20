
var request = require('request');

var SEASON = '';
    if (new Date().getMonth() < 6){
      SEASON = '' + new Date().getFullYear()-1 +'/'+ new Date().getFullYear();
    }
    else {
      SEASON = '' + new Date().getFullYear() +'/'+ (new Date().getFullYear()+1);
    }

exports.privacy_policy = function(req, res) {
    res.render('beta/privacy', {
        static_path: '/static',
        theme: process.env.THEME || 'flatly',
        flask_debug: process.env.FLASK_DEBUG || 'false',
        pageTitle : "Stockport & District Badminton League Privacy Policy",
        pageDescription : "Privacy Policy for the Stockport and District Badminton League",
        canonical:("https://" + req.get("host") + req.originalUrl).replace("www.'","").replace(".com",".co.uk").replace("-badders.herokuapp","-badminton")
    });
}

exports.messer_rules = function(req, res) {
    res.render('beta/messer-rules', {
        static_path: '/static',
        theme: process.env.THEME || 'flatly',
        flask_debug: process.env.FLASK_DEBUG || 'false',
        pageTitle : "Messer Tropy Rules",
        pageDescription : "Rules and regulations around the Stockrt and District Badminton Leagues' cup competition",
        canonical:("https://" + req.get("host") + req.originalUrl).replace("www.'","").replace(".com",".co.uk").replace("-badders.herokuapp","-badminton")
    });
}

exports.get_gallery = function(req, res) {
    var options = {
        'method': 'GET',
        'url': 'https://api.cloudinary.com/v1_1/hvunsveuh/resources/image?max_results=100&context=true&fields=tags,context,url',
        'headers': {
            'Authorization': 'Basic '+process.env.CLOUDINARY_AUTH
        }
    }
    //console.log(options);
    request(options,function(err,response,assets){
        //console.log(options);
        if (err){
            //console.log(err)
            return false
        }
        else{
            // console.log(JSON.parse(response.body).resources);
            let justwebsite = JSON.parse(response.body).resources.filter(asset => asset.tags.some(tag => tag == 'website'))
            let years = [2025,2024,2023,2022,2021]
            let othertags = ["messer","tournament","presentations","other"]
            let galleryObj = {}
            let galleryItem = []
            let yearObj = {}
            for (year of years){
                // console.log(year)
                galleryItems = []
                galleryItem = justwebsite.filter(row => row.tags.some(tag => tag == year))
                for (currTag of othertags){
                    yearObj[currTag] = galleryItem.filter(row => row.tags.some(tag => tag == currTag))
                }
                //console.log(galleryItem)
                galleryObj[year] = yearObj
                yearObj = {}
            }
            res.render('beta/gallery', {
                assets:galleryObj,
                static_path: '/static',
                theme: process.env.THEME || 'flatly',
                flask_debug: process.env.FLASK_DEBUG || 'false',
                pageTitle : "Stockport & District Badminton League Gallery",
                pageDescription : "Photos from the Stockport & District Badminton League presentations, tournaments etc.",
                canonical:("https://" + req.get("host") + req.originalUrl).replace("www.'","").replace(".com",".co.uk").replace("-badders.herokuapp","-badminton")
            });
        }
    })
}

exports.rules = function(req, res) {
    res.render('beta/rules', {
        season:SEASON,
        static_path: '/static',
        theme: process.env.THEME || 'flatly',
        flask_debug: process.env.FLASK_DEBUG || 'false',
        pageTitle : "Stockport & District Badminton League Rules",
        pageDescription : "Rules and regulations for the Stockport and District Badminton League",
        canonical:("https://" + req.get("host") + req.originalUrl).replace("www.'","").replace(".com",".co.uk").replace("-badders.herokuapp","-badminton")
    });
}

exports.upload_scoresheet = function(req,res){
    res.render('beta/file-upload',{
      static_path:'/static',
      theme:process.env.THEME || 'flatly',
      pageTitle : "Upload Scorecard",
      pageDescription : "Enter some results!",
      canonical:("https://" + req.get("host") + req.originalUrl).replace("www.'","").replace(".com",".co.uk").replace("-badders.herokuapp","-badminton")
    })
  };