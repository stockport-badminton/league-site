// The calendar gap-finder (/admin/gap-finder): free nights and valid rearrangement dates
// for a club across both leagues. The data is read live on each view (utils/gapFinder.js);
// the page does the judging in the browser (static/beta/js/gap-finder-core.js).
const GapFinder = require('../utils/gapFinder')
const { canonicalFor } = require('../utils/canonical')

exports.page = async function(req, res, next) {
  try {
    const data = await GapFinder.load()
    // ?fixture=S-123 opens on that match (the rearrangements queue links here).
    const fixture = /^[ST]-\d+$/.test(String(req.query.fixture || '')) ? String(req.query.fixture) : null
    res.render('admin/gap-finder', {
      static_path: '/static',
      pageTitle: 'Gap Finder',
      pageDescription: 'Free nights and rearrangement dates across Stockport and Tameside.',
      canonical: canonicalFor(req),
      data,
      // Inside a <script type="application/json">: `<` escaped so a team name cannot close it.
      dataJson: JSON.stringify(data).replace(/</g, '\\u003c'),
      fixture,
    })
  } catch (err) {
    next(err)
  }
}
