// robots.txt and llms.txt — with /sitemap.xml (sitemapController.js), the files crawlers and
// AI assistants read before, or instead of, the pages. Generated per request, because what
// they describe changes with the routes and the data, not with a release. Cached for an
// hour, for the reason in sitemapController.js: Firebase's CDN honours max-age and nothing
// purges it on deploy.

const Division = require('../models/division');
const Season = require('../models/season');
const Club = require('../models/club');
const Roster = require('../models/roster');
const robots = require('../utils/robots');
const { absoluteUrl, clubPath, divisionResultsPath, divisionTablePath } = require('../utils/canonical');

const HOUR = 'public, max-age=3600';

exports.robots = function(req, res) {
  res.set('Content-Type', 'text/plain; charset=utf-8');
  res.set('Cache-Control', HOUR);
  res.send(robots.renderRobots(req.app));
};

// ---------------------------------------------------------------------------------------
// GET /llms.txt — the llmstxt.org convention: a short Markdown guide to the site for a
// language model, so it can answer "where does Manor play?" or "where are the league
// tables?" without parsing the pages. Built from the same club query as /clubs/:slug and
// the sitemap, so it cannot drift from what the site says.
//
// Only facts the database or the rules hold; nothing here is marketing. Like the club
// pages, no officer names or contact details: enquiries go through /contact-us.

function seasonLabel(name) {
  const m = /^(\d{4})(\d{4})$/.exec(String(name || ''));
  return m ? m[1] + '/' + m[2].slice(2) : String(name || '');
}

function oneLine(s) {
  return String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
}

exports.llms = async function(req, res, next) {
  try {
    const [divisions, clubs] = await Promise.all([
      Division.getAll(),
      Club.getPublicClubs(Roster.NO_CLUB_ID),
    ]);
    const season = seasonLabel(Season.current());
    const link = (label, path, what) => '- [' + label + '](' + absoluteUrl(path) + '): ' + what;

    const lines = [
      '# Stockport & District Badminton League',
      '',
      '> An amateur inter-club badminton league for clubs in and around Stockport, Greater '
        + 'Manchester, England. The ' + season + ' season has '
        + divisions.length + ' divisions (' + divisions.map((d) => d.name).join(', ') + ') and '
        + clubs.length + ' member clubs.',
      '',
      // From views/rules.ejs (PLAY, b).
      'Each league match is between two teams of three women and three men: three ladies\' '
        + 'doubles, three men\'s doubles and three mixed doubles pairs, each playing two games '
        + 'against the opposing pair of equal rank, so 18 games in all. Tables rank teams on '
        + 'games won. Results, tables and fixtures on this site are updated as scorecards are '
        + 'submitted.',
      '',
      '## Current season',
      '',
      link('League tables', divisionTablePath('All'), 'standings for every division'),
      ...divisions.map((d) => link(d.name + ' table', divisionTablePath(d.name), d.name + ' standings')),
      link('Fixtures and results', divisionResultsPath('All'), 'every match this season, played and to come, with scores'),
      ...divisions.map((d) => link(d.name + ' results', divisionResultsPath(d.name), d.name + ' fixtures and results')),
      link('Fixture calendar', '/calendars/All', 'iCalendar feed of every fixture'),
      link('Messer Trophy', '/messer-rules', 'the league\'s handicapped knockout cup, in two sections; draws at '
        + absoluteUrl('/messer-draw/A') + ' and ' + absoluteUrl('/messer-draw/B')),
      '',
      '## Clubs',
      '',
      'Each club has its own page with its club night, venue, teams and how to get in touch. '
        + 'All clubs: ' + absoluteUrl('/info/clubs') + '. Venues: ' + absoluteUrl('/venues') + '.',
      '',
      ...clubs.map((c) => '- [' + oneLine(c.name) + '](' + absoluteUrl(clubPath(c)) + ')'
        + (c.clubNightText ? ': club night ' + oneLine(c.clubNightText) : '')
        + (c.venueName ? ' at ' + oneLine(c.venueName) : '')
        + (c.venueAddress ? ' (' + oneLine(c.venueAddress) + ')' : '')
        + (c.clubWebsite ? '. Website: ' + oneLine(c.clubWebsite) : '')),
      '',
      link('Junior clubs', '/info/junior-clubs', 'clubs in and around Stockport that run junior sessions'),
      '',
      '## About the league',
      '',
      link('Rules', '/rules', 'the league\'s competition rules'),
      link('History', '/history', 'results and tables from every past season'),
      link('Contact', '/contact-us', 'how to reach the league, or a club'),
      '',
      '## Optional',
      '',
      link('Sitemap', '/sitemap.xml', 'every public page, including one per fixture'),
      link('Privacy policy', '/privacy-policy', 'what the site collects'),
    ];

    res.set('Content-Type', 'text/plain; charset=utf-8');
    res.set('Cache-Control', HOUR);
    res.send(lines.join('\n') + '\n');
  } catch (err) {
    next(err);
  }
};
