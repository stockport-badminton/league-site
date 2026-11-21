// GET /robots.txt, built from the route table rather than written by hand (Nov 2026; the
// same change Tameside made in 78caf40).
//
// The rule: anything that needs a login, a token, a cron token or is dev-only is not for
// crawlers. Every route declares who may call it as its first middleware
// (middleware/access.js), so the Disallow list is DERIVED from those declarations: add a
// `member` route and it is disallowed without anyone remembering to edit this file. The
// test (__tests__/integration/crawlers.test.js) checks both directions against the real
// router: every non-public GET is blocked, and no public GET is blocked by accident.
//
// What it replaced: rootfiles/robots.txt, a 3,557-line per-bot blocklist (1,774 user
// agents) copied in years ago, with no `User-agent: *` group. Among its entries was CCBot —
// Common Crawl, one of the main corpora AI models learn from — so the league was opted out
// of exactly the thing that gets it known to ChatGPT, Claude and friends. Most of the rest
// were SEO scrapers that ignore robots.txt anyway. The file had to go, not just be ignored:
// `express.static('rootfiles')` is mounted before the router and would shadow this route.
//
// Why wildcards, not prefixes. Robots rules are prefix matches, and a route's literal
// prefix is often shared with a public route: `/club/:id` needs a login but every
// `/clubs/:slug` page is public, and `/club` would block them all. Each parameter becomes
// `*` instead (`/club/`, `/player/*/update`). `*` and `$` are in RFC 9309 and honoured by Google, Bing, OpenAI,
// Anthropic and Common Crawl.
//
// `X-Robots-Tag: noindex` on the same responses is the other half — see access.js.

const { routeTable } = require('./routeTable');
const { absoluteUrl } = require('./canonical');

// Public routes that are still not worth a crawl, with the reason. Everything else that is
// disallowed comes from the route table.
const EXTRA_DISALLOW = [
  ['/login', 'starts the Auth0 round trip'],
  ['/callback', 'Auth0 returns here'],
  ['/logout', 'ends a session'],
  ['/api/', 'JSON for the pages\' own scripts, not pages'],
  ['/sign-s3', 'hands out an upload URL'],
  ['/health', 'the uptime check (and /healthz)'],
  ['/offline-home', 'the PWA\'s cached homepage, a duplicate of /'],
  ['/eligiblePlayers/', 'JSON for the scorecard form'],
  ['/tables-social', 'a page rendered only to be screenshotted for Facebook'],
  ['/tournament-social', 'a page rendered only to be screenshotted for Facebook'],
  ['/handicap-tournament-social', 'a page rendered only to be screenshotted for Facebook'],
];

// Named on purpose, so it is obvious from the file that they are welcome. They share the
// `*` group's rules (consecutive User-agent lines form one group), so nothing has to be
// restated per bot.
const WELCOME = [
  'Googlebot', 'Bingbot', 'Applebot', 'DuckDuckBot',
  'GPTBot', 'OAI-SearchBot', 'ChatGPT-User',
  'ClaudeBot', 'Claude-SearchBot', 'Claude-User',
  'PerplexityBot', 'Perplexity-User', 'Google-Extended', 'CCBot',
];

// An Express path pattern as a robots rule: each parameter is `*`, and trailing wildcards
// are dropped because a rule is already a prefix match.
function ruleFor(routePath) {
  if (typeof routePath !== 'string') {
    throw new Error('robots: cannot derive a rule from a non-string route path ' + routePath);
  }
  return routePath
    .replace(/:\w+(\([^)]*\))?\??/g, '*')
    .replace(/\*+/g, '*')
    .replace(/(\/?\*)+$/, (m) => (m.startsWith('/') ? '/' : ''));
}

// A rule with no wildcard covers every rule that starts with it.
function collapse(rules) {
  const sorted = [...new Set(rules)].sort((a, b) => a.length - b.length || a.localeCompare(b));
  const kept = [];
  for (const r of sorted) {
    if (!kept.some((k) => !k.includes('*') && r.startsWith(k))) kept.push(r);
  }
  return kept.sort();
}

// A gated literal route that a public route extends is anchored with `$`: `/clubs` (the raw
// club JSON, superadmin) as a plain rule would be a prefix of every public `/clubs/<name>`
// page and take them all out of search. Found in Nov 2026, when `/clubs` was first gated.
function disallowRules(app) {
  const table = routeTable(app).filter((r) => r.method === 'GET');
  const publicRules = table.filter((r) => r.access === 'public').map((r) => ruleFor(r.path));
  const gated = table
    .filter((r) => r.access && r.access !== 'public')
    .map((r) => ruleFor(r.path))
    .map((rule) => (!rule.includes('*') && publicRules.some((p) => p !== rule && p.startsWith(rule)) ? rule + '$' : rule));
  return collapse([...gated, ...EXTRA_DISALLOW.map(([p]) => p)]);
}

// RFC 9309 matching, Disallow-only: does any rule match the start of the url?
function isDisallowed(rules, url) {
  return rules.some((rule) => {
    const anchored = rule.endsWith('$');
    const body = (anchored ? rule.slice(0, -1) : rule)
      .split('*')
      .map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
      .join('.*');
    return new RegExp('^' + body + (anchored ? '$' : '')).test(url);
  });
}

function renderRobots(app) {
  const lines = [
    '# Stockport & District Badminton League. Generated from the route table (utils/robots.js):',
    '# everything that needs a login is disallowed, everything public is open.',
    '# A plain-text guide to the site for language models: ' + absoluteUrl('/llms.txt'),
    '',
    ...WELCOME.map((ua) => 'User-agent: ' + ua),
    'User-agent: *',
    ...disallowRules(app).map((r) => 'Disallow: ' + r),
    '',
    'Sitemap: ' + absoluteUrl('/sitemap.xml'),
  ];
  return lines.join('\n') + '\n';
}

module.exports = { ruleFor, collapse, disallowRules, isDisallowed, renderRobots, EXTRA_DISALLOW, WELCOME };
