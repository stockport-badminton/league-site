// Every superadmin tool, grouped — the /admin hub is built from this list.
//
// The Admin dropdown used to list all of them: 23 items for a superadmin, and the navbar
// is `fixed-top`, so a dropdown longer than the window cannot be scrolled — the newest
// entries were literally out of reach on a laptop screen. The dropdown now carries only
// the pages used every week (NAV_SHORTLIST, picked from 30 days of Cloud Run request
// logs, 28 Sep 2026: Team Management ~280 views, Club Admin ~53, Registration Forms 50;
// most of the rest 0–5) and "All admin tools…", which is this list.
//
// One list rather than a hand-written page so a new tool is added in one place, and
// __tests__/unit/admin-tools.test.js checks that every href here has a route.

const GROUPS = [
  {
    title: 'Players & teams',
    tools: [
      { href: '/manage-players', label: 'Team Management', blurb: 'Every club\'s squads — reorder, move, add and release players.' },
      { href: '/admin/player-requests', label: 'Registration Requests', blurb: 'Registration emails forwarded to registrations@, waiting to be processed.', count: 'pendingRequests' },
      { href: '/admin/registrations', label: 'Registration Forms', blurb: 'Which clubs have returned this season\'s registration form; chase the rest.', count: 'formsOutstanding' },
      { href: '/admin/clubs', label: 'Club Admin', blurb: 'Add and edit clubs.' },
      { href: '/admin/teams', label: 'Team Admin', blurb: 'Teams and their divisions — promote, relegate, withdraw, reinstate.' },
    ],
  },
  {
    title: 'Results & stats',
    tools: [
      { href: '/fixture-players', label: 'Fixture Players', blurb: 'Who played in each fixture.' },
      { href: '/missed-three', label: 'Missed Three', blurb: 'Players who have missed three matches.' },
      { href: '/player-stats', label: 'Individual Stats', blurb: 'Per-player results and ratings.' },
      { href: '/pair-stats', label: 'Pair Stats', blurb: 'How each pairing has done together.' },
    ],
  },
  {
    title: 'Messer',
    tools: [
      { href: '/messer-results', label: 'Messer Results', blurb: 'Approve or reject submitted Messer results.' },
      { href: '/admin/messer-bracket', label: 'Messer Bracket Setup', blurb: 'Set up the Messer knockout bracket.' },
    ],
  },
  {
    title: 'Social',
    tools: [
      { href: '/admin/social/weekly-tables', label: 'Weekly Tables Post', blurb: 'Saturday\'s league tables — preview the cards and captions.' },
      { href: '/admin/social/weekly-fixtures', label: 'Weekly Fixtures Post', blurb: 'Sunday\'s coming-week fixtures.' },
      { href: '/admin/social/weekly-video', label: 'Weekly Video Post', blurb: 'The weekly results video.' },
      { href: '/admin/threads', label: 'Threads', blurb: 'Connect or refresh the Threads account.' },
    ],
  },
  {
    title: 'Site',
    tools: [
      { href: '/admin/homepage-content', label: 'Homepage Content', blurb: 'News items on the homepage.' },
      { href: '/admin/site-settings', label: 'Site Settings', blurb: 'The Cloudinary tag behind the homepage Messer gallery.' },
      { href: '/admin/spam', label: 'Spam Controls', blurb: 'Block an address, IP or phrase; see what the filters caught.' },
    ],
  },
  {
    title: 'League office',
    tools: [
      { href: '/admin/audit', label: 'Data Health', blurb: 'The weekly data-integrity checks, run now.' },
      { href: '/admin/invoices', label: 'Annual Invoices', blurb: 'Send the clubs\' annual invoices.' },
    ],
  },
];

// The superadmin's dropdown, in order. Everything else is one click further, on /admin.
const NAV_SHORTLIST = ['/manage-players', '/admin/player-requests', '/admin/registrations', '/admin/clubs', '/admin/audit'];

const byHref = new Map()
GROUPS.forEach(g => g.tools.forEach(t => byHref.set(t.href, t)))

function shortlist() {
  return NAV_SHORTLIST.map(href => byHref.get(href))
}

module.exports = { GROUPS, NAV_SHORTLIST, shortlist }
