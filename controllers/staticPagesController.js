const axios = require('axios');

const year = new Date().getFullYear()
const SEASON = new Date().getMonth() < 7
  ? `${year - 1}/${year}`
  : `${year}/${year + 1}`

exports.privacy_policy = function(req, res) {
  res.render('privacy', {
    static_path: '/static',
    theme: process.env.THEME || 'flatly',
    flask_debug: process.env.FLASK_DEBUG || 'false',
    pageTitle: 'Stockport & District Badminton League Privacy Policy',
    pageDescription: 'Privacy Policy for the Stockport and District Badminton League',
    canonical: ('https://' + req.get('host') + req.originalUrl).replace("www.'", '').replace('.com', '.co.uk').replace('-badders.herokuapp', '-badminton')
  })
}

exports.messer_rules = function(req, res) {
  res.render('messer-rules', {
    static_path: '/static',
    theme: process.env.THEME || 'flatly',
    flask_debug: process.env.FLASK_DEBUG || 'false',
    pageTitle: 'Messer Tropy Rules',
    pageDescription: "Rules and regulations around the Stockrt and District Badminton Leagues' cup competition",
    canonical: ('https://' + req.get('host') + req.originalUrl).replace("www.'", '').replace('.com', '.co.uk').replace('-badders.herokuapp', '-badminton')
  })
}

exports.get_gallery = async function(req, res, next) {
  try {
    const response = await axios.get(
      'https://'+process.env.CLOUDINARY_KEY+':'+process.env.CLOUDINARY_SECRET+'@api.cloudinary.com/v1_1/hvunsveuh/resources/image?max_results=100&context=true&fields=tags,context,url'
    )
    const assets = response.data
    const justwebsite = assets.resources.filter(asset => asset.tags.some(tag => tag == 'website'))
    const years = [2026, 2025, 2024, 2023, 2022, 2021]
    const othertags = ['messer', 'tournament', 'presentations', 'other']
    const galleryObj = {}
    let yearObj = {}
    for (const yr of years) {
      const galleryItem = justwebsite.filter(row => row.tags.some(tag => tag == yr))
      for (const currTag of othertags) {
        yearObj[currTag] = galleryItem.filter(row => row.tags.some(tag => tag == currTag))
      }
      galleryObj[yr] = yearObj
      yearObj = {}
    }
    res.render('gallery', {
      assets: galleryObj,
      static_path: '/static',
      theme: process.env.THEME || 'flatly',
      flask_debug: process.env.FLASK_DEBUG || 'false',
      pageTitle: 'Stockport & District Badminton League Gallery',
      pageDescription: 'Photos from the Stockport & District Badminton League presentations, tournaments etc.',
      canonical: ('https://' + req.get('host') + req.originalUrl).replace("www.'", '').replace('.com', '.co.uk').replace('-badders.herokuapp', '-badminton')
    })
  } catch (err) {
    next(err)
  }
}

exports.rules = function(req, res) {
  res.render('rules', {
    season: SEASON,
    static_path: '/static',
    theme: process.env.THEME || 'flatly',
    flask_debug: process.env.FLASK_DEBUG || 'false',
    pageTitle: 'Stockport & District Badminton League Rules',
    pageDescription: 'Rules and regulations for the Stockport and District Badminton League',
    canonical: ('https://' + req.get('host') + req.originalUrl).replace("www.'", '').replace('.com', '.co.uk').replace('-badders.herokuapp', '-badminton')
  })
}

exports.upload_scoresheet = function(req, res) {
  res.render('file-upload', {
    static_path: '/static',
    theme: process.env.THEME || 'flatly',
    pageTitle: 'Upload Scorecard',
    pageDescription: 'Enter some results!',
    canonical: ('https://' + req.get('host') + req.originalUrl).replace("www.'", '').replace('.com', '.co.uk').replace('-badders.herokuapp', '-badminton')
  })
}
