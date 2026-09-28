// The Admin dropdown builds three links from the user's club claim. That claim is a
// club name for an admin, but the literal string 'All' for a superadmin (see the
// Auth0 strategy in app.js), who has no single club — so building the links
// unconditionally handed the superadmin /manage-players/club-All and
// /forms/{team,club}-registration/All/prefilled, none of which can resolve. The
// registration pair was Sentry NODE-S, and all four events were the superadmin
// clicking their own nav.
//
// Rendering the partial directly rather than booting the app: this is about what the
// template emits for a given claim, and it lets the admin case be exercised without
// a real Auth0 login.

const ejs = require('ejs');
const fs = require('fs');
const path = require('path');

const NAV = path.join(__dirname, '../../views/nav.ejs');
const { shortlist: adminNavShortlist, GROUPS } = require('../../utils/adminTools');
const CLUB_CLAIM = 'https://my-app.example.com/club';
const ROLE_CLAIM = 'https://my-app.example.com/role';

function renderNav(club, role, extra = {}) {
  const user = {
    _json: {
      [ROLE_CLAIM]: role,
      [CLUB_CLAIM]: club,
      'https://my-app.example.com/messeradmin': !!extra.messeradmin,
    },
  };
  // adminNavShortlist is an app.local in the real app.
  const locals = Object.assign({ user }, extra.locals || {});
  return ejs.render(fs.readFileSync(NAV, 'utf8'),
    { user, locals, pastSeasons: [], static_path: '/static', adminNavShortlist },
    { filename: NAV });
}

const adminItems = html => {
  const menu = html.slice(html.lastIndexOf('dropdown-menu'));
  return (menu.match(/class="dropdown-item[^"]*"/g) || []).length;
};

// The navbar is fixed-top, so a dropdown taller than the window cannot be scrolled:
// at 23 items the superadmin's newest tools were out of reach on a laptop.
describe('the superadmin Admin menu', () => {
  it('stays short, and links to the hub for everything else', () => {
    const html = renderNav('All', 'superadmin');
    expect(adminItems(html)).toBeLessThanOrEqual(10);
    expect(html).toContain('href="/admin"');
  });

  it('keeps every tool reachable, from the menu or the hub', () => {
    const html = renderNav('All', 'superadmin');
    const onHub = GROUPS.flatMap(g => g.tools.map(t => t.href));
    for (const href of ['/manage-players', '/admin/player-requests', '/admin/registrations', '/admin/clubs', '/admin/audit']) {
      expect(html).toContain('href="' + href + '"');
    }
    expect(onHub).toEqual(expect.arrayContaining([
      '/missed-three', '/fixture-players', '/player-stats', '/pair-stats', '/admin/teams',
      '/admin/homepage-content', '/admin/site-settings', '/admin/spam', '/admin/invoices',
      '/admin/social/weekly-tables', '/admin/social/weekly-fixtures', '/admin/social/weekly-video',
      '/admin/threads', '/messer-results', '/admin/messer-bracket',
    ]));
  });

  it('lists the Messer pages once for a superadmin who is also a messer admin', () => {
    const html = renderNav('All', 'superadmin', { messeradmin: true });
    expect(html.match(/href="\/messer-results"/g)).toHaveLength(1);
  });

  it('shows the pending count on Registration Requests, and nothing at zero', () => {
    expect(renderNav('All', 'superadmin', { locals: { navPendingRequests: 3 } }))
      .toMatch(/Registration Requests <span class="badge badge-warning">3<\/span>/);
    expect(renderNav('All', 'superadmin', { locals: { navPendingRequests: 0 } }))
      .not.toMatch(/Registration Requests <span/);
  });

  it('gives a club admin none of it', () => {
    const html = renderNav('Shell', 'admin');
    expect(html).not.toContain('href="/admin"');
    expect(html).not.toContain('/admin/player-requests');
  });
});

describe('nav club links', () => {
  it('gives an admin the prefilled forms for their own club', () => {
    const html = renderNav('Shell', 'admin');
    expect(html).toContain('/manage-players/club-Shell');
    expect(html).toContain('/forms/team-registration/Shell/prefilled.docx');
    expect(html).toContain('/forms/club-registration/Shell/prefilled');
  });

  it('never builds a link from the literal claim "All"', () => {
    const html = renderNav('All', 'superadmin');
    expect(html).not.toContain('club-All');
    expect(html).not.toContain('/All/prefilled');
    expect(html).not.toMatch(/prefilled/);
  });

  it('does not duplicate the blank forms into the Admin dropdown', () => {
    // They are already in Useful Links, which every user sees.
    const html = renderNav('All', 'superadmin');
    expect(html.match(/href="\/forms\/club-registration"/g)).toHaveLength(1);
    // Team registration is the editable Word version now — the PDF routes still
    // answer for old links, but nothing points at them.
    expect(html.match(/href="\/forms\/team-registration\.docx"/g)).toHaveLength(1);
    expect(html).not.toMatch(/href="\/forms\/team-registration"/);
  });

  it('falls back safely when the claim is missing entirely', () => {
    const html = renderNav(undefined, 'admin');
    expect(html).not.toContain('club-undefined');
    expect(html).not.toContain('/undefined/prefilled');
    expect(html).not.toMatch(/prefilled/);
  });
});
